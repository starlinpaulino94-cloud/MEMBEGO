/**
 * CAMBIO DE PLAN PAGADO CON TARJETA — la pasarela lo entrega sola (decisión 8 de `docs/PAGO_TARJETA_COMPROBANTE.md`).
 *
 * Antes, el cobro de un cambio de plan quedaba «cliente esperando» hasta que una persona lo aplicaba desde Pagos. Ahora el
 * propio cobro aplica el plan que se pagó, con las garantías de las demás entregas de pasarela. Estas pruebas fijan, con la
 * base real y los servicios de verdad (sin simular la entrega):
 *
 *   1 · de punta a punta: importe prorrateado → intento con su plan → cobro aprobado → plan nuevo aplicado, pago fechado al
 *       cobro, auditoría, evento, aviso al cliente y venta «Cambio a …» en el libro; repetir no duplica nada;
 *   2 · si el cliente cambió su pedido después de pagar NO se aplica a ciegas: queda para una persona; y si vuelve a pedir
 *       ese mismo plan, el reintento lo entrega;
 *   3 · dos entregas a la vez aplican el cambio una sola vez;
 *   4 · el barrido entrega un cambio de plan que quedó fallido, sin recobrar;
 *   5 · la app resuelve el plan que se paga y el cliente no puede cambiar el objetivo a mitad.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../../src/lib/prisma'
import { confirmarIntento, crearIntento, reintentarEntrega } from '../../src/modules/pagos/intentos'
import { montoDeObjetivo } from '../../src/modules/pagos/cardnet3ds'
import { barridoEntregasDePago } from '../../src/modules/pagos/barrido-entregas'
import { resolveTarget } from '../../src/modules/pagos/cardnetClienteObjetivo'
import { conciliar } from '../../src/modules/observabilidad/conciliacion'
import { CAMBIO_DE_PLAN_PAGADO } from '../../src/modules/observabilidad/conciliacion-entrega'
import { calcularPagoCambioPlan } from '../../src/modules/membresia/prorrateo'
import { periodEnd } from '../../src/lib/periodos'

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const DIA = 24 * 3_600_000
const hace = (ms: number) => new Date(Date.now() - ms)

async function escenario(etiqueta: string) {
  const c = await prisma.company.create({
    data: { name: `CambioPlan ${etiqueta} ${sufijo}`, slug: `cambioplan-${etiqueta}-${sufijo}`, type: 'carwash', ciudad: 'Santo Domingo' },
    select: { id: true },
  })
  const planA = await prisma.plan.create({ data: { companyId: c.id, nombre: `Plan Basico ${etiqueta}`, precio: 500, vigenciaDias: 30, lavadosIncluidos: 4 }, select: { id: true } })
  const planB = await prisma.plan.create({ data: { companyId: c.id, nombre: `Plan Mayor ${etiqueta}`, precio: 900, vigenciaDias: 30, lavadosIncluidos: 8 }, select: { id: true } })
  const planC = await prisma.plan.create({ data: { companyId: c.id, nombre: `Plan Total ${etiqueta}`, precio: 1500, vigenciaDias: 30, lavadosIncluidos: 12 }, select: { id: true } })
  const supabaseId = `sb-cp-${etiqueta}-${sufijo}`
  const cliente = await prisma.cliente.create({
    data: { companyId: c.id, supabaseId, nombre: `Cliente ${etiqueta}`, email: `cp-${etiqueta}-${sufijo}@prueba.test` },
    select: { id: true },
  })
  const usuario = await prisma.user.create({
    data: { supabaseId, email: `cp-${etiqueta}-${sufijo}@prueba.test`, name: `Cliente ${etiqueta}`, role: 'CLIENTE', companyId: c.id },
    select: { id: true },
  })
  const pagoViejo = hace(15 * DIA)
  const m = await prisma.membership.create({
    data: {
      companyId: c.id,
      clienteId: cliente.id,
      planId: planA.id,
      planIdSolicitado: planB.id,
      estado: 'ACTIVA',
      pagoConfirmado: true,
      montoPagado: 500,
      fechaPago: pagoViejo,
      fechaInicio: pagoViejo,
      fechaVencimiento: new Date(Date.now() + 15 * DIA),
    },
    select: { id: true },
  })
  return { companyId: c.id, planA: planA.id, planB: planB.id, planC: planC.id, clienteId: cliente.id, supabaseId, usuarioId: usuario.id, membershipId: m.id }
}
type Escenario = Awaited<ReturnType<typeof escenario>>

/** Lo que hace la app/web al empezar a pagar: el importe sale de la base y el intento recuerda qué plan se paga. */
async function cobroDeCambio(e: Escenario) {
  const monto = await montoDeObjetivo({ companyId: e.companyId, clienteId: e.clienteId, membershipId: e.membershipId })
  assert.equal(monto.ok, true, JSON.stringify(monto))
  if (!monto.ok) throw new Error('sin monto')
  const intento = await crearIntento({
    companyId: e.companyId,
    clienteId: e.clienteId,
    proveedor: 'CARDNET',
    membershipId: e.membershipId,
    planDestinoId: monto.planDestinoId ?? null,
    monto: monto.pesos,
    canal: 'APP',
  })
  return { intentoId: intento.id, monto }
}

