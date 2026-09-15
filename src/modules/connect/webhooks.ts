import 'server-only'
import { randomBytes } from 'node:crypto'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { anotarFallo } from '@/lib/prisma-errors'
import { firmarHmac } from '@/modules/integraciones/nucleo'
import {
  CABECERA_ENTREGA,
  CABECERA_EVENTO_NOMBRE,
  CABECERA_FIRMA_EMPRESA,
  CABECERA_FIRMA_EMPRESA_V2,
  CABECERA_TIMESTAMP,
  DIAS_SOLAPE_ROTACION,
  cabeceraDeFirmas,
  materialFirmado,
} from '@membego/contracts'
import { dentroDelLimite } from '@/modules/connect/entitlements'
import { anotarConector } from '@/modules/connect/bitacora'
import {
  FALLOS_PARA_APAGAR,
  secretosVivos,
  suscripcionQuiere,
  validarUrlWebhook,
  type MotivoUrl,
  type SecretosDeFirma,
} from '@/modules/connect/webhooksNucleo'
import { programarReintento } from '@/modules/integraciones/programador'
import { CONCURRENCIA, antesDe, enParalelo } from '@/modules/integraciones/concurrencia'
import { agotoLosIntentos } from '@/modules/integraciones/reintentos'

/**
 * WEBHOOKS SALIENTES a cualquier URL (Membego Connect · Fase 3).
 *
 * El hermano abierto del despacho a satélites: mismo patrón outbox —la entrega
 * se registra ANTES de intentarse, así que un receptor caído no pierde nada—
 * pero el destino lo pone la empresa, no el superadmin.
 *
 * AISLAMIENTO: el fan-out parte del `companyId` DEL EVENTO y busca las
 * suscripciones de esa empresa. Nunca al revés. Una suscripción no puede
 * pedir eventos de otra empresa porque nadie le pregunta de qué empresa
 * quiere: se le da lo suyo.
 *
 * CADENCIA (auditoría A-1): cada fallo programa SU siguiente intento en la
 * cola, con espera creciente (30 s → 24 h). El cron diario deja de ser quien
 * reintenta y pasa a ser la red de seguridad: recoge lo que se quedó sin
 * programar porque QStash no estaba. Antes de esto, un receptor caído treinta
 * segundos costaba veinticuatro horas de retraso.
 */

const TIMEOUT_MS = 10_000

export type ResultadoCrearSuscripcion =
  | { ok: true; id: string; secreto: string }
  | { ok: false; motivo: 'limite_alcanzado' }
  | { ok: false; motivo: 'url_invalida'; detalle: MotivoUrl }

/**
 * Crea una suscripción. Devuelve el secreto de firma UNA vez, igual que las
 * claves de API: no hay pantalla que lo vuelva a enseñar.
 *
 * (Aquí decía que «también se puede volver a ver desde el panel». No es cierto
 * y nunca lo fue. Importa porque esa frase es la que justificaba guardarlo en
 * claro en vez de sellarlo con la clave maestra como las credenciales de
 * conector — y si no se enseña nunca, esa justificación no se sostiene.
 * Sellarlo es una migración aparte; queda anotado en la auditoría.)
 *
 * Perderlo ya no obliga a borrar la suscripción: desde la Fase A-7 se rota, con
 * unos días de solape en los que valen el viejo y el nuevo.
 */
export async function crearSuscripcion(input: {
  companyId: string
  nombre: string
  url: string
  eventos?: string[]
  creadoPor?: string | null
}): Promise<ResultadoCrearSuscripcion> {
  const url = validarUrlWebhook(input.url)
  if (!url.ok) return { ok: false, motivo: 'url_invalida', detalle: url.motivo }

  const activas = await conEmpresa(input.companyId, (tx) =>
    tx.suscripcionWebhook.count({
      where: { companyId: input.companyId, estado: { in: ['ACTIVE', 'PAUSED'] } },
    })
  )
  if (!(await dentroDelLimite(input.companyId, 'webhooks.max', activas))) {
    return { ok: false, motivo: 'limite_alcanzado' }
  }

  const secreto = `whs_${randomBytes(24).toString('hex')}`
  const fila = await conEmpresa(input.companyId, (tx) =>
    tx.suscripcionWebhook.create({
      data: {
        companyId: input.companyId,
        nombre: input.nombre.slice(0, 120),
        url: url.url,
        eventos: input.eventos ?? [],
        secreto,
        creadoPor: input.creadoPor ?? null,
      },
      select: { id: true },
    })
  )

  await anotarConector({
    companyId: input.companyId,
    origen: 'CONEXION',
    origenId: fila.id,
    evento: 'webhook.suscrito',
    // El host SÍ (identifica el destino en el panel); el secreto jamás.
    detalle: { host: new URL(url.url).hostname, eventos: (input.eventos ?? []).length },
  })

  return { ok: true, id: fila.id, secreto }
}

