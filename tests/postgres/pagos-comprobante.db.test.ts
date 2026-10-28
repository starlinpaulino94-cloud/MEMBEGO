/**
 * FASE 0 · PAGO CON TARJETA, COMPROBANTE Y CONCILIACIÓN — pruebas de CARACTERIZACIÓN.
 *
 * Contexto. Un pago de RD$ 500 con tarjeta dentro de la app activó la membresía y, en la pantalla
 * `/admin/conciliacion`, apareció como «Cobros sin transacción registrada». Estas pruebas fijan, contra
 * PostgreSQL real y con los servicios de verdad, el comportamiento ACTUAL que produce ese y otros
 * descuadres, para que la corrección (fases 1–5 del plan) cambie CADA aserción a propósito y a la vista:
 *
 *   H1  un pago con tarjeta aprobado activaba la membresía pero NO dejaba `Transaction` (ni ticket ni factura)
 *       y la conciliación lo detectaba como cobro sin transacción                    → CORREGIDO en la fase 2.
 *   H2  el libro de ventas no tenía método «tarjeta» (`MetodoCobroTipo`)              → CORREGIDO en la fase 1.
 *   H3  contraste: el panel de administración SÍ registra la venta                    → es el patrón a reutilizar.
 *   H4  la renovación automática con tarjeta guardada cobraba y renovaba, y tampoco dejaba `Transaction` → CORREGIDO en la fase 2.
 *   H5  falso positivo: un pago aprobado ANTES de la columna de cumplimiento (fila con el valor por defecto
 *       'PENDIENTE', la migración 20260912_p1b no rellenó nada) contaba como «cobrado sin entregar» aunque la
 *       membresía estuviera activa y entregada                                         → CORREGIDO en la fase 4 (se separa en «registro sin cerrar»).
 *   H6  punto ciego: un cobro cuya entrega FALLÓ (`FALLIDA`) y cuyo cliente no recibió nada NO se detectaba;
 *       la conciliación decía «Todo cuadra»                                            → CORREGIDO en la fase 4.
 *
 * Cuando una fase cambia un comportamiento, la aserción correspondiente se invierte en ese mismo commit y la
 * razón queda en su mensaje.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { MetodoCobroTipo } from '@prisma/client'
import { prisma } from '../../src/lib/prisma'
import { confirmarIntento, crearIntento } from '../../src/modules/pagos/intentos'
import { registrarVentaConfirmada } from '../../src/modules/pagos/venta'
import { renovarMembresiaPorTarjeta } from '../../src/modules/pagos/cardnetTokenGuardado'
import { conciliar } from '../../src/modules/observabilidad/conciliacion'

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const PRECIO = 500

interface Empresa {
  companyId: string
  clienteId: string
  planId: string
}

/** Cada prueba usa SU empresa: los recuentos de la conciliación son por empresa y tienen que ser exactos. */
async function crearEmpresa(etiqueta: string, conTarjetas = false): Promise<Empresa> {
  const c = await prisma.company.create({
    data: {
      name: `Tarjeta ${etiqueta} ${sufijo}`,
      slug: `tarjeta-${etiqueta}-${sufijo}`,
      type: 'carwash',
      ciudad: 'Santo Domingo',
      // `PAGO_CARDNET` encendida solo donde la prueba cobra con tarjeta guardada.
      ...(conTarjetas ? { capacidades: { overrides: { PAGO_CARDNET: true } } } : {}),
    },
    select: { id: true },
  })
  const cliente = await prisma.cliente.create({
    data: { companyId: c.id, supabaseId: `sb-tj-${etiqueta}-${sufijo}`, nombre: `Cliente ${etiqueta}`, email: `tj-${etiqueta}-${sufijo}@prueba.test` },
    select: { id: true },
  })
  const plan = await prisma.plan.create({
    data: { companyId: c.id, nombre: `Plan ${etiqueta}`, precio: PRECIO, vigenciaDias: 30, lavadosIncluidos: 4 },
    select: { id: true },
  })
  return { companyId: c.id, clienteId: cliente.id, planId: plan.id }
}

const membresia = (e: Empresa, extra: Record<string, unknown> = {}) =>
  prisma.membership.create({ data: { companyId: e.companyId, clienteId: e.clienteId, planId: e.planId, ...extra }, select: { id: true } })

const hallazgo = (r: Awaited<ReturnType<typeof conciliar>>, clave: string) => r.hallazgos.find((h) => h.clave === clave)

let fetchOriginal: typeof fetch
const ant = { pub: process.env.CARDNET_TOKENS_PUBLIC_KEY, priv: process.env.CARDNET_TOKENS_PRIVATE_KEY }

