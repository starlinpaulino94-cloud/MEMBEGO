/**
 * PAGO CON TARJETA → CONCILIACIÓN ACCIONABLE (fase 4), contra PostgreSQL con los servicios de verdad.
 *
 * Cada hallazgo trae su lista de CASOS y cada caso su acción, auditada y sin recobrar:
 *   1 · un cobro con tarjeta sin comprobante se resuelve con «Generar comprobante»: la venta lleva la fecha del COBRO;
 *   2 · no se genera comprobante de un cobro no entregado ni de otra empresa;
 *   3 · un cobro sin venta que NO fue de pasarela solo ofrece la ficha, y no se lista dos veces;
 *   4 · «Reintentar entrega» activa el producto de un cliente que esperaba; no se ofrece si ya está activo o está en curso;
 *   5 · «Marcar entregada» exige nota y evidencia, cierra el registro con la fecha de la activación y genera el comprobante;
 *   6 · una entrega recién empezada no es un fallo;
 *   7 · las cajas abiertas de días anteriores y los turnos descuadrados traen su caso con su enlace;
 *   8 · la ventana y el tope de la lista.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../../src/lib/prisma'
import { conciliar, CASOS_POR_HALLAZGO, type Conciliacion } from '../../src/modules/observabilidad/conciliacion'
import {
  generarComprobanteDeCobro,
  marcarCobroEntregado,
  reintentarEntregaDeCobro,
  type ActorDeConciliacion,
} from '../../src/modules/observabilidad/conciliacion-servicio'

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const PRECIO = 500
const DIA = 86_400_000

interface Empresa { companyId: string; clienteId: string; planId: string; userId: string; sucursalId: string }

async function crearEmpresa(etiqueta: string): Promise<Empresa> {
  const c = await prisma.company.create({ data: { name: `Concilia ${etiqueta} ${sufijo}`, slug: `concilia-${etiqueta}-${sufijo}`, type: 'carwash', ciudad: 'Santo Domingo' }, select: { id: true } })
  const cliente = await prisma.cliente.create({ data: { companyId: c.id, supabaseId: `sb-cc-${etiqueta}-${sufijo}`, nombre: `Cliente ${etiqueta}`, email: `cc-${etiqueta}-${sufijo}@prueba.test` }, select: { id: true } })
  const plan = await prisma.plan.create({ data: { companyId: c.id, nombre: `Plan ${etiqueta}`, precio: PRECIO, vigenciaDias: 30, lavadosIncluidos: 4 }, select: { id: true } })
  const u = await prisma.user.create({ data: { supabaseId: `sb-ccu-${etiqueta}-${sufijo}`, email: `ccu-${etiqueta}-${sufijo}@prueba.test`, name: `Gerente ${etiqueta}`, role: 'ADMINISTRADOR', companyId: c.id }, select: { id: true } })
  const s = await prisma.sucursal.create({ data: { companyId: c.id, nombre: 'Principal' }, select: { id: true } })
  return { companyId: c.id, clienteId: cliente.id, planId: plan.id, userId: u.id, sucursalId: s.id }
}

const actor = (e: Empresa): ActorDeConciliacion => ({ userId: e.userId, ipAddress: '10.0.0.1', userAgent: 'prueba' })
const hallazgo = (r: Conciliacion, clave: string) => r.hallazgos.find((h) => h.clave === clave)

/** Una membresía de ESTE cliente. El índice único es (cliente, empresa): cada caso que necesita otra trae su cliente. */
async function clienteExtra(e: Empresa, n: string) {
  return prisma.cliente.create({ data: { companyId: e.companyId, supabaseId: `sb-cx-${n}-${sufijo}`, nombre: `Extra ${n}`, email: `cx-${n}-${sufijo}@prueba.test` }, select: { id: true } })
}

async function membresia(e: Empresa, clienteId: string, extra: Record<string, unknown> = {}) {
  return prisma.membership.create({ data: { companyId: e.companyId, clienteId, planId: e.planId, ...extra }, select: { id: true } })
}

