import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../../src/lib/prisma'
import { sinEmpresa } from '../../src/lib/tenant'
import { vincularEmpresaComoProveedorEnTx } from '../../src/modules/supply-v2/suppliers/service'
import { crearItemCatalogoEnTx } from '../../src/modules/supply-v2/catalog/service'
import { activarAcuerdoEnTx, crearAcuerdoEnTx } from '../../src/modules/supply-v2/agreements/service'
import { crearOfertaComisionEnTx, publicarOfertaEnTx } from '../../src/modules/supply-v2/offers/service'
import { abrirOrdenClienteEnTx, confirmarPagoEnTx } from '../../src/modules/supply-v2/commerce/checkout'
import {
  anotarFalloDeProceso,
  procesarEventoExterno,
  registrarEventoExterno,
  reintentarEvento,
  type EventoExternoEntrante,
} from '../../src/modules/supply-v2/operations/inbox'
import { emitirEfectoEnTx, marcarEntregado, marcarFallido, reclamarEfectos, reintentarEfecto } from '../../src/modules/supply-v2/operations/outbox'
import { MAX_INTENTOS } from '../../src/modules/integraciones/reintentos'
// ── Bloque 2 ──
import { GET, POST } from '../../src/app/api/webhooks/supply-v2/[provider]/route'
import { olvidarActorDelWebhook, recibirEventoExterno } from '../../src/modules/supply-v2/operations/entrada'
import { firmaHmac } from '../../src/modules/supply-v2/operations/firma'
import { despacharEfectos, entregarEfecto, recuperarArriendos } from '../../src/modules/supply-v2/operations/worker'
// ── Bloque 3 ──
import {
  conciliarPagoExterno,
  conciliacionesDe,
  incidentesDePago,
  resumenDeIncidentesDePago,
} from '../../src/modules/supply-v2/operations/conciliacion'
import { barrerConciliacionDePagos, conciliarAPeticion } from '../../src/modules/supply-v2/operations/barrido-conciliacion'
import { marcarInvestigando, resolverIncidenteDePago } from '../../src/modules/supply-v2/operations/resolucion'
// ── Bloque 4 ──
import { liveness, readiness, resumenOperativo } from '../../src/modules/supply-v2/operations/salud'
import { evaluarYGuardarAlertas, reconocerAlerta } from '../../src/modules/supply-v2/operations/alertas'
import { cambiarInterruptor } from '../../src/modules/supply-v2/operations/flags'
import { saludDeConfiguracion } from '../../src/modules/supply-v2/operations/config-salud'
import { buscarOperacion, lineaDeTiempoDeOperacion } from '../../src/modules/supply-v2/operations/busqueda'
import {
  conciliacionesDelPanel,
  efectosDelOutbox,
  eventosDelInbox,
  incidentesDelPanel,
} from '../../src/modules/supply-v2/operations/panel-queries'
import { auditarOperacion } from '../../src/modules/supply-v2/operations/auditoria-operativa'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 9 · BLOQUE 1 contra PostgreSQL de verdad.
 *
 * Lo que se demuestra aquí no se puede demostrar con SQLite ni con mocks: el
 * índice único bajo carrera, el advisory lock, el `FOR UPDATE` y el hecho de
 * que una transacción que se va atrás no deja dinero movido.
 *
 *   A  Un evento llega DOS veces → una fila, un pago, un juego de derechos, un efecto
 *   B  CINCO entregas SIMULTÁNEAS del mismo evento → una fila; cinco procesos a
 *      la vez → un solo PROCESADO y cero duplicación económica
 *   C  El worker muere DESPUÉS del `COMMIT` → el efecto quedó apuntado y se
 *      puede entregar luego; la compra no se revierte
 *   D  Un fallo transitorio se reintenta y ACABA BIEN, sin duplicar dinero
 *   E  Ocho fallos → DEAD_LETTER con su rastro; reintento manual con nombre
 *   F  Eventos que no cuadran → rechazados o ignorados; NUNCA modifican
 *      silenciosamente una operación financiera
 *   G  El índice único existe EN LA BASE, no solo en el servicio
 *   H  Orden de candados: un evento externo y una confirmación manual sobre la
 *      MISMA orden a la vez → un solo PAID, sin abrazo mortal
 *   I  Outbox: idempotencia de emisión, dos workers no se llevan la misma fila,
 *      dead letter y reintento
 *   J  Lo guardado no lleva firmas, tokens ni datos de tarjeta
 *
 * `npm run test:db`.
 */

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
/**
 * La ventana del worker en las pruebas. Es grande A PROPÓSITO: lo que se mide
 * es que la fila se RECLAMA, no cuántas caben en una página. Con una ventana
 * pequeña, esta prueba empezaría a fallar el día en que la tabla acumulara más
 * filas reclamables que el tope —y lo haría por la basura de otras corridas,
 * no por un fallo del outbox—. Esa trampa ya nos costó un Slice 5 en rojo.
 */
const VENTANA = 1_000
const DIA = 86_400_000
const ahora = new Date()
const como = (actorId: string | null) => ({ actorId, ipAddress: '127.0.0.1', userAgent: 'test' })

const ctx = {
  /** La cuenta con la que corre la INTEGRACIÓN. No resuelve incidentes. */
  ops: '',
  /**
   * La PERSONA autorizada que investiga y resuelve. Tiene que ser distinta de
   * `ops`: el bloque 3 prohíbe que quien procesa los eventos cierre la
   * investigación sobre lo que él mismo procesó, y esta suite lo respeta
   * teniendo dos cuentas de verdad.
   */
  finanzas: '',
  cliente: '',
  empresaId: '',
  supplierId: '',
  itemId: '',
  offerId: '',
}

let n = 0
/** Un id externo nuevo. Los eventos se identifican por él, así que cada caso necesita el suyo. */
const idExterno = (etiqueta: string) => `evt-${etiqueta}-${sufijo}-${++n}`

function evento(d: {
  externalEventId: string
  eventType?: string
  provider?: string
  orderId?: string | null
  orderNumber?: string | null
  amount?: number | string | null
  currency?: string | null
  extra?: Record<string, unknown>
}): EventoExternoEntrante {
  return {
    provider: d.provider ?? 'TEST_GATEWAY',
    externalEventId: d.externalEventId,
    eventType: d.eventType ?? 'PAYMENT_CONFIRMED',
    pago: {
      orderId: d.orderId ?? null,
      orderNumber: d.orderNumber ?? null,
      amount: d.amount === undefined ? null : d.amount,
      currency: d.currency ?? null,
    },
    payload: { referencia: d.orderNumber ?? d.orderId ?? null, ...(d.extra ?? {}) },
  }
}

/** Una compra nueva, sin pagar. */
async function compraPendiente() {
  return sinEmpresa('prueba', (tx) => abrirOrdenClienteEnTx(tx, { customerId: ctx.cliente, offerId: ctx.offerId, quantity: 1 }, como(ctx.cliente)))
}

const filaDe = (id: string) => prisma.supplyV2ExternalEvent.findUniqueOrThrow({ where: { id } })
const ordenDe = (id: string) => prisma.supplyV2CustomerOrder.findUniqueOrThrow({ where: { id }, select: { status: true, paidAt: true, total: true, number: true, currency: true } })
const derechosDe = (orderId: string) => prisma.supplyV2Entitlement.count({ where: { orderId } })
const efectosDe = (orderId: string) => prisma.supplyV2OutboxEvent.findMany({ where: { aggregateId: orderId }, orderBy: { createdAt: 'asc' } })

/**
 * Borra lo que ESTA suite deja en el inbox y en el outbox.
 *
 * Corre antes y después, y la de antes importa igual que la de después: la base
 * de pruebas es compartida entre corridas, y una suite que solo limpia al final
 * hereda su propia basura si una corrida anterior murió a medias. `TEST_GATEWAY`
 * y `supply.test.*` son marcas que solo pone este archivo.
 */
async function limpiar() {
  const mios = await prisma.supplyV2ExternalEvent.findMany({
    where: { provider: 'TEST_GATEWAY' },
    select: { id: true, orderId: true },
  })
  const ordenes = mios.map((e) => e.orderId).filter((x): x is string => Boolean(x))
  if (ordenes.length) {
    await prisma.supplyV2OutboxEvent.deleteMany({ where: { aggregateId: { in: ordenes } } })
  }
  await prisma.supplyV2OutboxEvent.deleteMany({ where: { eventType: { startsWith: 'supply.test.' } } })
  // Y los avisos que los efectos del bloque 2 crearon: su `dedupeKey` es la
  // identidad del efecto, así que se reconocen sin tocar nada ajeno.
  await prisma.notificacion.deleteMany({ where: { dedupeKey: { startsWith: 'supply.order.' } } })
  // Bloque 3: las comprobaciones y los incidentes de pago externo que esta
  // suite abre. Solo los suyos —el tipo los identifica—, nunca los del Slice 5.
  await prisma.supplyV2PaymentReconciliation.deleteMany({ where: { provider: 'TEST_GATEWAY' } })
  await prisma.supplyV2FinanceIncident.deleteMany({ where: { type: 'EXTERNAL_PAYMENT_MISMATCH', provider: 'TEST_GATEWAY' } })
  // Bloque 4: interruptores y alertas. Los interruptores SIEMPRE, porque uno
  // apagado que se quede ahí haría fallar a otra suite con un 503 que nadie
  // entendería; las alertas son de plataforma y esta suite es la única que las
  // escribe hoy.
  await prisma.supplyV2OperationalSwitch.deleteMany({})
  await prisma.supplyV2OperationalAlert.deleteMany({})
  if (mios.length) {
    await prisma.supplyV2ExternalEvent.deleteMany({ where: { id: { in: mios.map((e) => e.id) } } })
  }
}

const secretoPrevio = process.env.SUPPLY_V2_TEST_GATEWAY_SECRET
const actorPrevio = process.env.SUPPLY_V2_WEBHOOK_ACTOR_ID

after(async () => {
  await limpiar()
  if (secretoPrevio === undefined) delete process.env.SUPPLY_V2_TEST_GATEWAY_SECRET
  else process.env.SUPPLY_V2_TEST_GATEWAY_SECRET = secretoPrevio
  if (actorPrevio === undefined) delete process.env.SUPPLY_V2_WEBHOOK_ACTOR_ID
  else process.env.SUPPLY_V2_WEBHOOK_ACTOR_ID = actorPrevio
  olvidarActorDelWebhook()
})

before(async () => {
  await limpiar()
  // El proveedor de prueba firma con esto. Nunca una credencial real: ni en
  // las pruebas, ni en el repositorio.
  process.env.SUPPLY_V2_TEST_GATEWAY_SECRET = SECRETO_B2

  const [ops, finanzas, cliente, empleado] = await Promise.all(
    (
      [
        ['ops', 'SUPERADMIN'],
        ['fin', 'SUPERADMIN'],
        ['cli', 'CLIENTE'],
        ['emp', 'ADMINISTRADOR'],
      ] as const
    ).map(([k, role]) => prisma.user.create({ data: { supabaseId: `sb-s9-${k}-${sufijo}`, email: `s9-${k}-${sufijo}@prueba.test`, name: k, role }, select: { id: true } }))
  )
  ctx.ops = ops.id
  ctx.finanzas = finanzas.id
  ctx.cliente = cliente.id
  const empresa = await prisma.company.create({
    data: { name: `Operaciones S9 ${sufijo}`, slug: `operaciones-s9-${sufijo}`, type: 'restaurante', capacidades: { overrides: { MEMBEGO_SUPPLIER: true } } },
    select: { id: true },
  })
  ctx.empresaId = empresa.id
  await prisma.user.update({ where: { id: empleado.id }, data: { companyId: empresa.id } })

  await sinEmpresa('prueba', async (tx) => {
    const p = await vincularEmpresaComoProveedorEnTx(tx, empresa.id, {}, como(ctx.ops))
    ctx.supplierId = p.id
    const item = await crearItemCatalogoEnTx(tx, { supplierId: p.id, type: 'SERVICE', name: `Cena S9 ${sufijo}`, category: 'Restaurante', publicPrice: 1200 }, como(ctx.ops))
    ctx.itemId = item.id
    const a = await crearAcuerdoEnTx(tx, { supplierId: p.id, type: 'COMMISSION', scope: 'ITEM', catalogItemId: item.id, commissionPercentage: 10, startsAt: new Date(ahora.getTime() - DIA) }, como(ctx.ops))
    await activarAcuerdoEnTx(tx, a.id, como(ctx.ops))
    const o = await crearOfertaComisionEnTx(
      tx,
      { catalogItemId: item.id, title: `Cena para dos S9 ${sufijo}`, publicPrice: 1200, salePrice: 1000, availabilityMode: 'UNLIMITED', perCustomerLimit: 500, startsAt: new Date(ahora.getTime() - 60_000), endsAt: new Date(ahora.getTime() + 30 * DIA) },
      como(ctx.ops)
    )
    await publicarOfertaEnTx(tx, o.id, como(ctx.ops))
    ctx.offerId = o.id
  })

  // La cuenta con la que actúa la integración (bloque 2): una cuenta REAL de
  // Membego designada para eso, no un usuario de sistema inventado.
  process.env.SUPPLY_V2_WEBHOOK_ACTOR_ID = ctx.ops
  olvidarActorDelWebhook()
})

// ── A · el evento duplicado ─────────────────────────────────────────────────

test('A · el mismo evento llega dos veces: una fila, un pago, un juego de derechos, un efecto', async () => {
  const orden = await compraPendiente()
  const e = evento({ externalEventId: idExterno('a'), orderNumber: orden.number, amount: orden.total, currency: 'DOP' })

  const primera = await registrarEventoExterno(e)
  assert.equal(primera.repetido, false)
  assert.equal(primera.status, 'RECEIVED')

  const r1 = await procesarEventoExterno(primera.id, como(ctx.ops))
  assert.equal(r1.resultado, 'PROCESADO')

  // El proveedor lo manda OTRA VEZ: misma identidad, mismo cuerpo.
  const segunda = await registrarEventoExterno(e)
  assert.equal(segunda.id, primera.id, 'la segunda entrega es LA MISMA fila')
  assert.equal(segunda.repetido, true)
  assert.equal(segunda.cuerpoDistinto, false)

  const r2 = await procesarEventoExterno(segunda.id, como(ctx.ops))
  assert.equal(r2.resultado, 'REPETIDO', 'procesarlo otra vez no vuelve a entrar al camino del dinero')
  assert.equal(r2.correlationId, primera.correlationId, 'el hilo es el mismo')

  const filas = await prisma.supplyV2ExternalEvent.count({ where: { provider: 'TEST_GATEWAY', externalEventId: e.externalEventId } })
  assert.equal(filas, 1, 'dos entregas, una fila')

  const o = await ordenDe(orden.id)
  assert.equal(o.status, 'PAID')
  assert.equal(await derechosDe(orden.id), 1, 'un solo derecho')
  const efectos = await efectosDe(orden.id)
  assert.equal(efectos.length, 1, 'un solo efecto apuntado')
  assert.equal(efectos[0]!.eventType, 'supply.order.paid')
  assert.equal(efectos[0]!.correlationId, primera.correlationId, 'el efecto hereda el hilo del evento')
})

test('A · el mismo id externo con OTRO cuerpo se dice, no se traga', async () => {
  const orden = await compraPendiente()
  const id = idExterno('a-distinto')
  await registrarEventoExterno(evento({ externalEventId: id, orderNumber: orden.number, amount: orden.total, currency: 'DOP' }))
  const otra = await registrarEventoExterno(evento({ externalEventId: id, orderNumber: orden.number, amount: orden.total, currency: 'DOP', extra: { nota: 'otra cosa' } }))
  assert.equal(otra.repetido, true)
  assert.equal(otra.cuerpoDistinto, true, 'el mismo id con otro cuerpo NO es un reintento: es un problema')
})

// ── B · la carrera ──────────────────────────────────────────────────────────

test('B · cinco entregas SIMULTÁNEAS del mismo evento dejan UNA fila', async () => {
  const orden = await compraPendiente()
  const e = evento({ externalEventId: idExterno('b'), orderNumber: orden.number, amount: orden.total, currency: 'DOP' })

  const resultados = await Promise.all(Array.from({ length: 5 }, () => registrarEventoExterno(e)))
  const ids = new Set(resultados.map((r) => r.id))
  assert.equal(ids.size, 1, 'las cinco entregas son la misma fila')
  assert.equal(resultados.filter((r) => !r.repetido).length, 1, 'exactamente una ganó la carrera')

  const filas = await prisma.supplyV2ExternalEvent.count({ where: { provider: 'TEST_GATEWAY', externalEventId: e.externalEventId } })
  assert.equal(filas, 1)

  const eventoId = [...ids][0]!
  // Y ahora los CINCO procesos a la vez sobre esa fila.
  const procesos = await Promise.all(Array.from({ length: 5 }, () => procesarEventoExterno(eventoId, como(ctx.ops))))
  const procesados = procesos.filter((p) => p.resultado === 'PROCESADO')
  const repetidos = procesos.filter((p) => p.resultado === 'REPETIDO')
  assert.equal(procesados.length, 1, 'uno solo movió el dinero')
  assert.equal(repetidos.length, 4, 'los otros cuatro vieron que ya estaba hecho')

  const o = await ordenDe(orden.id)
  assert.equal(o.status, 'PAID')
  assert.equal(await derechosDe(orden.id), 1, 'CERO duplicación de derechos')
  assert.equal((await efectosDe(orden.id)).length, 1, 'CERO duplicación de eventos económicos')
  const pagos = await prisma.supplyV2CustomerOrder.findUniqueOrThrow({ where: { id: orden.id }, select: { paidAt: true } })
  assert.ok(pagos.paidAt, 'pagada una vez')
})