before(() => {
  fetchOriginal = globalThis.fetch
  // Claves de PRUEBA (sintéticas): solo para que la renovación considere configurada la pasarela. No salen a la red:
  // `fetch` se sustituye por una pasarela simulada que aprueba el cobro.
  process.env.CARDNET_TOKENS_PUBLIC_KEY = 'prueba-prueba-prueba'
  process.env.CARDNET_TOKENS_PRIVATE_KEY = 'prueba-prueba-prueba'
})

after(() => {
  globalThis.fetch = fetchOriginal
  if (ant.pub === undefined) delete process.env.CARDNET_TOKENS_PUBLIC_KEY
  else process.env.CARDNET_TOKENS_PUBLIC_KEY = ant.pub
  if (ant.priv === undefined) delete process.env.CARDNET_TOKENS_PRIVATE_KEY
  else process.env.CARDNET_TOKENS_PRIVATE_KEY = ant.priv
})

test('H1 · (fase 2) un pago con tarjeta aprobado activa la membresía, entrega Y deja su venta con ticket; la conciliación ya no lo marca', async () => {
  const e = await crearEmpresa('h1')
  const m = await membresia(e)
  const intento = await crearIntento({ companyId: e.companyId, clienteId: e.clienteId, proveedor: 'CARDNET', membershipId: m.id, monto: PRECIO, canal: 'APP' })

  // El mismo camino que recorre la app: `finishApproval` → `confirmarIntento` → `entregarProducto` → `activarMembresia`.
  const res = await confirmarIntento(intento.id, { aprobada: true, autorizacion: 'AUTH-H1', motivo: null, crudo: { flujo: 'prueba' }, montoCobrado: PRECIO })
  assert.equal(res.ok, true)
  assert.equal(res.ok && res.entrega, 'COMPLETADA', 'el producto se entregó')

  const db = await prisma.membership.findUniqueOrThrow({ where: { id: m.id } })
  assert.equal(db.estado, 'ACTIVA')
  assert.equal(db.pagoConfirmado, true)
  assert.equal(Number(db.montoPagado), PRECIO)
  assert.ok(db.fechaPago, 'quedó fechado el cobro')
  const i = await prisma.pagoIntento.findUniqueOrThrow({ where: { id: intento.id } })
  assert.deepEqual([i.estado, i.fulfillmentEstado, i.autorizacion, i.canal], ['APROBADO', 'COMPLETADA', 'AUTH-H1', 'APP'])

  // ── LA CORRECCIÓN ── antes de la fase 2 esta aserción era `count === 0` («DEFECTO H1: la venta no llega al libro»).
  const ventas = await prisma.transaction.findMany({ where: { membershipId: m.id } })
  assert.equal(ventas.length, 1, 'UNA venta del cobro')
  const v = ventas[0]!
  assert.deepEqual([v.tipo, v.estado, v.metodoCobro, v.pagoIntentoId, Number(v.monto)], ['SALE', 'APPLIED', 'TARJETA', intento.id, PRECIO])
  assert.match(v.ticketNumero, /^TCK-\d+$/)
  const snap = v.snapshot as Record<string, unknown>
  assert.equal(snap.metodoCobroLabel, 'Tarjeta (en la app)')
  assert.equal(snap.referenciaPago, 'Aut. AUTH-H1')
  assert.equal(snap.total, '500.00')
  assert.equal(snap.pagoIntentoId, intento.id)

  // La conciliación ya no encuentra un cobro sin transacción (lo que enseñaba la captura de RD$ 500).
  const r = await conciliar(e.companyId)
  assert.equal(hallazgo(r, 'cobro-sin-transaccion'), undefined)
  assert.equal(hallazgo(r, 'cobrado-sin-entregar'), undefined)
  assert.equal(r.cuadra, true)

  // La bitácora del pago dice con qué y por dónde se pagó (la lee «Mis pagos» y el comprobante).
  const log = await prisma.auditLog.findFirstOrThrow({ where: { companyId: e.companyId, accion: 'PAGO_APROBADO', entidadId: m.id } })
  assert.deepEqual(
    { metodo: (log.payload as Record<string, unknown>).metodo, canal: (log.payload as Record<string, unknown>).canal, intentoId: (log.payload as Record<string, unknown>).intentoId },
    { metodo: 'TARJETA', canal: 'APP', intentoId: intento.id }
  )
})

