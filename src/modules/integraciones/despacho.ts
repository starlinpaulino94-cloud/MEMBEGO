import 'server-only'
import { conEmpresa, sinEmpresa, type Tx } from '@/lib/tenant'
import { anotarFallo } from '@/lib/prisma-errors'
import { getPlatformEventPrivateKey } from '@/lib/env'
import { firmarHmac, EVENTOS_REENVIADOS } from '@/modules/integraciones/nucleo'
import { sistemasDeEmpresa } from '@/modules/plataforma/registro'
import { construirSobre, cuerpoDelSobre } from '@/modules/plataforma/eventos'
import {
  CABECERA_EVENTO,
  CABECERA_FIRMA,
  CABECERA_TIMESTAMP,
  clavePrivadaDesde,
  firmarEd25519,
} from '@/modules/plataforma/firma'
import { agotoLosIntentos } from '@/modules/integraciones/reintentos'
import { programarReintento } from '@/modules/integraciones/programador'

/**
 * DESPACHO DE EVENTOS a los sistemas satélite conectados.
 *
 * Patrón outbox: el evento queda registrado en `eventos_salientes` ANTES de
 * intentar enviarlo — si el satélite está caído no se pierde nada.
 *
 * CADENCIA (auditoría A-1): cada fallo programa SU siguiente intento en la cola
 * con espera creciente (30 s → 24 h, `modules/integraciones/reintentos.ts`). El
 * cron pasa de ser quien reintenta a ser la red de seguridad. Antes, el único
 * reintento era el barrido diario: un satélite que se reiniciaba medio minuto
 * le costaba a su cliente un día entero de retraso, y agotar los ocho intentos
 * llevaba ocho días.
 *
 * AISLAMIENTO (regla de oro): cada evento lleva el companyId de UNA empresa y
 * solo va a los sistemas que ESA empresa tiene habilitados
 * (`modules/plataforma/registro`). El satélite jamás recibe datos de empresas
 * que no lo usan — antes bastaba con compartir categoría, ahora hace falta la
 * habilitación, que es más estrecho y nunca más ancho.
 *
 * FIRMA (Fase 3): salen las DOS. `X-Membego-Firma` es el HMAC de siempre;
 * `X-Membego-Signature` es Ed25519 sobre `timestamp.eventId.cuerpo`. Cambiar de
 * una a otra de golpe exigiría que Core y satélites desplegaran el mismo
 * minuto; con las dos juntas, cada satélite migra cuando puede.
 *
 * CUERPO (Fase 3): el sobre v2 con las claves del formato anterior duplicadas
 * dentro. Un satélite que hoy lee `tipo` y `payload` sigue funcionando sin
 * desplegar nada — y con Car Wash en producción eso no es una comodidad, es la
 * diferencia entre un despliegue y una parada.
 */

const TIMEOUT_MS = 10_000

/** Estado terminal del outbox: ya no se reintenta solo; alguien tiene que mirar. */
const DESCARTADO = 'DEAD_LETTER'

interface EventoParaEnviar {
  companyId: string
  tipo: string
  subjectId?: string | null
  payload?: Record<string, unknown>
  /** Hilo de la operación. Sin él, cada evento es su propio hilo. */
  traceId?: string | null
}

/**
 * La clave se parsea UNA vez por proceso y no en cada envío: `createPrivateKey`
 * no es gratis y el cron manda cien eventos seguidos.
 */
let clavePrivada: ReturnType<typeof clavePrivadaDesde> | undefined
function claveEventos() {
  if (clavePrivada === undefined) clavePrivada = clavePrivadaDesde(getPlatformEventPrivateKey())
  return clavePrivada
}

/**
 * Sistemas que la empresa tiene habilitados Y que reciben webhooks.
 *
 * `excluirSlug` quita del reparto al satélite que PROVOCÓ el evento. No es un
 * ahorro: un satélite que canjea por la API ya tiene la respuesta síncrona, y
 * devolverle por webhook la noticia de su propia acción es un eco. Una
 * implementación ingenua lo trata como un evento nuevo, actúa otra vez y vuelve
 * a llamarnos — un bucle que solo se nota cuando ya se ha multiplicado.
 */