/** Un cobro aprobado en pasarela con el producto indicado. */
async function cobro(e: Empresa, clienteId: string, membershipId: string, extra: Record<string, unknown> = {}) {
  return prisma.pagoIntento.create({
    data: { companyId: e.companyId, clienteId, proveedor: 'CARDNET', membershipId, monto: PRECIO, estado: 'APROBADO', activadoAt: new Date(), autorizacion: 'AUTH-CC', canal: 'APP', ...extra },
    select: { id: true },
  })
}

const entregado = { fulfillmentEstado: 'COMPLETADA' as const, fulfillmentAt: new Date() }
const bitacora = (e: Empresa, accion: string) => prisma.auditLog.findMany({ where: { companyId: e.companyId, accion: accion as never } })

test('1 · cobro con tarjeta sin comprobante: aparece con su acción y «Generar comprobante» escribe la venta con la fecha del COBRO', async () => {
  const e = await crearEmpresa('uno')
  const hace3 = new Date(Date.now() - 3 * DIA)
  const m = await membresia(e, e.clienteId, { estado: 'ACTIVA', pagoConfirmado: true, montoPagado: PRECIO, fechaPago: hace3, fechaInicio: hace3 })
  const i = await cobro(e, e.clienteId, m.id, { activadoAt: hace3, ...entregado, fulfillmentAt: hace3 })

  const antes = await conciliar(e.companyId)
  const h = hallazgo(antes, 'cobro-sin-transaccion')
  assert.ok(h)
  assert.deepEqual([h.cantidad, h.monto, h.href], [1, PRECIO, null], 'sin enlace genérico: la lista y la acción están en el propio hallazgo')
  assert.deepEqual(h.casos.map((c) => [c.tipo, c.id, c.acciones]), [['TARJETA_SIN_COMPROBANTE', i.id, ['GENERAR_COMPROBANTE', 'ABRIR_FICHA']]])
  assert.match(h.casos[0]!.titulo, /^Cliente uno · Membresía Plan uno$/)
  assert.equal(h.casos[0]!.detalle, 'Tarjeta · en la app · Aut. AUTH-CC')

  const r = await generarComprobanteDeCobro(e.companyId, i.id, actor(e))
  assert.ok(r.ok, JSON.stringify(r))
  const venta = await prisma.transaction.findUniqueOrThrow({ where: { pagoIntentoId: i.id } })
  assert.deepEqual([venta.tipo, venta.estado, venta.metodoCobro, Number(venta.monto)], ['SALE', 'APPLIED', 'TARJETA', PRECIO])
  assert.equal(venta.createdAt.getTime(), hace3.getTime(), 'la venta cae en el día en que el cliente PAGÓ, no en el de hoy')
  assert.match(String((venta.snapshot as Record<string, unknown>).metodoCobroLabel), /^Tarjeta \(en la app\)$/)

  assert.equal(hallazgo(await conciliar(e.companyId), 'cobro-sin-transaccion'), undefined, 'resuelto')
  const log = await bitacora(e, 'CONCILIACION_COMPROBANTE_GENERADO')
  assert.equal(log.length, 1)
  assert.deepEqual([log[0]!.userId, log[0]!.entidadTipo, log[0]!.entidadId, log[0]!.ipAddress], [e.userId, 'PagoIntento', i.id, '10.0.0.1'])
  assert.equal((log[0]!.payload as Record<string, unknown>).ticketNumero, venta.ticketNumero)

  // Repetir el clic no duplica nada.
  const otra = await generarComprobanteDeCobro(e.companyId, i.id, actor(e))
  assert.ok(otra.ok && /ya tenía su comprobante/.test(otra.mensaje))
  assert.equal(await prisma.transaction.count({ where: { pagoIntentoId: i.id } }), 1)
  assert.equal((await bitacora(e, 'CONCILIACION_COMPROBANTE_GENERADO')).length, 1, 'y no asienta dos veces')
})