test('H2 · (fase 1) el libro de ventas ya tiene método «tarjeta»', () => {
  // Antes de la fase 1 esta aserción era ['EFECTIVO', 'OTRO', 'TRANSFERENCIA'] y un cobro con tarjeta salía como «Otro».
  assert.deepEqual(Object.values(MetodoCobroTipo).sort(), ['EFECTIVO', 'OTRO', 'TARJETA', 'TRANSFERENCIA'])
})

test('H3 · contraste: la confirmación desde el panel SÍ deja venta con ticket (el patrón que la pasarela no usa)', async () => {
  const e = await crearEmpresa('h3')
  const m = await membresia(e, { estado: 'ACTIVA', pagoConfirmado: true, montoPagado: PRECIO, fechaPago: new Date() })
  const t = await registrarVentaConfirmada({
    companyId: e.companyId,
    clienteId: e.clienteId,
    clienteNombre: 'Cliente h3',
    empleadoId: null,
    detalle: 'Membresía Plan h3',
    monto: PRECIO,
    metodoCobro: 'TRANSFERENCIA',
    metodoCobroLabel: 'Transferencia',
    membershipId: m.id,
  })
  assert.ok(t, 'la venta se registra')
  assert.match(t.ticketNumero, /^TCK-\d+$/)
  const tx = await prisma.transaction.findUniqueOrThrow({ where: { id: t.id } })
  assert.deepEqual([tx.tipo, tx.estado, tx.metodoCobro, tx.membershipId], ['SALE', 'APPLIED', 'TRANSFERENCIA', m.id])
  const r = await conciliar(e.companyId)
  assert.equal(hallazgo(r, 'cobro-sin-transaccion'), undefined, 'con venta registrada la conciliación no lo marca')
  // Y no hay forma de expresar «tarjeta» en esta función: el tipo de `metodoCobro` es EFECTIVO | TRANSFERENCIA | OTRO.
})

