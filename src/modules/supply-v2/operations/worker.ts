import type { NotifTipo, Prisma } from '@prisma/client'
import { sinEmpresa } from '@/lib/tenant'
import { encolar } from '@/modules/jobs/cola'
import type { ContextoAuditoria } from '../core/auditoria'
import { sanearError } from './domain'
import { anotarSupply, anotarYContar } from './log'
import { marcarEntregado, marcarFallido, reclamarEfectos, type EfectoReclamado } from './outbox'
import { EFECTOS_DE_AVISO } from '../notifications/efectos'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 9 · BLOQUE 2 · DEL OUTBOX A LA COLA (§6, §7, §8).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TRES PIEZAS, Y CADA UNA HACE SOLO LO SUYO
 *
 *   1. `despacharEfectos`  — reclama filas del outbox y las pone en la cola que
 *      ya existe. No entrega: encola. Es lo único que corre cerca del request.
 *   2. `entregarEfecto`    — lo que el worker de la cola ejecuta: hace el efecto
 *      y marca el resultado. Aquí sí se llama «afuera».
 *   3. `recuperarArriendos` — devuelve a la cola lo que un proceso muerto dejó
 *      reclamado. Sin esto, morir entre reclamar y entregar pierde el efecto
 *      para siempre.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA REGLA QUE NO SE ROMPE: NADA DE TRANSACCIONES ABIERTAS MIENTRAS SE LLAMA
 * AFUERA
 *
 * `entregarEfecto` lee la fila, CIERRA la transacción, ejecuta el efecto y
 * abre otra para marcar. Mantener una transacción abierta durante una llamada
 * externa ataría la duración del candado a la latencia de un tercero: un
 * proveedor lento mantendría filas bloqueadas, y un proveedor colgado agotaría
 * el pool de conexiones. Es el error que convierte un retraso ajeno en una
 * caída propia.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA COLA NO SE REIMPLEMENTA
 *
 * `encolar()` de `modules/jobs/cola.ts`: con QStash publica fuera del request
 * con reintentos y dead letter en `trabajos_muertos`; sin QStash ejecuta EN
 * LÍNEA en vez de perder el trabajo. Esa degradación honesta es la razón de
 * reutilizarla y no escribir otra.
 */

/** Cuánto puede estar una fila reclamada antes de darla por abandonada. */
export const ARRIENDO_MS = 5 * 60 * 1000

/**
 * El efecto de un evento del outbox.
 *
 * Recibe la `idempotencyKey` —estable, derivada de la identidad de la fila— y
 * es responsable de usarla si el destino la soporta. Lo que NO puede hacer es
 * tragarse un fallo: si lanza, el worker reprograma; si devuelve, el worker
 * marca entregado. Un efecto que oculta su fallo convierte la escalera de
 * reintentos en decoración.
 */
export type EjecutorDeEfecto = (e: EfectoAEntregar) => Promise<{ detalle: string }>

export interface EfectoAEntregar extends EfectoReclamado {
  /**
   * Identidad estable del efecto, para transmitirla al destino cuando este
   * sepa deduplicar. Es la misma en todos los intentos a propósito: si cambiara
   * por intento, un reintento tras un corte sería un efecto nuevo para el
   * destino y la deduplicación no serviría de nada.
   */
  idempotencyKey: string
}

/**
 * LOS EFECTOS QUE HOY SABEMOS HACER.
 *
 * Son avisos al cliente dentro de Membego: lo que Supply 2.0 ya le debía y
 * nunca le daba —hasta ahora, confirmar un pago no avisaba a nadie—. Correo,
 * WhatsApp y alertas son de bloques posteriores a propósito; lo que este
 * bloque tiene que demostrar es el CAMINO, y un aviso in-app lo recorre
 * entero con una ventaja: la tabla `notificaciones` tiene índice único
 * `(userId, dedupeKey)`, así que la idempotencia del efecto se puede
 * DEMOSTRAR, no solo afirmar.
 */
export const EFECTOS: Record<string, EjecutorDeEfecto> = {
  'supply.order.paid': (e) =>
    avisarAlCliente(e, {
      tipo: 'PAGO_APROBADO',
      titulo: 'Tu compra está confirmada',
      mensaje: 'Recibimos el pago de tu compra. Ya puedes ver lo que compraste en tus beneficios.',
      href: '/cliente/compras',
    }),
  'supply.order.payment_rejected': (e) =>
    avisarAlCliente(e, {
      tipo: 'PAGO_RECHAZADO',
      titulo: 'Tu pago no se pudo confirmar',
      mensaje: 'El pago de tu compra fue rechazado. Puedes intentarlo de nuevo desde tus compras.',
      href: '/cliente/compras',
    }),

  /**
   * Y los avisos del bloque 5, que se registran aquí en vez de repetir el
   * mecanismo. Son los mismos efectos del outbox —con su escalera, su cola de
   * difuntos y su panel— y lo único que cambia es por dónde salen: dentro de
   * Membego o por correo, según el canal que lleve el efecto.
   *
   * Los dos de arriba se quedan como están. Se podrían reescribir sobre el
   * mecanismo nuevo, pero son el camino del dinero y ya están probados contra
   * PostgreSQL: cambiarlos sin necesidad es gastar el único crédito que vale,
   * el de que esa parte funciona.
   */
  ...EFECTOS_DE_AVISO,
}