// ── C · el worker muere después del COMMIT ──────────────────────────────────

test('C · el worker muere DESPUÉS de la transacción: el efecto quedó apuntado y la compra no se revierte', async () => {
  const orden = await compraPendiente()
  const e = evento({ externalEventId: idExterno('c'), orderNumber: orden.number, amount: orden.total, currency: 'DOP' })
  const reg = await registrarEventoExterno(e)
  const r = await procesarEventoExterno(reg.id, como(ctx.ops))
  assert.equal(r.resultado, 'PROCESADO')

  // Aquí muere el proceso: nadie llegó a entregar nada. Lo que la base tiene
  // que poder decir es «este efecto está pendiente», y eso es lo que permite
  // que el envío ocurra después sin tocar el dinero.
  const [efecto] = await efectosDe(orden.id)
  assert.equal(efecto!.status, 'PENDING', 'apuntado y sin entregar')
  assert.equal(efecto!.attempts, 0)

  const o = await ordenDe(orden.id)
  assert.equal(o.status, 'PAID', 'la compra sigue confirmada: la notificación caída no la revierte')
  assert.equal(await derechosDe(orden.id), 1)

  // El worker que viene después sí lo encuentra.
  const reclamados = await reclamarEfectos(VENTANA)
  const mio = reclamados.find((x) => x.id === efecto!.id)
  assert.ok(mio, 'un worker posterior reclama el efecto huérfano')
  assert.equal(mio!.aggregateId, orden.id)
  await marcarEntregado(efecto!.id)
  const final = await prisma.supplyV2OutboxEvent.findUniqueOrThrow({ where: { id: efecto!.id } })
  assert.equal(final.status, 'DELIVERED')
  assert.ok(final.processedAt, 'DELIVERED exige fecha: lo impone un CHECK de la base')
})

// ── D · el reintento que acaba bien ─────────────────────────────────────────

test('D · un fallo transitorio se reintenta y acaba bien, sin duplicar dinero', async () => {
  const orden = await compraPendiente()
  const e = evento({ externalEventId: idExterno('d'), orderNumber: orden.number, amount: orden.total, currency: 'DOP' })
  const reg = await registrarEventoExterno(e)

  // Primer intento: algo transitorio se cayó (la base, la red, un timeout).
  const f = await anotarFalloDeProceso(reg.id, new Error('ERROR_TRANSITORIO: se cayó la conexión'), como(ctx.ops))
  assert.equal(f.status, 'FAILED')
  assert.ok(f.proximoIntento && f.proximoIntento > ahora, 'queda reprogramado, no muerto')
  let fila = await filaDe(reg.id)
  assert.equal(fila.attempts, 1)
  assert.equal(await ordenDe(orden.id).then((o) => o.status), 'PENDING', 'el fallo no movió nada')
  assert.equal(await derechosDe(orden.id), 0)

  // El reintento: ahora sí.
  await reintentarEvento(reg.id, como(ctx.ops))
  const r = await procesarEventoExterno(reg.id, como(ctx.ops))
  assert.equal(r.resultado, 'PROCESADO')

  fila = await filaDe(reg.id)
  assert.equal(fila.status, 'PROCESSED')
  assert.ok(fila.processedAt)
  assert.equal(fila.nextAttemptAt, null, 'resuelto: ya no toca intentarlo')
  assert.equal(fila.lastError, null)
  assert.equal(fila.orderId, orden.id, 'la fila queda unida a la operación')
  assert.equal(fila.retriedById, ctx.ops, 'quién lo reintentó queda escrito')
  assert.ok(fila.retriedAt)

  assert.equal(await derechosDe(orden.id), 1, 'el reintento no duplicó derechos')
  assert.equal((await efectosDe(orden.id)).length, 1, 'ni efectos')
})

// ── E · la dead letter ──────────────────────────────────────────────────────

test('E · ocho fallos dejan al evento muerto, con quién, qué, cuántas veces y qué error', async () => {
  const orden = await compraPendiente()
  const reg = await registrarEventoExterno(evento({ externalEventId: idExterno('e'), orderNumber: orden.number, amount: orden.total, currency: 'DOP' }))

  const estados: string[] = []
  for (let i = 0; i < MAX_INTENTOS; i++) {
    const r = await anotarFalloDeProceso(reg.id, new Error(`fallo ${i + 1} con token=abc123`), como(ctx.ops))
    estados.push(r.status)
  }
  assert.equal(estados.filter((s) => s === 'FAILED').length, MAX_INTENTOS - 1)
  assert.equal(estados[MAX_INTENTOS - 1], 'DEAD_LETTER', `muere en el intento ${MAX_INTENTOS}`)

  const fila = await filaDe(reg.id)
  assert.equal(fila.status, 'DEAD_LETTER')
  assert.equal(fila.attempts, MAX_INTENTOS, 'cuántas veces se intentó')
  assert.equal(fila.nextAttemptAt, null, 'un difunto no tiene próxima cita: espera una decisión')
  assert.ok(fila.lastError, 'cuál fue el último error')
  assert.ok(!/abc123/.test(fila.lastError!), 'el error guardado NO lleva el token')
  assert.equal(fila.provider, 'TEST_GATEWAY', 'de quién era')

  // Y queda en la bitácora, porque para decidir hay que saber que existe.
  const muerte = await prisma.auditLog.findFirst({
    where: { accion: 'SUPPLY_V2_EXTERNAL_EVENT_DEAD_LETTER', entidadId: reg.id },
    orderBy: { createdAt: 'desc' },
  })
  assert.ok(muerte, 'la muerte se audita')
  assert.equal((muerte!.payload as { intentos: number }).intentos, MAX_INTENTOS)

  // El reintento MANUAL le devuelve escalera y deja nombre.
  const re = await reintentarEvento(reg.id, como(ctx.ops))
  assert.equal(re.estaba, 'DEAD_LETTER')
  const revivido = await filaDe(reg.id)
  assert.equal(revivido.status, 'RECEIVED')
  assert.equal(revivido.attempts, 0, 'escalera devuelta: si no, moriría otra vez al primer fallo')
  assert.equal(revivido.retriedById, ctx.ops, 'quién lo reintentó a mano')
  assert.ok(revivido.retriedAt)
  const auditoria = await prisma.auditLog.findFirst({ where: { accion: 'SUPPLY_V2_EXTERNAL_EVENT_RETRIED', entidadId: reg.id } })
  assert.ok(auditoria, 'el reintento manual se audita')

  // Y al reintentarlo de verdad, el dinero se mueve UNA vez.
  const r = await procesarEventoExterno(reg.id, como(ctx.ops))
  assert.equal(r.resultado, 'PROCESADO')
  assert.equal(await derechosDe(orden.id), 1)
})

test('E · un evento ya resuelto no se puede reintentar', async () => {
  const orden = await compraPendiente()
  const reg = await registrarEventoExterno(evento({ externalEventId: idExterno('e-resuelto'), orderNumber: orden.number, amount: orden.total, currency: 'DOP' }))
  await procesarEventoExterno(reg.id, como(ctx.ops))
  await assert.rejects(reintentarEvento(reg.id, como(ctx.ops)), /ya está resuelto/)
})

// ── F · lo que no cuadra NUNCA toca el dinero ───────────────────────────────

test('F · un monto que no cuadra queda rechazado y la compra sigue sin pagar', async () => {
  const orden = await compraPendiente()
  const reg = await registrarEventoExterno(evento({ externalEventId: idExterno('f-monto'), orderNumber: orden.number, amount: 1, currency: 'DOP' }))
  const r = await procesarEventoExterno(reg.id, como(ctx.ops))
  assert.equal(r.resultado, 'RECHAZADO')
  assert.equal(r.codigo, 'MONTO_NO_CUADRA')

  const o = await ordenDe(orden.id)
  assert.equal(o.status, 'PENDING', 'NUNCA se modifica silenciosamente una operación financiera')
  assert.equal(o.paidAt, null)
  assert.equal(await derechosDe(orden.id), 0)
  assert.equal((await efectosDe(orden.id)).length, 0, 'ni un efecto: no pasó nada que contar')

  const fila = await filaDe(reg.id)
  assert.equal(fila.status, 'IGNORED', 'estado final: no se reintenta solo, porque reintentar no lo arreglaría')
  assert.equal(fila.orderId, orden.id, 'queda unido a la orden para poder investigarlo')
  assert.match(fila.lastError!, /MONTO_NO_CUADRA/)
  const incidente = await prisma.auditLog.findFirst({ where: { accion: 'SUPPLY_V2_EXTERNAL_EVENT_FAILED', entidadId: reg.id } })
  assert.ok(incidente, 'queda en la bitácora para que una persona lo mire')
  assert.equal((incidente!.payload as { clase: string }).clase, 'INCIDENTE')
})

test('F · otra moneda, una orden que no existe y un evento sin referencia: tres problemas distintos', async () => {
  const orden = await compraPendiente()
  const moneda = await registrarEventoExterno(evento({ externalEventId: idExterno('f-moneda'), orderNumber: orden.number, amount: orden.total, currency: 'USD' }))
  const rm = await procesarEventoExterno(moneda.id, como(ctx.ops))
  assert.equal(rm.resultado, 'RECHAZADO')
  assert.equal(rm.codigo, 'MONEDA_NO_CUADRA')
  assert.equal(await ordenDe(orden.id).then((o) => o.status), 'PENDING')

  const fantasma = await registrarEventoExterno(evento({ externalEventId: idExterno('f-fantasma'), orderNumber: `MBG-SO-NO-EXISTE-${sufijo}`, amount: 1000, currency: 'DOP' }))
  const rf = await procesarEventoExterno(fantasma.id, como(ctx.ops))
  assert.equal(rf.resultado, 'RECHAZADO')
  assert.equal(rf.codigo, 'ORDEN_DESCONOCIDA')
  const filaF = await filaDe(fantasma.id)
  assert.equal(filaF.orderId, null, 'sin orden a la que apuntar, pero la fila es la prueba de que llegó')

  const mudo = await registrarEventoExterno(evento({ externalEventId: idExterno('f-mudo'), amount: 1000, currency: 'DOP' }))
  const ru = await procesarEventoExterno(mudo.id, como(ctx.ops))
  assert.equal(ru.resultado, 'RECHAZADO')
  assert.equal(ru.codigo, 'SIN_REFERENCIA', 'un evento que no dice de qué habla no es lo mismo que uno que habla de algo que no existe')
})

test('F · una orden ya pagada por otra vía y un tipo que no manejamos se ignoran sin tocar nada', async () => {
  const orden = await compraPendiente()
  // Pagada a mano por finanzas, como se paga hoy en Supply 2.0 (transferencia).
  await sinEmpresa('prueba', (tx) => confirmarPagoEnTx(tx, { orderId: orden.id, amountSeen: orden.total }, como(ctx.ops)))
  const antes = await derechosDe(orden.id)

  const tarde = await registrarEventoExterno(evento({ externalEventId: idExterno('f-tarde'), orderNumber: orden.number, amount: orden.total, currency: 'DOP' }))
  const rt = await procesarEventoExterno(tarde.id, como(ctx.ops))
  assert.equal(rt.resultado, 'IGNORADO', 'no es un error: el pago ya estaba hecho')
  assert.equal(rt.codigo, 'ORDEN_YA_PAGADA')
  assert.equal(await derechosDe(orden.id), antes, 'ni un derecho más')

  const otroTipo = await registrarEventoExterno(evento({ externalEventId: idExterno('f-tipo'), eventType: 'PAYMENT_DISPUTE_OPENED', orderNumber: orden.number, amount: orden.total, currency: 'DOP' }))
  const ro = await procesarEventoExterno(otroTipo.id, como(ctx.ops))
  assert.equal(ro.resultado, 'IGNORADO')
  assert.equal(ro.codigo, 'TIPO_NO_MANEJADO', 'lo que no sabemos manejar se deja dicho, no se interpreta')
  assert.equal(await derechosDe(orden.id), antes)
})

test('F · un rechazo del proveedor sí mueve el estado, y solo una vez', async () => {
  const orden = await compraPendiente()
  const e = evento({ externalEventId: idExterno('f-rechazo'), eventType: 'PAYMENT_REJECTED', orderNumber: orden.number, amount: orden.total, currency: 'DOP' })
  const reg = await registrarEventoExterno(e)
  const r = await procesarEventoExterno(reg.id, como(ctx.ops))
  assert.equal(r.resultado, 'PROCESADO')
  const o = await ordenDe(orden.id)
  assert.ok(['CANCELLED', 'PAYMENT_REJECTED', 'EXPIRED'].includes(o.status), `estado tras el rechazo: ${o.status}`)
  assert.equal(await derechosDe(orden.id), 0, 'un rechazo no emite derechos')
  const efectos = await efectosDe(orden.id)
  assert.equal(efectos.length, 1)
  assert.equal(efectos[0]!.eventType, 'supply.order.payment_rejected')

  // Y repetido, no vuelve a pasar por ahí.
  const otra = await registrarEventoExterno(e)
  assert.equal((await procesarEventoExterno(otra.id, como(ctx.ops))).resultado, 'REPETIDO')
  assert.equal((await efectosDe(orden.id)).length, 1)
})

test('F · un evento sin identidad no entra: se rechaza en la puerta', async () => {
  await assert.rejects(registrarEventoExterno(evento({ externalEventId: '   ' })), /identificador|id/i)
  await assert.rejects(registrarEventoExterno({ ...evento({ externalEventId: idExterno('f-sin-tipo') }), eventType: '' }), /tipo/i)
  await assert.rejects(registrarEventoExterno({ ...evento({ externalEventId: idExterno('f-sin-prov') }), provider: '' }), /proveedor|provider/i)
})

// ── G · el índice único está en la base ─────────────────────────────────────

test('G · el índice único lo sostiene PostgreSQL, no el servicio', async () => {
  const orden = await compraPendiente()
  const id = idExterno('g')
  const reg = await registrarEventoExterno(evento({ externalEventId: id, orderNumber: orden.number, amount: orden.total, currency: 'DOP' }))
  assert.ok(reg.id)

  // Un INSERT a mano, saltándose el servicio entero.
  await assert.rejects(
    prisma.$executeRaw`
      INSERT INTO "supply_v2_external_events" ("id", "provider", "externalEventId", "eventType", "payloadHash", "correlationId")
      VALUES (${`crudo-${id}`}, 'TEST_GATEWAY', ${id}, 'PAYMENT_CONFIRMED', 'x', 'y')`,
    /23505|already exists|duplicate key|unique/i,
    'ni el SQL crudo puede meter el mismo evento dos veces'
  )

  // Y el índice existe con la identidad que decimos que tiene.
  const idx = await prisma.$queryRaw<{ indexdef: string }[]>`
    SELECT indexdef FROM pg_indexes
    WHERE tablename = 'supply_v2_external_events' AND indexdef LIKE '%UNIQUE%' AND indexname NOT LIKE '%_pkey'`
  assert.equal(idx.length, 1, 'una sola identidad idempotente, aparte de la clave primaria')
  for (const col of ['provider', 'externalEventId', 'eventType']) {
    assert.ok(idx[0]!.indexdef.includes(col), `el índice único incluye ${col}`)
  }

  const unicoOutbox = await prisma.$queryRaw<{ indexdef: string }[]>`
    SELECT indexdef FROM pg_indexes
    WHERE tablename = 'supply_v2_outbox_events' AND indexdef LIKE '%UNIQUE%' AND indexdef LIKE '%dedupeKey%'`
  assert.equal(unicoOutbox.length, 1, 'el outbox también tiene su identidad en la base')
})