/**
 * ¿Tiene esta empresa algún destino vivo?
 *
 * Se pregunta ANTES de fabricar el sobre, para poder degradar con un motivo
 * («sin webhooks suscritos») en vez de crear entregas que no irían a ningún
 * sitio. Es una cuenta, no una lectura de filas: en el camino caliente de una
 * automatización, traer las suscripciones para descartarlas sería trabajo de
 * más en cada ejecución.
 */
export async function haySuscripcionesActivas(companyId: string): Promise<boolean> {
  const n = await conEmpresa(companyId, (tx) =>
    tx.suscripcionWebhook.count({ where: { companyId, estado: 'ACTIVE' } })
  ).catch(() => 0)
  return n > 0
}

/** Las suscripciones de una empresa, para el panel. */
export async function suscripcionesDeEmpresa(companyId: string) {
  return conEmpresa(companyId, (tx) =>
    tx.suscripcionWebhook.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
    })
  )
}

/** Una suscripción tal como la pinta el panel. SIN secretos, por construcción. */
export interface SuscripcionVista {
  id: string
  nombre: string
  url: string
  eventos: string[]
  estado: string
  fallosSeguidos: number
  ultimoOkAt: Date | null
  ultimoErrorAt: Date | null
  ultimoError: string | null
  /** Hasta cuándo vale el secreto anterior, o null si no hay rotación viva. */
  rotandoHasta: Date | null
}

/**
 * Lo mismo, pero ya resuelto para la pantalla.
 *
 * Existe por dos motivos, y el segundo importa más de lo que parece:
 *
 *  1. El tipo NO tiene campos de secreto, así que es imposible mandarlos al
 *     navegador por descuido. Antes la página recibía la fila entera —secreto
 *     incluido— y solo un mapeo a mano evitaba que viajara; un campo nuevo
 *     añadido sin cuidado lo habría filtrado sin que nada avisara.
 *  2. «¿Sigue vivo el solape?» se decide AQUÍ, contra el mismo reloj y con la
 *     misma regla que usa quien firma. En la página sería una segunda respuesta
 *     a la misma pregunta —y una que el compilador de React ni siquiera deja
 *     calcular, porque leer el reloj durante el render es impuro.
 */
export async function suscripcionesParaPanel(companyId: string): Promise<SuscripcionVista[]> {
  const filas = await suscripcionesDeEmpresa(companyId)
  const ahora = new Date()
  return filas.map((f) => ({
    id: f.id,
    nombre: f.nombre,
    url: f.url,
    eventos: f.eventos,
    estado: f.estado,
    fallosSeguidos: f.fallosSeguidos,
    ultimoOkAt: f.ultimoOkAt,
    ultimoErrorAt: f.ultimoErrorAt,
    ultimoError: f.ultimoError,
    // Vivo = `secretosVivos` devuelve dos. Se pregunta a la misma función que
    // firma, y no se reimplementa la comparación de fechas.
    rotandoHasta: secretosVivos(f, ahora).length > 1 ? f.secretoAnteriorHasta : null,
  }))
}

/** Pausa, reactiva o desactiva. La empresa decide; el sistema solo DISABLED. */
export async function cambiarEstadoSuscripcion(
  companyId: string,
  id: string,
  estado: 'ACTIVE' | 'PAUSED'
): Promise<{ ok: boolean }> {
  const r = await conEmpresa(companyId, (tx) =>
    tx.suscripcionWebhook.updateMany({
      where: { id, companyId },
      // Reactivar limpia el contador: si no, una suscripción que ya se apagó
      // sola volvería a apagarse al primer fallo.
      data: estado === 'ACTIVE' ? { estado, fallosSeguidos: 0 } : { estado },
    })
  )
  return { ok: r.count > 0 }
}