test('2 · no se genera comprobante de un cobro no entregado, de un cobro rechazado ni de otra empresa', async () => {
  const a = await crearEmpresa('dos-a')
  const b = await crearEmpresa('dos-b')
  const m = await membresia(a, a.clienteId)
  const pendiente = await cobro(a, a.clienteId, m.id, { fulfillmentEstado: 'FALLIDA' })
  const r1 = await generarComprobanteDeCobro(a.companyId, pendiente.id, actor(a))
  assert.ok(!r1.ok && /todavía no recibió su producto/.test(r1.error))

  const rechazado = await cobro(a, a.clienteId, (await membresia(a, (await clienteExtra(a, 'rech')).id)).id, { estado: 'RECHAZADO', activadoAt: null })
  const r2 = await generarComprobanteDeCobro(a.companyId, rechazado.id, actor(a))
  assert.ok(!r2.ok && /aprobado/.test(r2.error))

  const r3 = await generarComprobanteDeCobro(b.companyId, pendiente.id, actor(b))
  assert.ok(!r3.ok && /no encontrado/i.test(r3.error), 'el id de otra empresa no encuentra nada')
  assert.equal(await prisma.transaction.count({ where: { companyId: { in: [a.companyId, b.companyId] } } }), 0)
})

test('3 · un cobro sin venta que NO fue de pasarela solo ofrece la ficha, y un cobro de pasarela no se lista dos veces', async () => {
  const e = await crearEmpresa('tres')
  const hace1 = new Date(Date.now() - DIA)
  // (a) Pagada a mano (sin intento) y sin venta.
  const mano = await membresia(e, e.clienteId, { estado: 'ACTIVA', pagoConfirmado: true, montoPagado: 700, fechaPago: hace1, fechaInicio: hace1 })
  // (b) Pagada por pasarela y sin venta: va por la lista de tarjeta, no por la de membresías.
  const otro = await clienteExtra(e, 'pasarela')
  const conTarjeta = await membresia(e, otro.id, { estado: 'ACTIVA', pagoConfirmado: true, montoPagado: PRECIO, fechaPago: hace1, fechaInicio: hace1 })
  const i = await cobro(e, otro.id, conTarjeta.id, { activadoAt: hace1, ...entregado })

  const h = hallazgo(await conciliar(e.companyId), 'cobro-sin-transaccion')
  assert.ok(h)
  assert.equal(h.cantidad, 2, 'dos cobros, cada uno UNA vez')
  assert.equal(h.monto, 1200)
  const porTipo = Object.fromEntries(h.casos.map((c) => [c.tipo, c]))
  assert.deepEqual(porTipo.MEMBRESIA_SIN_TRANSACCION?.acciones, ['ABRIR_FICHA'])
  assert.equal(porTipo.MEMBRESIA_SIN_TRANSACCION?.id, mano.id)
  assert.deepEqual(porTipo.TARJETA_SIN_COMPROBANTE?.acciones, ['GENERAR_COMPROBANTE', 'ABRIR_FICHA'])
  assert.equal(porTipo.TARJETA_SIN_COMPROBANTE?.id, i.id)
})

test('4 · «Reintentar entrega» activa el producto del cliente que esperaba; no se ofrece si ya está activo ni si está en curso', async () => {
  const e = await crearEmpresa('cuatro')
  const m = await membresia(e, e.clienteId, { estado: 'CANCELADA' }) // no se puede activar: la entrega falla
  const falla = { fulfillmentEstado: 'FALLIDA' as const, fulfillmentError: 'No se puede activar una membresía en estado CANCELADA.', fulfillmentIntentos: 1 }
  const i = await cobro(e, e.clienteId, m.id, falla)

  const h = hallazgo(await conciliar(e.companyId), 'cobrado-sin-entregar')
  assert.ok(h)
  assert.equal(h.casos[0]!.id, i.id)
  assert.deepEqual(h.casos[0]!.acciones, ['REINTENTAR_ENTREGA', 'ABRIR_FICHA'])

  // Mientras la causa siga, el reintento falla y se dice por qué (y se asienta igual).
  const mal = await reintentarEntregaDeCobro(e.companyId, i.id, actor(e))
  assert.ok(!mal.ok && /no se pudo completar/.test(mal.error), JSON.stringify(mal))
  assert.equal((await prisma.pagoIntento.findUniqueOrThrow({ where: { id: i.id } })).fulfillmentEstado, 'FALLIDA')

  // Se corrige la causa y se reintenta: el cliente recibe su producto y el cobro queda con su comprobante.
  await prisma.membership.update({ where: { id: m.id }, data: { estado: 'PENDIENTE' } })
  const bien = await reintentarEntregaDeCobro(e.companyId, i.id, actor(e))
  assert.ok(bien.ok, JSON.stringify(bien))
  const db = await prisma.pagoIntento.findUniqueOrThrow({ where: { id: i.id } })
  assert.deepEqual([db.fulfillmentEstado, db.fulfillmentError], ['COMPLETADA', null])
  assert.equal((await prisma.membership.findUniqueOrThrow({ where: { id: m.id } })).estado, 'ACTIVA')
  assert.equal(await prisma.transaction.count({ where: { pagoIntentoId: i.id } }), 1, 'y su venta')
  assert.equal(hallazgo(await conciliar(e.companyId), 'cobrado-sin-entregar'), undefined)
  const log = await bitacora(e, 'CONCILIACION_ENTREGA_REINTENTADA')
  assert.equal(log.length, 2, 'los dos intentos quedan en la bitácora, con su resultado')
  assert.deepEqual(log.map((l) => (l.payload as Record<string, unknown>).resultado).sort(), ['COMPLETADA', 'FALLIDA'])

  // Ya entregado: repetir no hace nada.
  const otra = await reintentarEntregaDeCobro(e.companyId, i.id, actor(e))
  assert.ok(otra.ok && /ya estaba entregado/.test(otra.mensaje))
})