async function sistemasDestino(
  companyId: string,
  excluirSlug?: string | null
): Promise<{ id: string; urlWebhook: string; secreto: string }[]> {
  try {
    const sistemas = await sistemasDeEmpresa(companyId, { conSecreto: true })
    return sistemas
      .filter((s) => s.urlWebhook !== null && s.secreto !== undefined)
      .filter((s) => !excluirSlug || s.slug !== excluirSlug)
      .map((s) => ({ id: s.id, urlWebhook: s.urlWebhook!, secreto: s.secreto! }))
  } catch {
    return []
  }
}

/**
 * Slug del satélite que provocó el evento, si lo hubo.
 *
 * Viaja dentro del payload y no como columna porque el evento cruza el bus de
 * automatizaciones (`AutomationEvent`), cuyo `payload` es Json: añadir una
 * columna allí para un dato de integración sería meter la plataforma dentro del
 * motor de reglas.
 */
function sistemaOrigenDe(payload: Record<string, unknown> | undefined): string | null {
  const v = payload?.sistemaOrigen
  return typeof v === 'string' && v ? v : null
}

/** POST firmado al satélite. Devuelve null si llegó, o el error si no. */
async function entregar(
  urlWebhook: string,
  secreto: string,
  cuerpo: string,
  eventId: string
): Promise<string | null> {
  const timestamp = Math.floor(Date.now() / 1000)
  const ed25519 = firmarEd25519(claveEventos(), timestamp, eventId, cuerpo)

  try {
    const resp = await fetch(urlWebhook, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // La de siempre. Se retira cuando ningún satélite la use.
        'X-Membego-Firma': firmarHmac(secreto, cuerpo),
        [CABECERA_TIMESTAMP]: String(timestamp),
        [CABECERA_EVENTO]: eventId,
        ...(ed25519 ? { [CABECERA_FIRMA]: ed25519 } : {}),
      },
      body: cuerpo,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (resp.ok) return null
    // El código solo no alcanza: un 404 de la plataforma de alojamiento («el
    // dominio no apunta a nada») y un 404 de la aplicación («falta la ruta»)
    // se arreglan en sitios distintos, y sin el cuerpo son indistinguibles.
    const detalle = (await resp.text().catch(() => '')).trim().replace(/\s+/g, ' ')
    return detalle ? `HTTP ${resp.status} · ${detalle.slice(0, 200)}` : `HTTP ${resp.status}`
  } catch (e) {
    return e instanceof Error ? e.message : 'fetch falló'
  }
}

function cuerpoDe(evento: {
  id: string
  companyId: string
  tipo: string
  payload: unknown
  createdAt: Date
  traceId?: string | null
}): string {
  return cuerpoDelSobre(construirSobre(evento))
}

/**
 * ANOTA CÓMO FUE UN INTENTO y programa el siguiente si lo hay.
 *
 * Es el único sitio que escribe el resultado de una entrega a satélite — lo
 * llaman el envío inmediato, el barrido del cron y el trabajo de la cola—. Que
 * sea uno solo es lo que hace imposible que un fallo quede anotado sin su
 * reintento programado.
 *
 * `enCron` elige el modo de acceso y no es cosmético: el envío inmediato ocurre
 * dentro del contexto de UNA empresa y va con `conEmpresa`; el barrido y la
 * cola cruzan inquilinos por definición y van con `sinEmpresa` y su motivo,
 * como exige `lib/tenant.ts`. Pasar por `sinEmpresa` en el camino caliente
 * sería aflojar el aislamiento para ahorrarse un parámetro.
 */
async function anotarResultado(input: {
  companyId: string
  eventoId: string
  intentos: number
  /** El error de la entrega, o null si llegó. */
  error: string | null
  enCron: boolean
}): Promise<void> {
  // Null en `fecha` = se agotaron los intentos. Se pregunta al programador en
  // vez de comparar contra el máximo aquí: dos sitios decidiendo cuándo muere
  // un evento acaban decidiendo cosas distintas.
  const proximo = input.error
    ? await programarReintento({
        cola: 'satelite',
        entregaId: input.eventoId,
        companyId: input.companyId,
        intentos: input.intentos,
      })
    : null

  const data = input.error
    ? {
        intentos: input.intentos,
        ultimoError: input.error.slice(0, 300),
        proximoIntentoAt: proximo?.fecha ?? null,
        ...(proximo?.fecha ? {} : { estado: DESCARTADO }),
      }
    : {
        estado: 'ENVIADO',
        intentos: input.intentos,
        enviadoAt: new Date(),
        proximoIntentoAt: null,
      }

  const escribir = (tx: Tx) =>
    tx.eventoSaliente.update({ where: { id: input.eventoId }, data })

  await (input.enCron
    ? sinEmpresa('integraciones: marcar evento tras intento (cron/cola global)', escribir)
    : conEmpresa(input.companyId, escribir)
  ).catch(anotarFallo('integraciones:marcar', { id: input.eventoId }))
}