const aprobar = (intentoId: string, montoCobrado: number) => confirmarIntento(intentoId, { aprobada: true, autorizacion: 'AUTH-CP', motivo: null, crudo: null, montoCobrado })
const ventaDe = (pagoIntentoId: string) => prisma.transaction.findUnique({ where: { pagoIntentoId } })

test('1 · de punta a punta: el cobro aprobado aplica el plan pagado, lo fecha al cobro y deja venta, auditoría, evento y aviso', async () => {
  const e = await escenario('uno')
  const { intentoId, monto } = await cobroDeCambio(e)
  const esperado = calcularPagoCambioPlan({ precioNuevo: 900, precioVigente: 500, fechaVencimiento: (await prisma.membership.findUniqueOrThrow({ where: { id: e.membershipId } })).fechaVencimiento, vigenciaDias: 30 }).aPagar
  assert.ok(monto.ok && Math.abs(monto.pesos - esperado) < 1, 'el importe es la diferencia prorrateada, no el plan completo')
  assert.equal(monto.ok ? monto.planDestinoId : null, e.planB, 'el cobro dice QUÉ plan se paga')
  assert.equal((await prisma.pagoIntento.findUniqueOrThrow({ where: { id: intentoId } })).planDestinoId, e.planB)

  const r = await aprobar(intentoId, monto.ok ? monto.pesos : 0)
  assert.deepEqual(r.ok && [r.estado, r.yaEstaba, r.entrega], ['APROBADO', false, 'COMPLETADA'])

  const cobro = await prisma.pagoIntento.findUniqueOrThrow({ where: { id: intentoId } })
  assert.deepEqual([cobro.estado, cobro.fulfillmentEstado, cobro.fulfillmentError], ['APROBADO', 'COMPLETADA', null])
  const mem = await prisma.membership.findUniqueOrThrow({ where: { id: e.membershipId } })
  assert.deepEqual([mem.planId, mem.planIdSolicitado, mem.estado, mem.pagoConfirmado], [e.planB, null, 'ACTIVA', true], 'plan nuevo, sin pedido pendiente')
  assert.equal(Number(mem.montoPagado), Number(cobro.monto), 'lo pagado es lo que cobró la pasarela')
  assert.equal(mem.fechaPago?.getTime(), cobro.activadoAt?.getTime(), 'el pago lleva la fecha del cobro')
  assert.equal(mem.fechaVencimiento?.getTime(), periodEnd(mem.fechaInicio as Date, 30).getTime(), 'el periodo nuevo empieza al aplicarse')

  const log = await prisma.auditLog.findMany({ where: { companyId: e.companyId, accion: 'PAGO_APROBADO', entidadId: e.membershipId } })
  assert.equal(log.length, 1)
  assert.deepEqual(
    { cambioDePlan: (log[0]!.payload as Record<string, unknown>).cambioDePlan, planNuevo: (log[0]!.payload as Record<string, unknown>).planNuevo, metodo: (log[0]!.payload as Record<string, unknown>).metodo, intentoId: (log[0]!.payload as Record<string, unknown>).intentoId },
    { cambioDePlan: true, planNuevo: e.planB, metodo: 'TARJETA', intentoId }
  )
  const evento = await prisma.membresiaEvento.findMany({ where: { membershipId: e.membershipId, tipo: 'CAMBIO_PLAN' } })
  assert.equal(evento.length, 1)
  assert.equal(evento[0]!.planNuevoId, e.planB)

  const venta = await ventaDe(intentoId)
  assert.ok(venta, 'el cambio también deja su venta en el libro')
  assert.deepEqual([venta.tipo, venta.metodoCobro, Number(venta.monto)], ['SALE', 'TARJETA', Number(cobro.monto)])
  assert.match(String((venta.snapshot as Record<string, unknown>).detalle), /^Cambio a Plan Mayor/)

  const aviso = await prisma.notificacion.findFirst({ where: { userId: e.usuarioId } })
  assert.match(aviso?.mensaje ?? '', /Plan Mayor/)

  const conc = await conciliar(e.companyId)
  assert.equal(conc.cuadra, true, JSON.stringify(conc.hallazgos.map((h) => h.clave)))

  // Repetir (el retorno del navegador y el webhook llegan los dos) no aplica ni cobra otra vez.
  const otra = await aprobar(intentoId, monto.ok ? monto.pesos : 0)
  assert.equal(otra.ok && otra.yaEstaba, true)
  assert.equal((await prisma.auditLog.count({ where: { companyId: e.companyId, accion: 'PAGO_APROBADO', entidadId: e.membershipId } })), 1)
  assert.equal(await prisma.transaction.count({ where: { pagoIntentoId: intentoId } }), 1)
})

