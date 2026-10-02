import { prisma } from '@/lib/prisma'
import type { ContextoAuditoria } from '../core/auditoria'
import { adaptadorDe, type EventoExternoAdaptado } from './adaptadores'
import { normalizarCorrelationId } from './correlacion'
import { EVENTO_RESUELTO, sanearError } from './domain'
import { capacidadActiva } from './flags'
import { verificadorDe } from './firma'
import { anotarFalloDeProceso, procesarEventoExterno, registrarEventoExterno } from './inbox'
import { anotarSupply, anotarYContar } from './log'
import type { CodigoEntrada } from './respuestas'
import { httpDe } from './respuestas'
import { despacharEfectos } from './worker'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 9 · BLOQUE 2 · LA PUERTA, DE PRINCIPIO A FIN (§1).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CINCO PASOS Y NINGUNA DECISIÓN DE DINERO
 *
 *   autenticar → adaptar → registrar → procesar → contestar
 *
 * Aquí no hay un solo `if` sobre importes, estados de orden ni derechos. Todo
 * eso vive en el procesador del Bloque 1, que lo hace contra NUESTRA orden y
 * dentro de la transacción. Esta capa solo traduce entre «una petición HTTP» y
 * «un evento del inbox», y traduce de vuelta el resultado a un código.
 *
 * Está separada del route handler a propósito: así se puede probar el camino
 * completo sin levantar Next, y el handler se queda en lo que solo él puede
 * hacer —leer el cuerpo crudo, mirar cabeceras, devolver una respuesta—.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL ORDEN DE LOS PASOS ES LA SEGURIDAD
 *
 * La firma se verifica ANTES de registrar nada. Si se registrara primero
 * «para tener constancia», cualquiera podría llenar el inbox con filas
 * inventadas, y el panel de difuntos que viene después sería un buzón de
 * basura ajena. Lo que no está firmado no entra en la base.
 */

export interface PeticionEntrante {
  /** Lo que diga la URL. Se resuelve contra los proveedores conocidos. */
  provider: string
  /** Los bytes exactos del cuerpo. Es lo que se firma; no se reserializa. */
  cuerpoCrudo: string
  /** Cabeceras en minúsculas. */
  cabeceras: Record<string, string | null>
  /** De dónde vino, para la bitácora. Nunca para autorizar. */
  ip?: string | null
  userAgent?: string | null
  ahora?: Date
  /**
   * Si el efecto se despacha en la misma petición. Por defecto sí: así el
   * cliente recibe su aviso en segundos y no cuando pase el cron. Se puede
   * apagar para probar el despachador por separado.
   */
  despachar?: boolean
}

export interface ResultadoEntrada {
  codigo: CodigoEntrada
  http: number
  correlationId: string
  /** La fila del inbox, cuando llegó a haberla. */
  inboxId?: string
  /** Detalle interno. NO va en la respuesta HTTP: va al log y a la bitácora. */
  detalle?: string
}

/**
 * Recibe un evento externo. Es todo el camino del esquema del bloque, menos el
 * HTTP de los extremos.
 */