test('5 · «Reintentar» no se ofrece cuando el producto YA está activo (no hay nada que reintentar) ni cuando la entrega está en curso', async () => {
  const e = await crearEmpresa('cinco')
  const hace20 = new Date(Date.now() - 20 * DIA)
  const activa = await membresia(e, e.clienteId, { estado: 'ACTIVA', pagoConfirmado: true, montoPagado: PRECIO, fechaPago: hace20, fechaInicio: hace20 })
  const vieja = await cobro(e, e.clienteId, activa.id, { activadoAt: hace20, createdAt: hace20, updatedAt: hace20 }) // PENDIENTE de siempre
  const r = await reintentarEntregaDeCobro(e.companyId, vieja.id, actor(e))
  assert.ok(!r.ok && /Marcar entregada/.test(r.error))

  const otro = await clienteExtra(e, 'curso')
  const m2 = await membresia(e, otro.id)
  const enCurso = await cobro(e, otro.id, m2.id, { fulfillmentEstado: 'PROCESANDO' }) // updatedAt = ahora
  const r2 = await reintentarEntregaDeCobro(e.companyId, enCurso.id, actor(e))
  assert.ok(!r2.ok && /sigue en curso/.test(r2.error))
  assert.equal((await bitacora(e, 'CONCILIACION_ENTREGA_REINTENTADA')).length, 0, 'lo rechazado no se asienta como hecho')
})

