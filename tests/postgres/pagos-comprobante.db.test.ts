/**
 * FASE 0 · PAGO CON TARJETA, COMPROBANTE Y CONCILIACIÓN — pruebas de CARACTERIZACIÓN.
 *
 * Contexto. Un pago de RD$ 500 con tarjeta dentro de la app activó la membresía y, en la pantalla
 * `/admin/conciliacion`, apareció como «Cobros sin transacción registrada». Estas pruebas fijan, contra
 * PostgreSQL real y con los servicios de verdad, el comportamiento ACTUAL que produce ese y otros
 * descuadres, para que la corrección (fases 1–5 del plan) cambie CADA aserción a propósito y a la vista:
 *
 *   H1  un pago con tarjeta aprobado activa la membresía pero NO deja `Transaction` (ni ticket ni factura),
 *       y la conciliación lo detecta como cobro sin transacción                      → fase 2 lo invierte.
 *   H2  el libro de ventas no tiene método «tarjeta» (`MetodoCobroTipo`)              → fase 1.
 *   H3  contraste: el panel de administración SÍ registra la venta                    → es el patrón a reutilizar.
 *   H4  la renovación automática con tarjeta guardada cobra y renueva, y tampoco deja `Transaction` → fase 2.
 *   H5  falso positivo: un pago aprobado ANTES de la columna de cumplimiento (fila con el valor por defecto
 *       'PENDIENTE', la migración 20260912_p1b no rellenó nada) cuenta como «cobrado sin entregar» aunque la
 *       membresía esté activa y entregada                                              → fase 1 (backfill) y 4.
 *   H6  punto ciego: un cobro cuya entrega FALLÓ (`FALLIDA`) y cuyo cliente no recibió nada NO se detecta;
 *       la conciliación dice «Todo cuadra»                                             → fase 4.
 *
 * Nada de esto se arregla aquí. Cuando una fase cambie un comportamiento, la aserción correspondiente se
 * invierte en ese mismo commit y la razón queda en su mensaje.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { MetodoCobroTipo } from '@prisma/client'
import { prisma } from '../../src/lib/prisma'
import { conEmpresa } from '../../src/lib/tenant'
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
const envOriginal = { pub: process.env.CARDNET_TOKENS_PUBLIC_KEY, priv: process.env.CARDNET_TOKENS_PRIVATE_KEY }

before(() => {
  fetchOriginal = globalThis.fetch
  // Claves de PRUEBA (sintéticas): solo para que la renovación considere configurada la pasarela. No salen a la red:
  // `fetch` se sustituye por una pasarela simulada que aprueba el cobro.
  process.env.CARDNET_TOKENS_PUBLIC_KEY = 'pk-prueba-sintetica'
  process.env.CARDNET_TOKENS_PRIVATE_KEY = 'sk-prueba-sintetica'
})

after(() => {
  globalThis.fetch = fetchOriginal
  if (envOriginal.pub === undefined) delete process.env.CARDNET_TOKENS_PUBLIC_KEY
  else process.env.CARDNET_TOKENS_PUBLIC_KEY = envOriginal.pub
  if (envOriginal.priv === undefined) delete process.env.CARDNET_TOKENS_PRIVATE_KEY
  else process.env.CARDNET_TOKENS_PRIVATE_KEY = envOriginal.priv
})

test('H1 · un pago con tarjeta aprobado activa la membresía y entrega, pero NO deja Transaction; la conciliación lo ve como «cobro sin transacción»', async () => {
  const e = await crearEmpresa('h1')
  const m = await membresia(e)
  const intento = await crearIntento({ companyId: e.companyId, clienteId: e.clienteId, proveedor: 'CARDNET', membershipId: m.id, monto: PRECIO })

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
  assert.deepEqual([i.estado, i.fulfillmentEstado, i.autorizacion], ['APROBADO', 'COMPLETADA', 'AUTH-H1'])

  // ── EL DEFECTO ── (fase 2: debe haber UNA transacción SALE por intento, con ticket)
  assert.equal(await prisma.transaction.count({ where: { membershipId: m.id } }), 0, 'DEFECTO H1: la venta no llega al libro')
  assert.equal(await prisma.transaction.count({ where: { companyId: e.companyId } }), 0)

  // Y es exactamente lo que enseña la pantalla de conciliación.
  const r = await conciliar(e.companyId)
  const h = hallazgo(r, 'cobro-sin-transaccion')
  assert.ok(h, 'la conciliación detecta el cobro sin transacción')
  assert.equal(h.cantidad, 1)
  assert.equal(h.monto, PRECIO)
  assert.equal(h.severidad, 'ALTA')
  assert.equal(h.href, '/admin/pagos', 'DEFECTO: «Revisar» lleva a las colas de validación, donde este pago no aparece')
  assert.equal(r.cuadra, false)
})

test('H2 · el libro de ventas no tiene método «tarjeta»: aunque se registrara, saldría como «Otro»', () => {
  assert.deepEqual(Object.values(MetodoCobroTipo).sort(), ['EFECTIVO', 'OTRO', 'TRANSFERENCIA'], 'DEFECTO H2 (fase 1: añadir TARJETA)')
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

test('H4 · la renovación automática con tarjeta guardada cobra, renueva y entrega, pero tampoco deja Transaction', async () => {
  const e = await crearEmpresa('h4', true)
  const tarjeta = await prisma.tarjetaTokenizada.create({
    data: { companyId: e.companyId, clienteId: e.clienteId, customerId: 'cust-h4', paymentProfileId: 'pp-h4', token: 'CT__sintetico', marca: 'VISA', ultimos4: '4242', activa: true },
    select: { id: true },
  })
  const venceEn = new Date(Date.now() + 3 * 3_600_000)
  const m = await membresia(e, { estado: 'ACTIVA', pagoConfirmado: true, montoPagado: PRECIO, fechaPago: new Date(Date.now() - 29 * 86_400_000), fechaInicio: new Date(Date.now() - 29 * 86_400_000), fechaVencimiento: venceEn, autoRenovar: true, tarjetaTokenizadaId: tarjeta.id })

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
  assert.equal(await prisma.transaction.count({ where: { membershipId: m.id } }), 0, 'DEFECTO H4: el cobro automático tampoco llega al libro (fase 2)')
})

test('H5 · falso positivo: un pago aprobado ANTES de la columna de cumplimiento (valor por defecto PENDIENTE) cuenta como «cobrado sin entregar» aunque la membresía esté activa', async () => {
  const e = await crearEmpresa('h5')
  const cobro = new Date(Date.now() - 20 * 86_400_000)
  const m = await membresia(e, { estado: 'ACTIVA', pagoConfirmado: true, montoPagado: 1600, fechaPago: cobro, fechaInicio: cobro, fechaVencimiento: new Date(Date.now() + 10 * 86_400_000) })
  // Una fila tal como la dejó la migración 20260912_p1b sobre un cobro anterior: estado APROBADO y NINGUNA marca de cumplimiento.
  await prisma.pagoIntento.create({
    data: { companyId: e.companyId, clienteId: e.clienteId, proveedor: 'CARDNET', membershipId: m.id, monto: 1600, estado: 'APROBADO', activadoAt: cobro, autorizacion: 'AUTH-H5', createdAt: cobro },
  })
  const i = await prisma.pagoIntento.findFirstOrThrow({ where: { membershipId: m.id } })
  assert.equal(i.fulfillmentEstado, 'PENDIENTE', 'valor por defecto de la columna (sin backfill)')

  const r = await conciliar(e.companyId)
  const h = hallazgo(r, 'cobrado-sin-entregar')
  assert.ok(h, 'DEFECTO H5: se cuenta como cliente esperando')
  assert.equal(h.cantidad, 1)
  assert.equal(h.monto, 1600)
  assert.equal(h.href, '/admin/reportes/finanzas', '«Revisar» solo enseña una cifra: no hay lista ni acción')
})

test('H6 · punto ciego: un cobro con la entrega FALLIDA y el cliente sin su membresía NO se detecta; la conciliación dice «Todo cuadra»', async () => {
  const e = await crearEmpresa('h6')
  const m = await membresia(e) // sigue PENDIENTE: el cliente pagó y no recibió nada
  await prisma.pagoIntento.create({
    data: { companyId: e.companyId, clienteId: e.clienteId, proveedor: 'CARDNET', membershipId: m.id, monto: PRECIO, estado: 'APROBADO', activadoAt: new Date(), autorizacion: 'AUTH-H6', fulfillmentEstado: 'FALLIDA', fulfillmentError: 'La activación falló.', fulfillmentIntentos: 1 },
  })
  assert.equal((await prisma.membership.findUniqueOrThrow({ where: { id: m.id } })).estado, 'PENDIENTE')

  const r = await conciliar(e.companyId)
  assert.equal(hallazgo(r, 'cobrado-sin-entregar'), undefined, 'DEFECTO H6: la regla solo mira PENDIENTE; FALLIDA y PROCESANDO atascados quedan fuera (fase 4)')
  assert.equal(r.cuadra, true, 'y el panel afirma «Todo cuadra» con un cliente que pagó y no recibió')
})