test('H4 · (fase 2) la renovación automática con tarjeta guardada cobra, renueva, entrega y deja su venta con la tarjeta usada', async () => {
  const e = await crearEmpresa('h4', true)
  const tarjeta = await prisma.tarjetaTokenizada.create({
    data: { companyId: e.companyId, clienteId: e.clienteId, customerId: 'cust-h4', paymentProfileId: 'pp-h4', token: 'CT__sintetico', marca: 'VISA', ultimos4: '4242', activa: true },
    select: { id: true },
  })
  const venceEn = new Date(Date.now() + 3 * 3_600_000)
  const m = await membresia(e, { estado: 'ACTIVA', pagoConfirmado: true, montoPagado: PRECIO, fechaPago: new Date(Date.now() - 29 * 86_400_000), fechaInicio: new Date(Date.now() - 29 * 86_400_000), fechaVencimiento: venceEn, autoRenovar: true, tarjetaTokenizadaId: tarjeta.id })
  // La renovación automática exige un consentimiento VIGENTE: un fixture que la enciende sin uno no es una renovación autorizada.
  await prisma.consentimientoPago.create({ data: { companyId: e.companyId, clienteId: e.clienteId, tipo: 'RENOVACION_AUTOMATICA', tarjetaId: tarjeta.id, membershipId: m.id, origen: 'HEREDADO', textoVersion: 'previo-a-registro' } })

  // Pasarela simulada: aprueba el cobro (formato real de CardNET: { Response: { Transaction: { TransactionStatusId: 1, … } }, Errors: [] }).
  let llamadas = 0
  globalThis.fetch = (async () => {
    llamadas++
    return new Response(JSON.stringify({ Response: { Transaction: { TransactionStatusId: 1, ResponseCode: '00', AuthorizationCode: 'AUTH-H4' } }, Errors: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch

  const r = await renovarMembresiaPorTarjeta(m.id, '127.0.0.1')
  assert.equal(r.estado, 'renovada', JSON.stringify(r))
  assert.equal(llamadas, 1, 'se cobró una vez')

  const db = await prisma.membership.findUniqueOrThrow({ where: { id: m.id } })
  assert.ok(db.fechaVencimiento && db.fechaVencimiento.getTime() > venceEn.getTime(), 'la vigencia se extendió')
  const i = await prisma.pagoIntento.findFirstOrThrow({ where: { membershipId: m.id } })
  assert.deepEqual([i.estado, i.fulfillmentEstado, i.autorizacion], ['APROBADO', 'COMPLETADA', 'AUTH-H4'], 'la renovación SÍ cierra la entrega (marcarEntrega)')
  // Antes de la fase 2: `count === 0` («DEFECTO H4: el cobro automático tampoco llega al libro»).
  const v = await prisma.transaction.findMany({ where: { membershipId: m.id } })
  assert.equal(v.length, 1)
  assert.deepEqual([v[0]!.tipo, v[0]!.metodoCobro, v[0]!.pagoIntentoId, Number(v[0]!.monto)], ['SALE', 'TARJETA', i.id, PRECIO])
  const snap = v[0]!.snapshot as Record<string, unknown>
  assert.equal(snap.metodoCobroLabel, 'Tarjeta VISA ••••4242 (renovación automática)')
  assert.match(String(snap.detalle), /^Renovación /)
  assert.equal(snap.referenciaPago, 'Aut. AUTH-H4')
})

test('H5 · (fase 4) un pago aprobado ANTES de la columna de cumplimiento, con la membresía ya activa, NO es un cliente esperando: es un registro sin cerrar', async () => {
  const e = await crearEmpresa('h5')
  const cobro = new Date(Date.now() - 20 * 86_400_000)
  const m = await membresia(e, { estado: 'ACTIVA', pagoConfirmado: true, montoPagado: 1600, fechaPago: cobro, fechaInicio: cobro, fechaVencimiento: new Date(Date.now() + 10 * 86_400_000) })
  // Una fila tal como la dejó la migración 20260912_p1b sobre un cobro anterior: estado APROBADO, NINGUNA marca de cumplimiento y vieja.
  await prisma.pagoIntento.create({
    data: { companyId: e.companyId, clienteId: e.clienteId, proveedor: 'CARDNET', membershipId: m.id, monto: 1600, estado: 'APROBADO', activadoAt: cobro, autorizacion: 'AUTH-H5', createdAt: cobro, updatedAt: cobro },
  })
  const i = await prisma.pagoIntento.findFirstOrThrow({ where: { membershipId: m.id } })
  assert.equal(i.fulfillmentEstado, 'PENDIENTE', 'valor por defecto de la columna (sin backfill)')

  const r = await conciliar(e.companyId)
  // Antes de la fase 4: `cobrado-sin-entregar` con cantidad 1 y monto 1600 («DEFECTO H5: se cuenta como cliente esperando»).
  assert.equal(hallazgo(r, 'cobrado-sin-entregar'), undefined, 'ya no se cuenta como cliente esperando')
  const h = hallazgo(r, 'entrega-sin-registrar')
  assert.ok(h, 'sí se ve, como registro sin cerrar')
  assert.deepEqual([h.cantidad, h.monto, h.severidad, h.href], [1, 1600, 'MEDIA', null])
  assert.deepEqual(h.casos.map((c) => [c.tipo, c.id, c.acciones]), [['REGISTRO_SIN_CERRAR', i.id, ['MARCAR_ENTREGADA', 'CERRAR_SIN_ENTREGAR', 'ABRIR_FICHA']]])
})

test('H6 · (fase 4) un cobro con la entrega FALLIDA y el cliente sin su membresía SE DETECTA, con su acción', async () => {
  const e = await crearEmpresa('h6')
  const m = await membresia(e) // sigue PENDIENTE: el cliente pagó y no recibió nada
  const i = await prisma.pagoIntento.create({
    data: { companyId: e.companyId, clienteId: e.clienteId, proveedor: 'CARDNET', membershipId: m.id, monto: PRECIO, estado: 'APROBADO', activadoAt: new Date(), autorizacion: 'AUTH-H6', fulfillmentEstado: 'FALLIDA', fulfillmentError: 'La activación falló.', fulfillmentIntentos: 1 },
    select: { id: true },
  })
  assert.equal((await prisma.membership.findUniqueOrThrow({ where: { id: m.id } })).estado, 'PENDIENTE')

  const r = await conciliar(e.companyId)
  // Antes de la fase 4: `undefined` y `r.cuadra === true` («DEFECTO H6: la regla solo mira PENDIENTE»).
  const h = hallazgo(r, 'cobrado-sin-entregar')
  assert.ok(h, 'ahora aparece')
  assert.deepEqual([h.cantidad, h.monto, h.severidad], [1, PRECIO, 'ALTA'])
  assert.deepEqual(h.casos.map((c) => [c.tipo, c.id, c.acciones]), [['CLIENTE_ESPERANDO', i.id, ['REINTENTAR_ENTREGA', 'CERRAR_SIN_ENTREGAR', 'ABRIR_FICHA']]])
  assert.match(h.casos[0]!.detalle ?? '', /fallida: La activación falló\. \(1 intento\)/)
  assert.equal(r.cuadra, false, 'y el panel deja de afirmar «Todo cuadra»')
})