test('6 · «Marcar entregada» exige nota y evidencia; cierra el registro con la fecha de la ACTIVACIÓN y genera el comprobante', async () => {
  const e = await crearEmpresa('seis')
  const hace20 = new Date(Date.now() - 20 * DIA)
  const m = await membresia(e, e.clienteId, { estado: 'ACTIVA', pagoConfirmado: true, montoPagado: PRECIO, fechaPago: hace20, fechaInicio: hace20 })
  const i = await cobro(e, e.clienteId, m.id, { activadoAt: hace20, createdAt: hace20, updatedAt: hace20 })

  assert.ok(!(await marcarCobroEntregado(e.companyId, i.id, actor(e), '   ')).ok, 'sin nota no se cierra')
  const corta = await marcarCobroEntregado(e.companyId, i.id, actor(e), 'ok')
  assert.ok(!corta.ok && /al menos 5 caracteres/.test(corta.error))
  assert.equal((await prisma.pagoIntento.findUniqueOrThrow({ where: { id: i.id } })).fulfillmentEstado, 'PENDIENTE', 'nada cambió')

  const r = await marcarCobroEntregado(e.companyId, i.id, actor(e), 'Se activó a mano el mismo día; verificado con el cliente.')
  assert.ok(r.ok, JSON.stringify(r))
  const db = await prisma.pagoIntento.findUniqueOrThrow({ where: { id: i.id } })
  assert.deepEqual([db.fulfillmentEstado, db.fulfillmentError], ['COMPLETADA', null])
  assert.equal(db.fulfillmentAt?.getTime(), hace20.getTime(), 'el registro dice cuándo se entregó de verdad')
  const venta = await prisma.transaction.findUniqueOrThrow({ where: { pagoIntentoId: i.id } })
  assert.equal(venta.createdAt.getTime(), hace20.getTime())
  const log = await bitacora(e, 'CONCILIACION_ENTREGA_MARCADA')
  assert.equal(log.length, 1)
  assert.equal((log[0]!.payload as Record<string, unknown>).nota, 'Se activó a mano el mismo día; verificado con el cliente.')
  assert.equal((log[0]!.payload as Record<string, unknown>).estadoAnterior, 'PENDIENTE')
  assert.equal((await conciliar(e.companyId)).cuadra, true)

  // Dos pulsaciones a la vez: una sola gana y la bitácora no se duplica.
  const j = await cobro(e, (await clienteExtra(e, 'carrera')).id, (await membresia(e, (await clienteExtra(e, 'carrera2')).id, { estado: 'ACTIVA', pagoConfirmado: true, montoPagado: PRECIO, fechaPago: hace20, fechaInicio: hace20 })).id, { activadoAt: hace20, createdAt: hace20, updatedAt: hace20 })
  const [x, y] = await Promise.all([
    marcarCobroEntregado(e.companyId, j.id, actor(e), 'Primera pulsación del gerente'),
    marcarCobroEntregado(e.companyId, j.id, actor(e), 'Segunda pulsación del gerente'),
  ])
  assert.ok(x.ok || y.ok)
  assert.equal(await prisma.transaction.count({ where: { pagoIntentoId: j.id } }), 1)
  assert.equal((await bitacora(e, 'CONCILIACION_ENTREGA_MARCADA')).filter((l) => l.entidadId === j.id).length, 1)
})

test('7 · «Marcar entregada» NO se permite si el cliente no tiene su producto: taparía justo lo que se busca', async () => {
  const e = await crearEmpresa('siete')
  const m = await membresia(e, e.clienteId) // PENDIENTE: no recibió nada
  const i = await cobro(e, e.clienteId, m.id, { fulfillmentEstado: 'FALLIDA', fulfillmentError: 'x' })
  const r = await marcarCobroEntregado(e.companyId, i.id, actor(e), 'Quiero cerrarlo para que no salga')
  assert.ok(!r.ok && /todavía no tiene su producto activo/.test(r.error))
  assert.equal((await prisma.pagoIntento.findUniqueOrThrow({ where: { id: i.id } })).fulfillmentEstado, 'FALLIDA')
  assert.ok(hallazgo(await conciliar(e.companyId), 'cobrado-sin-entregar'), 'sigue a la vista')

  // Un pago ANTERIOR de la misma membresía tampoco prueba nada sobre ESTE cobro.
  const otro = await clienteExtra(e, 'anterior')
  const vieja = new Date(Date.now() - 40 * DIA)
  const m2 = await membresia(e, otro.id, { estado: 'VENCIDA', pagoConfirmado: true, montoPagado: PRECIO, fechaPago: vieja, fechaInicio: vieja })
  const nuevo = await cobro(e, otro.id, m2.id, { fulfillmentEstado: 'FALLIDA', fulfillmentError: 'y' })
  const r2 = await marcarCobroEntregado(e.companyId, nuevo.id, actor(e), 'La membresía ya tuvo un pago anterior')
  assert.ok(!r2.ok, 'una membresía pagada hace 40 días no prueba que el cobro de hoy se entregó')
})

test('8 · una entrega recién empezada no es un fallo; un PROCESANDO atascado sí se ve', async () => {
  const e = await crearEmpresa('ocho')
  const m = await membresia(e, e.clienteId)
  await cobro(e, e.clienteId, m.id, { fulfillmentEstado: 'PROCESANDO' }) // recién empezada
  assert.equal(hallazgo(await conciliar(e.companyId), 'cobrado-sin-entregar'), undefined)

  const hace1h = new Date(Date.now() - 3_600_000)
  const otro = await clienteExtra(e, 'atascado')
  const m2 = await membresia(e, otro.id)
  const atascado = await cobro(e, otro.id, m2.id, { fulfillmentEstado: 'PROCESANDO', createdAt: hace1h, updatedAt: hace1h })
  const h = hallazgo(await conciliar(e.companyId), 'cobrado-sin-entregar')
  assert.ok(h)
  assert.deepEqual(h.casos.map((c) => c.id), [atascado.id])
  assert.match(h.casos[0]!.detalle ?? '', /atascada procesando/)
})