/** El sobre que viaja. Estable: es contrato con quien integra. */
export interface SobreWebhook {
  id: string
  event: string
  companyId: string
  createdAt: string
  data: Record<string, unknown>
}

/**
 * FAN-OUT: registra una entrega por cada suscripción interesada y hace UN
 * intento inmediato. Best-effort — nunca lanza: el flujo de negocio que emitió
 * el evento no puede romperse porque el servidor de un tercero esté caído.
 */
export async function repartirEventoAWebhooks(input: {
  companyId: string
  /** Nombre del evento tal como viaja por el cable (v2). */
  evento: string
  eventoId?: string | null
  datos: Record<string, unknown>
}): Promise<void> {
  try {
    const suscripciones = await conEmpresa(input.companyId, (tx) =>
      tx.suscripcionWebhook.findMany({
        where: { companyId: input.companyId, estado: 'ACTIVE' },
        select: { id: true, url: true, eventos: true, ...SELECT_SECRETOS },
      })
    )
    const interesadas = suscripciones.filter((s) => suscripcionQuiere(s.eventos, input.evento))
    if (interesadas.length === 0) return

    // EN PARALELO Y ACOTADO (A-6). En serie, cinco suscripciones lentas dejaban
    // al worker del bus cincuenta segundos ocupado en una sola visita — y el
    // tiempo que una empresa tarda en recibir sus avisos dependía de cuántas
    // suscripciones tuviera y de lo lento que fuera el servidor de otra.
    //
    // Sin `continuar`: el fan-out corre dentro del worker de eventos, que tiene
    // 300 s, y el número de suscripciones lo acota el entitlement. Aquí no hay
    // presupuesto que apurar; en el barrido sí.
    await enParalelo(interesadas, CONCURRENCIA, async (s) => {
      const entrega = await conEmpresa(input.companyId, (tx) =>
        tx.entregaWebhook.create({
          data: {
            suscripcionId: s.id,
            companyId: input.companyId,
            evento: input.evento,
            eventoId: input.eventoId ?? null,
            payload: input.datos as object,
          },
          select: { id: true, createdAt: true },
        })
      ).catch(anotarFallo('connect:webhook:outbox', { evento: input.evento }))
      if (!entrega) return

      const sobre: SobreWebhook = {
        id: entrega.id,
        event: input.evento,
        companyId: input.companyId,
        createdAt: entrega.createdAt.toISOString(),
        data: input.datos,
      }
      const resultado = await entregar(s.url, s, sobre)
      await registrarResultado(input.companyId, entrega.id, s.id, resultado, 1)
    })
  } catch (e) {
    console.error('[connect] fan-out de webhooks:', e)
  }
}

/** Lo que se selecciona de una suscripción para poder firmar. */
export const SELECT_SECRETOS = {
  secreto: true,
  secretoAnterior: true,
  secretoAnteriorHasta: true,
} as const

interface ResultadoEntrega {
  ok: boolean
  status: number | null
  error: string | null
}

/**
 * POST firmado. Salen LAS DOS firmas (hallazgo A-2).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ DOS, Y NO LA BUENA DIRECTAMENTE
 *
 * La v1 firma solo el cuerpo y es la que verifica hoy todo el que ya integró.
 * Cambiarle el significado a esa cabecera de golpe haría que TODOS empezaran a
 * rechazar sus propios avisos el minuto del despliegue — y un webhook que
 * rechaza todo no se nota: se nota tres días después, cuando alguien echa de
 * menos un dato. Con las dos juntas, cada quien migra cuando puede, y la v1 se
 * retira cuando nadie la use.
 *
 * Es la misma estrategia con la que los satélites pasaron de HMAC a Ed25519.
 */
