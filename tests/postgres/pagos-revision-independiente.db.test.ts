/**
 * PAGO CON TARJETA · lo que encontró la REVISIÓN INDEPENDIENTE, fijado contra PostgreSQL real.
 *
 * Después de cerrar las seis fases, un revisor que no había escrito el código leyó el dinero que se mueve y encontró fallos
 * que las pruebas propias no veían. Cada prueba de aquí falla si vuelve el defecto:
 *
 *   1 · una renovación automática cobrada cuya EXTENSIÓN falló quedaba fallando para siempre (`activarMembresia` rechaza una
 *       membresía ya activa): ahora se rehace con el reintento, sin recobrar, con el pago fechado al cobro;
 *   2 · un CAMBIO DE PLAN pagado con tarjeta no se puede entregar por la pasarela: ni el botón ni el barrido lo reintentan en
 *       vano, el caso dice qué hace falta, y al cerrarlo la bitácora guarda la evidencia y cuánto tardó;
 *   3 · el barrido recorría solo las 500 filas más antiguas y filtraba después: los clientes recientes que esperaban no
 *       entraban nunca en la lectura;
 *   4 · el total «cobrado» no se cuenta dos veces en el reporte de Clientes, y el pago de la membresía lleva la fecha del
 *       cobro aunque la entrega se reintente días después;
 *   5 · lo AUTOMÁTICO no escribe ventas fechadas en un mes ya cerrado; la tarjeta que sale en el comprobante es la usada;
 *   6 · la lista de cobros en línea no recorta el total del cuadre;
 *   7 · una renovación cobrada y sin entregar bloquea otro cobro del mismo periodo;
 *   8 · el cron no calla un comprobante que no se pudo escribir.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../../src/lib/prisma'
import { barridoEntregasDePago } from '../../src/modules/pagos/barrido-entregas'
import { reintentarEntrega } from '../../src/modules/pagos/intentos'
import { asegurarVentaDelIntento } from '../../src/modules/pagos/venta-tarjeta'
import { renovarMembresiaPorTarjeta } from '../../src/modules/pagos/cardnetTokenGuardado'
import { crearTransaccionAplicada } from '../../src/lib/transactions/application/transaction-service'
import { snapshotDeCobroConTarjeta } from '../../src/modules/pagos/comprobante-tarjeta'
import { getCobrosEnLineaDelDia } from '../../src/modules/pagos/cobros-en-linea'
import { conciliar } from '../../src/modules/observabilidad/conciliacion'
import { CAMBIO_DE_PLAN_PAGADO } from '../../src/modules/observabilidad/conciliacion-entrega'
import { marcarCobroEntregado, reintentarEntregaDeCobro } from '../../src/modules/observabilidad/conciliacion-servicio'
import { getReporteClientes } from '../../src/modules/reportes/clientes'
import { diaLocal, leerRango } from '../../src/modules/reportes/rango'
import { periodEnd } from '../../src/lib/server-utils'

const TZ = 'America/Santo_Domingo'
const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const PRECIO = 500
const H = 3_600_000
const DIA = 24 * H
const hace = (ms: number) => new Date(Date.now() - ms)
const hoy = () => diaLocal(new Date(), TZ)
const actor = { userId: null as string | null, ipAddress: '10.0.0.1', userAgent: 'prueba' }

let fetchOriginal: typeof fetch
const anterior = { pub: process.env.CARDNET_TOKENS_PUBLIC_KEY, priv: process.env.CARDNET_TOKENS_PRIVATE_KEY }
before(() => {
  fetchOriginal = globalThis.fetch
  // Claves de PRUEBA (sintéticas): solo para que la renovación considere configurada la pasarela. No salen a la red.
  process.env.CARDNET_TOKENS_PUBLIC_KEY = 'prueba-prueba-prueba'
  process.env.CARDNET_TOKENS_PRIVATE_KEY = 'prueba-prueba-prueba'
})
after(() => {
  globalThis.fetch = fetchOriginal
  if (anterior.pub === undefined) delete process.env.CARDNET_TOKENS_PUBLIC_KEY
  else process.env.CARDNET_TOKENS_PUBLIC_KEY = anterior.pub
  if (anterior.priv === undefined) delete process.env.CARDNET_TOKENS_PRIVATE_KEY
  else process.env.CARDNET_TOKENS_PRIVATE_KEY = anterior.priv
})

async function empresa(etiqueta: string, conTarjetas = false) {
  const c = await prisma.company.create({
    data: {
      name: `Revision ${etiqueta} ${sufijo}`,
      slug: `revision-${etiqueta}-${sufijo}`,
      type: 'carwash',
      ciudad: 'Santo Domingo',
      ...(conTarjetas ? { capacidades: { overrides: { PAGO_CARDNET: true } } } : {}),
    },
    select: { id: true },
  })
  const plan = await prisma.plan.create({ data: { companyId: c.id, nombre: `Plan ${etiqueta}`, precio: PRECIO, vigenciaDias: 30, lavadosIncluidos: 4 }, select: { id: true } })
  const planNuevo = await prisma.plan.create({ data: { companyId: c.id, nombre: `Plan Mayor ${etiqueta}`, precio: 900, vigenciaDias: 30, lavadosIncluidos: 8 }, select: { id: true } })
  const admin = await prisma.user.create({ data: { supabaseId: `sb-rev-${etiqueta}-${sufijo}`, email: `rev-${etiqueta}-${sufijo}@prueba.test`, name: `Admin ${etiqueta}`, role: 'ADMINISTRADOR', companyId: c.id }, select: { id: true } })
  return { companyId: c.id, planId: plan.id, planNuevoId: planNuevo.id, adminId: admin.id }
}
type Empresa = Awaited<ReturnType<typeof empresa>>

let n = 0
async function cliente(e: Empresa) {
  const k = n++
  return (
    await prisma.cliente.create({
      data: { companyId: e.companyId, supabaseId: `sb-rvc-${sufijo}-${k}`, nombre: `Cliente ${k}`, email: `rv-${sufijo}-${k}@prueba.test` },
      select: { id: true },
    })
  ).id
}

async function membresia(e: Empresa, clienteId: string, extra: Record<string, unknown> = {}) {
  return (await prisma.membership.create({ data: { companyId: e.companyId, clienteId, planId: e.planId, ...extra }, select: { id: true } })).id
}

function cobro(e: Empresa, clienteId: string, membershipId: string, extra: Record<string, unknown> = {}) {
  return prisma.pagoIntento.create({
    data: {
      companyId: e.companyId,
      clienteId,
      proveedor: 'CARDNET',
      membershipId,
      monto: PRECIO,
      estado: 'APROBADO',
      activadoAt: hace(2 * H),
      createdAt: hace(2 * H),
      updatedAt: hace(2 * H),
      autorizacion: 'AUTH-REV',
      canal: 'APP',
      ...extra,
    },
    select: { id: true },
  })
}

const falla = { fulfillmentEstado: 'FALLIDA' as const, fulfillmentError: 'La activación falló.', fulfillmentIntentos: 1 }
const barrer = (e: Empresa) => barridoEntregasDePago({ companyId: e.companyId })
const intentoDe = (id: string) => prisma.pagoIntento.findUniqueOrThrow({ where: { id } })
const ventaDe = (pagoIntentoId: string) => prisma.transaction.findUnique({ where: { pagoIntentoId } })

test('1 · una renovación cobrada cuya extensión falló se rehace con el reintento: sin recobrar, una sola vez, con el pago fechado al cobro', async () => {
  const e = await empresa('uno')
  const c = await cliente(e)
  const venceAntes = new Date(Date.now() + DIA)
  const pagoViejo = hace(29 * DIA)
  const m = await membresia(e, c, { estado: 'ACTIVA', pagoConfirmado: true, montoPagado: PRECIO, fechaPago: pagoViejo, fechaInicio: pagoViejo, fechaVencimiento: venceAntes, autoRenovar: true })
  const cobradoEn = hace(3 * H)
  const i = await cobro(e, c, m, { canal: 'RENOVACION_AUTOMATICA', activadoAt: cobradoEn, createdAt: cobradoEn, updatedAt: cobradoEn, ...falla, fulfillmentError: 'Cobrado, pero la extensión falló.' })

  let llamadas = 0
  globalThis.fetch = (async () => {
    llamadas++
    throw new Error('la pasarela no debe tocarse: el reintento no recobra')
  }) as typeof fetch

  const r = await barrer(e)
  assert.deepEqual([r.revisados, r.reintentadas, r.entregadas, r.errores], [1, 1, 1, 0], 'el barrido la entrega en vez de gastar su reintento en vano')
  assert.equal(llamadas, 0, 'no recobra')

  const db = await intentoDe(i.id)
  assert.deepEqual([db.fulfillmentEstado, db.fulfillmentError, db.fulfillmentIntentos], ['COMPLETADA', null, 2])
  const mem = await prisma.membership.findUniqueOrThrow({ where: { id: m } })
  assert.equal(mem.fechaVencimiento?.getTime(), periodEnd(venceAntes, 30).getTime(), 'se extendió desde el vencimiento vigente')
  assert.equal(mem.fechaPago?.getTime(), cobradoEn.getTime(), 'el pago lleva la fecha del COBRO, no la de la entrega')
  assert.equal(Number(mem.montoPagado), PRECIO)

  const venta = await ventaDe(i.id)
  assert.ok(venta, 'y su venta en el libro')
  assert.equal(venta.createdAt.getTime(), cobradoEn.getTime(), 'la venta cae en el día del cobro')
  assert.equal((venta.snapshot as Record<string, unknown>).canalDeCobro, 'RENOVACION_AUTOMATICA')

  const log = await prisma.auditLog.findMany({ where: { companyId: e.companyId, accion: 'PAGO_APROBADO', entidadId: m } })
  assert.equal(log.length, 1)
  assert.equal((log[0]!.payload as Record<string, unknown>).intentoId, i.id)
  assert.equal(await prisma.membresiaEvento.count({ where: { membershipId: m, tipo: 'RENOVADA' } }), 1)

  // Idempotente: otra pasada y un reintento a mano no extienden otra vez.
  const otra = await barrer(e)
  assert.equal(otra.revisados, 0)
  const aMano = await reintentarEntrega(i.id)
  assert.deepEqual([aMano.ok, aMano.entrega], [true, 'COMPLETADA'])
  const despues = await prisma.membership.findUniqueOrThrow({ where: { id: m } })
  assert.equal(despues.fechaVencimiento?.getTime(), mem.fechaVencimiento?.getTime(), 'una sola extensión')
})

test('1b · de punta a punta: la pasarela cobra, la extensión FALLA de verdad, la entrega queda fallida y el reintento la rehace sin recobrar', async () => {
  const e = await empresa('unob', true)
  const c = await cliente(e)
  const tarjeta = await prisma.tarjetaTokenizada.create({
    data: { companyId: e.companyId, clienteId: c, customerId: 'cust-rev1b', paymentProfileId: 'pp-rev1b', token: 'CT__sinteticob', marca: 'VISA', ultimos4: '4242', activa: true },
    select: { id: true },
  })
  const venceAntes = new Date(Date.now() + 3 * H)
  const m = await membresia(e, c, { estado: 'ACTIVA', pagoConfirmado: true, montoPagado: PRECIO, fechaPago: hace(29 * DIA), fechaInicio: hace(29 * DIA), fechaVencimiento: venceAntes, autoRenovar: true, tarjetaTokenizadaId: tarjeta.id })
  // La renovación automática exige un consentimiento VIGENTE: un fixture que la enciende sin uno no es una renovación autorizada.
  await prisma.consentimientoPago.create({ data: { companyId: e.companyId, clienteId: c, tipo: 'RENOVACION_AUTOMATICA', tarjetaId: tarjeta.id, membershipId: m, origen: 'HEREDADO', textoVersion: 'previo-a-registro' } })

  let llamadas = 0
  globalThis.fetch = (async () => {
    llamadas++
    return new Response(JSON.stringify({ Response: { Transaction: { TransactionStatusId: 1, ResponseCode: '00', AuthorizationCode: 'AUTH-R1B' } }, Errors: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch

  // Un fallo real de la base justo en la extensión: un disparador que rechaza la actualización de ESTA membresía.
  const nombre = `rev_falla_${sufijo}`
  await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION ${nombre}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'falla simulada de la extension'; END $$`)
  await prisma.$executeRawUnsafe(`CREATE TRIGGER ${nombre} BEFORE UPDATE ON memberships FOR EACH ROW WHEN (NEW.id = '${m}') EXECUTE FUNCTION ${nombre}()`)
  let soltado = false
  const soltar = async () => {
    if (soltado) return
    soltado = true
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${nombre} ON memberships`)
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${nombre}()`)
  }
  try {
    const r = await renovarMembresiaPorTarjeta(m, '127.0.0.1')
    assert.equal(r.estado, 'error', JSON.stringify(r))
    assert.equal(llamadas, 1, 'se cobró una vez')
    const i = await prisma.pagoIntento.findFirstOrThrow({ where: { membershipId: m } })
    assert.deepEqual([i.estado, i.fulfillmentEstado, i.fulfillmentError, i.fulfillmentIntentos], ['APROBADO', 'FALLIDA', 'Cobrado, pero la extensión falló.', 1], 'cobrado, y la entrega dice que falló')
    assert.equal((await prisma.membership.findUniqueOrThrow({ where: { id: m } })).fechaVencimiento?.getTime(), venceAntes.getTime(), 'la membresía no se tocó')
    assert.equal(await ventaDe(i.id), null, 'sin entrega no hay venta')

    // Mientras la entrega siga sin resolverse, otra renovación no vuelve a cobrar.
    await prisma.pagoIntento.update({ where: { id: i.id }, data: { createdAt: hace(2 * DIA) } })
    const otra = await renovarMembresiaPorTarjeta(m, '127.0.0.1')
    assert.equal(otra.estado, 'omitida')
    assert.equal(llamadas, 1, 'no recobra')

    // Se arregla la base y se reintenta la entrega: extiende, cierra y factura, sin tocar la pasarela.
    await soltar()
    const reintento = await reintentarEntrega(i.id)
    assert.deepEqual([reintento.ok, reintento.entrega], [true, 'COMPLETADA'])
    assert.equal(llamadas, 1, 'el reintento no recobra')
    const mem = await prisma.membership.findUniqueOrThrow({ where: { id: m } })
    assert.equal(mem.fechaVencimiento?.getTime(), periodEnd(venceAntes, 30).getTime())
    assert.equal(mem.fechaPago?.getTime(), i.activadoAt?.getTime())
    const venta = await ventaDe(i.id)
    assert.ok(venta)
    assert.match(String((venta.snapshot as Record<string, unknown>).metodoCobroLabel), /VISA ••••4242/, 'la renovación inmediata sí lleva su tarjeta')
  } finally {
    await soltar()
  }
})

test('2 · un cambio de plan pagado con tarjeta no se reintenta en vano: el caso dice qué hace falta y el cierre guarda la evidencia', async () => {
  const e = await empresa('dos')
  const c = await cliente(e)
  const pagoViejo = hace(10 * DIA)
  const m = await membresia(e, c, { estado: 'ACTIVA', pagoConfirmado: true, montoPagado: PRECIO, fechaPago: pagoViejo, fechaInicio: pagoViejo, fechaVencimiento: new Date(Date.now() + 20 * DIA), planIdSolicitado: e.planNuevoId })
  const i = await cobro(e, c, m, { monto: 400, ...falla })

  const aMano = await reintentarEntrega(i.id)
  assert.deepEqual([aMano.ok, aMano.entrega, aMano.error], [false, 'FALLIDA', CAMBIO_DE_PLAN_PAGADO])
  assert.equal((await intentoDe(i.id)).fulfillmentIntentos, 1, 'no gasta un reintento')

  const servicio = await reintentarEntregaDeCobro(e.companyId, i.id, actor)
  assert.deepEqual(servicio, { ok: false, error: CAMBIO_DE_PLAN_PAGADO })

  const barrido = await barrer(e)
  assert.deepEqual([barrido.reintentadas, barrido.omitidos.requierenPersona, barrido.siguenEsperando, barrido.avisos], [0, 1, 1, 1])
  const aviso = await prisma.notificacion.findFirstOrThrow({ where: { userId: e.adminId } })
  assert.match(aviso.mensaje, /hace falta una persona/)

  const h = (await conciliar(e.companyId)).hallazgos.find((x) => x.clave === 'cobrado-sin-entregar')
  assert.ok(h)
  assert.deepEqual(h.casos.map((x) => [x.tipo, x.acciones]), [['CLIENTE_ESPERANDO', ['CERRAR_SIN_ENTREGAR', 'ABRIR_FICHA']]], 'no se ofrece un botón que va a fallar')
  assert.match(h.casos[0]!.detalle ?? '', /cambio de plan/i)

  // Una persona aplica el cambio desde Pagos: la membresía queda con el plan nuevo y la fecha de ese pago.
  await prisma.membership.update({ where: { id: m }, data: { planId: e.planNuevoId, planIdSolicitado: null, fechaPago: new Date() } })
  const despues = (await conciliar(e.companyId)).hallazgos.find((x) => x.clave === 'entrega-sin-registrar')
  assert.ok(despues)
  const caso = despues.casos.find((x) => x.id === i.id)
  assert.deepEqual(caso?.acciones, ['MARCAR_ENTREGADA', 'CERRAR_SIN_ENTREGAR', 'ABRIR_FICHA'])
  assert.equal(caso?.cierreCancelaMembresia, true, 'cerrarla sin entregar cancelaría la membresía, y la pantalla lo avisa')
  assert.match(caso?.detalle ?? '', /Se activó 2 horas después del cobro\./)
  assert.doesNotMatch(caso?.detalle ?? '', /Tardó mucho/)

  const cierre = await marcarCobroEntregado(e.companyId, i.id, actor, 'Cambio de plan aplicado desde Pagos')
  assert.equal(cierre.ok, true)
  const asiento = await prisma.auditLog.findFirstOrThrow({ where: { companyId: e.companyId, accion: 'CONCILIACION_ENTREGA_MARCADA', entidadId: i.id } })
  const evidencia = (asiento.payload as { evidencia: Record<string, unknown> }).evidencia
  assert.equal(evidencia.fuente, 'MEMBRESIA')
  assert.equal(evidencia.demoraSospechosa, false)
  assert.ok(typeof evidencia.demoraMs === 'number' && evidencia.demoraMs > 0)
})

test('2b · una activación que tardó días tras el cobro se dice, para que la nota no se firme a ciegas', async () => {
  const e = await empresa('dosb')
  const c = await cliente(e)
  const m = await membresia(e, c, { estado: 'ACTIVA', pagoConfirmado: true, montoPagado: PRECIO, fechaPago: new Date(), fechaInicio: new Date(), fechaVencimiento: new Date(Date.now() + 29 * DIA) })
  const i = await cobro(e, c, m, { activadoAt: hace(3 * DIA), createdAt: hace(3 * DIA), updatedAt: hace(3 * DIA), ...falla })

  const h = (await conciliar(e.companyId)).hallazgos.find((x) => x.clave === 'entrega-sin-registrar')
  const caso = h?.casos.find((x) => x.id === i.id)
  assert.match(caso?.detalle ?? '', /Se activó 3 días después del cobro\./)
  assert.match(caso?.detalle ?? '', /Tardó mucho/)

  await marcarCobroEntregado(e.companyId, i.id, actor, 'Confirmado en la ficha del cliente')
  const asiento = await prisma.auditLog.findFirstOrThrow({ where: { companyId: e.companyId, accion: 'CONCILIACION_ENTREGA_MARCADA', entidadId: i.id } })
  assert.equal(((asiento.payload as { evidencia: Record<string, unknown> }).evidencia).demoraSospechosa, true)
})

test('3 · el barrido llega a los clientes que esperan aunque haya más de una página de cobros que no lo son', async () => {
  const e = await empresa('tres')
  // Más de una página (500) de registros sin cerrar, MÁS RECIENTES que el cliente que espera: antes ocupaban toda la lectura.
  const cRel = await cliente(e)
  const mRel = await membresia(e, cRel, { estado: 'ACTIVA', pagoConfirmado: true, montoPagado: PRECIO, fechaPago: hace(1 * H), fechaInicio: hace(1 * H), fechaVencimiento: new Date(Date.now() + 29 * DIA) })
  const filas = Array.from({ length: 501 }, (_, k) => {
    const t = hace(2 * DIA + k * 1000)
    return { companyId: e.companyId, clienteId: cRel, proveedor: 'CARDNET' as const, membershipId: mRel, monto: PRECIO, estado: 'APROBADO' as const, activadoAt: t, createdAt: t, updatedAt: t, canal: 'APP', fulfillmentEstado: 'FALLIDA' as const, fulfillmentIntentos: 1 }
  })
  await prisma.pagoIntento.createMany({ data: filas })

  const cEsp = await cliente(e)
  const mEsp = await membresia(e, cEsp)
  const viejo = hace(6 * DIA)
  const espera = await cobro(e, cEsp, mEsp, { activadoAt: viejo, createdAt: viejo, updatedAt: viejo, ...falla })

  const r = await barrer(e)
  assert.deepEqual([r.revisados, r.reintentadas, r.entregadas, r.incompleto], [1, 1, 1, false], 'solo el cliente que esperaba, aunque esté al final')
  assert.equal((await intentoDe(espera.id)).fulfillmentEstado, 'COMPLETADA')
  assert.equal((await prisma.membership.findUniqueOrThrow({ where: { id: mEsp } })).estado, 'ACTIVA')
})

test('4 · el reporte de Clientes cuenta el cobro una vez, y la entrega tardía no mueve el pago de periodo', async () => {
  const e = await empresa('cuatro')
  const rango = leerRango({ desde: hoy(), hasta: hoy() }, TZ)

  // (a) cobrado con tarjeta: la membresía y su venta del libro son el MISMO dinero.
  const c1 = await cliente(e)
  const m1 = await membresia(e, c1, { estado: 'ACTIVA', pagoConfirmado: true, montoPagado: PRECIO, fechaPago: new Date(), fechaInicio: new Date() })
  const i1 = await cobro(e, c1, m1, { activadoAt: new Date(), createdAt: new Date(), fulfillmentEstado: 'COMPLETADA', fulfillmentAt: new Date() })
  await crearTransaccionAplicada(prisma, {
    tipo: 'SALE',
    companyId: e.companyId,
    clienteId: c1,
    monto: PRECIO,
    metodoCobro: 'TARJETA',
    pagoIntentoId: i1.id,
    membershipId: m1,
    snapshot: snapshotDeCobroConTarjeta({ detalle: 'Membresía', clienteNombre: 'Cliente', monto: PRECIO, canal: 'APP', pagoIntentoId: i1.id, autorizacion: 'AUTH-REV' }),
    timeZone: TZ,
  })
  const rep = await getReporteClientes(e.companyId, rango, TZ, { verFinancieros: true })
  assert.equal(rep.valorGenerado?.valor, PRECIO, 'RD$500, no RD$1,000')

  // (b) una entrega reintentada días después: el pago de la membresía queda en el día del cobro, igual que su venta.
  const c2 = await cliente(e)
  const m2 = await membresia(e, c2)
  const cobradoEn = hace(3 * DIA)
  const i2 = await cobro(e, c2, m2, { activadoAt: cobradoEn, createdAt: cobradoEn, updatedAt: cobradoEn, ...falla })
  const r = await reintentarEntrega(i2.id)
  assert.deepEqual([r.ok, r.entrega], [true, 'COMPLETADA'])
  const mem = await prisma.membership.findUniqueOrThrow({ where: { id: m2 } })
  assert.equal(mem.fechaPago?.getTime(), cobradoEn.getTime(), 'fechaPago = cuándo la pasarela aprobó el cobro')
  assert.ok(mem.fechaInicio && mem.fechaInicio.getTime() > cobradoEn.getTime() + DIA, 'el periodo sí empieza cuando se entrega')
  assert.equal((await ventaDe(i2.id))?.createdAt.getTime(), cobradoEn.getTime())
})

test('5 · lo automático no escribe ventas en un mes cerrado, una persona sí; y la tarjeta del comprobante es la que se usó', async () => {
  const e = await empresa('cinco')
  const c = await cliente(e)
  const tarjeta = await prisma.tarjetaTokenizada.create({
    data: { companyId: e.companyId, clienteId: c, customerId: 'cust-rev', paymentProfileId: 'pp-rev', token: 'CT__sintetico', marca: 'VISA', ultimos4: '4242', activa: true },
    select: { id: true },
  })
  const m = await membresia(e, c, { estado: 'ACTIVA', pagoConfirmado: true, montoPagado: PRECIO, fechaPago: hace(20 * DIA), tarjetaTokenizadaId: tarjeta.id })
  const antiguo = hace(20 * DIA)
  const i = await cobro(e, c, m, { activadoAt: antiguo, createdAt: antiguo, updatedAt: antiguo, fulfillmentEstado: 'COMPLETADA', fulfillmentAt: antiguo })

  assert.equal(await asegurarVentaDelIntento(i.id), null, 'el camino automático no fecha una venta de hace 20 días')
  assert.equal(await ventaDe(i.id), null)

  const aMano = await asegurarVentaDelIntento(i.id, { explicito: true })
  assert.equal(aMano?.nueva, true)
  const venta = await ventaDe(i.id)
  assert.equal(venta?.createdAt.getTime(), antiguo.getTime(), 'la acción explícita sí la fecha en el día del cobro')
  const etiqueta = String((venta?.snapshot as Record<string, unknown>).metodoCobroLabel)
  assert.doesNotMatch(etiqueta, /4242|VISA/, 'un cobro en la app no sabe qué tarjeta usó: no se le pega la guardada de la membresía')

  // Una renovación cuya venta se repara tarde tampoco: la tarjeta guardada pudo cambiar desde entonces.
  const c2 = await cliente(e)
  const t2 = await prisma.tarjetaTokenizada.create({
    data: { companyId: e.companyId, clienteId: c2, customerId: 'cust-rev2', paymentProfileId: 'pp-rev2', token: 'CT__sintetico2', marca: 'MASTERCARD', ultimos4: '1111', activa: true },
    select: { id: true },
  })
  const m2 = await membresia(e, c2, { estado: 'ACTIVA', pagoConfirmado: true, montoPagado: PRECIO, fechaPago: hace(2 * H), tarjetaTokenizadaId: t2.id })
  const i2 = await cobro(e, c2, m2, { canal: 'RENOVACION_AUTOMATICA', fulfillmentEstado: 'COMPLETADA', fulfillmentAt: hace(2 * H) })
  assert.equal((await asegurarVentaDelIntento(i2.id))?.nueva, true)
  assert.doesNotMatch(String(((await ventaDe(i2.id))?.snapshot as Record<string, unknown>).metodoCobroLabel), /1111|MASTERCARD/)
})

test('6 · la lista de cobros en línea se acota, pero el total del cuadre es el del día completo y se avisa', async () => {
  const e = await empresa('seis')
  for (let k = 0; k < 3; k++) {
    const c = await cliente(e)
    const m = await membresia(e, c, { estado: 'ACTIVA', pagoConfirmado: true, montoPagado: PRECIO, fechaPago: new Date() })
    const i = await cobro(e, c, m, { activadoAt: new Date(), createdAt: new Date(), fulfillmentEstado: 'COMPLETADA', fulfillmentAt: new Date() })
    await crearTransaccionAplicada(prisma, {
      tipo: 'SALE',
      companyId: e.companyId,
      clienteId: c,
      monto: PRECIO,
      metodoCobro: 'TARJETA',
      pagoIntentoId: i.id,
      membershipId: m,
      snapshot: snapshotDeCobroConTarjeta({ detalle: 'Membresía', clienteNombre: `Cliente ${k}`, monto: PRECIO, canal: 'APP', pagoIntentoId: i.id, autorizacion: 'AUTH-REV' }),
      timeZone: TZ,
    })
  }
  const recortado = await getCobrosEnLineaDelDia(e.companyId, hoy(), TZ, { tope: 2, conDetalle: true })
  assert.equal(recortado.items.length, 2)
  assert.equal(recortado.truncado, true)
  assert.deepEqual([recortado.resumen.cantidad, recortado.resumen.total], [3, 3 * PRECIO], 'el total no se recorta con la lista')
  const completo = await getCobrosEnLineaDelDia(e.companyId, hoy(), TZ, { conDetalle: true })
  assert.deepEqual([completo.items.length, completo.truncado, completo.resumen.cantidad, completo.resumen.total], [3, false, 3, 3 * PRECIO])
})

test('7 · una renovación cobrada y sin entregar bloquea otro cobro del mismo periodo, aunque pase la ventana anti-duplicado', async () => {
  const e = await empresa('siete', true)
  const c = await cliente(e)
  const tarjeta = await prisma.tarjetaTokenizada.create({
    data: { companyId: e.companyId, clienteId: c, customerId: 'cust-rev7', paymentProfileId: 'pp-rev7', token: 'CT__sintetico7', marca: 'VISA', ultimos4: '4242', activa: true },
    select: { id: true },
  })
  const m = await membresia(e, c, { estado: 'ACTIVA', pagoConfirmado: true, montoPagado: PRECIO, fechaPago: hace(29 * DIA), fechaInicio: hace(29 * DIA), fechaVencimiento: new Date(Date.now() + 3 * H), autoRenovar: true, tarjetaTokenizadaId: tarjeta.id })
  // La renovación automática exige un consentimiento VIGENTE: un fixture que la enciende sin uno no es una renovación autorizada.
  await prisma.consentimientoPago.create({ data: { companyId: e.companyId, clienteId: c, tipo: 'RENOVACION_AUTOMATICA', tarjetaId: tarjeta.id, membershipId: m, origen: 'HEREDADO', textoVersion: 'previo-a-registro' } })
  const hace2d = hace(2 * DIA)
  const pendiente = await cobro(e, c, m, { canal: 'RENOVACION_AUTOMATICA', activadoAt: hace2d, createdAt: hace2d, updatedAt: hace2d, ...falla })

  let llamadas = 0
  globalThis.fetch = (async () => {
    llamadas++
    return new Response(JSON.stringify({ Response: { Transaction: { TransactionStatusId: 1, ResponseCode: '00', AuthorizationCode: 'AUTH-R7' } }, Errors: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch

  const bloqueada = await renovarMembresiaPorTarjeta(m, '127.0.0.1')
  assert.equal(bloqueada.estado, 'omitida')
  assert.equal(llamadas, 0, 'no se cobra otra vez mientras el cobro anterior espera su entrega')

  // Con el cobro anterior ya resuelto, la renovación sigue su camino normal.
  await prisma.pagoIntento.update({ where: { id: pendiente.id }, data: { fulfillmentEstado: 'COMPLETADA', fulfillmentAt: hace2d } })
  const libre = await renovarMembresiaPorTarjeta(m, '127.0.0.1')
  assert.equal(libre.estado, 'renovada', JSON.stringify(libre))
  assert.equal(llamadas, 1)
})

test('8 · el cron cuenta como error el comprobante que no se pudo escribir, en vez de decir que todo salió bien', async () => {
  const e = await empresa('ocho')
  const c = await cliente(e)
  const m = await membresia(e, c, { estado: 'ACTIVA', pagoConfirmado: true, montoPagado: PRECIO, fechaPago: new Date() })
  const i = await cobro(e, c, m, { fulfillmentEstado: 'COMPLETADA', fulfillmentAt: new Date() })

  // `asegurarVentaDelIntento` no lanza: cuando el libro no la deja escribir, devuelve null. El barrido tiene que verlo.
  const roto = await barridoEntregasDePago({ companyId: e.companyId, asegurarVenta: async () => null })
  assert.equal(roto.comprobantes, 0)
  assert.equal(roto.errores, 1, 'el fallo se ve en el resumen del cron')
  assert.equal(await ventaDe(i.id), null)

  // Y con el libro sano, la pasada siguiente lo repara.
  const sano = await barrer(e)
  assert.deepEqual([sano.comprobantes, sano.errores], [1, 0])
  assert.ok(await ventaDe(i.id))
})