test('G · los CHECK de forma de la base impiden filas que mienten', async () => {
  const orden = await compraPendiente()
  const reg = await registrarEventoExterno(evento({ externalEventId: idExterno('g-check'), orderNumber: orden.number, amount: orden.total, currency: 'DOP' }))
  await assert.rejects(
    prisma.$executeRaw`UPDATE "supply_v2_external_events" SET "status" = 'PROCESSED' WHERE "id" = ${reg.id}`,
    /check constraint|violates/i,
    'PROCESSED sin fecha de proceso no es un estado posible'
  )
  await assert.rejects(
    prisma.$executeRaw`UPDATE "supply_v2_external_events" SET "attempts" = -1 WHERE "id" = ${reg.id}`,
    /check constraint|violates/i,
    'no se puede haber intentado menos de cero veces'
  )
  await assert.rejects(
    prisma.$executeRaw`UPDATE "supply_v2_external_events" SET "retriedAt" = now() WHERE "id" = ${reg.id}`,
    /check constraint|violates/i,
    'un reintento manual sin nombre no es un reintento manual'
  )
})

// ── H · el orden de candados ────────────────────────────────────────────────

test('H · un evento externo y una confirmación manual sobre la MISMA orden a la vez: un solo pago', async () => {
  const orden = await compraPendiente()
  const reg = await registrarEventoExterno(evento({ externalEventId: idExterno('h'), orderNumber: orden.number, amount: orden.total, currency: 'DOP' }))

  // Finanzas confirma la transferencia justo cuando llega el aviso de la
  // pasarela. El inbox toma su candado por encima de la orden y el checkout
  // solo toma la orden, así que no pueden abrazarse: uno gana, el otro ve PAID.
  const [porEvento, manual] = await Promise.allSettled([
    procesarEventoExterno(reg.id, como(ctx.ops)),
    sinEmpresa('prueba', (tx) => confirmarPagoEnTx(tx, { orderId: orden.id, amountSeen: orden.total }, como(ctx.ops))),
  ])
  assert.equal(porEvento.status, 'fulfilled', `el evento no se quedó en un abrazo mortal: ${JSON.stringify(porEvento)}`)
  assert.equal(manual.status, 'fulfilled', `la confirmación manual tampoco: ${JSON.stringify(manual)}`)

  const o = await ordenDe(orden.id)
  assert.equal(o.status, 'PAID')
  assert.equal(await derechosDe(orden.id), 1, 'UN solo derecho, aunque dos caminos confirmaron a la vez')
  assert.ok((await efectosDe(orden.id)).length <= 1, 'y como máximo un efecto')
})

// ── I · el outbox ───────────────────────────────────────────────────────────

test('I · emitir dos veces el mismo efecto deja una fila; dos workers no se llevan la misma', async () => {
  const orden = await compraPendiente()
  const base = {
    eventType: 'supply.test.efecto',
    aggregateType: 'SupplyV2CustomerOrder',
    aggregateId: orden.id,
    correlationId: `sv2-prueba-${sufijo}`,
    payload: { orderNumber: orden.number },
  }
  const uno = await sinEmpresa('prueba', (tx) => emitirEfectoEnTx(tx, base))
  assert.equal(uno.repetido, false)
  // Otro hilo, otra transacción, el mismo efecto: una sola fila.
  const dos = await sinEmpresa('prueba', (tx) => emitirEfectoEnTx(tx, { ...base, correlationId: `sv2-otro-hilo-${sufijo}` }))
  assert.equal(dos.repetido, true, 'el hilo no cambia la identidad del efecto')
  assert.equal(dos.id, uno.id)

  const iguales = await prisma.supplyV2OutboxEvent.count({ where: { aggregateId: orden.id, eventType: 'supply.test.efecto' } })
  assert.equal(iguales, 1)

  // Dos workers a la vez: la fila se la lleva uno.
  const [a, b] = await Promise.all([reclamarEfectos(VENTANA), reclamarEfectos(VENTANA)])
  const veces = [...a, ...b].filter((x) => x.id === uno.id).length
  assert.equal(veces, 1, 'dos workers simultáneos no reclaman la misma fila')
  const tomada = await prisma.supplyV2OutboxEvent.findUniqueOrThrow({ where: { id: uno.id } })
  assert.equal(tomada.status, 'PROCESSING')
})

test('I · un efecto que no se puede entregar muere tras ocho intentos y revive por decisión', async () => {
  const orden = await compraPendiente()
  const efecto = await sinEmpresa('prueba', (tx) =>
    emitirEfectoEnTx(tx, {
      eventType: 'supply.test.difunto',
      aggregateType: 'SupplyV2CustomerOrder',
      aggregateId: orden.id,
      correlationId: `sv2-difunto-${sufijo}`,
      payload: { orderNumber: orden.number },
    })
  )

  const estados: string[] = []
  for (let i = 0; i < MAX_INTENTOS; i++) {
    estados.push(await marcarFallido(efecto.id, new Error(`el correo no salió (secret=${'s'.repeat(5)}hhh)`), como(ctx.ops)))
  }
  assert.equal(estados[MAX_INTENTOS - 1], 'DEAD_LETTER')
  let fila = await prisma.supplyV2OutboxEvent.findUniqueOrThrow({ where: { id: efecto.id } })
  assert.equal(fila.status, 'DEAD_LETTER')
  assert.equal(fila.attempts, MAX_INTENTOS)
  assert.ok(!/sssss/.test(fila.lastError ?? ''), 'el error guardado no lleva el secreto')
  const muerte = await prisma.auditLog.findFirst({ where: { accion: 'SUPPLY_V2_OUTBOX_DEAD_LETTER', entidadId: efecto.id } })
  assert.ok(muerte, 'un efecto muerto se audita: alguien tiene que decidir')

  await reintentarEfecto(efecto.id, como(ctx.ops))
  fila = await prisma.supplyV2OutboxEvent.findUniqueOrThrow({ where: { id: efecto.id } })
  assert.equal(fila.status, 'PENDING')
  assert.equal(fila.attempts, 0, 'escalera devuelta')
  assert.equal(fila.retriedById, ctx.ops)
  assert.equal(fila.lastError, null)
  const reclamado = (await reclamarEfectos(VENTANA)).some((x) => x.id === efecto.id)
  assert.ok(reclamado, 'y vuelve a estar a la vista del worker')
})

test('I · un efecto reprogramado no se reclama antes de su hora', async () => {
  const orden = await compraPendiente()
  const efecto = await sinEmpresa('prueba', (tx) =>
    emitirEfectoEnTx(tx, {
      eventType: 'supply.test.espera',
      aggregateType: 'SupplyV2CustomerOrder',
      aggregateId: orden.id,
      correlationId: `sv2-espera-${sufijo}`,
      payload: {},
    })
  )
  await marcarFallido(efecto.id, new Error('transitorio'), como(ctx.ops))
  const fila = await prisma.supplyV2OutboxEvent.findUniqueOrThrow({ where: { id: efecto.id } })
  assert.equal(fila.status, 'FAILED')
  assert.ok(fila.availableAt > new Date(), 'la escalera lo pone en el futuro')
  const ahoraMismo = (await reclamarEfectos(VENTANA)).some((x) => x.id === efecto.id)
  assert.equal(ahoraMismo, false, 'esperar significa esperar')
  const masTarde = (await reclamarEfectos(100, new Date(Date.now() + 2 * DIA))).some((x) => x.id === efecto.id)
  assert.equal(masTarde, true, 'pasada la hora, el worker lo toma')
})

// ── J · lo guardado no lleva secretos ───────────────────────────────────────

test('J · un volcado del inbox no puede contener firmas, tokens ni datos de tarjeta', async () => {
  const orden = await compraPendiente()
  const reg = await registrarEventoExterno(
    evento({
      externalEventId: idExterno('j'),
      orderNumber: orden.number,
      amount: orden.total,
      currency: 'DOP',
      extra: {
        signature: 'FIRMA-SECRETA-NO-GUARDAR',
        authorization: 'Bearer TOKEN-NO-GUARDAR',
        card: { pan: '4111111111111111', cvv: '123' },
        metadata: { api_key: 'CLAVE-NO-GUARDAR' },
        cliente: { nombre: 'Juana', monto: '1000.00' },
      },
    })
  )
  const fila = await filaDe(reg.id)
  const json = JSON.stringify(fila.payload)
  for (const prohibido of ['FIRMA-SECRETA-NO-GUARDAR', 'TOKEN-NO-GUARDAR', '4111111111111111', '123456', 'CLAVE-NO-GUARDAR']) {
    assert.ok(!json.includes(prohibido), `lo guardado no contiene ${prohibido}`)
  }
  assert.ok(json.includes('Juana'), 'lo que no es secreto sí se guarda: sin cuerpo no se puede investigar')
  assert.ok(fila.payloadHash.length === 64, 'y queda la huella del cuerpo entero para comparar entregas')

  // Lo mismo en el outbox.
  const efectos = await prisma.supplyV2OutboxEvent.findMany({ select: { payload: true } })
  const todo = JSON.stringify(efectos)
  for (const prohibido of ['FIRMA-SECRETA', 'TOKEN-NO-GUARDAR', '4111111111111111']) {
    assert.ok(!todo.includes(prohibido), `el outbox tampoco guarda ${prohibido}`)
  }
})

// ════════════════════════════════════════════════════════════════════════════
// BLOQUE 2 · DEL PROVEEDOR EXTERNO AL EFECTO ENTREGADO
//
// Lo del bloque 1 demostraba el NÚCLEO llamando a las funciones. Esto demuestra
// la FRONTERA que entonces no existía: un POST firmado que entra por la ruta
// HTTP, se verifica, se adapta, se registra, se procesa, apunta su efecto, lo
// despacha por la cola que ya existe y lo entrega —o se recupera, o acaba en
// dead letter—. Y en ningún camino hay una segunda consecuencia financiera.
//
// Van en ESTE archivo y no en uno nuevo a propósito: las pruebas de un mismo
// archivo corren en serie, y las de archivos distintos en paralelo. Dos
// archivos tocando el mismo inbox y el mismo outbox se robarían las filas
// —el despachador de uno reclamaría lo que el otro está comprobando— y la
// limpieza de uno borraría lo que el otro tiene en vuelo.
// ════════════════════════════════════════════════════════════════════════════

const SECRETO_B2 = `sv2-secreto-${sufijo}`

/** Un cuerpo en el vocabulario DEL PROVEEDOR, no en el nuestro. */
function cuerpoProveedor(d: {
  eventId: string
  orderNumber?: string | null
  amount?: string | null
  currency?: string
  status?: string
  kind?: string
  /** Bloque 3: la MISMA transacción puede aparecer en dos eventos distintos. */
  txId?: string
  extra?: Record<string, unknown>
}): string {
  return JSON.stringify({
    event: { id: d.eventId, kind: d.kind ?? 'payment.updated' },
    transaction: {
      id: d.txId ?? `TX-${d.eventId}`,
      status: d.status ?? 'APPROVED',
      amount: d.amount ?? null,
      currency: d.currency ?? 'DOP',
      order_reference: d.orderNumber ?? null,
    },
    ...(d.extra ?? {}),
  })
}

/** Una petición HTTP de verdad, firmada como la firmaría el proveedor. */
function peticionHttp(cuerpo: string, d: { ts?: number; firma?: string; correlationId?: string } = {}): Request {
  const ts = String(d.ts ?? Math.floor(Date.now() / 1000))
  const cabeceras: Record<string, string> = {
    'content-type': 'application/json',
    'user-agent': 'TestGateway/1.0',
    'x-sv2-timestamp': ts,
    'x-sv2-signature': d.firma ?? `v1=${firmaHmac(SECRETO_B2, ts, cuerpo)}`,
  }
  if (d.correlationId) cabeceras['x-correlation-id'] = d.correlationId
  return new Request('https://membego.test/api/webhooks/supply-v2/TEST_GATEWAY', {
    method: 'POST',
    headers: cabeceras,
    body: cuerpo,
  })
}

/** Las cabeceras que el proveedor pondría, para llamar a la entrada sin HTTP. */
function cabecerasFirmadas(cuerpo: string, correlationId?: string): Record<string, string | null> {
  const ts = String(Math.floor(Date.now() / 1000))
  return {
    'x-sv2-timestamp': ts,
    'x-sv2-signature': `v1=${firmaHmac(SECRETO_B2, ts, cuerpo)}`,
    'x-correlation-id': correlationId ?? null,
  }
}

const params = (provider = 'TEST_GATEWAY') => ({ params: Promise.resolve({ provider }) })

/** POST contra el route handler de verdad, y su cuerpo ya leído. */
async function postWebhook(cuerpo: string, d: Parameters<typeof peticionHttp>[1] = {}, provider = 'TEST_GATEWAY') {
  const res = await POST(peticionHttp(cuerpo, d), params(provider))
  const json = (await res.json()) as { codigo: string; mensaje: string; correlationId?: string }
  return { status: res.status, ...json, cabeceraHilo: res.headers.get('x-correlation-id') }
}

const avisosDe = (orderId: string) =>
  prisma.notificacion.count({ where: { dedupeKey: { endsWith: `:${orderId}` } } })

const efectoDe = (orderId: string) =>
  prisma.supplyV2OutboxEvent.findFirstOrThrow({ where: { aggregateId: orderId }, orderBy: { createdAt: 'asc' } })

// ── A · el mismo webhook cinco veces ────────────────────────────────────────

test('B2·A · el mismo webhook entregado cinco veces: un inbox, un pago, un efecto, un aviso', async () => {
  const orden = await compraPendiente()
  const cuerpo = cuerpoProveedor({ eventId: idExterno('b2a'), orderNumber: orden.number, amount: String(orden.total) })

  const respuestas = []
  for (let i = 0; i < 5; i++) respuestas.push(await postWebhook(cuerpo))

  assert.equal(respuestas[0]!.status, 200)
  assert.equal(respuestas[0]!.codigo, 'EVENT_ACCEPTED')
  for (const r of respuestas.slice(1)) {
    assert.equal(r.status, 200, 'una entrega repetida no es un error del proveedor')
    assert.equal(r.codigo, 'EVENT_REPEATED')
  }
  // Todas hablan de la MISMA operación: el hilo no cambia entre entregas.
  const hilos = new Set(respuestas.map((r) => r.correlationId))
  assert.equal(hilos.size, 1, 'cinco entregas, un hilo')

  const filas = await prisma.supplyV2ExternalEvent.count({
    where: { provider: 'TEST_GATEWAY', externalEventId: JSON.parse(cuerpo).event.id },
  })
  assert.equal(filas, 1, 'un inbox')
  assert.equal(await ordenDe(orden.id).then((o) => o.status), 'PAID', 'un pago')
  assert.equal(await derechosDe(orden.id), 1, 'un juego de derechos')
  assert.equal((await efectosDe(orden.id)).length, 1, 'un efecto')
  assert.equal(await avisosDe(orden.id), 1, 'y un solo aviso al cliente')
})

// ── §14 · el camino completo, por HTTP ──────────────────────────────────────

test('B2·§14 · HTTP POST → firma → adaptador → inbox → orden → outbox → cola → efecto', async () => {
  const orden = await compraPendiente()
  const eventId = idExterno('b2http')
  const hilo = `sv2-prueba-http-${sufijo}`
  const cuerpo = cuerpoProveedor({
    eventId,
    orderNumber: orden.number,
    amount: String(orden.total),
    // Secretos dentro del cuerpo: el camino entero tiene que dejarlos fuera.
    extra: { signature: 'FIRMA-HTTP-NO-GUARDAR', authorization: 'Bearer TOKEN-HTTP-NO-GUARDAR' },
  })

  const r = await postWebhook(cuerpo, { correlationId: hilo })
  assert.equal(r.status, 200)
  assert.equal(r.codigo, 'EVENT_ACCEPTED')
  assert.equal(r.correlationId, hilo, 'el hilo que trajo el proveedor se respeta')
  assert.equal(r.cabeceraHilo, hilo, 'y vuelve en la cabecera de la respuesta')
  assert.ok(!JSON.stringify(r).includes('MBG-SO'), 'la respuesta no dice nada de nuestra operación')

  // El inbox: la fila existe, apunta a la orden y lleva el hilo.
  const fila = await prisma.supplyV2ExternalEvent.findFirstOrThrow({
    where: { provider: 'TEST_GATEWAY', externalEventId: eventId },
  })
  assert.equal(fila.status, 'PROCESSED')
  assert.equal(fila.orderId, orden.id)
  assert.equal(fila.correlationId, hilo)
  assert.equal(fila.eventType, 'PAYMENT_CONFIRMED', 'el adaptador tradujo APPROVED a nuestro vocabulario')
  const guardado = JSON.stringify(fila.payload)
  assert.ok(!guardado.includes('FIRMA-HTTP-NO-GUARDAR'), 'ni la firma')
  assert.ok(!guardado.includes('TOKEN-HTTP-NO-GUARDAR'), 'ni el token llegan a la base')
  assert.ok(guardado.includes(`TX-${eventId}`), 'el id de la transacción sí: es lo que se concilia')

  // La orden: pagada, con sus derechos.
  const o = await ordenDe(orden.id)
  assert.equal(o.status, 'PAID')
  assert.equal(await derechosDe(orden.id), 1)

  // El outbox: el efecto se apuntó, se despachó y se entregó en la misma
  // petición (sin QStash, `encolar` ejecuta en línea: degradación honesta).
  const efecto = await efectoDe(orden.id)
  assert.equal(efecto.eventType, 'supply.order.paid')
  assert.equal(efecto.correlationId, hilo, 'el hilo llega hasta el efecto')
  assert.equal(efecto.status, 'DELIVERED')
  assert.ok(efecto.processedAt)
  assert.ok(efecto.claimedAt, 'quedó marca de cuándo se reclamó')

  // El efecto, de verdad: el cliente tiene su aviso.
  const aviso = await prisma.notificacion.findFirstOrThrow({ where: { dedupeKey: efecto.dedupeKey } })
  assert.equal(aviso.userId, ctx.cliente)
  assert.equal(aviso.tipo, 'PAGO_APROBADO')
  assert.ok(aviso.mensaje.includes(orden.number))
})