async function entregar(
  url: string,
  secretos: SecretosDeFirma,
  sobre: SobreWebhook
): Promise<ResultadoEntrega> {
  const cuerpo = JSON.stringify(sobre)
  const timestamp = Math.floor(Date.now() / 1000)
  const vivos = secretosVivos(secretos)
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [CABECERA_EVENTO_NOMBRE]: sobre.event,
        [CABECERA_ENTREGA]: sobre.id,
        [CABECERA_TIMESTAMP]: String(timestamp),
        // v2: el timestamp y el id de la entrega van DENTRO de lo firmado, así
        // que ya no se pueden cambiar por el camino. Es lo que hace que la
        // ventana anti-replay signifique algo.
        //
        // Y es una LISTA: durante una rotación van las dos firmas, y el
        // receptor acepta con el secreto que tenga configurado. Fuera de una
        // rotación lleva una sola y se lee igual que siempre.
        [CABECERA_FIRMA_EMPRESA_V2]: cabeceraDeFirmas(
          vivos.map((sec) => firmarHmac(sec, materialFirmado(timestamp, sobre.id, cuerpo)))
        ),
        // v1 (legado): el cuerpo a secas, y firmada SIEMPRE con el secreto
        // vigente. No puede llevar lista —su verificador hace un único
        // `timingSafeEqual` y una cadena con comas le daría basura—, así que
        // durante una rotación un receptor que siga en v1 tiene que copiar el
        // nuevo secreto antes de que acabe el solape. La pantalla se lo dice
        // con la fecha exacta antes de que confirme la rotación.
        [CABECERA_FIRMA_EMPRESA]: firmarHmac(secretos.secreto, cuerpo),
      },
      body: cuerpo,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (resp.ok) return { ok: true, status: resp.status, error: null }
    // El cuerpo del error ayuda a quien integra a arreglarlo: un 404 de la
    // plataforma de alojamiento y uno de la aplicación se corrigen en sitios
    // distintos y sin el texto son indistinguibles.
    const detalle = (await resp.text().catch(() => '')).trim().replace(/\s+/g, ' ')
    return {
      ok: false,
      status: resp.status,
      error: detalle ? `HTTP ${resp.status} · ${detalle.slice(0, 200)}` : `HTTP ${resp.status}`,
    }
  } catch (e) {
    return { ok: false, status: null, error: e instanceof Error ? e.message : 'fetch falló' }
  }
}

/**
 * Anota cómo fue la entrega, PROGRAMA el siguiente intento y mueve la salud de
 * la suscripción.
 *
 * Al octavo intento la entrega pasa a DEAD_LETTER (deja de reintentarse sola);
 * a los `FALLOS_PARA_APAGAR` fallos SEGUIDOS, la suscripción entera se apaga.
 * Son dos umbrales distintos porque responden a preguntas distintas: uno es
 * «este mensaje no llega», el otro «este destino está muerto».
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ SE PROGRAMA AQUÍ Y NO EN CADA LLAMADOR
 *
 * Esta función es el ÚNICO sitio en el que se anota un fallo de entrega —lo
 * llaman el fan-out inmediato, el barrido del cron y el trabajo de la cola—.
 * Programar aquí es lo que hace imposible que exista una entrega fallida sin su
 * reintento: no hay ningún camino que anote el fallo y se salte esto.
 *
 * Y la fecha se guarda en el MISMO `update` que el fallo. Escribirla después,
 * en su propia consulta, dejaría una ventana en la que la fila está fallada y
 * sin fecha — que para el barrido es indistinguible de «vencida», y la
 * atendería a destiempo.
 */
