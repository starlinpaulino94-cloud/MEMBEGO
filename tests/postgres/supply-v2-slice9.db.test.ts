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
  ops: '',
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
  if (mios.length) {
    await prisma.supplyV2ExternalEvent.deleteMany({ where: { id: { in: mios.map((e) => e.id) } } })
  }
}

after(limpiar)

before(async () => {
  await limpiar()

  const [ops, cliente, empleado] = await Promise.all(
    (
      [
        ['ops', 'SUPERADMIN'],
        ['cli', 'CLIENTE'],
        ['emp', 'ADMINISTRADOR'],
      ] as const
    ).map(([k, role]) => prisma.user.create({ data: { supabaseId: `sb-s9-${k}-${sufijo}`, email: `s9-${k}-${sufijo}@prueba.test`, name: k, role }, select: { id: true } }))
  )
  ctx.ops = ops.id
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