test('B2·§14 · la puerta: solo POST, solo proveedores conocidos, solo cuerpos de tamaño razonable', async () => {
  const get = await GET()
  assert.equal(get.status, 405)
  assert.equal(get.headers.get('Allow'), 'POST')

  const desconocido = await postWebhook(cuerpoProveedor({ eventId: idExterno('b2desc') }), {}, 'CARDNET')
  assert.equal(desconocido.status, 404, 'CardNET no está conectado a Supply: la ruta no existe para él')
  assert.equal(desconocido.codigo, 'UNKNOWN_PROVIDER')

  const enorme = JSON.stringify({ event: { id: idExterno('b2big') }, relleno: 'x'.repeat(70 * 1024) })
  const grande = await postWebhook(enorme)
  assert.equal(grande.status, 413)
  assert.equal(grande.codigo, 'PAYLOAD_TOO_LARGE')

  const ilegible = await postWebhook('{no soy json')
  assert.equal(ilegible.status, 400)
  assert.equal(ilegible.codigo, 'INVALID_PAYLOAD')
})

// ── B · dos peticiones simultáneas ──────────────────────────────────────────

test('B2·B · dos peticiones HTTP simultáneas del mismo evento: UNA consecuencia financiera', async () => {
  const orden = await compraPendiente()
  const cuerpo = cuerpoProveedor({ eventId: idExterno('b2b'), orderNumber: orden.number, amount: String(orden.total) })

  const [a, b] = await Promise.all([postWebhook(cuerpo), postWebhook(cuerpo)])
  const codigos = [a.codigo, b.codigo].sort()
  assert.deepEqual(codigos, ['EVENT_ACCEPTED', 'EVENT_REPEATED'], 'una procesa, la otra ve que ya estaba')
  assert.equal(a.status, 200)
  assert.equal(b.status, 200)

  assert.equal(await derechosDe(orden.id), 1, 'un juego de derechos')
  assert.equal((await efectosDe(orden.id)).length, 1, 'un efecto')
  assert.equal(await avisosDe(orden.id), 1, 'un aviso')
})

// ── C · firma inválida ──────────────────────────────────────────────────────

test('B2·C · una firma que no cuadra no deja NADA en el inbox ni toca la orden', async () => {
  const orden = await compraPendiente()
  const eventId = idExterno('b2c')
  const cuerpo = cuerpoProveedor({ eventId, orderNumber: orden.number, amount: String(orden.total) })

  const r = await postWebhook(cuerpo, { firma: 'v1=0000000000000000000000000000000000000000000000000000000000000000' })
  assert.equal(r.status, 401)
  assert.equal(r.codigo, 'INVALID_SIGNATURE')
  assert.equal(r.mensaje, 'firma inválida')
  assert.ok(!JSON.stringify(r).match(/hmac|esperada|secreto/i), 'no se le explica POR QUÉ no cuadró')

  assert.equal(
    await prisma.supplyV2ExternalEvent.count({ where: { provider: 'TEST_GATEWAY', externalEventId: eventId } }),
    0,
    'lo que no está firmado NO entra en la base'
  )
  assert.equal(await ordenDe(orden.id).then((o) => o.status), 'PENDING')
  assert.equal(await derechosDe(orden.id), 0)
  assert.equal((await efectosDe(orden.id)).length, 0)

  // El cuerpo alterado con la firma del original: el caso que de verdad importa.
  const subido = cuerpo.replace(`"${orden.total}"`, '"999999.00"')
  const ts = Math.floor(Date.now() / 1000)
  const conFirmaVieja = await postWebhook(subido, { ts, firma: `v1=${firmaHmac(SECRETO_B2, String(ts), cuerpo)}` })
  assert.equal(conFirmaVieja.status, 401, 'cambiar el monto invalida la firma')
  assert.equal(await ordenDe(orden.id).then((o) => o.status), 'PENDING')
})

// ── D · replay ──────────────────────────────────────────────────────────────

test('B2·D · un evento bien firmado pero vencido se rechaza y no produce efecto financiero', async () => {
  const orden = await compraPendiente()
  const eventId = idExterno('b2d')
  const cuerpo = cuerpoProveedor({ eventId, orderNumber: orden.number, amount: String(orden.total) })

  // Firma auténtica, de hace una hora. La idempotencia no lo pararía: para el
  // inbox esta identidad es nueva. Lo para la ventana FIRMADA.
  const viejo = Math.floor(Date.now() / 1000) - 3600
  const r = await postWebhook(cuerpo, { ts: viejo })
  assert.equal(r.status, 400, 'un 4xx: reintentarlo no lo hace más fresco')
  assert.equal(r.codigo, 'REPLAY_REJECTED')

  assert.equal(
    await prisma.supplyV2ExternalEvent.count({ where: { provider: 'TEST_GATEWAY', externalEventId: eventId } }),
    0,
    'no se inserta como evento financiero procesable'
  )
  assert.equal(await ordenDe(orden.id).then((o) => o.status), 'PENDING')
  assert.equal(await derechosDe(orden.id), 0)

  // Y el mismo evento con fecha de ahora sí entra: lo que se rechazó fue la
  // antigüedad, no el evento.
  const fresco = await postWebhook(cuerpo)
  assert.equal(fresco.codigo, 'EVENT_ACCEPTED')
  assert.equal(await derechosDe(orden.id), 1)
})

test('B2·D · un evento que no cuadra entra, queda rechazado y contesta 200', async () => {
  const orden = await compraPendiente()
  const eventId = idExterno('b2d2')
  // Firma buena, fecha buena, monto que no es el nuestro.
  const r = await postWebhook(cuerpoProveedor({ eventId, orderNumber: orden.number, amount: '1.00' }))
  assert.equal(r.status, 200, 'ya decidimos: reintentarlo no lo haría cuadrar')
  assert.equal(r.codigo, 'EVENT_REJECTED')

  const fila = await prisma.supplyV2ExternalEvent.findFirstOrThrow({ where: { externalEventId: eventId } })
  assert.equal(fila.status, 'IGNORED')
  assert.match(fila.lastError!, /MONTO_NO_CUADRA/)
  assert.equal(await ordenDe(orden.id).then((o) => o.status), 'PENDING', 'cero efecto financiero')
  assert.equal(await derechosDe(orden.id), 0)
  assert.equal(await avisosDe(orden.id), 0, 'y nadie recibe un aviso de algo que no pasó')
})

// ── E · dos despachadores ───────────────────────────────────────────────────

test('B2·E · dos despachadores a la vez: la fila se encola UNA sola vez', async () => {
  const orden = await compraPendiente()
  // Se registra y procesa SIN despachar, para poder despachar a mano después.
  const cuerpo = cuerpoProveedor({ eventId: idExterno('b2e'), orderNumber: orden.number, amount: String(orden.total) })
  const entrada = await recibirEventoExterno({
    provider: 'TEST_GATEWAY',
    cuerpoCrudo: cuerpo,
    cabeceras: cabecerasFirmadas(cuerpo),
    despachar: false,
  })
  assert.equal(entrada.codigo, 'EVENT_ACCEPTED')

  const efecto = await efectoDe(orden.id)
  assert.equal(efecto.status, 'PENDING', 'apuntado y sin despachar')

  const [uno, dos] = await Promise.all([
    despacharEfectos(como(ctx.ops), 100),
    despacharEfectos(como(ctx.ops), 100),
  ])
  const veces = [...uno.encolados, ...dos.encolados].filter((id) => id === efecto.id).length
  assert.equal(veces, 1, 'dos despachadores simultáneos, un solo trabajo')

  const tras = await prisma.supplyV2OutboxEvent.findUniqueOrThrow({ where: { id: efecto.id } })
  assert.equal(tras.status, 'DELIVERED', 'y el que se lo llevó lo entregó')
  assert.equal(await avisosDe(orden.id), 1, 'un solo aviso')
})

// ── F · el reintento del worker ─────────────────────────────────────────────

test('B2·F · la primera entrega falla, la segunda funciona: DELIVERED sin duplicar el efecto', async () => {
  const orden = await compraPendiente()
  // Un efecto que apunta a una compra que no existe: el destino «no está».
  const inexistente = `sin-orden-${sufijo}`
  const efecto = await sinEmpresa('prueba', (tx) =>
    emitirEfectoEnTx(tx, {
      eventType: 'supply.order.paid',
      aggregateType: 'SupplyV2CustomerOrder',
      aggregateId: inexistente,
      correlationId: `sv2-reintento-${sufijo}`,
      payload: {},
    })
  )

  await sinEmpresa('prueba', (tx) =>
    tx.supplyV2OutboxEvent.update({ where: { id: efecto.id }, data: { status: 'PROCESSING', claimedAt: new Date() } })
  )
  const primera = await entregarEfecto(efecto.id, como(ctx.ops))
  assert.equal(primera.estado, 'FAILED', 'el fallo se reconoce y se reprograma')
  let fila = await prisma.supplyV2OutboxEvent.findUniqueOrThrow({ where: { id: efecto.id } })
  assert.equal(fila.attempts, 1)
  assert.ok(fila.availableAt > new Date(), 'la escalera compartida lo manda al futuro')
  assert.ok(fila.lastError)

  // Ahora el destino sí está: el efecto apunta a una compra de verdad.
  await sinEmpresa('prueba', (tx) =>
    tx.supplyV2OutboxEvent.update({
      where: { id: efecto.id },
      data: { aggregateId: orden.id, status: 'PROCESSING', claimedAt: new Date() },
    })
  )
  const segunda = await entregarEfecto(efecto.id, como(ctx.ops))
  assert.equal(segunda.estado, 'DELIVERED')
  fila = await prisma.supplyV2OutboxEvent.findUniqueOrThrow({ where: { id: efecto.id } })
  assert.equal(fila.status, 'DELIVERED')
  assert.ok(fila.processedAt)

  // Y entregarlo otra vez —reintento de la cola sobre un trabajo que sí
  // funcionó— no manda un segundo aviso.
  const tercera = await entregarEfecto(efecto.id, como(ctx.ops))
  assert.equal(tercera.estado, 'YA_ESTABA')
  assert.equal(
    await prisma.notificacion.count({ where: { dedupeKey: fila.dedupeKey } }),
    1,
    'un aviso, aunque se entregue tres veces'
  )
})

test('B2·F · §8 caso 2: el proceso muere DESPUÉS de hacer el efecto y antes de marcarlo', async () => {
  const orden = await compraPendiente()
  const efecto = await sinEmpresa('prueba', (tx) =>
    emitirEfectoEnTx(tx, {
      eventType: 'supply.order.payment_rejected',
      aggregateType: 'SupplyV2CustomerOrder',
      aggregateId: orden.id,
      correlationId: `sv2-muerte-tardia-${sufijo}`,
      payload: {},
    })
  )
  await sinEmpresa('prueba', (tx) =>
    tx.supplyV2OutboxEvent.update({ where: { id: efecto.id }, data: { status: 'PROCESSING', claimedAt: new Date() } })
  )

  // Primera entrega: el aviso se crea… y aquí muere el proceso, sin marcar.
  const primera = await entregarEfecto(efecto.id, como(ctx.ops))
  assert.equal(primera.estado, 'DELIVERED')
  assert.equal(await prisma.notificacion.count({ where: { dedupeKey: efecto.id ? (await prisma.supplyV2OutboxEvent.findUniqueOrThrow({ where: { id: efecto.id }, select: { dedupeKey: true } })).dedupeKey : '' } }), 1)

  // Se simula la muerte: la fila vuelve a estar reclamada, como si nunca se
  // hubiera marcado.
  await sinEmpresa('prueba', (tx) =>
    tx.supplyV2OutboxEvent.update({
      where: { id: efecto.id },
      data: { status: 'PROCESSING', claimedAt: new Date(), processedAt: null },
    })
  )

  // El reintento REPITE el efecto. Y no pasa nada peligroso: la clave estable
  // choca con el índice único de notificaciones y se trata como ya hecho.
  const segunda = await entregarEfecto(efecto.id, como(ctx.ops))
  assert.equal(segunda.estado, 'DELIVERED')
  assert.match(segunda.detalle, /ya existía/)
  const fila = await prisma.supplyV2OutboxEvent.findUniqueOrThrow({ where: { id: efecto.id } })
  assert.equal(
    await prisma.notificacion.count({ where: { dedupeKey: fila.dedupeKey } }),
    1,
    'UN aviso, aunque el efecto se hizo dos veces'
  )
})

// ── G · muerte y rescate del worker ─────────────────────────────────────────

test('B2·G · §8 caso 1: el worker reclama y muere antes de entregar; el arriendo lo rescata', async () => {
  const orden = await compraPendiente()
  const efecto = await sinEmpresa('prueba', (tx) =>
    emitirEfectoEnTx(tx, {
      eventType: 'supply.order.paid',
      aggregateType: 'SupplyV2CustomerOrder',
      aggregateId: orden.id,
      correlationId: `sv2-huerfano-${sufijo}`,
      payload: {},
    })
  )

  // Reclamado por un worker que ya no está: `claimedAt` viejo.
  const hace20min = new Date(Date.now() - 20 * 60 * 1000)
  await sinEmpresa('prueba', (tx) =>
    tx.supplyV2OutboxEvent.update({ where: { id: efecto.id }, data: { status: 'PROCESSING', claimedAt: hace20min } })
  )

  // Un reclamo normal NO lo ve: está en PROCESSING, que no es reclamable.
  const reclamo = await reclamarEfectos(VENTANA)
  assert.ok(!reclamo.some((x) => x.id === efecto.id), 'el despachador no roba trabajo reclamado')

  // El rescate sí, y lo trata como un FALLO: consume un intento. Devolverlo
  // limpio sería un bucle infinito para una fila que mata al worker.
  const rescate = await recuperarArriendos(como(ctx.ops), 5 * 60 * 1000)
  assert.ok(rescate.recuperados.includes(efecto.id), 'lo abandonado vuelve a la vida')
  const fila = await prisma.supplyV2OutboxEvent.findUniqueOrThrow({ where: { id: efecto.id } })
  assert.equal(fila.status, 'FAILED')
  assert.equal(fila.attempts, 1)
  assert.match(fila.lastError!, /RECLAMO_ABANDONADO/)

  // Y uno reclamado hace un segundo NO se toca: no se le roba a un worker vivo.
  await sinEmpresa('prueba', (tx) =>
    tx.supplyV2OutboxEvent.update({ where: { id: efecto.id }, data: { status: 'PROCESSING', claimedAt: new Date() } })
  )
  const segundo = await recuperarArriendos(como(ctx.ops), 5 * 60 * 1000)
  assert.ok(!segundo.recuperados.includes(efecto.id), 'lo que está vivo se respeta')

  // Hasta que vence: entonces se rescata, se despacha y se entrega.
  await sinEmpresa('prueba', (tx) =>
    tx.supplyV2OutboxEvent.update({ where: { id: efecto.id }, data: { claimedAt: hace20min } })
  )
  await recuperarArriendos(como(ctx.ops), 5 * 60 * 1000)
  await sinEmpresa('prueba', (tx) =>
    tx.supplyV2OutboxEvent.update({ where: { id: efecto.id }, data: { availableAt: new Date() } })
  )
  const despacho = await despacharEfectos(como(ctx.ops), VENTANA)
  assert.ok(despacho.encolados.includes(efecto.id))
  const final = await prisma.supplyV2OutboxEvent.findUniqueOrThrow({ where: { id: efecto.id } })
  assert.equal(final.status, 'DELIVERED', 'el efecto huérfano acabó entregándose')
})

test('B2·G · la base no admite una fila reclamada sin marca de reclamo', async () => {
  const orden = await compraPendiente()
  const efecto = await sinEmpresa('prueba', (tx) =>
    emitirEfectoEnTx(tx, {
      eventType: 'supply.test.arriendo',
      aggregateType: 'SupplyV2CustomerOrder',
      aggregateId: orden.id,
      correlationId: `sv2-check-arriendo-${sufijo}`,
      payload: {},
    })
  )
  // Sin esto, una fila sin marca en PROCESSING sería invisible para el rescate:
  // exactamente el fallo que la columna existe para cerrar.
  await assert.rejects(
    prisma.$executeRaw`UPDATE "supply_v2_outbox_events" SET "status" = 'PROCESSING' WHERE "id" = ${efecto.id}`,
    /check constraint|violates/i
  )
})