export async function recibirEventoExterno(p: PeticionEntrante): Promise<ResultadoEntrada> {
  const ahora = p.ahora ?? new Date()
  const correlationId = normalizarCorrelationId(p.cabeceras['x-correlation-id'])
  const ctx: ContextoAuditoria = {
    actorId: null,
    ipAddress: p.ip ?? null,
    userAgent: p.userAgent ?? 'webhook:supply-v2',
  }

  // ── 0 · ¿está encendida la integración? (bloque 4 · §10, §11) ────────────
  //
  // Lo PRIMERO, antes de verificar la firma y antes de tocar la base. Si está
  // apagada no se procesa NADA y se responde 503: el proveedor lo reintentará
  // cuando se reactive. Lo que no se hace es aceptar en silencio —un 200 sin
  // procesar le diría que quedó entregado y no volvería a mandarlo, que es
  // perder un aviso de pago con todas las letras—.
  //
  // Esto apaga el PROCESAMIENTO. El Centro de Operaciones, la búsqueda, la
  // investigación y la resolución manual siguen funcionando: si apagar la
  // integración apagara el panel, nadie podría ver por qué la apagó.
  if (!(await capacidadActiva('SUPPLY_V2_EXTERNAL_PAYMENTS'))) {
    return fin(
      { codigo: 'FEATURE_DISABLED', correlationId, detalle: 'pagos externos apagados' },
      { provider: p.provider },
      'capacidad_apagada'
    )
  }

  // ── 1 · ¿sabemos quién es? ────────────────────────────────────────────────
  const verificador = verificadorDe(p.provider)
  const adaptador = adaptadorDe(p.provider)
  if (!verificador || !adaptador) {
    return fin({ codigo: 'UNKNOWN_PROVIDER', correlationId }, { provider: p.provider }, 'proveedor_desconocido')
  }
  const provider = verificador.provider

  // ── 2 · ¿es quien dice ser, y es de ahora? ────────────────────────────────
  let verificacion
  try {
    verificacion = await verificador.verificar({
      provider,
      cuerpoCrudo: p.cuerpoCrudo,
      cabeceras: p.cabeceras,
      ahora,
    })
  } catch (e) {
    // Un verificador que lanza es un fallo NUESTRO, no una firma mala: 500,
    // para que el proveedor lo reintente.
    return fin(
      { codigo: 'INTERNAL_ERROR', correlationId, detalle: sanearError(e) },
      { provider },
      'verificador_fallo'
    )
  }
  if (!verificacion.ok) {
    // La evidencia del rechazo es el log y el evento contable: NO una fila en
    // el inbox. Un evento reproducido o mal firmado no es un evento financiero
    // procesable, y guardarlo como tal convertiría el inbox en algo que
    // cualquiera puede escribir desde fuera.
    return fin(
      { codigo: verificacion.codigo, correlationId, detalle: verificacion.motivo },
      { provider },
      verificacion.codigo === 'REPLAY_REJECTED' ? 'replay' : 'firma_invalida'
    )
  }

  // ── 3 · traducir a nuestro vocabulario ───────────────────────────────────
  let adaptado: EventoExternoAdaptado
  try {
    adaptado = adaptador.adaptar({ provider, cuerpoCrudo: p.cuerpoCrudo, cabeceras: p.cabeceras })
  } catch (e) {
    return fin(
      { codigo: 'INVALID_PAYLOAD', correlationId, detalle: sanearError(e) },
      { provider },
      'payload_invalido'
    )
  }

  // ── 4 · registrar y procesar ─────────────────────────────────────────────
  //
  // El id de la fila se guarda FUERA del `try`: si el proceso falla por algo
  // transitorio, hay que poder anotarlo en la fila que ya existe. Sin esto, un
  // fallo pasajero contestaba 500 y no dejaba ni un intento contado ni una hora
  // para volver: el rastro de que algo falló se perdía.
  let inboxId: string | null = null
  try {
    const registrado = await registrarEventoExterno({
      provider: adaptado.provider,
      externalEventId: adaptado.externalEventId,
      eventType: adaptado.eventType,
      // Lo que el adaptador YA interpretó. El procesador lee esto y no vuelve
      // a adivinar sobre el cuerpo crudo (el defecto que el Bloque 1 cerró).
      pago: {
        orderNumber: adaptado.payment.orderReference,
        orderId: null,
        amount: adaptado.payment.amount,
        currency: adaptado.payment.currency,
      },
      payload: {
        ...adaptado.rawSanitizedPayload,
        // Lo que el adaptador sacó y el inbox no tiene columna para guardar:
        // viaja en el cuerpo conservado, que es donde se mira al conciliar.
        externalTransactionId: adaptado.payment.externalTransactionId,
        providerStatus: adaptado.payment.status,
      },
      correlationId,
    })

    inboxId = registrado.id
    anotarSupply({
      event: 'evento_recibido',
      provider,
      externalEventId: adaptado.externalEventId,
      correlationId: registrado.correlationId,
      inboxId: registrado.id,
      status: registrado.status,
      errorCode: registrado.cuerpoDistinto ? 'CUERPO_DISTINTO' : null,
    })

    // Un evento YA RESUELTO se contesta aquí mismo, sin pasar por nada más.
    //
    // No es solo un atajo: procesar a un resuelto no haría nada —el Bloque 1 lo
    // para—, pero el camino de abajo exige la cuenta de la integración y, si
    // faltara, anotaría un fallo SOBRE UNA FILA FINAL, devolviendo a FAILED un
    // evento que ya estaba PROCESSED. Una entrega repetida no puede cambiar el
    // estado de algo que ya terminó, y menos por un problema de configuración.
    if (EVENTO_RESUELTO.includes(registrado.status)) {
      return fin(
        { codigo: 'EVENT_REPEATED', correlationId: registrado.correlationId, inboxId: registrado.id, detalle: registrado.status },
        { provider, externalEventId: adaptado.externalEventId, inboxId: registrado.id },
        'repetido'
      )
    }

    // ── QUIÉN CONFIRMA UN PAGO QUE NADIE VIO ─────────────────────────────
    //
    // El Slice 5 exige que toda confirmación de pago nombre a quién la hizo
    // (`confirmarPagoEnTx` falla con SIN_ACTOR), y hace bien: un pago
    // confirmado sin responsable es un agujero de auditoría. Pero un webhook
    // no tiene persona detrás, y aquí no se va a fingir una: ni se inventa un
    // usuario de sistema que parezca empleado en las pantallas, ni se relaja
    // la regla del Slice 5 —eso cambiaría la semántica de un camino que mueve
    // dinero y no es de este bloque—.
    //
    // Lo que se hace es pedir que la organización DESIGNE la cuenta con la que
    // actúa la integración (`SUPPLY_V2_WEBHOOK_ACTOR_ID`), como cualquier
    // cuenta de servicio en un sistema contable. Si no está puesta, el evento
    // NO se procesa: queda guardado y reprogramado, y alguien lo ve. Fallar
    // cerrado aquí significa que una configuración olvidada deja eventos
    // esperando; dejarlo pasar significaría mover dinero sin responsable.
    const actor = await actorDelWebhook()
    if (!actor) {
      await anotarFalloDeProceso(
        registrado.id,
        new Error('SIN_ACTOR_CONFIGURADO: falta SUPPLY_V2_WEBHOOK_ACTOR_ID'),
        ctx,
        ahora
      )
      return fin(
        { codigo: 'INTERNAL_ERROR', correlationId: registrado.correlationId, inboxId: registrado.id, detalle: 'SIN_ACTOR_CONFIGURADO' },
        { provider, externalEventId: adaptado.externalEventId, inboxId: registrado.id },
        'sin_actor_configurado'
      )
    }
    const ctxProceso: ContextoAuditoria = { ...ctx, actorId: actor }

    const procesado = await procesarEventoExterno(registrado.id, ctxProceso, ahora)

    // El despacho va DESPUÉS de que el dinero esté decidido y nunca cambia la
    // respuesta: si encolar falla, el efecto se queda apuntado y lo recoge el
    // cron. Lo que se le contesta al proveedor describe qué pasó con el pago,
    // no si el aviso salió.
    if (p.despachar !== false && (await capacidadActiva('SUPPLY_V2_OUTBOX_DELIVERY'))) {
      try {
        // Con la hora DE AHORA, no con la del principio de la petición: el
        // efecto se acaba de escribir, así que su `availableAt` es posterior a
        // `ahora` y el despachador —que solo reclama lo ya disponible— no lo
        // vería. Pasar la hora de entrada dejaba el aviso esperando al cron,
        // hasta un día después. Lo encontró la prueba de integración.
        await despacharEfectos(ctxProceso, 10)
      } catch (e) {
        anotarSupply({
          event: 'despacho_fallido',
          provider,
          correlationId: registrado.correlationId,
          inboxId: registrado.id,
          errorCode: sanearError(e),
        })
      }
    }

    const codigo = codigoDeProceso(procesado.resultado, registrado.repetido)
    return fin(
      {
        codigo,
        correlationId: registrado.correlationId,
        inboxId: registrado.id,
        detalle: 'codigo' in procesado ? `${procesado.codigo}: ${procesado.motivo}` : procesado.resultado,
      },
      { provider, externalEventId: adaptado.externalEventId, inboxId: registrado.id },
      codigo === 'EVENT_ACCEPTED' ? undefined : etiquetaDe(procesado.resultado)
    )
  } catch (e) {
    // Cualquier cosa que falle a partir de aquí es NUESTRA: la base, una
    // transacción, un fallo de dominio inesperado. 500 para que el proveedor
    // vuelva a mandarlo, porque perderlo sí cuesta dinero.
    //
    // Si la fila ya existía, el fallo se anota en ella: un intento contado, el
    // error saneado y hora para volver. La transacción que falló se fue atrás,
    // así que esto va en la suya (lo hace `anotarFalloDeProceso`).
    if (inboxId) {
      try {
        await anotarFalloDeProceso(inboxId, e, ctx, ahora)
      } catch (anotando) {
        anotarSupply({ event: 'fallo_sin_anotar', provider, inboxId, errorCode: sanearError(anotando) })
      }
    }
    return fin(
      { codigo: 'INTERNAL_ERROR', correlationId, inboxId: inboxId ?? undefined, detalle: sanearError(e) },
      { provider, externalEventId: adaptado.externalEventId, inboxId: inboxId ?? undefined },
      'proceso_fallo'
    )
  }
}