test('2 · si el cliente cambió su pedido después de pagar NO se aplica a ciegas; al volver a pedir ese plan, el reintento lo entrega', async () => {
  const e = await escenario('dos')
  const { intentoId, monto } = await cobroDeCambio(e)
  // El cliente cambia su pedido mientras el pago está en curso.
  await prisma.membership.update({ where: { id: e.membershipId }, data: { planIdSolicitado: e.planC } })

  const r = await aprobar(intentoId, monto.ok ? monto.pesos : 0)
  assert.deepEqual(r.ok && [r.estado, r.entrega], ['APROBADO', 'FALLIDA'])
  const cobro = await prisma.pagoIntento.findUniqueOrThrow({ where: { id: intentoId } })
  assert.deepEqual([cobro.fulfillmentEstado, cobro.fulfillmentError], ['FALLIDA', CAMBIO_DE_PLAN_PAGADO])
  const sinTocar = await prisma.membership.findUniqueOrThrow({ where: { id: e.membershipId } })
  assert.deepEqual([sinTocar.planId, sinTocar.planIdSolicitado], [e.planA, e.planC], 'no se le dio el plan C por el precio del B')
  assert.equal(await ventaDe(intentoId), null)

  const h = (await conciliar(e.companyId)).hallazgos.find((x) => x.clave === 'cobrado-sin-entregar')
  assert.deepEqual(h?.casos.map((c) => c.acciones), [['ABRIR_FICHA']], 'solo una persona puede resolverlo: no se ofrece un botón que falla')
  const intentos = cobro.fulfillmentIntentos
  const enVano = await reintentarEntrega(intentoId)
  assert.deepEqual([enVano.ok, enVano.error], [false, CAMBIO_DE_PLAN_PAGADO])
  assert.equal((await prisma.pagoIntento.findUniqueOrThrow({ where: { id: intentoId } })).fulfillmentIntentos, intentos, 'no gasta un reintento')

  // El cliente vuelve a pedir el plan que pagó: ahora el cobro lo respalda y se entrega.
  await prisma.membership.update({ where: { id: e.membershipId }, data: { planIdSolicitado: e.planB } })
  const bien = await reintentarEntrega(intentoId)
  assert.deepEqual([bien.ok, bien.entrega], [true, 'COMPLETADA'])
  const mem = await prisma.membership.findUniqueOrThrow({ where: { id: e.membershipId } })
  assert.deepEqual([mem.planId, mem.planIdSolicitado], [e.planB, null])
  assert.ok(await ventaDe(intentoId))
})