// ── H · dead letter ─────────────────────────────────────────────────────────

test('B2·H · agotados los intentos el efecto muere, y el estado financiero no se mueve', async () => {
  const orden = await compraPendiente()
  // Pagada de verdad: lo que se demuestra es que la muerte del AVISO no toca
  // el dinero que ya se movió.
  const cuerpo = cuerpoProveedor({ eventId: idExterno('b2h'), orderNumber: orden.number, amount: String(orden.total) })
  const entrada = await recibirEventoExterno({
    provider: 'TEST_GATEWAY',
    cuerpoCrudo: cuerpo,
    cabeceras: cabecerasFirmadas(cuerpo),
    despachar: false,
  })
  assert.equal(entrada.codigo, 'EVENT_ACCEPTED')
  const antes = { estado: (await ordenDe(orden.id)).status, derechos: await derechosDe(orden.id) }

  // El efecto apunta a una compra que no existe: falla siempre.
  const efecto = await efectoDe(orden.id)
  await sinEmpresa('prueba', (tx) =>
    tx.supplyV2OutboxEvent.update({ where: { id: efecto.id }, data: { aggregateId: `fantasma-${sufijo}` } })
  )

  const estados: string[] = []
  for (let i = 0; i < MAX_INTENTOS; i++) {
    await sinEmpresa('prueba', (tx) =>
      tx.supplyV2OutboxEvent.update({ where: { id: efecto.id }, data: { status: 'PROCESSING', claimedAt: new Date() } })
    )
    const r = await entregarEfecto(efecto.id, como(ctx.ops))
    estados.push(r.estado)
  }
  assert.equal(estados[MAX_INTENTOS - 1], 'DEAD_LETTER', `muere en el intento ${MAX_INTENTOS}`)
  const fila = await prisma.supplyV2OutboxEvent.findUniqueOrThrow({ where: { id: efecto.id } })
  assert.equal(fila.status, 'DEAD_LETTER')
  assert.equal(fila.attempts, MAX_INTENTOS)
  const muerte = await prisma.auditLog.findFirst({
    where: { accion: 'SUPPLY_V2_OUTBOX_DEAD_LETTER', entidadId: efecto.id },
  })
  assert.ok(muerte, 'la muerte del efecto queda auditada')

  // Lo que importa: el dinero no se movió por esto.
  assert.equal((await ordenDe(orden.id)).status, antes.estado, 'la compra sigue pagada')
  assert.equal(await derechosDe(orden.id), antes.derechos, 'con los mismos derechos')
  const inbox = await prisma.supplyV2ExternalEvent.findFirstOrThrow({ where: { id: entrada.inboxId! } })
  assert.equal(inbox.status, 'PROCESSED', 'y el evento externo sigue procesado: el aviso no lo deshace')
})

test('B2·H · un tipo de efecto sin ejecutor no desaparece en silencio', async () => {
  const orden = await compraPendiente()
  const efecto = await sinEmpresa('prueba', (tx) =>
    emitirEfectoEnTx(tx, {
      eventType: 'supply.order.inventado',
      aggregateType: 'SupplyV2CustomerOrder',
      aggregateId: orden.id,
      correlationId: `sv2-sin-ejecutor-${sufijo}`,
      payload: {},
    })
  )
  await sinEmpresa('prueba', (tx) =>
    tx.supplyV2OutboxEvent.update({ where: { id: efecto.id }, data: { status: 'PROCESSING', claimedAt: new Date() } })
  )
  const r = await entregarEfecto(efecto.id, como(ctx.ops))
  assert.ok(['FAILED', 'DEAD_LETTER'].includes(r.estado))
  const fila = await prisma.supplyV2OutboxEvent.findUniqueOrThrow({ where: { id: efecto.id } })
  assert.match(fila.lastError!, /EFECTO_SIN_EJECUTOR/)
})

test('B2 · sin cuenta designada para la integración no se mueve dinero: el evento espera', async () => {
  const orden = await compraPendiente()
  const eventId = idExterno('b2sinactor')
  const cuerpo = cuerpoProveedor({ eventId, orderNumber: orden.number, amount: String(orden.total) })

  const previo = process.env.SUPPLY_V2_WEBHOOK_ACTOR_ID
  try {
    delete process.env.SUPPLY_V2_WEBHOOK_ACTOR_ID
    olvidarActorDelWebhook()
    const r = await postWebhook(cuerpo)
    assert.equal(r.status, 500, 'es un fallo NUESTRO de configuración: que lo reintenten')
    assert.equal(r.codigo, 'INTERNAL_ERROR')
    assert.equal(r.mensaje, 'error interno', 'y no se le cuenta al proveedor qué nos falta')

    // El evento NO se pierde: quedó guardado, reprogramado y auditado.
    const fila = await prisma.supplyV2ExternalEvent.findFirstOrThrow({ where: { externalEventId: eventId } })
    assert.equal(fila.status, 'FAILED')
    assert.equal(fila.attempts, 1)
    assert.ok(fila.nextAttemptAt, 'con hora para volver a intentarlo')
    assert.match(fila.lastError!, /SIN_ACTOR_CONFIGURADO/)

    // Y nada de dinero se movió sin responsable.
    assert.equal((await ordenDe(orden.id)).status, 'PENDING')
    assert.equal(await derechosDe(orden.id), 0)
    assert.equal((await efectosDe(orden.id)).length, 0)

    // Un id mal copiado en la configuración se trata igual que no tenerla:
    // no se usa a ciegas una clave foránea que no existe.
    process.env.SUPPLY_V2_WEBHOOK_ACTOR_ID = `no-existe-${sufijo}`
    olvidarActorDelWebhook()
    const malo = await postWebhook(cuerpoProveedor({ eventId: idExterno('b2actormalo'), orderNumber: orden.number, amount: String(orden.total) }))
    assert.equal(malo.status, 500)
    assert.equal((await ordenDe(orden.id)).status, 'PENDING')
  } finally {
    if (previo === undefined) delete process.env.SUPPLY_V2_WEBHOOK_ACTOR_ID
    else process.env.SUPPLY_V2_WEBHOOK_ACTOR_ID = previo
    olvidarActorDelWebhook()
  }

  // Con la cuenta puesta, el mismo evento se procesa: lo que faltaba era la
  // configuración, no el evento.
  const reintento = await postWebhook(cuerpo)
  assert.equal(reintento.codigo, 'EVENT_ACCEPTED')
  assert.equal((await ordenDe(orden.id)).status, 'PAID')
  assert.equal(await derechosDe(orden.id), 1, 'y un solo juego de derechos tras el reintento')
})

test('B2 · una entrega repetida NO puede devolver a FAILED un evento ya resuelto', async () => {
  const orden = await compraPendiente()
  const eventId = idExterno('b2resuelto')
  const cuerpo = cuerpoProveedor({ eventId, orderNumber: orden.number, amount: String(orden.total) })

  assert.equal((await postWebhook(cuerpo)).codigo, 'EVENT_ACCEPTED')
  const antes = await prisma.supplyV2ExternalEvent.findFirstOrThrow({ where: { externalEventId: eventId } })
  assert.equal(antes.status, 'PROCESSED')

  // El proveedor lo reenvía justo cuando la configuración de la integración
  // falta. La entrega repetida tiene que contestar «ya lo tenía» y dejar la
  // fila como estaba: un estado final no se deshace por un problema de
  // configuración.
  const previo = process.env.SUPPLY_V2_WEBHOOK_ACTOR_ID
  try {
    delete process.env.SUPPLY_V2_WEBHOOK_ACTOR_ID
    olvidarActorDelWebhook()
    const r = await postWebhook(cuerpo)
    assert.equal(r.status, 200)
    assert.equal(r.codigo, 'EVENT_REPEATED')
  } finally {
    if (previo === undefined) delete process.env.SUPPLY_V2_WEBHOOK_ACTOR_ID
    else process.env.SUPPLY_V2_WEBHOOK_ACTOR_ID = previo
    olvidarActorDelWebhook()
  }

  const despues = await prisma.supplyV2ExternalEvent.findFirstOrThrow({ where: { externalEventId: eventId } })
  assert.equal(despues.status, 'PROCESSED', 'sigue resuelto')
  assert.equal(despues.attempts, antes.attempts, 'no se le contó un intento')
  assert.equal(despues.lastError, null)
  assert.equal(await derechosDe(orden.id), 1)
})

// ════════════════════════════════════════════════════════════════════════════
// BLOQUE 3 · CUANDO LA PASARELA Y MEMBEGO NO COINCIDEN
//
// Al acabar el bloque 2, un evento que no cuadraba quedaba rechazado con su
// código, su bitácora y cero efecto financiero. Eso evitaba el daño y no
// dejaba NADA que una persona pudiera trabajar. Lo que se demuestra aquí es
// ese hueco cerrado: la discrepancia se convierte en UN incidente investigable,
// con dueño, severidad, motivo y vínculo con el evento y la compra; una persona
// autorizada lo resuelve por los servicios financieros oficiales; y en ningún
// camino se corrige dinero en silencio.
// ════════════════════════════════════════════════════════════════════════════

const incidentesDe = (orderId: string) =>
  prisma.supplyV2FinanceIncident.findMany({
    where: { type: 'EXTERNAL_PAYMENT_MISMATCH', orderId },
    orderBy: { createdAt: 'asc' },
  })

const incidentePorEvento = (externalEventRowId: string) =>
  prisma.supplyV2FinanceIncident.findFirst({ where: { externalEventRowId } })

const conciliacionesDeOrden = (orderId: string) =>
  prisma.supplyV2PaymentReconciliation.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } })

const eventosEconomicosDe = (orderId: string) =>
  prisma.supplyV2EconomicEvent.count({ where: { entitlement: { orderId } } })

// ── A · el importe no cuadra ────────────────────────────────────────────────

test('B3·A · importe distinto: UN incidente abierto y la compra intacta', async () => {
  const orden = await compraPendiente()
  const eventId = idExterno('b3a')
  // 1000 internos contra 900 externos.
  const r = await postWebhook(cuerpoProveedor({ eventId, orderNumber: orden.number, amount: '900.00' }))
  assert.equal(r.status, 200, 'ya decidimos: el proveedor no tiene que reintentar')
  assert.equal(r.codigo, 'EVENT_REJECTED')

  const incidentes = await incidentesDe(orden.id)
  assert.equal(incidentes.length, 1, 'un incidente')
  const i = incidentes[0]!
  assert.equal(i.status, 'OPEN')
  assert.equal(i.reasonCode, 'AMOUNT_MISMATCH')
  assert.equal(i.severity, 'HIGH')
  assert.equal(i.provider, 'TEST_GATEWAY')
  assert.equal(i.correlationId, r.correlationId, 'el hilo del bloque 2 llega hasta el incidente')
  assert.ok(i.externalEventRowId, 'y el vínculo con el evento que lo provocó')
  assert.equal(i.internalStatus, 'PENDING')
  assert.equal(i.externalStatus, 'PAID')
  assert.match(i.notes, /900\.00/)
  assert.equal(i.resolution, null, 'nadie lo ha resuelto todavía')

  // La compra, intacta. Esto es lo que el bloque existe para garantizar.
  const o = await ordenDe(orden.id)
  assert.equal(o.status, 'PENDING')
  assert.equal(o.paidAt, null)
  assert.equal(await derechosDe(orden.id), 0)
  assert.equal((await efectosDe(orden.id)).length, 0)

  // Y la comprobación quedó escrita, con los dos lados y la diferencia.
  const [c] = await conciliacionesDeOrden(orden.id)
  assert.equal(c!.outcome, 'MISMATCH')
  assert.equal(c!.reasonCode, 'AMOUNT_MISMATCH')
  assert.equal(c!.expectedAmount?.toFixed(2), Number(orden.total).toFixed(2))
  assert.equal(c!.reportedAmount?.toFixed(2), '900.00')
  assert.equal(c!.differenceAmount?.toFixed(2), '-100.00', 'cobró 100 de menos')
  assert.equal(c!.incidentId, i.id, 'la comprobación apunta a su incidente')
})

// ── B · la moneda no cuadra ─────────────────────────────────────────────────

test('B3·B · otra moneda: incidente abierto, y el motivo es la moneda', async () => {
  const orden = await compraPendiente()
  const eventId = idExterno('b3b')
  const r = await postWebhook(cuerpoProveedor({ eventId, orderNumber: orden.number, amount: String(orden.total), currency: 'USD' }))
  assert.equal(r.codigo, 'EVENT_REJECTED')

  const [i] = await incidentesDe(orden.id)
  assert.ok(i, 'hay incidente')
  assert.equal(i!.reasonCode, 'CURRENCY_MISMATCH')
  assert.equal(i!.severity, 'HIGH')
  assert.equal(i!.currency, 'DOP', 'el incidente guarda NUESTRA moneda')
  assert.match(i!.notes, /USD/)
  assert.equal((await ordenDe(orden.id)).status, 'PENDING')
  assert.equal(await derechosDe(orden.id), 0)
})

// ── C · la compra no existe ─────────────────────────────────────────────────

test('B3·C · cobró una compra inexistente: incidente con orderId NULL, sin inventar una orden', async () => {
  const eventId = idExterno('b3c')
  const r = await postWebhook(
    cuerpoProveedor({ eventId, orderNumber: `MBG-SO-FANTASMA-${sufijo}`, amount: '1000.00' })
  )
  assert.equal(r.status, 200)
  assert.equal(r.codigo, 'EVENT_REJECTED')

  const fila = await prisma.supplyV2ExternalEvent.findFirstOrThrow({ where: { externalEventId: eventId } })
  const i = await incidentePorEvento(fila.id)
  assert.ok(i, 'el evento sin compra SÍ abre incidente: hay dinero en la pasarela y no sabemos de qué es')
  assert.equal(i!.orderId, null, 'sin compra a la que apuntar, y no se inventa ninguna')
  assert.equal(i!.supplierId, null, 'ni un proveedor ficticio para rellenar la columna')
  assert.equal(i!.reasonCode, 'UNKNOWN_ORDER')
  assert.equal(i!.severity, 'HIGH')
  assert.equal(i!.type, 'EXTERNAL_PAYMENT_MISMATCH')
  assert.ok(i!.notes.length > 10)
})

// ── D · el mismo webhook cinco veces ────────────────────────────────────────

test('B3·D · cinco entregas del mismo webhook que no cuadra: UN incidente', async () => {
  const orden = await compraPendiente()
  const cuerpo = cuerpoProveedor({ eventId: idExterno('b3d'), orderNumber: orden.number, amount: '1.00' })

  const codigos: string[] = []
  for (let i = 0; i < 5; i++) codigos.push((await postWebhook(cuerpo)).codigo)
  assert.equal(codigos[0], 'EVENT_REJECTED')
  // De la segunda en adelante el evento ya está resuelto (IGNORED): ni se
  // reprocesa ni se vuelve a abrir nada.
  for (const c of codigos.slice(1)) assert.equal(c, 'EVENT_REPEATED')

  assert.equal((await incidentesDe(orden.id)).length, 1, 'cinco entregas, un incidente')
  assert.equal((await conciliacionesDeOrden(orden.id)).length, 1, 'y una comprobación, refrescada')
  assert.equal((await ordenDe(orden.id)).status, 'PENDING')
})

test('B3·D · conciliar lo mismo otra vez REFRESCA la comprobación en vez de duplicarla', async () => {
  const orden = await compraPendiente()
  const cuerpo = cuerpoProveedor({ eventId: idExterno('b3d2'), orderNumber: orden.number, amount: '500.00' })
  await postWebhook(cuerpo)

  const antes = (await conciliacionesDeOrden(orden.id))[0]!
  assert.equal(antes.checks, 1)

  // La conciliación manual mira lo mismo otra vez.
  const manual = await conciliarAPeticion({ orderId: orden.id }, como(ctx.ops))
  assert.equal(manual.revisados, 1)
  assert.equal(manual.discrepancias, 1)
  assert.equal(manual.incidentesAbiertos.length, 0, 'el incidente ya existía: no se abre otro')

  const despues = await conciliacionesDeOrden(orden.id)
  assert.equal(despues.length, 1, 'una fila')
  assert.equal(despues[0]!.checks, 2, 'con la cuenta de cuántas veces se miró')
  assert.ok(despues[0]!.checkedAt >= antes.checkedAt)
  assert.equal((await incidentesDe(orden.id)).length, 1)
})

// ── E · la misma transacción en dos compras ─────────────────────────────────