export interface ResultadoDespacho {
  /** Las filas que este despachador se llevó. Por id, para poder comprobarlo. */
  encolados: string[]
  /** Las que reclamó y no pudo encolar: vuelven a estar disponibles. */
  devueltos: string[]
}

/**
 * PASO 1 · RECLAMAR Y ENCOLAR.
 *
 * El reclamo es el candado: `reclamarEfectos` pone la fila en PROCESSING con un
 * `UPDATE` condicionado al estado, así que de dos despachadores simultáneos solo
 * uno se lleva cada fila —el otro actualiza cero filas y sigue—. Por eso «dos
 * despachadores → un trabajo» no depende de la deduplicación de la cola: ya
 * está decidido antes de llegar a ella. La clave de deduplicación es el segundo
 * cinturón, para cuando la publicación misma se reintenta.
 *
 * Si encolar falla, la fila se DEVUELVE (se marca fallida con la escalera) en
 * vez de quedarse reclamada: una fila reclamada que nadie va a entregar es
 * exactamente lo que el arriendo tiene que ir a rescatar después, y es mejor no
 * crear el problema que confiar en el rescate.
 */
export async function despacharEfectos(
  ctx: ContextoAuditoria,
  limite = 20,
  ahora = new Date()
): Promise<ResultadoDespacho> {
  const reclamados = await reclamarEfectos(limite, ahora)
  const encolados: string[] = []
  const devueltos: string[] = []

  for (const efecto of reclamados) {
    try {
      const donde = await encolar({
        tipo: 'supply-v2-efecto',
        outboxId: efecto.id,
        correlationId: efecto.correlationId,
        intentos: efecto.attempts,
      })
      encolados.push(efecto.id)
      anotarSupply({
        event: 'efecto_encolado',
        outboxId: efecto.id,
        correlationId: efecto.correlationId,
        attempt: efecto.attempts,
        status: donde,
      })
    } catch (e) {
      // Nota: con la cola degradada a ejecución en línea, el fallo del EFECTO
      // llega hasta aquí. `entregarEfecto` ya lo marcó, así que no se vuelve a
      // marcar: solo se anota que esta fila no se pudo despachar.
      devueltos.push(efecto.id)
      anotarSupply({
        event: 'efecto_no_despachado',
        outboxId: efecto.id,
        correlationId: efecto.correlationId,
        attempt: efecto.attempts,
        errorCode: sanearError(e),
      })
      await devolverSiSigueReclamado(efecto.id, e, ctx, ahora)
    }
  }

  return { encolados, devueltos }
}

/**
 * PASO 2 · ENTREGAR. Esto es lo que ejecuta el worker de la cola.
 *
 * Idempotente a propósito en los dos extremos:
 *
 *   · Una fila ya ENTREGADA no se vuelve a entregar: el reintento de la cola
 *     sobre un trabajo que en realidad sí funcionó no manda el aviso dos veces.
 *   · El efecto recibe una `idempotencyKey` estable, así que incluso si el
 *     proceso murió DESPUÉS de hacer el efecto y ANTES de marcarlo, repetirlo
 *     no produce una segunda consecuencia (ver §8, caso 2).
 */
