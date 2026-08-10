import 'server-only'
import { NextResponse } from 'next/server'
import { conEmpresa } from '@/lib/tenant'
import { anotarFallo } from '@/lib/prisma-errors'
import { errorApi, type CodigoError } from '@/modules/plataforma/errores'
import {
  EN_CURSO,
  VIGENCIA_MS,
  decidirClave,
  huellaDe,
} from '@/modules/plataforma/idempotencia-nucleo'

/**
 * PLATAFORMA · Fase 3 — IDEMPOTENCIA DE LAS ESCRITURAS.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL PROBLEMA, EN UNA FRASE
 *
 * Un reintento de red sobre un canje consume el beneficio dos veces, y el
 * satélite **no puede distinguir «no llegó» de «llegó y se perdió la
 * respuesta»**. Desde su lado las dos cosas se ven igual: un timeout.
 *
 * Sin idempotencia solo hay dos opciones, y las dos son malas: reintentar
 * —y a veces cobrar dos veces— o no reintentar —y a veces perder la operación—.
 * La clave de idempotencia es lo que convierte esa ambigüedad en una respuesta
 * repetible: la misma llamada con la misma clave devuelve LA MISMA respuesta,
 * sin volver a ejecutar nada.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * REPETIR NO ES LO MISMO QUE CAMBIAR
 *
 * Se guarda el SHA-256 del cuerpo. Con eso:
 *
 *   misma clave + mismo cuerpo   → la respuesta guardada (es un reintento)
 *   misma clave + cuerpo distinto → 400 IDEMPOTENCY_KEY_REUSED
 *
 * El segundo caso es un error del cliente, casi siempre una clave derivada de
 * algo que no identifica la operación (la fecha, el id de mesa). Aceptarlo en
 * silencio devolvería la respuesta de OTRA operación como si fuera la de esta —
 * un fallo que se lee como un acierto, y el peor sitio para tener uno.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DOS LLAMADAS A LA VEZ
 *
 * La reserva se hace con un INSERT sobre un índice único: si dos peticiones
 * idénticas entran en el mismo milisegundo, una gana y la otra choca. La que
 * pierde NO ejecuta: espera a leer la respuesta de la ganadora. Comprobar
 * primero y escribir después dejaría una ventana en la que las dos leen «no
 * existe» y las dos canjean.
 */

export type ResultadoIdempotente =
  /** Ejecuta y llama a `guardar` con lo que salga. */
  | { modo: 'EJECUTAR'; guardar: (estado: number, cuerpo: unknown) => Promise<void> }
  /** Ya se hizo: devuelve esto tal cual. */
  | { modo: 'REPETIDA'; respuesta: NextResponse }
  /** No se puede continuar (clave reutilizada, o la primera sigue en curso). */
  | { modo: 'RECHAZAR'; respuesta: NextResponse }

/**
 * Reserva la clave, o devuelve lo que ya se respondió.
 *
 * `clave` es la que manda el satélite en `Idempotency-Key`. Sin ella no hay
 * protección posible y quien llama decide si eso es un error (para una
 * escritura, lo es).
 */
export async function conIdempotencia(args: {
  sistemaId: string
  companyId: string
  clave: string
  endpoint: string
  cuerpo: string
  requestId: string
}): Promise<ResultadoIdempotente> {
  const { sistemaId, companyId, clave, endpoint, requestId } = args
  const huella = huellaDe(args.cuerpo)

  const negar = (code: CodigoError, message: string) => ({
    modo: 'RECHAZAR' as const,
    respuesta: errorApi(code, requestId, { message }),
  })

  // Reserva optimista: el índice único (sistemaId, clave) es el que arbitra.
  const reservada = await conEmpresa(companyId, (tx) =>
    tx.claveIdempotencia.create({
      data: {
        sistemaId,
        clave,
        companyId,
        endpoint,
        huellaPeticion: huella,
        estadoHttp: EN_CURSO,
        respuesta: {},
        expiraAt: new Date(Date.now() + VIGENCIA_MS),
      },
      select: { id: true },
    })
  ).catch(() => null)

  if (reservada) {
    return {
      modo: 'EJECUTAR',
      async guardar(estado: number, cuerpoRespuesta: unknown) {
        await conEmpresa(companyId, (tx) =>
          tx.claveIdempotencia.update({
            where: { id: reservada.id },
            data: { estadoHttp: estado, respuesta: cuerpoRespuesta as object },
          })
        ).catch(anotarFallo('platform-api:idempotencia-guardar', { clave }))
      },
    }
  }

  // No se pudo reservar: o ya existe, o la base falló. Se distingue leyendo.
  const previa = await conEmpresa(companyId, (tx) =>
    tx.claveIdempotencia.findUnique({
      where: { sistemaId_clave: { sistemaId, clave } },
      select: { endpoint: true, huellaPeticion: true, estadoHttp: true, respuesta: true },
    })
  ).catch(() => null)

  if (!previa) {
    return negar('INTERNAL_ERROR', 'Could not reserve the idempotency key. Retry.')
  }

  const veredicto = decidirClave(previa, endpoint, huella)

  if (veredicto === 'REUSADA') {
    return negar(
      'IDEMPOTENCY_KEY_REUSED',
      'This Idempotency-Key was already used with a different request. Use a new key per operation.'
    )
  }

  if (veredicto === 'EN_CURSO') {
    // La primera todavía está trabajando. 409 y no una espera: bloquear aquí
    // ataría dos peticiones a la misma transacción y multiplicaría el problema
    // que la clave venía a resolver.
    return negar(
      'IDEMPOTENCY_IN_PROGRESS',
      'An identical request is still in progress. Retry in a moment.'
    )
  }

  // Se repite el ESTADO guardado, no un 200.
  //
  // Esto se descubrió probándolo: `respuestaApi` siempre responde 200, así que
  // el reintento de un canje RECHAZADO —«sin usos»— devolvía 200 con un cuerpo
  // de error dentro. Un satélite que mira el código HTTP habría concluido que
  // el canje funcionó, y le habría dado al cliente un beneficio que MembeGo
  // acababa de negarle. Un fallo que se lee como un acierto.
  return {
    modo: 'REPETIDA',
    respuesta: repetir(previa.respuesta, previa.estadoHttp, requestId),
  }
}

/**
 * Devuelve una respuesta guardada tal cual: mismo cuerpo, mismo código.
 *
 * `X-Idempotent-Replay` deja claro en los logs del satélite que esa respuesta
 * no ejecutó nada. Sin la cabecera, un canje y su reintento son indistinguibles
 * al revisar un incidente.
 */
function repetir(cuerpo: unknown, estado: number, requestId: string): NextResponse {
  return NextResponse.json(cuerpo, {
    status: estado,
    headers: {
      'X-Request-Id': requestId,
      'X-Idempotent-Replay': 'true',
      'Cache-Control': 'no-store',
    },
  })
}

/**
 * Purga las claves caducadas (cron). Guardarlas para siempre convertiría una
 * tabla operativa en un archivo histórico de todas las operaciones de todos los
 * satélites — con sus respuestas dentro.
 */
export async function purgarClavesIdempotencia(companyId: string): Promise<number> {
  const r = await conEmpresa(companyId, (tx) =>
    tx.claveIdempotencia.deleteMany({ where: { expiraAt: { lte: new Date() } } })
  ).catch(() => ({ count: 0 }))
  return r.count
}