/** Del resultado del procesador al código que se contesta. */
export function codigoDeProceso(
  resultado: 'PROCESADO' | 'REPETIDO' | 'IGNORADO' | 'RECHAZADO' | 'REINTENTABLE',
  repetido: boolean
): CodigoEntrada {
  switch (resultado) {
    case 'PROCESADO':
      return 'EVENT_ACCEPTED'
    case 'REPETIDO':
      return 'EVENT_REPEATED'
    case 'IGNORADO':
    case 'RECHAZADO':
      // Recibido y no aceptado. 200: ya decidimos, y reintentarlo no lo haría
      // cuadrar. El rastro queda en la fila y en la bitácora.
      return 'EVENT_REJECTED'
    case 'REINTENTABLE':
      // Esto sí invita a reintentar, y es lo que el 500 significa.
      return repetido ? 'EVENT_REPEATED' : 'INTERNAL_ERROR'
  }
}

function etiquetaDe(resultado: string): string {
  switch (resultado) {
    case 'REPETIDO':
      return 'repetido'
    case 'IGNORADO':
      return 'ignorado'
    case 'RECHAZADO':
      return 'rechazado'
    case 'REINTENTABLE':
      return 'reintentable'
    default:
      return 'procesado'
  }
}

/**
 * Cierra el camino: deja la línea estructurada, cuenta el evento y devuelve el
 * resultado con su código HTTP. Un solo sitio para que ninguna salida se vaya
 * sin registrar.
 */