export async function entregarEfecto(
  outboxId: string,
  ctx: ContextoAuditoria,
  ahora = new Date()
): Promise<{ estado: 'DELIVERED' | 'FAILED' | 'DEAD_LETTER' | 'YA_ESTABA'; detalle: string }> {
  // `sinEmpresa` y no `prisma` a pelo: el outbox es una tabla de PLATAFORMA,
  // pero «sin inquilino» no es «sin contexto». Con RLS encendida una consulta
  // sin contexto no falla: devuelve CERO filas. Aquí cero filas se leería como
  // «ese efecto no existe» y el despacho se quedaría mudo para siempre. El
  // gate `rls:cobertura` no lo cazó porque mira por ARCHIVO y este ya tenía un
  // `sinEmpresa` más abajo; eso no lo hace menos defecto.
  const fila = await sinEmpresa('Supply 2.0: leer el efecto a entregar', (tx) =>
    tx.supplyV2OutboxEvent.findUnique({
    where: { id: outboxId },
    select: {
      id: true,
      eventType: true,
      aggregateType: true,
      aggregateId: true,
      payload: true,
      correlationId: true,
      dedupeKey: true,
      attempts: true,
      status: true,
    },
    })
  )
  if (!fila) {
    // La fila ya no está: no es un fallo del que reintentar sirva.
    anotarSupply({ event: 'efecto_inexistente', outboxId })
    return { estado: 'YA_ESTABA', detalle: 'el efecto ya no existe' }
  }
  if (fila.status === 'DELIVERED') {
    anotarSupply({ event: 'efecto_ya_entregado', outboxId, correlationId: fila.correlationId, status: fila.status })
    return { estado: 'YA_ESTABA', detalle: 'ya estaba entregado' }
  }
  if (fila.status !== 'PROCESSING') {
    // La fila ya no está reclamada: o el rescate la devolvió, o otro la movió.
    // Entregarla igualmente sería entregar lo que ahora es de otro, y dos
    // workers podrían hacerlo a la vez. No es un fallo —no se cuenta intento
    // ni se reprograma—: este trabajo simplemente llegó tarde.
    anotarSupply({ event: 'efecto_ya_no_reclamado', outboxId, correlationId: fila.correlationId, status: fila.status })
    return { estado: 'YA_ESTABA', detalle: `el efecto ya no está reclamado (${fila.status})` }
  }

  const ejecutor = EFECTOS[fila.eventType]
  if (!ejecutor) {
    // Un tipo sin ejecutor es un error NUESTRO, de programación, no del
    // destino: reintentarlo ocho veces no lo arregla. Pasa por la escalera
    // igualmente —acaba en dead letter y auditado— porque lo que no puede pasar
    // es que desaparezca en silencio.
    const estado = await marcarFallido(outboxId, new Error(`EFECTO_SIN_EJECUTOR: ${fila.eventType}`), ctx, ahora)
    anotarYContar(
      { event: 'efecto_sin_ejecutor', outboxId, correlationId: fila.correlationId, attempt: fila.attempts, status: estado, errorCode: 'EFECTO_SIN_EJECUTOR' },
      { accion: 'efecto_sin_ejecutor', ok: false, motivo: 'sin_ejecutor' }
    )
    return { estado, detalle: 'no hay ejecutor para ese tipo de efecto' }
  }

  // ── Fuera de toda transacción ─────────────────────────────────────────────
  try {
    const r = await ejecutor({ ...fila, idempotencyKey: fila.dedupeKey })
    await marcarEntregado(outboxId)
    anotarYContar(
      { event: 'efecto_entregado', outboxId, correlationId: fila.correlationId, attempt: fila.attempts, status: 'DELIVERED' },
      { accion: 'efecto_entregado', ok: true }
    )
    return { estado: 'DELIVERED', detalle: r.detalle }
  } catch (e) {
    const estado = await marcarFallido(outboxId, e, ctx, ahora)
    anotarYContar(
      { event: 'efecto_fallido', outboxId, correlationId: fila.correlationId, attempt: fila.attempts + 1, status: estado, errorCode: sanearError(e) },
      { accion: 'efecto_fallido', ok: false, motivo: estado === 'DEAD_LETTER' ? 'dead_letter' : 'reprogramado' }
    )
    return { estado, detalle: sanearError(e) }
  }
}

/**
 * PASO 3 · RESCATAR ARRIENDOS ABANDONADOS (§8, caso 1).
 *
 * Una fila en PROCESSING cuyo `claimedAt` es viejo la reclamó alguien que ya no
 * está. Se trata como un FALLO, no como un reclamo nuevo, y es deliberado:
 * pasa por la escalera compartida, consume un intento y acaba en dead letter si
 * se repite. Devolverla «limpia» a PENDING sería un bucle infinito perfecto
 * —una fila que mata al worker lo mataría para siempre, sin que nadie se
 * enterara—.
 */