async function registrarResultado(
  companyId: string,
  entregaId: string,
  suscripcionId: string,
  r: ResultadoEntrega,
  intentos: number
): Promise<void> {
  // Null en `fecha` = se acabaron los intentos. Se pregunta al programador en
  // vez de comparar contra el máximo por segunda vez: dos sitios decidiendo
  // cuándo muere una entrega acaban decidiendo cosas distintas.
  const proximo = r.ok
    ? null
    : await programarReintento({ cola: 'empresa', entregaId, companyId, intentos })

  await conEmpresa(companyId, (tx) =>
    tx.entregaWebhook.update({
      where: { id: entregaId },
      data: r.ok
        ? {
            estado: 'ENVIADO',
            intentos,
            estadoHttp: r.status,
            enviadoAt: new Date(),
            proximoIntentoAt: null,
          }
        : {
            intentos,
            estadoHttp: r.status,
            ultimoError: r.error?.slice(0, 300) ?? null,
            proximoIntentoAt: proximo?.fecha ?? null,
            ...(proximo?.fecha ? {} : { estado: 'DEAD_LETTER' }),
          },
    })
  ).catch(anotarFallo('connect:webhook:marcar', { entregaId }))

  if (r.ok) {
    await conEmpresa(companyId, (tx) =>
      tx.suscripcionWebhook.update({
        where: { id: suscripcionId },
        data: { fallosSeguidos: 0, ultimoOkAt: new Date(), ultimoError: null },
      })
    ).catch(anotarFallo('connect:webhook:salud-ok', { suscripcionId }))
    return
  }

  const actualizada = await conEmpresa(companyId, (tx) =>
    tx.suscripcionWebhook.update({
      where: { id: suscripcionId },
      data: {
        fallosSeguidos: { increment: 1 },
        ultimoErrorAt: new Date(),
        ultimoError: r.error?.slice(0, 300) ?? null,
      },
      select: { fallosSeguidos: true },
    })
  ).catch(anotarFallo('connect:webhook:salud-fallo', { suscripcionId }))

  if (actualizada && actualizada.fallosSeguidos >= FALLOS_PARA_APAGAR) {
    await conEmpresa(companyId, (tx) =>
      tx.suscripcionWebhook.updateMany({
        where: { id: suscripcionId, estado: 'ACTIVE' },
        data: { estado: 'DISABLED' },
      })
    ).catch(anotarFallo('connect:webhook:apagar', { suscripcionId }))
    await anotarConector({
      companyId,
      origen: 'CONEXION',
      origenId: suscripcionId,
      nivel: 'ERROR',
      evento: 'webhook.apagado_por_fallos',
      detalle: { fallosSeguidos: actualizada.fallosSeguidos },
    })
  }
}

/** Una entrega tal como la necesitan el reintento y el barrido. */
interface FilaEntrega {
  id: string
  companyId: string
  evento: string
  payload: unknown
  intentos: number
  createdAt: Date
  suscripcion: { id: string; url: string; estado: string } & SecretosDeFirma
}

/**
 * UN intento sobre UNA entrega. Lo comparten el barrido del cron y el trabajo
 * de la cola, y por eso el destino se vuelve a resolver aquí: una suscripción
 * pausada entre medias deja de recibir, en vez de que le vaciemos la cola
 * encima a quien pidió que paráramos.
 */
async function intentarEntrega(e: FilaEntrega): Promise<'enviado' | 'fallido' | 'agotado'> {
  if (e.suscripcion.estado !== 'ACTIVE') {
    await sinEmpresa('connect: cerrar entrega de suscripción inactiva', (tx) =>
      tx.entregaWebhook.update({
        where: { id: e.id },
        data: {
          estado: 'DEAD_LETTER',
          ultimoError: 'La suscripción ya no está activa.',
          proximoIntentoAt: null,
        },
      })
    ).catch(anotarFallo('connect:webhook:cerrar', { id: e.id }))
    return 'agotado'
  }

  const sobre: SobreWebhook = {
    id: e.id,
    event: e.evento,
    companyId: e.companyId,
    createdAt: e.createdAt.toISOString(),
    data: (e.payload ?? {}) as Record<string, unknown>,
  }
  const r = await entregar(e.suscripcion.url, e.suscripcion, sobre)
  const intentos = e.intentos + 1
  await registrarResultado(e.companyId, e.id, e.suscripcion.id, r, intentos)
  if (r.ok) return 'enviado'
  return agotoLosIntentos(intentos) ? 'agotado' : 'fallido'
}

/**
 * EL REINTENTO PROGRAMADO (trabajo `reintento-entrega`, cola `empresa`).
 *
 * `intentosEsperados` es un cerrojo optimista: si la fila ya no tiene ese
 * número de intentos, alguien la atendió entre medias —el barrido, o un
 * reintento de QStash sobre este mismo trabajo— y aquí no hay nada que hacer.
 * Sin el cerrojo, ese solapamiento gastaría un intento que nadie contó y
 * acortaría la vida de la entrega sin que se note.
 */