/**
 * Registra el evento en el outbox de cada sistema destino y hace UN intento
 * de entrega inmediata. Best-effort: nunca lanza — el bus de negocio no puede
 * romperse por un satélite caído.
 */
export async function reenviarEventoASistemas(evento: EventoParaEnviar): Promise<void> {
  try {
    if (!(EVENTOS_REENVIADOS as readonly string[]).includes(evento.tipo)) return
    const sistemas = await sistemasDestino(evento.companyId, sistemaOrigenDe(evento.payload))
    if (sistemas.length === 0) return

    for (const sistema of sistemas) {
      const fila = await conEmpresa(evento.companyId, (tx) =>
        tx.eventoSaliente.create({
          data: {
            sistemaId: sistema.id,
            companyId: evento.companyId,
            tipo: evento.tipo,
            traceId: evento.traceId ?? null,
            payload: {
              ...(evento.payload ?? {}),
              ...(evento.subjectId ? { clienteId: evento.subjectId } : {}),
            } as object,
          },
        })
      ).catch(anotarFallo('integraciones:outbox', { tipo: evento.tipo }))
      if (!fila) continue

      const error = await entregar(sistema.urlWebhook, sistema.secreto, cuerpoDe(fila), fila.id)
      await anotarResultado({
        companyId: evento.companyId,
        eventoId: fila.id,
        intentos: 1,
        error,
        enCron: false,
      })
    }
  } catch (e) {
    console.error('[integraciones] reenviar evento:', e)
  }
}

/** Un evento del outbox, tal como lo necesitan el barrido y el reintento. */
interface FilaEvento {
  id: string
  companyId: string
  sistemaId: string
  tipo: string
  payload: unknown
  intentos: number
  createdAt: Date
  traceId: string | null
}

/**
 * UN intento sobre UN evento, con el destino resuelto de nuevo.
 *
 * EL DESTINO SE VUELVE A COMPROBAR EN CADA REINTENTO, y no se da por bueno
 * porque el evento estuviera en la cola. Un evento encolado el lunes puede
 * salir el miércoles, y entre medias la empresa pudo perder la habilitación o
 * el sistema pudo suspenderse: entregarlo entonces sería mandar datos a un
 * sistema al que esa empresa ya no pertenece. Con el destino resuelto de nuevo,
 * revocar deja de ser una promesa a futuro y vacía también la cola.
 */
async function intentarEvento(
  ev: FilaEvento,
  destino: { urlWebhook: string; secreto: string } | undefined
): Promise<'enviado' | 'fallido' | 'agotado'> {
  if (!destino) {
    await sinEmpresa('integraciones: cerrar evento sin destino (cron/cola global)', (tx) =>
      tx.eventoSaliente.update({
        where: { id: ev.id },
        data: {
          estado: DESCARTADO,
          ultimoError: 'Sistema no habilitado para esta empresa, inactivo o sin webhook.',
          proximoIntentoAt: null,
        },
      })
    ).catch(anotarFallo('integraciones:cerrar', { id: ev.id }))
    return 'agotado'
  }

  const error = await entregar(destino.urlWebhook, destino.secreto, cuerpoDe(ev), ev.id)
  const intentos = ev.intentos + 1
  await anotarResultado({
    companyId: ev.companyId,
    eventoId: ev.id,
    intentos,
    error,
    enCron: true,
  })
  if (!error) return 'enviado'
  return agotoLosIntentos(intentos) ? 'agotado' : 'fallido'
}

/**
 * EL REINTENTO PROGRAMADO (trabajo `reintento-entrega`, cola `satelite`).
 *
 * `intentosEsperados` es un cerrojo optimista: si la fila ya no tiene ese
 * número de intentos, la atendió alguien entre medias —el barrido, el botón del
 * panel, o un reintento de QStash sobre este mismo trabajo— y aquí no hay nada
 * que hacer. Sin el cerrojo, ese solapamiento gastaría un intento que nadie
 * contó y el evento moriría antes de tiempo.
 */