test('9 · cajas abiertas de días anteriores y turnos descuadrados traen su caso con su acción', async () => {
  const e = await crearEmpresa('nueve')
  const ayer = new Date(Date.now() - 2 * DIA)
  const vieja = await prisma.cajaSesion.create({ data: { companyId: e.companyId, sucursalId: e.sucursalId, abiertaPorId: e.userId, estado: 'ABIERTA', balanceInicial: 500, abiertaAt: ayer }, select: { id: true } })
  await prisma.cajaSesion.create({ data: { companyId: e.companyId, sucursalId: e.sucursalId, abiertaPorId: e.userId, estado: 'ABIERTA', balanceInicial: 0 } }) // de hoy: no cuenta
  const cuadre = await prisma.cajaSesion.create({
    data: { companyId: e.companyId, sucursalId: e.sucursalId, abiertaPorId: e.userId, estado: 'CERRADA', balanceInicial: 0, cerradaPorId: e.userId, cerradaAt: new Date(), balanceFinal: 90, balanceEsperado: 100, diferencia: -10 },
    select: { id: true },
  })

  const r = await conciliar(e.companyId)
  const abierta = hallazgo(r, 'caja-abierta')
  assert.ok(abierta)
  assert.deepEqual([abierta.cantidad, abierta.href], [1, null])
  assert.deepEqual(abierta.casos.map((c) => [c.tipo, c.id, c.acciones]), [['CAJA_ABIERTA', vieja.id, ['ABRIR_CAJA']]])
  assert.match(abierta.casos[0]!.titulo, /^Principal · abrió Gerente nueve$/)
  assert.match(abierta.casos[0]!.detalle ?? '', /0 cobros en el turno/)

  const desc = hallazgo(r, 'caja-descuadrada')
  assert.ok(desc)
  assert.deepEqual(desc.casos.map((c) => [c.tipo, c.id, c.monto, c.acciones, c.detalle]), [['CAJA_DESCUADRADA', cuadre.id, -10, ['VER_CIERRE'], 'Faltante de efectivo']])
})

test('10 · la ventana acota la lista de cobros sin comprobante y el tope de casos no esconde la cifra real', async () => {
  const e = await crearEmpresa('diez')
  const hace20 = new Date(Date.now() - 20 * DIA)
  const m = await membresia(e, e.clienteId, { estado: 'ACTIVA', pagoConfirmado: true, montoPagado: PRECIO, fechaPago: hace20, fechaInicio: hace20 })
  await cobro(e, e.clienteId, m.id, { activadoAt: hace20, ...entregado })
  assert.equal(hallazgo(await conciliar(e.companyId), 'cobro-sin-transaccion'), undefined, 'fuera de los 7 días')
  assert.equal(hallazgo(await conciliar(e.companyId, 30), 'cobro-sin-transaccion')?.cantidad, 1, 'con 30 días sí')

  const muchos = await crearEmpresa('muchos')
  const total = CASOS_POR_HALLAZGO + 5
  for (let n = 0; n < total; n++) {
    const c = await clienteExtra(muchos, `m${n}`)
    const mm = await membresia(muchos, c.id, { estado: 'ACTIVA', pagoConfirmado: true, montoPagado: PRECIO, fechaPago: new Date(), fechaInicio: new Date() })
    await cobro(muchos, c.id, mm.id, { ...entregado })
  }
  const h = hallazgo(await conciliar(muchos.companyId), 'cobro-sin-transaccion')
  assert.ok(h)
  assert.equal(h.cantidad, total, 'la cifra es la real')
  assert.equal(h.monto, total * PRECIO)
  assert.equal(h.casos.length, CASOS_POR_HALLAZGO, 'la lista es lo que cabe')
})