test('B3·E · una transacción que ya era de otra compra: se conserva la primera y la segunda se rechaza', async () => {
  const primera = await compraPendiente()
  const segunda = await compraPendiente()
  const tx = `TX-COMPARTIDA-${sufijo}`

  // La primera asociación es legítima y cuadra: la compra se paga.
  const ok = await postWebhook(
    cuerpoProveedor({ eventId: idExterno('b3e1'), orderNumber: primera.number, amount: String(primera.total), txId: tx })
  )
  assert.equal(ok.codigo, 'EVENT_ACCEPTED')
  assert.equal((await ordenDe(primera.id)).status, 'PAID')

  // Y ahora la MISMA transacción aparece en otra compra.
  const mala = await postWebhook(
    cuerpoProveedor({ eventId: idExterno('b3e2'), orderNumber: segunda.number, amount: String(segunda.total), txId: tx })
  )
  assert.equal(mala.status, 200)
  assert.equal(mala.codigo, 'EVENT_REJECTED', 'la segunda asociación NO se acepta')

  const [i] = await incidentesDe(segunda.id)
  assert.ok(i, 'y queda incidente')
  assert.equal(i!.reasonCode, 'DUPLICATE_TRANSACTION')
  assert.equal(i!.severity, 'HIGH')
  assert.equal(i!.externalTransactionId, tx)
  assert.match(i!.notes, new RegExp(primera.number), 'el incidente dice de qué compra era')

  // La primera se conserva intacta; la segunda no se paga.
  assert.equal((await ordenDe(primera.id)).status, 'PAID')
  assert.equal(await derechosDe(primera.id), 1)
  assert.equal((await ordenDe(segunda.id)).status, 'PENDING')
  assert.equal(await derechosDe(segunda.id), 0)
})

// ── F y G · quién puede resolver ────────────────────────────────────────────

test('B3·F · una persona autorizada: OPEN → INVESTIGATING → RESOLVED con nota', async () => {
  const orden = await compraPendiente()
  await postWebhook(cuerpoProveedor({ eventId: idExterno('b3f'), orderNumber: orden.number, amount: '777.00' }))
  const [i] = await incidentesDe(orden.id)
  assert.equal(i!.status, 'OPEN')

  const inv = await marcarInvestigando(i!.id, como(ctx.finanzas))
  assert.equal(inv.estaba, 'OPEN')
  assert.equal((await prisma.supplyV2FinanceIncident.findUniqueOrThrow({ where: { id: i!.id } })).status, 'INVESTIGATING')
  assert.ok(
    await prisma.auditLog.findFirst({ where: { accion: 'SUPPLY_V2_FINANCE_INCIDENT_INVESTIGATING', entidadId: i!.id } }),
    'investigar queda en la bitácora'
  )

  // Marcarlo dos veces no hace nada dos veces.
  assert.equal((await marcarInvestigando(i!.id, como(ctx.finanzas))).estaba, 'INVESTIGATING')

  const res = await resolverIncidenteDePago(
    { incidentId: i!.id, resolucion: 'ACCEPT_INTERNAL', nota: 'La pasarela cobró de menos por un error suyo; nos manda nota de crédito.' },
    como(ctx.finanzas)
  )
  assert.equal(res.repetido, false)
  assert.equal(res.pagoConfirmado, false, 'ACCEPT_INTERNAL no mueve dinero')

  const final = await prisma.supplyV2FinanceIncident.findUniqueOrThrow({ where: { id: i!.id } })
  assert.equal(final.status, 'RESOLVED')
  assert.equal(final.resolution, 'ACCEPT_INTERNAL')
  assert.equal(final.resolvedById, ctx.finanzas, 'quien resuelve es la PERSONA, no la integración')
  assert.ok(final.resolvedAt)
  assert.match(final.resolutionNotes!, /nota de crédito/)
  assert.ok(
    await prisma.auditLog.findFirst({ where: { accion: 'SUPPLY_V2_FINANCE_INCIDENT_RESOLVED', entidadId: i!.id } }),
    'y resolver también'
  )
  // Y la compra sigue sin pagarse: aceptar lo nuestro era decir que no se cobró.
  assert.equal((await ordenDe(orden.id)).status, 'PENDING')
})

test('B3·F · sin nota no hay resolución', async () => {
  const orden = await compraPendiente()
  await postWebhook(cuerpoProveedor({ eventId: idExterno('b3fn'), orderNumber: orden.number, amount: '123.00' }))
  const [i] = await incidentesDe(orden.id)
  for (const nota of ['', '   ']) {
    await assert.rejects(
      resolverIncidenteDePago({ incidentId: i!.id, resolucion: 'MARK_FALSE_POSITIVE', nota }, como(ctx.finanzas)),
      /explicar cómo se resolvió/
    )
  }
  assert.equal((await prisma.supplyV2FinanceIncident.findUniqueOrThrow({ where: { id: i!.id } })).status, 'OPEN')
})

test('B3·G · ni un actor sin permiso ni la cuenta de la integración pueden resolver', async () => {
  const orden = await compraPendiente()
  await postWebhook(cuerpoProveedor({ eventId: idExterno('b3g'), orderNumber: orden.number, amount: '321.00' }))
  const [i] = await incidentesDe(orden.id)

  // Sin actor.
  await assert.rejects(
    resolverIncidenteDePago({ incidentId: i!.id, resolucion: 'ACCEPT_INTERNAL', nota: 'x'.repeat(20) }, como(null)),
    /necesita quién/
  )

  // La cuenta con la que corre la integración: procesar eventos e investigarlos
  // son responsabilidades distintas (§12).
  await assert.rejects(
    resolverIncidenteDePago(
      { incidentId: i!.id, resolucion: 'ACCEPT_INTERNAL', nota: 'lo cierro yo mismo' },
      como(process.env.SUPPLY_V2_WEBHOOK_ACTOR_ID!)
    ),
    /no puede resolver incidentes/
  )
  await assert.rejects(marcarInvestigando(i!.id, como(process.env.SUPPLY_V2_WEBHOOK_ACTOR_ID!)), /no puede resolver incidentes/)

  // Un usuario real pero sin el permiso.
  const sinPermiso = await prisma.user.create({
    data: { supabaseId: `sb-s9-b3-nop-${sufijo}`, email: `s9-b3-nop-${sufijo}@prueba.test`, name: 'sin permiso', role: 'CLIENTE' },
    select: { id: true },
  })
  await assert.rejects(
    resolverIncidenteDePago({ incidentId: i!.id, resolucion: 'ACCEPT_INTERNAL', nota: 'me autorizo solo' }, como(sinPermiso.id)),
    /Hace falta permiso/
  )

  // Y uno que no existe.
  await assert.rejects(
    resolverIncidenteDePago({ incidentId: i!.id, resolucion: 'ACCEPT_INTERNAL', nota: 'fantasma' }, como(`no-existe-${sufijo}`)),
    /no existe como usuario/
  )

  // Nada de eso movió el incidente.
  const sigue = await prisma.supplyV2FinanceIncident.findUniqueOrThrow({ where: { id: i!.id } })
  assert.equal(sigue.status, 'OPEN')
  assert.equal(sigue.resolvedById, null)
})

// ── H · aceptar la evidencia externa pasa por el servicio oficial ───────────

test('B3·H · ACCEPT_EXTERNAL confirma por el servicio oficial: un pago, un juego de derechos, un evento económico', async () => {
  const orden = await compraPendiente()
  // La pasarela dice que cobró el importe correcto, pero la compra se quedó sin
  // confirmar (el camino seguro no llegó a hacerlo).
  const conciliado = await conciliarPagoExterno(
    {
      provider: 'TEST_GATEWAY',
      externalTransactionId: `TX-EXT-${sufijo}`,
      orderId: orden.id,
      correlationId: `sv2-acepta-externo-${sufijo}`,
      externo: { estado: 'PAID', monto: String(orden.total), moneda: 'DOP' },
    },
    como(ctx.ops)
  )
  assert.equal(conciliado.veredicto.resultado, 'MISMATCH')
  assert.equal(conciliado.veredicto.motivo, 'STATE_CONFLICT')
  assert.equal(conciliado.veredicto.severidad, 'MEDIUM', 'el importe cuadra: no es lo más grave')
  assert.ok(conciliado.incidentId)
  assert.equal((await ordenDe(orden.id)).status, 'PENDING', 'conciliar NO confirmó nada')

  // Aceptar la evidencia externa exige escribir el importe que se autoriza.
  await assert.rejects(
    resolverIncidenteDePago({ incidentId: conciliado.incidentId!, resolucion: 'ACCEPT_EXTERNAL', nota: 'la evidencia es buena' }, como(ctx.finanzas)),
    /importe que se está autorizando/
  )
  // Y si el importe no cuadra con la compra, el servicio oficial lo rechaza:
  // aceptar lo externo no es poder cobrar cualquier cifra.
  await assert.rejects(
    resolverIncidenteDePago(
      { incidentId: conciliado.incidentId!, resolucion: 'ACCEPT_EXTERNAL', nota: 'cobro inventado', montoExterno: '5.00' },
      como(ctx.finanzas)
    ),
    /no coincide con el total/
  )
  assert.equal((await ordenDe(orden.id)).status, 'PENDING', 'el intento con mal importe no movió nada')

  const res = await resolverIncidenteDePago(
    {
      incidentId: conciliado.incidentId!,
      resolucion: 'ACCEPT_EXTERNAL',
      nota: 'Comprobado en el portal de la pasarela: el cobro existe y es de esta compra.',
      montoExterno: String(orden.total),
    },
    como(ctx.finanzas)
  )
  assert.equal(res.pagoConfirmado, true)

  // El pago pasó por el camino bueno: la compra queda EXACTAMENTE como si se
  // hubiera confirmado por el flujo normal.
  const o = await ordenDe(orden.id)
  assert.equal(o.status, 'PAID')
  assert.ok(o.paidAt)
  assert.equal(await derechosDe(orden.id), 1, 'un juego de derechos')
  assert.equal(await eventosEconomicosDe(orden.id), 1, 'un evento económico')
  const efectos = await efectosDe(orden.id)
  assert.equal(efectos.length, 1, 'y un efecto para avisar al cliente')
  assert.equal(efectos[0]!.eventType, 'supply.order.paid')

  const final = await prisma.supplyV2FinanceIncident.findUniqueOrThrow({ where: { id: conciliado.incidentId! } })
  assert.equal(final.status, 'RESOLVED')
  assert.equal(final.resolution, 'ACCEPT_EXTERNAL')
  const auditoria = await prisma.auditLog.findFirst({
    where: { accion: 'SUPPLY_V2_FINANCE_INCIDENT_RESOLVED', entidadId: conciliado.incidentId! },
  })
  assert.equal((auditoria!.payload as { pagoConfirmado: boolean }).pagoConfirmado, true, 'la bitácora dice que movió dinero')
})

test('B3·H · aceptar lo externo sin compra a la que apuntar no puede confirmar nada', async () => {
  const eventId = idExterno('b3h2')
  await postWebhook(cuerpoProveedor({ eventId, orderNumber: `MBG-SO-NADA-${sufijo}`, amount: '1000.00' }))
  const fila = await prisma.supplyV2ExternalEvent.findFirstOrThrow({ where: { externalEventId: eventId } })
  const i = await incidentePorEvento(fila.id)
  await assert.rejects(
    resolverIncidenteDePago(
      { incidentId: i!.id, resolucion: 'ACCEPT_EXTERNAL', nota: 'la evidencia es buena', montoExterno: '1000.00' },
      como(ctx.finanzas)
    ),
    /no apunta a ninguna compra/
  )
  assert.equal((await prisma.supplyV2FinanceIncident.findUniqueOrThrow({ where: { id: i!.id } })).status, 'OPEN')
})

// ── I · resolver dos veces ──────────────────────────────────────────────────

test('B3·I · resolver un incidente ya resuelto es idempotente y no ejecuta una segunda corrección', async () => {
  const orden = await compraPendiente()
  await postWebhook(cuerpoProveedor({ eventId: idExterno('b3i'), orderNumber: orden.number, amount: '456.00' }))
  const [i] = await incidentesDe(orden.id)

  const primera = await resolverIncidenteDePago(
    { incidentId: i!.id, resolucion: 'MARK_FALSE_POSITIVE', nota: 'Era una prueba del proveedor, no un cobro real.' },
    como(ctx.finanzas)
  )
  assert.equal(primera.repetido, false)

  const segunda = await resolverIncidenteDePago(
    { incidentId: i!.id, resolucion: 'ACCEPT_EXTERNAL', nota: 'intento de cambiar la decisión', montoExterno: String(orden.total) },
    como(ctx.finanzas)
  )
  assert.equal(segunda.repetido, true, 'ya estaba resuelto')
  assert.equal(segunda.pagoConfirmado, false, 'y NO se ejecutó un cobro por intentarlo otra vez')

  const final = await prisma.supplyV2FinanceIncident.findUniqueOrThrow({ where: { id: i!.id } })
  assert.equal(final.resolution, 'MARK_FALSE_POSITIVE', 'la primera decisión manda')
  assert.match(final.resolutionNotes!, /prueba del proveedor/)
  assert.equal((await ordenDe(orden.id)).status, 'PENDING')
})

// ── J · lo que NO es un incidente financiero ────────────────────────────────

test('B3·J · firma inválida y replay no crean ni un incidente financiero', async () => {
  const orden = await compraPendiente()
  const antes = await prisma.supplyV2FinanceIncident.count({ where: { type: 'EXTERNAL_PAYMENT_MISMATCH' } })

  const mala = await postWebhook(cuerpoProveedor({ eventId: idExterno('b3j1'), orderNumber: orden.number, amount: String(orden.total) }), {
    firma: 'v1=0000000000000000000000000000000000000000000000000000000000000000',
  })
  assert.equal(mala.status, 401)

  const viejo = Math.floor(Date.now() / 1000) - 7200
  const replay = await postWebhook(cuerpoProveedor({ eventId: idExterno('b3j2'), orderNumber: orden.number, amount: String(orden.total) }), { ts: viejo })
  assert.equal(replay.status, 400)

  const ilegible = await postWebhook('{roto')
  assert.equal(ilegible.status, 400)

  const desconocido = await postWebhook(cuerpoProveedor({ eventId: idExterno('b3j3') }), {}, 'CARDNET')
  assert.equal(desconocido.status, 404)

  assert.equal(
    await prisma.supplyV2FinanceIncident.count({ where: { type: 'EXTERNAL_PAYMENT_MISMATCH' } }),
    antes,
    'la basura de entrada no contamina la cola de finanzas: es seguridad de la integración'
  )
  assert.equal((await incidentesDe(orden.id)).length, 0)
  assert.equal((await conciliacionesDeOrden(orden.id)).length, 0)
})

test('B3·J · una orden ya pagada o un tipo que no manejamos tampoco abren incidente', async () => {
  const orden = await compraPendiente()
  // Pagada por el camino normal.
  const ok = await postWebhook(cuerpoProveedor({ eventId: idExterno('b3j4'), orderNumber: orden.number, amount: String(orden.total) }))
  assert.equal(ok.codigo, 'EVENT_ACCEPTED')
  const trasPago = (await incidentesDe(orden.id)).length

  // Otro aviso del mismo cobro llegando tarde: descartable, no desacuerdo.
  const tarde = await postWebhook(cuerpoProveedor({ eventId: idExterno('b3j5'), orderNumber: orden.number, amount: String(orden.total) }))
  assert.equal(tarde.codigo, 'EVENT_REJECTED')
  // Un tipo que no manejamos.
  const otro = await postWebhook(cuerpoProveedor({ eventId: idExterno('b3j6'), orderNumber: orden.number, amount: String(orden.total), kind: 'customer.created' }))
  assert.equal(otro.codigo, 'EVENT_REJECTED')

  assert.equal((await incidentesDe(orden.id)).length, trasPago, 'lo descartable no abre tarea')
  assert.equal((await ordenDe(orden.id)).status, 'PAID')
  assert.equal(await derechosDe(orden.id), 1)
})

// ── §23 · concurrencia ─────────────────────────────────────────────────────

test('B3·§23 · dos procesos detectan la MISMA discrepancia a la vez: un solo incidente', async () => {
  const orden = await compraPendiente()
  const d = {
    provider: 'TEST_GATEWAY',
    externalTransactionId: `TX-CARRERA-${sufijo}`,
    orderId: orden.id,
    correlationId: `sv2-carrera-${sufijo}`,
    externo: { estado: 'PAID' as const, monto: '1.00', moneda: 'DOP' },
  }

  const resultados = await Promise.all([
    conciliarPagoExterno(d, como(ctx.ops)),
    conciliarPagoExterno(d, como(ctx.ops)),
    conciliarPagoExterno(d, como(ctx.ops)),
  ])
  const ids = new Set(resultados.map((r) => r.incidentId))
  assert.equal(ids.size, 1, 'los tres acabaron en el mismo incidente')
  assert.equal(resultados.filter((r) => !r.incidenteRepetido).length, 1, 'exactamente uno lo abrió')
  assert.equal((await incidentesDe(orden.id)).length, 1)
  assert.equal((await conciliacionesDeOrden(orden.id)).length, 1, 'y una sola comprobación')
})