export async function reintentarEntregaWebhook(
  entregaId: string,
  intentosEsperados: number
): Promise<{ resultado: 'enviado' | 'fallido' | 'agotado' | 'omitido'; motivo?: string }> {
  const fila = await sinEmpresa('connect: entrega de webhook por id (cola)', (tx) =>
    tx.entregaWebhook.findUnique({
      where: { id: entregaId },
      select: {
        id: true,
        companyId: true,
        evento: true,
        payload: true,
        intentos: true,
        estado: true,
        createdAt: true,
        suscripcion: { select: { id: true, url: true, estado: true, ...SELECT_SECRETOS } },
      },
    })
  ).catch(() => null)

  if (!fila) return { resultado: 'omitido', motivo: 'no existe' }
  if (fila.estado !== 'PENDIENTE') return { resultado: 'omitido', motivo: 'ya cerrada' }
  if (fila.intentos !== intentosEsperados) {
    return { resultado: 'omitido', motivo: 'la atendió otro' }
  }

  return { resultado: await intentarEntrega(fila) }
}

/**
 * ROTAR EL SECRETO de una suscripción, sin cortar (hallazgo A-7).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTO FALTABA, Y POR QUÉ IMPORTA
 *
 * Había un solo secreto por suscripción. Cambiarlo dejaba de golpe todas las
 * entregas sin una firma que el receptor reconociera, hasta que alguien copiara
 * el nuevo a mano en su servidor. Así que la única rotación practicable era
 * borrar la suscripción y crear otra — que cambia el id y tira el historial de
 * entregas.
 *
 * Y una rotación que obliga a un corte es una rotación que no se hace. El
 * problema es cuándo se descubre: la primera vez que hace falta rotar de verdad
 * es cuando se sospecha que el secreto se filtró, o sea el peor momento
 * imaginable para enterarse de que el procedimiento duele.
 *
 * Ahora se firma con los dos durante `DIAS_SOLAPE_ROTACION` días y el receptor
 * acepta con el que tenga configurado. El solape se acaba solo (ver
 * `secretosVivos`).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ROTAR DOS VECES SEGUIDAS NO ENCADENA SECRETOS
 *
 * La segunda rotación retira el secreto de la primera, no el de antes. Es lo
 * correcto y conviene decirlo: quien rota dos veces en la misma tarde
 * —normalmente porque se equivocó al copiar— quiere que el penúltimo muera, no
 * que sigan vivos tres. Vivos hay como mucho dos, siempre.
 */
export type ResultadoRotacion =
  | { ok: true; secreto: string; anteriorHasta: Date }
  | { ok: false; motivo: 'no_existe' }

export async function rotarSecretoSuscripcion(
  companyId: string,
  id: string
): Promise<ResultadoRotacion> {
  const actual = await conEmpresa(companyId, (tx) =>
    tx.suscripcionWebhook.findFirst({
      // Acotado por empresa: el id sale del formulario, y con `findUnique` por
      // id suelto bastaría cambiarlo para rotarle el secreto a otra empresa —
      // que es, además, una forma cómoda de cortarle el servicio.
      where: { id, companyId },
      select: { id: true, secreto: true },
    })
  ).catch(() => null)
  if (!actual) return { ok: false, motivo: 'no_existe' }

  const nuevo = `whs_${randomBytes(24).toString('hex')}`
  const anteriorHasta = new Date(Date.now() + DIAS_SOLAPE_ROTACION * 24 * 60 * 60 * 1000)

  const r = await conEmpresa(companyId, (tx) =>
    tx.suscripcionWebhook.updateMany({
      where: { id, companyId },
      data: {
        secreto: nuevo,
        secretoAnterior: actual.secreto,
        secretoAnteriorHasta: anteriorHasta,
      },
    })
  ).catch(anotarFallo('connect:webhook:rotar', { id }))
  if (!r || r.count === 0) return { ok: false, motivo: 'no_existe' }

  await anotarConector({
    companyId,
    origen: 'CONEXION',
    origenId: id,
    evento: 'webhook.secreto_rotado',
    // Ni el viejo ni el nuevo, evidentemente. La fecha sí: es el dato que hace
    // falta para reconstruir «por qué dejaron de llegarle los avisos el día 8».
    detalle: { solapeHasta: anteriorHasta.toISOString() },
  })

  return { ok: true, secreto: nuevo, anteriorHasta }
}