function fin(
  r: Omit<ResultadoEntrada, 'http'>,
  ids: { provider?: string; externalEventId?: string; inboxId?: string },
  motivo?: string
): ResultadoEntrada {
  const http = httpDe(r.codigo)
  anotarYContar(
    {
      event: 'evento_resuelto',
      provider: ids.provider ?? null,
      externalEventId: ids.externalEventId ?? null,
      correlationId: r.correlationId,
      inboxId: ids.inboxId ?? null,
      status: r.codigo,
      errorCode: http >= 400 ? r.detalle ?? r.codigo : null,
    },
    { accion: 'webhook_supply_v2', ok: http < 300, motivo }
  )
  return { ...r, http }
}

/**
 * La cuenta con la que actúa la integración, comprobada contra la base.
 *
 * Se comprueba —y no se usa a ciegas— porque `paymentConfirmedById` es una
 * clave foránea: un id mal copiado en la configuración haría fallar la
 * transacción del pago con un error de base de datos en vez de con un motivo
 * legible. Y se guarda en memoria porque esto corre en el camino de cada
 * webhook: una consulta por evento para leer una configuración que no cambia
 * es latencia regalada.
 */
let actorEnMemoria: { id: string; valido: boolean } | null = null

export async function actorDelWebhook(): Promise<string | null> {
  const configurado = process.env.SUPPLY_V2_WEBHOOK_ACTOR_ID?.trim()
  if (!configurado) return null
  if (actorEnMemoria?.id === configurado) return actorEnMemoria.valido ? configurado : null
  const existe = await prisma.user.findUnique({ where: { id: configurado }, select: { id: true } })
  actorEnMemoria = { id: configurado, valido: Boolean(existe) }
  return existe ? configurado : null
}

/** Para las pruebas: olvida lo recordado cuando la configuración cambia. */
export function olvidarActorDelWebhook(): void {
  actorEnMemoria = null
}