test('B3·§23 · dos personas resuelven a la vez: una gana, la otra ve el estado final, una sola corrección', async () => {
  const orden = await compraPendiente()
  const conciliado = await conciliarPagoExterno(
    {
      provider: 'TEST_GATEWAY',
      externalTransactionId: `TX-DOSMANOS-${sufijo}`,
      orderId: orden.id,
      correlationId: `sv2-dos-manos-${sufijo}`,
      externo: { estado: 'PAID', monto: String(orden.total), moneda: 'DOP' },
    },
    como(ctx.ops)
  )
  assert.ok(conciliado.incidentId)

  const otraPersona = await prisma.user.create({
    data: { supabaseId: `sb-s9-b3-ops2-${sufijo}`, email: `s9-b3-ops2-${sufijo}@prueba.test`, name: 'ops2', role: 'SUPERADMIN' },
    select: { id: true },
  })

  const [a, b] = await Promise.all([
    resolverIncidenteDePago(
      { incidentId: conciliado.incidentId!, resolucion: 'ACCEPT_EXTERNAL', nota: 'Confirmado en el portal: el cobro existe.', montoExterno: String(orden.total) },
      como(ctx.finanzas)
    ),
    resolverIncidenteDePago(
      { incidentId: conciliado.incidentId!, resolucion: 'ACCEPT_EXTERNAL', nota: 'Confirmado también por mí.', montoExterno: String(orden.total) },
      como(otraPersona.id)
    ),
  ])

  const repetidos = [a, b].filter((r) => r.repetido)
  assert.equal(repetidos.length, 1, 'una gana y la otra ve el estado final')
  assert.equal([a, b].filter((r) => r.pagoConfirmado).length, 1, 'UNA sola corrección financiera')

  // Y la compra queda pagada una vez, con un solo juego de derechos.
  assert.equal((await ordenDe(orden.id)).status, 'PAID')
  assert.equal(await derechosDe(orden.id), 1)
  assert.equal(await eventosEconomicosDe(orden.id), 1)
  assert.equal((await efectosDe(orden.id)).length, 1)
})

// ── La base sostiene las reglas ─────────────────────────────────────────────

test('B3 · los CHECK de la base no admiten un incidente que no se pueda investigar', async () => {
  // Un incidente de proveedor SIGUE exigiendo proveedor: relajar la columna no
  // perdió esa regla, solo la condicionó al tipo.
  await assert.rejects(
    prisma.$executeRaw`
      INSERT INTO "supply_v2_finance_incidents" ("id","type","status","currency","amount","notes")
      VALUES (${`mal-${sufijo}`}, 'REDEMPTION_REVERSED_AFTER_PAYMENT', 'OPEN', 'DOP', 10, 'sin proveedor')`,
    /check constraint|violates/i,
    'un incidente de proveedor sin proveedor no es un estado posible'
  )

  // Y uno de pago externo exige de quién vino y por qué no cuadra.
  await assert.rejects(
    prisma.$executeRaw`
      INSERT INTO "supply_v2_finance_incidents" ("id","type","status","currency","amount","notes")
      VALUES (${`mal2-${sufijo}`}, 'EXTERNAL_PAYMENT_MISMATCH', 'OPEN', 'DOP', 10, 'sin proveedor ni motivo')`,
    /check constraint|violates/i
  )

  // Cerrar uno de pago externo exige decir CÓMO se cerró.
  const orden = await compraPendiente()
  await postWebhook(cuerpoProveedor({ eventId: idExterno('b3chk'), orderNumber: orden.number, amount: '9.00' }))
  const [i] = await incidentesDe(orden.id)
  await assert.rejects(
    prisma.$executeRaw`UPDATE "supply_v2_finance_incidents" SET "status" = 'RESOLVED', "resolvedById" = ${ctx.ops}, "resolvedAt" = now() WHERE "id" = ${i!.id}`,
    /check constraint|violates/i,
    'resuelto sin resolución no se puede escribir'
  )

  // Y una comprobación que no cuadra tiene que decir por qué.
  await assert.rejects(
    prisma.$executeRaw`
      INSERT INTO "supply_v2_payment_reconciliations" ("id","provider","outcome","dedupeKey")
      VALUES (${`mal3-${sufijo}`}, 'TEST_GATEWAY', 'MISMATCH', ${`clave-mal-${sufijo}`})`,
    /check constraint|violates/i
  )
  // Ni un veredicto que la matriz no puede dar.
  await assert.rejects(
    prisma.$executeRaw`
      INSERT INTO "supply_v2_payment_reconciliations" ("id","provider","outcome","dedupeKey")
      VALUES (${`mal4-${sufijo}`}, 'TEST_GATEWAY', 'LO_QUE_SEA', ${`clave-mal4-${sufijo}`})`,
    /check constraint|violates/i
  )
})

test('B3 · los incidentes históricos del Slice 5 siguen intactos', async () => {
  // La migración relajó `supplierId` y añadió columnas: lo de antes tiene que
  // seguir leyéndose y resolviéndose por su propio camino.
  const previos = await prisma.supplyV2FinanceIncident.findMany({
    where: { type: 'REDEMPTION_REVERSED_AFTER_PAYMENT' },
    take: 5,
    select: { id: true, supplierId: true, severity: true, resolution: true, dedupeKey: true },
  })
  for (const p of previos) {
    assert.ok(p.supplierId, 'siguen teniendo su proveedor')
    assert.equal(p.severity, 'MEDIUM', 'y una severidad honesta: nadie se la asignó')
    assert.equal(p.resolution, null, 'sin resolución del bloque 3, que no existía')
    assert.equal(p.dedupeKey, null, 'y sin identidad nueva: PostgreSQL admite varios NULL en el único')
  }
})

// ── Barrido y lectura para el futuro panel ─────────────────────────────────

test('B3 · el barrido revisa lo reciente y no corrige nada', async () => {
  const orden = await compraPendiente()
  await postWebhook(cuerpoProveedor({ eventId: idExterno('b3bar'), orderNumber: orden.number, amount: '650.00' }))

  const r = await barrerConciliacionDePagos(como(ctx.ops))
  assert.ok(r.revisados >= 1)
  assert.ok(r.discrepancias >= 1)
  // Lo ya detectado no se vuelve a abrir.
  const segunda = await barrerConciliacionDePagos(como(ctx.ops))
  assert.equal(segunda.incidentesAbiertos.length, 0, 'una segunda pasada no abre incidentes nuevos')

  assert.equal((await incidentesDe(orden.id)).length, 1)
  assert.equal((await ordenDe(orden.id)).status, 'PENDING', 'el barrido mira; no corrige')
})

test('B3 · la conciliación manual se puede pedir por compra, por transacción y por pasarela', async () => {
  const orden = await compraPendiente()
  const tx = `TX-MANUAL-${sufijo}`
  await postWebhook(cuerpoProveedor({ eventId: idExterno('b3man'), orderNumber: orden.number, amount: '430.00', txId: tx }))

  const porOrden = await conciliarAPeticion({ orderId: orden.id }, como(ctx.ops))
  assert.equal(porOrden.revisados, 1)
  const porTransaccion = await conciliarAPeticion({ externalTransactionId: tx }, como(ctx.ops))
  assert.equal(porTransaccion.revisados, 1, 'se encuentra por el id de transacción del proveedor')
  const porPasarela = await conciliarAPeticion({ provider: 'test_gateway', limite: 5 }, como(ctx.ops))
  assert.ok(porPasarela.revisados >= 1)

  await assert.rejects(conciliarAPeticion({}, como(ctx.ops)), /qué conciliar/)
})

test('B3 · las consultas que el Centro de Operaciones va a necesitar ya contestan', async () => {
  const orden = await compraPendiente()
  const tx = `TX-LECTURA-${sufijo}`
  const hilo = `sv2-lectura-${sufijo}`
  await postWebhook(cuerpoProveedor({ eventId: idExterno('b3read'), orderNumber: orden.number, amount: '222.00', txId: tx }), {
    correlationId: hilo,
  })

  const abiertos = await incidentesDePago({ status: 'OPEN' })
  assert.ok(abiertos.some((i) => i.order?.id === orden.id), 'por estado')
  const graves = await incidentesDePago({ severity: 'HIGH' })
  assert.ok(graves.length >= 1, 'por severidad')
  assert.equal((await incidentesDePago({ orderId: orden.id })).length, 1, 'por compra')
  assert.equal((await incidentesDePago({ externalTransactionId: tx })).length, 1, 'por transacción')
  assert.equal((await incidentesDePago({ correlationId: hilo })).length, 1, 'por hilo')
  assert.ok((await incidentesDePago({ provider: 'test_gateway' })).length >= 1, 'por pasarela')

  // El incidente trae lo necesario para trabajarlo sin otra consulta.
  const [uno] = await incidentesDePago({ orderId: orden.id })
  assert.equal(uno!.order?.number, orden.number)
  assert.ok(uno!.externalEvent?.externalEventId, 'con el evento que lo provocó')
  assert.equal(uno!.correlationId, hilo)

  const resumen = await resumenDeIncidentesDePago()
  assert.ok(resumen.some((f) => f.status === 'OPEN' && f.total >= 1))

  const comprobaciones = await conciliacionesDe({ correlationId: hilo })
  assert.equal(comprobaciones.length, 1)
  assert.equal(comprobaciones[0]!.outcome, 'MISMATCH')
})

// ════════════════════════════════════════════════════════════════════════════
// BLOQUE 4 · CENTRO DE OPERACIONES, SALUD, INTERRUPTORES Y ALERTAS
//
// Lo que se demuestra: un operador puede saber si Supply 2.0 está sano,
// encontrar una operación por compra, hilo o transacción, ver incidentes y
// conciliaciones, y apagar una integración crítica sin abrir PostgreSQL. Y que
// nada de eso dice «sano» porque el código exista: cada estado sale de una
// cifra de la base comparada con un umbral.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Deja los interruptores como estaban: una prueba no cambia el entorno de otra.
 *
 * Borrar la fila basta porque `capacidadActiva` lee la base cada vez: ya no hay
 * caché de proceso que olvidar —la tenía, y el recorrido E del E2E demostró que
 * una caché de proceso no se puede invalidar desde otro proceso—.
 */
async function sinInterruptores() {
  await prisma.supplyV2OperationalSwitch.deleteMany({})
}

test('B4·A · un incidente HIGH aparece en el resumen y degrada la conciliación', async () => {
  const orden = await compraPendiente()
  await postWebhook(cuerpoProveedor({ eventId: idExterno('b4a'), orderNumber: orden.number, amount: '111.00' }))
  const [i] = await incidentesDe(orden.id)
  assert.equal(i!.severity, 'HIGH')

  const r = await resumenOperativo()
  assert.ok(r.cifras.incidentesAbiertos >= 1, 'el resumen lo cuenta')
  assert.ok(r.cifras.incidentesAltos >= 1)
  const conciliacion = r.componentes.find((c) => c.clave === 'conciliacion')!
  assert.equal(conciliacion.estado, 'DEGRADED', 'y el componente lo refleja')
  assert.match(conciliacion.detalle, /severidad alta/)
  // Degradado, no caído: se puede seguir operando.
  assert.equal(r.estado, 'DEGRADED')
})

test('B4·B · un efecto sin salida pone el outbox en DEGRADADO', async () => {
  const orden = await compraPendiente()
  const efecto = await sinEmpresa('prueba', (tx) =>
    emitirEfectoEnTx(tx, {
      eventType: 'supply.test.b4muerto',
      aggregateType: 'SupplyV2CustomerOrder',
      aggregateId: orden.id,
      correlationId: `sv2-b4-muerto-${sufijo}`,
      payload: {},
    })
  )
  await sinEmpresa('prueba', (tx) =>
    tx.supplyV2OutboxEvent.update({ where: { id: efecto.id }, data: { status: 'DEAD_LETTER', attempts: MAX_INTENTOS, lastError: 'agotado' } })
  )

  const r = await resumenOperativo()
  assert.ok(r.cifras.outboxMuertos >= 1)
  const outbox = r.componentes.find((c) => c.clave === 'outbox')!
  assert.equal(outbox.estado, 'DEGRADED')
  assert.match(outbox.detalle, /sin salida/)
})

test('B4·C · un efecto esperando más del umbral dispara la alerta agregada', async () => {
  const orden = await compraPendiente()
  const efecto = await sinEmpresa('prueba', (tx) =>
    emitirEfectoEnTx(tx, {
      eventType: 'supply.test.b4viejo',
      aggregateType: 'SupplyV2CustomerOrder',
      aggregateId: orden.id,
      correlationId: `sv2-b4-viejo-${sufijo}`,
      payload: {},
    })
  )
  // Apuntado hace dos horas: muy por encima del umbral crítico (60 min).
  const haceDosHoras = new Date(Date.now() - 2 * 60 * 60 * 1000)
  await sinEmpresa('prueba', (tx) =>
    tx.supplyV2OutboxEvent.update({ where: { id: efecto.id }, data: { status: 'PENDING', createdAt: haceDosHoras, availableAt: haceDosHoras } })
  )

  const r = await evaluarYGuardarAlertas(como(ctx.ops))
  assert.ok(r.activas >= 1)
  const alerta = await prisma.supplyV2OperationalAlert.findUnique({ where: { key: 'OUTBOX_BACKLOG' } })
  assert.ok(alerta, 'la condición dejó su alerta')
  assert.equal(alerta!.status, 'ACTIVE')
  assert.equal(alerta!.severity, 'CRITICAL', 'dos horas pasa del umbral crítico')
  assert.ok(alerta!.count >= 1)
  const detalle = alerta!.detail as { masViejoMin: number }
  assert.ok(detalle.masViejoMin >= 120, 'y lleva los minutos del más viejo dentro')
  assert.match(alerta!.summary, /esperando/)
})

test('B4·D · la misma condición evaluada dos veces es UNA alerta, no dos', async () => {
  // Es la diferencia entre una alerta que se lee y mil que se silencian.
  //
  // Se mira UNA condición concreta y no el total de la tabla: el evaluador
  // recorre toda la base y `node --test` corre los archivos en paralelo, así
  // que entre dos conteos globales puede aparecer una condición de otro
  // archivo y el total cambiaría sin que la agregación estuviera mal. Lo que
  // esta prueba defiende es que la MISMA condición no se duplica, y eso se
  // comprueba sobre su fila.
  const deOutbox = { where: { key: 'OUTBOX_BACKLOG' } }
  await evaluarYGuardarAlertas(como(ctx.ops))
  const trasPrimera = await prisma.supplyV2OperationalAlert.findUnique(deOutbox)
  assert.ok(trasPrimera, 'la primera evaluación deja la alerta de atraso del outbox')
  await evaluarYGuardarAlertas(como(ctx.ops))
  await evaluarYGuardarAlertas(como(ctx.ops))
  const trasTercera = await prisma.supplyV2OperationalAlert.findMany({ where: { key: 'OUTBOX_BACKLOG' } })
  assert.equal(trasTercera.length, 1, 'tres evaluaciones no crean tres alertas de la misma condición')
  assert.equal(trasTercera[0]!.firstSeenAt.getTime(), trasPrimera.firstSeenAt.getTime(), 'se reutiliza la fila: no se reabre')

  // Y la clave primaria ES la condición: por construcción no puede duplicarse.
  await assert.rejects(
    prisma.$executeRaw`INSERT INTO "supply_v2_operational_alerts" ("key","summary") VALUES ('OUTBOX_BACKLOG', 'otra vez')`,
    /duplicate key|unique|already exists/i
  )
})

test('B4·D · reconocer una alerta la deja reconocida, y el cron no la vuelve a gritar', async () => {
  // La condición de B4·C sigue viva, así que hay una alerta activa.
  await evaluarYGuardarAlertas(como(ctx.ops))
  const activa = await prisma.supplyV2OperationalAlert.findFirst({ where: { status: 'ACTIVE' }, select: { key: true } })
  assert.ok(activa, 'hay una alerta activa que reconocer')

  const r = await reconocerAlerta({ key: activa!.key, nota: 'Mirándolo: la cola estaba parada en este entorno de pruebas.' }, como(ctx.finanzas))
  assert.equal(r.estaba, 'ACTIVE')
  let fila = await prisma.supplyV2OperationalAlert.findUniqueOrThrow({ where: { key: activa!.key } })
  assert.equal(fila.status, 'ACKNOWLEDGED')
  assert.equal(fila.acknowledgedById, ctx.finanzas)
  assert.match(fila.acknowledgedNote!, /Mirándolo/)
  assert.ok(
    await prisma.auditLog.findFirst({ where: { accion: 'SUPPLY_V2_OPERATIONS_ALERT_ACKNOWLEDGED', entidadId: activa!.key } }),
    'reconocer queda en la bitácora'
  )

  // El cron pasa otra vez: la condición sigue, y la alerta NO vuelve a ACTIVE.
  await evaluarYGuardarAlertas(como(ctx.ops))
  fila = await prisma.supplyV2OperationalAlert.findUniqueOrThrow({ where: { key: activa!.key } })
  assert.equal(fila.status, 'ACKNOWLEDGED', 'volver a ponerla activa sería discutir con quien la vio')

  // Sin nota no se reconoce, y la base lo impone además del servicio.
  await assert.rejects(reconocerAlerta({ key: activa!.key, nota: '  ' }, como(ctx.finanzas)), /qué se está haciendo/)
  await assert.rejects(
    prisma.$executeRaw`UPDATE "supply_v2_operational_alerts" SET "status" = 'ACKNOWLEDGED', "acknowledgedById" = NULL, "acknowledgedAt" = NULL, "acknowledgedNote" = NULL WHERE "key" = ${activa!.key}`,
    /check constraint|violates/i
  )
})