export async function recuperarArriendos(
  ctx: ContextoAuditoria,
  arriendoMs = ARRIENDO_MS,
  ahora = new Date()
): Promise<{ recuperados: string[]; muertos: string[] }> {
  const limite = new Date(ahora.getTime() - arriendoMs)
  // `sinEmpresa` y no `prisma` a pelo: el outbox es una tabla de PLATAFORMA,
  // pero «sin inquilino» no es «sin contexto». Con RLS encendida una consulta
  // sin contexto no falla: devuelve CERO filas. Aquí cero filas se leería como
  // «ese efecto no existe» y el despacho se quedaría mudo para siempre. El
  // gate `rls:cobertura` no lo cazó porque mira por ARCHIVO y este ya tenía un
  // `sinEmpresa` más abajo; eso no lo hace menos defecto.
  const abandonadas = await sinEmpresa('Supply 2.0: efectos con el arriendo vencido', (tx) =>
    tx.supplyV2OutboxEvent.findMany({
      where: { status: 'PROCESSING', claimedAt: { lt: limite } },
      select: { id: true, correlationId: true, attempts: true },
      take: 100,
    })
  )

  const recuperados: string[] = []
  const muertos: string[] = []
  for (const fila of abandonadas) {
    const estado = await marcarFallido(
      fila.id,
      new Error('RECLAMO_ABANDONADO: un worker lo reclamó y no terminó'),
      ctx,
      ahora
    )
    if (estado === 'DEAD_LETTER') muertos.push(fila.id)
    else recuperados.push(fila.id)
    anotarSupply({
      event: 'arriendo_recuperado',
      outboxId: fila.id,
      correlationId: fila.correlationId,
      attempt: fila.attempts + 1,
      status: estado,
      errorCode: 'RECLAMO_ABANDONADO',
    })
  }
  return { recuperados, muertos }
}

// ── Efectos concretos ───────────────────────────────────────────────────────

/**
 * El aviso al cliente dueño de la compra.
 *
 * Escribe la notificación DIRECTAMENTE y no con `crearNotificacion`, y la razón
 * importa: ese ayudante se traga el error (`catch` → `console.error`) porque
 * para un aviso nacido de un clic eso es correcto —no vas a tumbar una compra
 * porque la campanita falle—. Aquí es justo lo contrario: el worker existe para
 * REACCIONAR al fallo, y un ayudante que lo oculta dejaría la fila marcada
 * como entregada sin que el aviso exista.
 *
 * La `idempotencyKey` va al `dedupeKey` de la notificación, que tiene índice
 * único `(userId, dedupeKey)`. Eso es lo que hace que el caso 2 de §8 —el
 * proceso muere tras hacer el efecto y antes de marcarlo— no produzca dos
 * avisos: el segundo intento choca con el índice y se trata como ya hecho.
 */
async function avisarAlCliente(
  e: EfectoAEntregar,
  aviso: { tipo: NotifTipo; titulo: string; mensaje: string; href: string }
): Promise<{ detalle: string }> {
  const orden = await sinEmpresa('Supply 2.0: a quién avisar de esta compra', (tx) =>
    tx.supplyV2CustomerOrder.findUnique({
      where: { id: e.aggregateId },
      select: { customerId: true, number: true },
    })
  )
  if (!orden) {
    // Sin orden no hay a quién avisar. No es transitorio: no se reintenta
    // ocho veces una compra que no existe.
    throw new Error('ORDEN_INEXISTENTE: el efecto apunta a una compra que no está')
  }

  try {
    await sinEmpresa('Supply 2.0: avisar al cliente del resultado de su pago', (tx) =>
      tx.notificacion.create({
        data: {
          userId: orden.customerId,
          tipo: aviso.tipo,
          titulo: aviso.titulo,
          mensaje: `${aviso.mensaje} (compra ${orden.number})`,
          href: aviso.href,
          dedupeKey: e.idempotencyKey,
        },
      })
    )
    return { detalle: `aviso creado para la compra ${orden.number}` }
  } catch (err) {
    // P2002: el aviso ya existía. Es la idempotencia funcionando —el intento
    // anterior sí llegó, aunque no pudiéramos marcarlo— y se trata como hecho.
    if (err && typeof err === 'object' && 'code' in err && err.code === 'P2002') {
      return { detalle: `el aviso de la compra ${orden.number} ya existía` }
    }
    throw err
  }
}

/**
 * Si la fila sigue reclamada por nosotros, se marca fallida para que vuelva a
 * estar disponible. Si ya la movió otro —el efecto corrió en línea y se marcó—,
 * no se toca: marcar dos veces consumiría un intento que nadie gastó.
 */
async function devolverSiSigueReclamado(
  id: string,
  error: unknown,
  ctx: ContextoAuditoria,
  ahora: Date
): Promise<void> {
  const fila = await sinEmpresa('Supply 2.0: estado del efecto antes de anotar el fallo', (tx) =>
    tx.supplyV2OutboxEvent.findUnique({ where: { id }, select: { status: true } })
  )
  if (fila?.status !== 'PROCESSING') return
  await marcarFallido(id, error, ctx, ahora)
}

/** Lo que el ejecutor de la cola necesita saber del payload, sin tocar JSON. */
export type PayloadDeEfecto = Prisma.JsonValue