export async function reintentarEventoSaliente(
  eventoId: string,
  intentosEsperados: number
): Promise<{ resultado: 'enviado' | 'fallido' | 'agotado' | 'omitido'; motivo?: string }> {
  const ev = await sinEmpresa('integraciones: evento saliente por id (cola)', (tx) =>
    tx.eventoSaliente.findUnique({
      where: { id: eventoId },
      select: {
        id: true,
        companyId: true,
        sistemaId: true,
        tipo: true,
        payload: true,
        intentos: true,
        estado: true,
        createdAt: true,
        traceId: true,
      },
    })
  ).catch(() => null)

  if (!ev) return { resultado: 'omitido', motivo: 'no existe' }
  if (ev.estado !== 'PENDIENTE') return { resultado: 'omitido', motivo: 'ya cerrado' }
  if (ev.intentos !== intentosEsperados) {
    return { resultado: 'omitido', motivo: 'lo atendió otro' }
  }

  const destinos = await sistemasDestino(ev.companyId)
  return { resultado: await intentarEvento(ev, destinos.find((d) => d.id === ev.sistemaId)) }
}

/**
 * BARRIDO de los eventos VENCIDOS. Al agotar los intentos pasan a DEAD_LETTER:
 * dejan de reintentarse solos y esperan a que alguien mire el panel. El payload
 * se conserva íntegro, así que reencolarlos es un botón.
 *
 * Desde la Fase A-1 esto ya no es quien reintenta —cada fallo programa su
 * siguiente intento en la cola—: es la RED DE SEGURIDAD que recoge lo que la
 * cola no pudo tomar (QStash sin configurar, publicación rechazada, mensaje
 * perdido). `proximoIntentoAt: null` entra en el barrido a propósito: es lo que
 * tienen los eventos anteriores a esta fase y los que no se pudieron programar.
 *
 * El coste es una consulta por empresa —no por evento— gracias al memo: cien
 * eventos pendientes suelen ser de dos o tres empresas.
 */
export async function reintentarPendientes(
  limite = 100,
  /**
   * Acota el reintento a UN sistema. Sin él se despacha todo, que es lo que
   * quiere el cron.
   *
   * Existe porque el botón «reintentar» vive en la tarjeta de un satélite
   * concreto y llamaba a esta función SIN argumento: pulsarlo en el sistema del
   * restaurante disparaba también la cola del car wash — que podía estar
   * encolada precisamente porque ese otro sistema estaba caído. Y el mensaje de
   * vuelta («12 entregados») mezclaba los de todos.
   */
  sistemaId?: string,
  /**
   * `false` ignora la fecha del próximo intento y despacha TODO lo pendiente.
   *
   * Es lo que quiere el botón del panel y lo que NO quiere el cron. Cuando una
   * persona acaba de arreglar la ruta del satélite y pulsa «reintentar», está
   * diciendo «ahora»; responderle que el siguiente intento toca dentro de seis
   * horas sería devolverle su propia espera. El cron, en cambio, tiene que
   * respetar la escalera: si atendiera lo que ya está programado, volvería a
   * convertir los reintentos en «una vez al día».
   */
  opciones: { soloVencidos?: boolean } = {}
): Promise<{ enviados: number; fallidos: number }> {
  const soloVencidos = opciones.soloVencidos !== false
  let enviados = 0
  let fallidos = 0
  const pendientes = await sinEmpresa('integraciones: reintento de eventos pendientes', (tx) =>
    tx.eventoSaliente.findMany({
      where: {
        estado: 'PENDIENTE',
        ...(sistemaId ? { sistemaId } : {}),
        ...(soloVencidos
          ? { OR: [{ proximoIntentoAt: null }, { proximoIntentoAt: { lte: new Date() } }] }
          : {}),
      },
      orderBy: { createdAt: 'asc' },
      take: limite,
    })
  ).catch(() => [])

  const memo = new Map<string, Map<string, { urlWebhook: string; secreto: string }>>()
  const destinosDe = async (companyId: string) => {
    const cacheado = memo.get(companyId)
    if (cacheado) return cacheado
    const porId = new Map((await sistemasDestino(companyId)).map((s) => [s.id, s]))
    memo.set(companyId, porId)
    return porId
  }

  for (const ev of pendientes) {
    const r = await intentarEvento(ev, (await destinosDe(ev.companyId)).get(ev.sistemaId))
    if (r === 'enviado') enviados++
    else if (r === 'agotado') fallidos++
  }
  return { enviados, fallidos }
}