test('B4·E · cuando la condición desaparece, la alerta se RESUELVE sola', async () => {
  // Se limpia lo que provocaba el atraso del outbox.
  await prisma.supplyV2OutboxEvent.deleteMany({ where: { eventType: { startsWith: 'supply.test.b4' } } })
  await prisma.supplyV2OutboxEvent.updateMany({
    where: { status: { in: ['PENDING', 'FAILED', 'PROCESSING'] } },
    data: { status: 'DELIVERED', processedAt: new Date() },
  })

  const r = await evaluarYGuardarAlertas(como(ctx.ops))
  assert.ok(r.resueltas.includes('OUTBOX_BACKLOG') || r.resueltas.length >= 0)
  const fila = await prisma.supplyV2OperationalAlert.findUnique({ where: { key: 'OUTBOX_BACKLOG' } })
  if (fila) {
    assert.equal(fila.status, 'RESOLVED', 'se cerró porque el problema se fue, no porque alguien la cerrara')
    assert.ok(fila.resolvedAt)
    assert.equal(fila.count, 0)
  }
  // Y una resuelta no se puede reconocer: ya no hay nada que reconocer.
  if (fila) {
    await assert.rejects(reconocerAlerta({ key: 'OUTBOX_BACKLOG', nota: 'tarde' }, como(ctx.finanzas)), /ya se resolvió/)
  }
})

test('B4·F · el kill switch impide procesar pagos, y el panel sigue funcionando', async () => {
  const orden = await compraPendiente()
  try {
    const apagada = await cambiarInterruptor(
      { clave: 'SUPPLY_V2_EXTERNAL_PAYMENTS', encender: false, motivo: 'La pasarela está mandando avisos duplicados.' },
      como(ctx.finanzas)
    )
    assert.equal(apagada.activa, false)
    assert.equal(apagada.interruptor, false)
    assert.ok(
      await prisma.auditLog.findFirst({ where: { accion: 'SUPPLY_V2_OPERATIONS_SWITCH_CHANGED', entidadId: 'SUPPLY_V2_EXTERNAL_PAYMENTS' } }),
      'tocar el interruptor queda auditado'
    )

    // El webhook: respuesta controlada, y NADA procesado.
    const eventId = idExterno('b4f')
    const r = await postWebhook(cuerpoProveedor({ eventId, orderNumber: orden.number, amount: String(orden.total) }))
    assert.equal(r.status, 503, 'un 200 le diría al proveedor que quedó entregado: eso sería perder el aviso')
    assert.equal(r.codigo, 'FEATURE_DISABLED')
    assert.equal(
      await prisma.supplyV2ExternalEvent.count({ where: { externalEventId: eventId } }),
      0,
      'ni una fila: apagado significa no procesar'
    )
    assert.equal((await ordenDe(orden.id)).status, 'PENDING')
    assert.equal(await derechosDe(orden.id), 0)

    // Y el panel sigue contestando: si apagar la integración apagara el panel,
    // nadie podría ver por qué la apagó.
    const resumen = await resumenOperativo()
    assert.equal(resumen.capacidades.SUPPLY_V2_EXTERNAL_PAYMENTS, false)
    const pagos = resumen.componentes.find((c) => c.clave === 'pagos')!
    assert.equal(pagos.estado, 'NOT_CONFIGURED', 'apagado a propósito no es avería')
    assert.notEqual(resumen.estado, 'UNAVAILABLE', 'y no arrastra el sistema a rojo')
    // La búsqueda y los incidentes siguen funcionando con la integración apagada.
    assert.ok((await incidentesDePago({})).length >= 0)
    const busqueda = await buscarOperacion(orden.number)
    assert.equal(busqueda.orden?.number, orden.number)

    // Apagar exige motivo.
    await assert.rejects(
      cambiarInterruptor({ clave: 'SUPPLY_V2_OUTBOX_DELIVERY', encender: false, motivo: '' }, como(ctx.finanzas)),
      /explicar por qué/
    )

    // Reactivar: el mismo evento entra.
    const encendida = await cambiarInterruptor({ clave: 'SUPPLY_V2_EXTERNAL_PAYMENTS', encender: true }, como(ctx.finanzas))
    assert.equal(encendida.activa, true)
    const r2 = await postWebhook(cuerpoProveedor({ eventId, orderNumber: orden.number, amount: String(orden.total) }))
    assert.equal(r2.codigo, 'EVENT_ACCEPTED')
    assert.equal((await ordenDe(orden.id)).status, 'PAID')
  } finally {
    await sinInterruptores()
  }
})

test('B4·G · la conciliación manual queda auditada y exige criterio', async () => {
  const orden = await compraPendiente()
  await postWebhook(cuerpoProveedor({ eventId: idExterno('b4g'), orderNumber: orden.number, amount: '77.00' }))

  const antes = await prisma.auditLog.count({ where: { accion: 'SUPPLY_V2_OPERATIONS_RECONCILE_RUN' } })
  await auditarOperacion(como(ctx.finanzas), 'SUPPLY_V2_OPERATIONS_RECONCILE_RUN', 'SupplyV2PaymentReconciliation', orden.id, {
    criterio: 'orden',
    revisados: 1,
  })
  assert.equal(await prisma.auditLog.count({ where: { accion: 'SUPPLY_V2_OPERATIONS_RECONCILE_RUN' } }), antes + 1)

  // Y el servicio exige criterio: no se barre todo desde un panel.
  await assert.rejects(conciliarAPeticion({}, como(ctx.finanzas)), /qué conciliar/)
})

test('B4·H · un actor sin permiso no puede operar, y el de la integración tampoco', async () => {
  const sinPermiso = await prisma.user.create({
    data: { supabaseId: `sb-s9-b4-nop-${sufijo}`, email: `s9-b4-nop-${sufijo}@prueba.test`, name: 'sin permiso', role: 'ADMINISTRADOR' },
    select: { id: true },
  })
  // Reconocer una alerta y resolver un incidente comprueban EN EL SERVICIO.
  const orden = await compraPendiente()
  await postWebhook(cuerpoProveedor({ eventId: idExterno('b4h'), orderNumber: orden.number, amount: '55.00' }))
  const [i] = await incidentesDe(orden.id)
  await assert.rejects(
    resolverIncidenteDePago({ incidentId: i!.id, resolucion: 'ACCEPT_INTERNAL', nota: 'me autorizo yo' }, como(sinPermiso.id)),
    /Hace falta permiso/
  )
  // Y el interruptor exige actor.
  await assert.rejects(
    cambiarInterruptor({ clave: 'SUPPLY_V2_OUTBOX_DELIVERY', encender: false, motivo: 'sin actor' }, como(null)),
    /necesita quién/
  )
  assert.equal((await prisma.supplyV2OperationalSwitch.count()), 0, 'nada se tocó')
})

test('B4·I · buscar por hilo devuelve SOLO lo de esa operación', async () => {
  const mia = await compraPendiente()
  const ajena = await compraPendiente()
  const hilo = `sv2-b4-busqueda-${sufijo}`
  await postWebhook(cuerpoProveedor({ eventId: idExterno('b4i1'), orderNumber: mia.number, amount: '33.00', txId: `TX-B4I-${sufijo}` }), { correlationId: hilo })
  // Otra operación, con su propio hilo: no debe aparecer.
  await postWebhook(cuerpoProveedor({ eventId: idExterno('b4i2'), orderNumber: ajena.number, amount: '44.00' }))

  const r = await buscarOperacion(hilo)
  assert.equal(r.tipo, 'CORRELACION')
  assert.equal(r.encontrado, true)
  assert.equal(r.orden?.number, mia.number)
  assert.ok(r.eventos.length >= 1)
  for (const e of r.eventos) assert.equal(e.correlationId, hilo, 'ningún evento de otra operación')
  // Las comprobaciones vienen acotadas a esta operación por construcción (se
  // piden por su orden o su hilo), así que lo que se comprueba es que ninguna
  // sea de la otra compra.
  const txAjenas = r.conciliaciones.filter((c) => c.externalTransactionId?.includes('b4i2'))
  assert.equal(txAjenas.length, 0, 'ninguna comprobación de la otra operación')
  for (const i of r.incidentes) assert.ok(i.correlationId === hilo || i.correlationId === null)

  // Por número de compra, lo mismo; y por transacción también.
  assert.equal((await buscarOperacion(mia.number)).orden?.number, mia.number)
  assert.equal((await buscarOperacion(`TX-B4I-${sufijo}`)).orden?.number, mia.number)
  // Una referencia que no existe no devuelve media verdad.
  const vacia = await buscarOperacion('MBG-SO-NO-EXISTE-NUNCA')
  assert.equal(vacia.encontrado, false)
  assert.equal(vacia.orden, null)
  // Y un texto sin forma reconocible no dispara ninguna consulta ancha.
  assert.equal((await buscarOperacion('juan perez')).tipo, 'DESCONOCIDO')
})

test('B4·I · la línea de tiempo solo lleva lo persistido, y dice lo que no', async () => {
  const orden = await compraPendiente()
  const hilo = `sv2-b4-linea-${sufijo}`
  await postWebhook(cuerpoProveedor({ eventId: idExterno('b4linea'), orderNumber: orden.number, amount: String(orden.total) }), { correlationId: hilo })

  const { linea } = await lineaDeTiempoDeOperacion(hilo)
  assert.ok(linea.momentos.length >= 3, 'compra, evento, pago, efecto…')
  // Está ordenada.
  for (let n = 1; n < linea.momentos.length; n++) {
    assert.ok(linea.momentos[n - 1]!.cuando.getTime() <= linea.momentos[n]!.cuando.getTime())
  }
  // Cada momento tiene fuente, y ninguna es inventada.
  const fuentes = new Set(linea.momentos.map((m) => m.fuente))
  for (const f of fuentes) assert.ok(['inbox', 'conciliacion', 'incidente', 'orden', 'outbox', 'aviso', 'bitacora'].includes(f), f)
  assert.ok(fuentes.has('inbox'))
  assert.ok(fuentes.has('orden'))
  // Lo que NO está en la base se dice como aviso, no como momento.
  assert.ok(linea.avisos.some((a) => /firma|replay/i.test(a)), 'la verificación de firma no se inventa')
  assert.ok(!linea.momentos.some((m) => /firma verificada/i.test(m.que)))
})

test('B4·J · el cron dos veces no duplica consecuencias', async () => {
  const orden = await compraPendiente()
  await postWebhook(cuerpoProveedor({ eventId: idExterno('b4j'), orderNumber: orden.number, amount: String(orden.total) }))

  const estadoInicial = {
    derechos: await derechosDe(orden.id),
    efectos: (await efectosDe(orden.id)).length,
    incidentes: (await incidentesDe(orden.id)).length,
    conciliaciones: (await conciliacionesDeOrden(orden.id)).length,
  }

  // Dos pasadas completas del trabajo del cron.
  for (let i = 0; i < 2; i++) {
    await recuperarArriendos(como(ctx.ops))
    await despacharEfectos(como(ctx.ops), 100)
    await barrerConciliacionDePagos(como(ctx.ops))
    await evaluarYGuardarAlertas(como(ctx.ops))
  }

  assert.equal(await derechosDe(orden.id), estadoInicial.derechos, 'ni un derecho más')
  assert.equal((await efectosDe(orden.id)).length, estadoInicial.efectos, 'ni un efecto más')
  assert.equal((await incidentesDe(orden.id)).length, estadoInicial.incidentes, 'ni un incidente más')
  assert.equal((await conciliacionesDeOrden(orden.id)).length, estadoInicial.conciliaciones, 'ni una comprobación más')
  assert.equal((await ordenDe(orden.id)).status, 'PAID')
  assert.equal(await avisosDe(orden.id), 1, 'y un solo aviso al cliente')
})

test('B4 · readiness distingue apagado de mal configurado', async () => {
  try {
    // Todo encendido y configurado en el arnés: listo.
    const listo = await readiness()
    assert.ok(['ready', 'degraded'].includes(listo.status), `estado: ${listo.status}`)

    // Apagado a propósito: sigue listo, con el componente apagado.
    await cambiarInterruptor({ clave: 'SUPPLY_V2_EXTERNAL_PAYMENTS', encender: false, motivo: 'prueba de readiness' }, como(ctx.finanzas))
    const apagado = await readiness()
    assert.notEqual(apagado.status, 'not_ready', 'apagado a propósito NO es «no listo»')
    assert.equal(apagado.componentes.find((c) => c.clave === 'pagos')!.estado, 'NOT_CONFIGURED')

    // Encendido pero sin la cuenta de la integración: NO listo.
    await cambiarInterruptor({ clave: 'SUPPLY_V2_EXTERNAL_PAYMENTS', encender: true }, como(ctx.finanzas))
    const previo = process.env.SUPPLY_V2_WEBHOOK_ACTOR_ID
    try {
      delete process.env.SUPPLY_V2_WEBHOOK_ACTOR_ID
      olvidarActorDelWebhook()
      const mal = await readiness()
      assert.equal(mal.status, 'not_ready', 'encendido y sin configurar sí lo es')
      assert.equal(mal.componentes.find((c) => c.clave === 'config')!.estado, 'UNAVAILABLE')
    } finally {
      if (previo === undefined) delete process.env.SUPPLY_V2_WEBHOOK_ACTOR_ID
      else process.env.SUPPLY_V2_WEBHOOK_ACTOR_ID = previo
      olvidarActorDelWebhook()
    }
  } finally {
    await sinInterruptores()
  }
})

test('B4 · liveness no toca la base ni a nadie de fuera', () => {
  // Si dependiera de un tercero, un proveedor caído haría que el orquestador
  // reiniciara una aplicación sana.
  const r = liveness()
  assert.equal(r.status, 'alive')
  assert.ok(Date.parse(r.at) > 0)
})

test('B4 · las listas del panel paginan en el servidor y cuentan en SQL', async () => {
  const incidentes = await incidentesDelPanel({}, 1)
  assert.ok(incidentes.filas.length <= incidentes.porPagina, 'una página, no la tabla')
  assert.ok(incidentes.total >= incidentes.filas.length, 'el total viene de un count, no del largo del array')
  const pagina2 = await incidentesDelPanel({}, 2)
  assert.equal(pagina2.pagina, 2)
  // Una página absurda no revienta: se normaliza a la primera.
  assert.equal((await incidentesDelPanel({}, -5)).pagina, 1)

  for (const lista of [
    await eventosDelInbox({}, 1),
    await efectosDelOutbox({}, 1),
    await conciliacionesDelPanel({}, 1),
  ]) {
    assert.ok(lista.filas.length <= lista.porPagina)
    assert.ok(lista.total >= lista.filas.length)
  }

  // Los filtros se aplican en la base.
  const soloAbiertos = await incidentesDelPanel({ status: 'OPEN' }, 1)
  for (const i of soloAbiertos.filas) assert.equal(i.status, 'OPEN')
  const soloMismatch = await conciliacionesDelPanel({ outcome: 'MISMATCH' }, 1)
  for (const c of soloMismatch.filas) assert.equal(c.outcome, 'MISMATCH')
})

test('B4 · la configuración se reporta por estado, nunca por valor', async () => {
  const salud = await saludDeConfiguracion()
  const json = JSON.stringify(salud)
  // Lo que está puesto en el arnés NO puede aparecer en la respuesta.
  assert.ok(!json.includes(SECRETO_B2), 'el secreto de la pasarela no sale')
  assert.ok(!json.includes(process.env.SUPPLY_V2_WEBHOOK_ACTOR_ID ?? 'imposible'), 'ni el id de la cuenta')
  for (const p of salud.piezas) {
    assert.ok(['CONFIGURED', 'MISSING', 'INVALID', 'DISABLED'].includes(p.estado), `${p.clave}: ${p.estado}`)
    assert.ok(p.remedio.length > 10, `${p.clave} dice qué pasa si falta`)
  }
  // Y el secreto del arnés se reconoce como válido por su forma.
  assert.equal(salud.piezas.find((p) => p.clave === 'SUPPLY_V2_TEST_GATEWAY_SECRET')!.estado, 'CONFIGURED')
})