/**
 * CAMBIAR QUÉ EVENTOS RECIBE una suscripción (hallazgo A-5).
 *
 * Es la mitad que de verdad hace falta. Elegir al crear solo sirve para los
 * webhooks nuevos, y TODOS los que existen hoy tienen la lista vacía —o sea,
 * lo reciben todo— precisamente porque hasta ahora no había forma de decir otra
 * cosa. Sin esto, la función no le serviría a nadie que ya estuviera integrado.
 *
 * La lista llega ya filtrada contra el catálogo (`soloEventosConocidos`): aquí
 * no se valida otra vez, pero tampoco se acepta nada que no haya pasado por
 * ahí — por eso el parámetro se llama `eventos` y quien llama es una server
 * action, no la red.
 *
 * Lista vacía = todos, igual que al crear. No es un caso especial que haya que
 * recordar: es el mismo significado en los dos sitios, y `suscripcionQuiere` es
 * el único que lo interpreta.
 */
export async function actualizarEventosSuscripcion(
  companyId: string,
  id: string,
  eventos: string[]
): Promise<{ ok: boolean }> {
  const r = await conEmpresa(companyId, (tx) =>
    tx.suscripcionWebhook.updateMany({
      // `updateMany` con el companyId en el `where`, y no `update` por id: el id
      // viene del formulario. Con `update` bastaría con cambiarlo para tocar la
      // suscripción de otra empresa.
      where: { id, companyId },
      data: { eventos },
    })
  ).catch(anotarFallo('connect:webhook:eventos', { id }))

  if (!r || r.count === 0) return { ok: false }

  await anotarConector({
    companyId,
    origen: 'CONEXION',
    origenId: id,
    evento: 'webhook.eventos_cambiados',
    // Cuántos, no cuáles: la bitácora no es el sitio donde se consulta la
    // configuración actual —esa está en la pantalla— y una lista larga por cada
    // cambio la llena de ruido.
    detalle: { elegidos: eventos.length },
  })
  return { ok: true }
}

/**
 * REENVIAR UNA ENTREGA A MANO (hallazgo A-4).
 *
 * Es el botón que cierra el ciclo: quien integra arregla su servidor y
 * comprueba AHÍ MISMO si sirvió, en vez de esperar a que caiga otro evento de
 * verdad para enterarse.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ SE REINICIAN LOS INTENTOS
 *
 * Una entrega en DEAD_LETTER llegó a ocho intentos. Reenviarla sin más la
 * mataría otra vez al primer fallo, y quien pulsó el botón interpretaría —con
 * razón— que su arreglo no sirvió, cuando lo que pasó es que no le quedaban
 * intentos. Reenviar significa «vuelve a intentarlo como si fuera nueva», y eso
 * incluye volver a tener escalera. Es lo mismo que hace `revivirFallidos` con
 * la cola de satélites.
 *
 * Se pierde el «esto falló ocho veces», y se pierde a propósito: el histórico
 * de esa pelea está en la bitácora, y el estado de la fila sirve para saber qué
 * pasa AHORA.
 *
 * Una suscripción pausada o apagada NO se reenvía: se dice y no se toca la
 * fila. Entregarla igual sería saltarse la pausa que la propia empresa pidió, y
 * dejarla caer en DEAD_LETTER por «suscripción inactiva» sería castigar la fila
 * por algo que se arregla reactivando el webhook.
 */
export async function reenviarEntregaAhora(
  companyId: string,
  entregaId: string
): Promise<
  | { ok: true; resultado: 'enviado' | 'fallido' | 'agotado' }
  | { ok: false; motivo: 'no_existe' | 'suscripcion_inactiva' }