test('3 · dos entregas a la vez aplican el cambio una sola vez', async () => {
  const e = await escenario('tres')
  const { intentoId, monto } = await cobroDeCambio(e)
  // Cobrado y con la entrega fallida (como si el servidor hubiera muerto entre el cobro y la entrega).
  const cobradoEn = hace(3_600_000)
  await prisma.pagoIntento.update({
    where: { id: intentoId },
    data: { estado: 'APROBADO', activadoAt: cobradoEn, updatedAt: cobradoEn, autorizacion: 'AUTH-CP', fulfillmentEstado: 'FALLIDA', fulfillmentError: 'La activación falló.', fulfillmentIntentos: 1 },
  })

  const [a, b] = await Promise.all([reintentarEntrega(intentoId), reintentarEntrega(intentoId)])
  assert.ok(a.ok && b.ok, JSON.stringify([a, b]))
  const mem = await prisma.membership.findUniqueOrThrow({ where: { id: e.membershipId } })
  assert.equal(mem.planId, e.planB)
  assert.equal(Number(mem.montoPagado), monto.ok ? monto.pesos : -1)
  assert.equal(mem.fechaPago?.getTime(), cobradoEn.getTime(), 'fechado al cobro aunque se entregue horas después')
  assert.equal(await prisma.auditLog.count({ where: { companyId: e.companyId, accion: 'PAGO_APROBADO', entidadId: e.membershipId } }), 1)
  assert.equal(await prisma.membresiaEvento.count({ where: { membershipId: e.membershipId, tipo: 'CAMBIO_PLAN' } }), 1)
  assert.equal(await prisma.transaction.count({ where: { pagoIntentoId: intentoId } }), 1)
})

test('4 · el barrido entrega un cambio de plan que quedó fallido, y no toca el que necesita a una persona', async () => {
  const e = await escenario('cuatro')
  const { intentoId } = await cobroDeCambio(e)
  const cobradoEn = hace(2 * 3_600_000)
  await prisma.pagoIntento.update({
    where: { id: intentoId },
    data: { estado: 'APROBADO', activadoAt: cobradoEn, updatedAt: cobradoEn, autorizacion: 'AUTH-CP', fulfillmentEstado: 'FALLIDA', fulfillmentError: 'La activación falló.', fulfillmentIntentos: 1 },
  })
  const r = await barridoEntregasDePago({ companyId: e.companyId })
  assert.deepEqual([r.revisados, r.reintentadas, r.entregadas, r.omitidos.requierenPersona, r.errores], [1, 1, 1, 0, 0])
  assert.equal((await prisma.membership.findUniqueOrThrow({ where: { id: e.membershipId } })).planId, e.planB)

  // Un cobro anterior a que se guardara el plan (sin `planDestinoId`) sigue siendo cosa de una persona.
  const v = await escenario('cuatrov')
  const viejo = await prisma.pagoIntento.create({
    data: { companyId: v.companyId, clienteId: v.clienteId, proveedor: 'CARDNET', membershipId: v.membershipId, monto: 400, estado: 'APROBADO', activadoAt: cobradoEn, createdAt: cobradoEn, updatedAt: cobradoEn, autorizacion: 'AUTH-VIEJO', canal: 'APP', fulfillmentEstado: 'FALLIDA', fulfillmentError: 'La activación falló.', fulfillmentIntentos: 1 },
    select: { id: true },
  })
  const rv = await barridoEntregasDePago({ companyId: v.companyId })
  assert.deepEqual([rv.reintentadas, rv.omitidos.requierenPersona], [0, 1])
  assert.equal((await prisma.membership.findUniqueOrThrow({ where: { id: v.membershipId } })).planId, v.planA)
  assert.equal((await prisma.pagoIntento.findUniqueOrThrow({ where: { id: viejo.id } })).fulfillmentIntentos, 1)
})

test('5 · la app resuelve el plan que se paga y el cobro no admite un cambio sin plan', async () => {
  const e = await escenario('cinco')
  const user = { supabaseId: e.supabaseId } as never
  const t = await resolveTarget(user, { membershipId: e.membershipId })
  assert.equal(t.kind, 'ready')
  if (t.kind === 'ready') {
    assert.equal(t.target.planDestinoId, e.planB, 'la sesión de captura lleva el plan hasta el intento')
    assert.ok(t.target.amount > 0 && t.target.amount < 900)
  }
  // Si el cliente cambia el pedido, el objetivo cambia: la app lo detecta antes de cobrar.
  await prisma.membership.update({ where: { id: e.membershipId }, data: { planIdSolicitado: e.planC } })
  const otro = await resolveTarget(user, { membershipId: e.membershipId })
  assert.equal(otro.kind === 'ready' ? otro.target.planDestinoId : null, e.planC)
})