> {
  const fila = await conEmpresa(companyId, (tx) =>
    tx.entregaWebhook.findFirst({
      // `findFirst` con `companyId` y no `findUnique` por id: el id viaja desde
      // el navegador, y sin la condición de empresa un id adivinado de otra
      // empresa devolvería su fila. La pantalla no lo permite; la consulta
      // tampoco debe permitirlo.
      where: { id: entregaId, companyId },
      select: {
        id: true,
        companyId: true,
        evento: true,
        payload: true,
        createdAt: true,
        suscripcion: { select: { id: true, url: true, estado: true, ...SELECT_SECRETOS } },
      },
    })
  ).catch(() => null)

  if (!fila) return { ok: false, motivo: 'no_existe' }
  if (fila.suscripcion.estado !== 'ACTIVE') {
    return { ok: false, motivo: 'suscripcion_inactiva' }
  }

  await conEmpresa(companyId, (tx) =>
    tx.entregaWebhook.update({
      where: { id: entregaId },
      data: {
        estado: 'PENDIENTE',
        intentos: 0,
        ultimoError: null,
        estadoHttp: null,
        enviadoAt: null,
        proximoIntentoAt: null,
      },
    })
  ).catch(anotarFallo('connect:webhook:reenviar', { entregaId }))

  await anotarConector({
    companyId,
    origen: 'CONEXION',
    origenId: fila.suscripcion.id,
    evento: 'webhook.reenvio_manual',
    detalle: { entregaId, evento: fila.evento },
  })

  return { ok: true, resultado: await intentarEntrega({ ...fila, intentos: 0 }) }
}

/**
 * BARRIDO de las entregas VENCIDAS (cron).
 *
 * Desde la Fase A-1 esto ya no es quien reintenta: cada fallo programa su
 * siguiente intento en la cola. Esto es la RED DE SEGURIDAD, y recoge lo que la
 * cola no pudo tomar — QStash sin configurar, una publicación rechazada, un
 * mensaje perdido.
 *
 * `proximoIntentoAt: null` entra en el barrido a propósito: es lo que tienen
 * las entregas anteriores a esta fase y las que no se pudieron programar. Null
 * significa «ya tocaba», no «nunca».
 */
export async function reintentarWebhooksPendientes(
  limite = 100,
  /**
   * Cuánto tiempo puede consumir este barrido. Se corta por tiempo y no solo
   * por número de filas porque las dos cosas no se parecen en nada: cien
   * entregas contra un servidor sano son dos segundos, y contra uno caído son
   * mil. Ver `PRESUPUESTO_BARRIDO_MS` en el cron.
   */
  presupuestoMs = 25_000
): Promise<{
  enviados: number
  agotados: number
  /** Filas que se dejaron para la próxima por falta de tiempo. */
  sinTiempo: number
}> {
  let enviados = 0
  let agotados = 0

  const pendientes = await sinEmpresa(
    'connect: entregas de webhook vencidas (cron global)',
    (tx) =>
      tx.entregaWebhook.findMany({
        where: {
          estado: 'PENDIENTE',
          OR: [{ proximoIntentoAt: null }, { proximoIntentoAt: { lte: new Date() } }],
        },
        orderBy: { createdAt: 'asc' },
        take: limite,
        include: {
          suscripcion: { select: { id: true, url: true, estado: true, ...SELECT_SECRETOS } },
        },
      })
  ).catch(() => [])

  // Acotado por concurrencia Y por tiempo (A-6). En serie, con un receptor
  // caído, cada fila costaba sus diez segundos de timeout: el cron procesaba
  // unas seis de cien y la plataforma lo mataba, sin error y sin traza. Al día
  // siguiente repetía con las mismas seis.
  const { sinEmpezar } = await enParalelo(
    pendientes,
    CONCURRENCIA,
    async (e) => {
      const r = await intentarEntrega(e)
      if (r === 'enviado') enviados++
      else if (r === 'agotado') agotados++
    },
    // El margen es para que lo que esté en vuelo termine de escribir su
    // resultado. Que nos maten a mitad de un `update` deja la fila diciendo
    // algo que no pasó.
    { continuar: antesDe(presupuestoMs, 12_000) }
  )

  return { enviados, agotados, sinTiempo: sinEmpezar }
}
