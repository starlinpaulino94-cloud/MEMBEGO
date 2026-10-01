import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { Prisma } from '@prisma/client'
import { prisma } from '../../src/lib/prisma'
import { sinEmpresa } from '../../src/lib/tenant'
import { vincularEmpresaComoProveedorEnTx } from '../../src/modules/supply-v2/suppliers/service'
import { crearItemCatalogoEnTx } from '../../src/modules/supply-v2/catalog/service'
import { activarAcuerdoEnTx, crearAcuerdoEnTx } from '../../src/modules/supply-v2/agreements/service'
import { crearOfertaComisionEnTx, publicarOfertaEnTx } from '../../src/modules/supply-v2/offers/service'
import { abrirOrdenClienteEnTx, cancelarOrdenClienteEnTx, confirmarPagoEnTx, expirarOrdenEnTx } from '../../src/modules/supply-v2/commerce/checkout'
import { abrirSesionQrEnTx, confirmarEntregaEnTx, type EmpleadoProveedor } from '../../src/modules/supply-v2/redemption/service'
import {
  adjuntarPromocionEnTx,
  agregarOfertaEnTx,
  ajustarPromocionEnTx,
  aprobarCampanaEnTx,
  asignarCampanaAClienteEnTx,
  barridoCampanasEnTx,
  cancelarCampanaEnTx,
  completarCampanaEnTx,
  crearCampanaCompletaEnTx,
  crearCampanaEnTx,
  enviarARevisionEnTx,
  pausarCampanaEnTx,
  presupuestoDeCampanaEnTx,
  publicarCampanaEnTx,
  rechazarCampanaEnTx,
} from '../../src/modules/supply-v2/campaigns/service'
import { cancelarCuponEnTx, generarCuponesEnTx, resolverCuponEnTx } from '../../src/modules/supply-v2/campaigns/coupons'
import { generarLiquidacionEnTx } from '../../src/modules/supply-v2/finance/settlements'
import { calcularEconomia } from '../../src/modules/supply-v2/economics/queries'
import { fichaCampana, misCupones } from '../../src/modules/supply-v2/campaigns/queries'
import { minutosLocales } from '../../src/modules/supply-v2/campaigns/domain'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 7 contra PostgreSQL de verdad (§31).
 *
 *   A  Cupón público: dos clientes usan el mismo código y los dos límites se
 *      respetan; el tercero se queda fuera
 *   B  Cupón privado: el cupón de otra persona se rechaza aunque se sepa
 *   C  Último uso: dos clientes a la vez por el último uso; solo uno pasa
 *   D  Presupuesto: dos compras simultáneas por el saldo final, sin sobregiro
 *   E  Cancelación: el checkout vencido libera cupón y presupuesto, sin duplicar
 *   F  Economía: descuento del proveedor y subsidio de Membego, cada uno por su
 *      nombre; la demostración del enunciado (1 000 → 600 / 72 / 828)
 *   G  Comisión: la venta de campaña genera la obligación contractual correcta
 *   H  Atribución: un pedido pertenece a UNA campaña y no duplica GMV
 *   I  Compatibilidad: un pedido sin campaña funciona como en los Slices 1–6
 *   J  Reversas: cancelar una campaña no toca liquidaciones ya pagadas
 *
 * `npm run test:db`.
 */

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const DIA = 86_400_000
const ahora = new Date()
const como = (actorId: string | null) => ({ actorId, ipAddress: '127.0.0.1', userAgent: 'test' })
const D = (n: number | string) => new Prisma.Decimal(n)

const ctx = {
  compras: '',
  finanzas: '',
  cliente: '',
  cliente2: '',
  cliente3: '',
  sucursal: '',
  empleado: null as unknown as EmpleadoProveedor,
  supplierId: '',
  itemId: '',
  itemOtro: '',
  offerId: '',
  offerOtra: '',
}

async function oferta(itemId: string, titulo: string, precio = 1000): Promise<string> {
  return sinEmpresa('prueba', async (tx) => {
    const o = await crearOfertaComisionEnTx(
      tx,
      { catalogItemId: itemId, title: `${titulo} ${sufijo}`, publicPrice: 1200, salePrice: precio, availabilityMode: 'UNLIMITED', perCustomerLimit: 5, startsAt: new Date(ahora.getTime() - 60_000), endsAt: new Date(ahora.getTime() + 30 * DIA) },
      como(ctx.compras)
    )
    await publicarOfertaEnTx(tx, o.id, como(ctx.compras))
    return o.id
  })
}

/** Campaña publicada con una promoción sobre una oferta. Devuelve ids. */
async function campanaConPromocion(d: {
  nombre: string
  funding: 'MEMBEGO' | 'SUPPLIER' | 'SHARED'
  membego?: number | null
  proveedor?: number | null
  presupuesto?: number | null
  offerId: string
  exigeCupon?: boolean
  requiereAsignacion?: boolean
  maxRedemptions?: number | null
  maxPerCustomer?: number
  audience?: 'ALL' | 'NEW_CUSTOMERS' | 'RETURNING_CUSTOMERS' | 'PAST_CAMPAIGN' | 'SELECTED'
  endsAt?: Date | null
  activeFromMinute?: number | null
  activeToMinute?: number | null
  presupuestoPromocion?: number | null
  publicar?: boolean
}): Promise<{ campaignId: string; benefitId: string; code: string }> {
  const c = await sinEmpresa('prueba', (tx) =>
    crearCampanaEnTx(
      tx,
      {
        name: `${d.nombre} ${sufijo}`,
        organizer: 'MEMBEGO',
        supplierId: d.funding === 'MEMBEGO' ? null : ctx.supplierId,
        funding: d.funding,
        budgetTotal: d.presupuesto ?? null,
        budgetWaiverReason: d.presupuesto == null && d.funding !== 'SUPPLIER' ? 'Prueba automatizada: sin tope a propósito' : null,
        audience: d.audience ?? 'ALL',
        startsAt: new Date(ahora.getTime() - DIA),
        endsAt: d.endsAt === undefined ? new Date(ahora.getTime() + 30 * DIA) : d.endsAt,
        activeFromMinute: d.activeFromMinute ?? null,
        activeToMinute: d.activeToMinute ?? null,
        maxRedemptions: d.maxRedemptions ?? null,
        maxPerCustomer: d.maxPerCustomer ?? 1,
      },
      como(ctx.compras)
    )
  )
  await sinEmpresa('prueba', (tx) => agregarOfertaEnTx(tx, { campaignId: c.id, offerId: d.offerId }, como(ctx.compras)))
  const b = await sinEmpresa('prueba', (tx) =>
    adjuntarPromocionEnTx(
      tx,
      {
        campaignId: c.id,
        offerId: d.offerId,
        valueType: 'FIXED_AMOUNT',
        membegoValue: d.membego ?? null,
        supplierValue: d.proveedor ?? null,
        budgetTotal: d.presupuestoPromocion ?? d.presupuesto ?? null,
        requiresCoupon: d.exigeCupon ?? false,
        requiresAssignment: d.requiereAsignacion ?? false,
        perCustomerLimit: d.maxPerCustomer ?? 1,
      },
      como(ctx.compras)
    )
  )
  if (d.publicar !== false) {
    await sinEmpresa('prueba', (tx) => enviarARevisionEnTx(tx, c.id, como(ctx.compras)))
    await sinEmpresa('prueba', (tx) => aprobarCampanaEnTx(tx, c.id, como(ctx.finanzas)))
    await sinEmpresa('prueba', (tx) => publicarCampanaEnTx(tx, c.id, como(ctx.finanzas)))
  }
  return { campaignId: c.id, benefitId: b.id, code: c.code }
}

async function cupon(d: { campaignId: string; benefitId: string; kind: 'PUBLIC' | 'PRIVATE'; codigo?: string; customerIds?: string[]; maxRedemptions?: number | null; maxPerCustomer?: number; minPurchase?: number | null }): Promise<string> {
  const r = await sinEmpresa('prueba', (tx) =>
    generarCuponesEnTx(
      tx,
      {
        campaignId: d.campaignId,
        benefitId: d.benefitId,
        kind: d.kind,
        cantidad: d.kind === 'PRIVATE' ? (d.customerIds?.length ?? 1) : 1,
        codigo: d.codigo ?? null,
        customerIds: d.customerIds ?? null,
        maxRedemptions: d.maxRedemptions ?? null,
        maxPerCustomer: d.maxPerCustomer ?? 1,
        minPurchase: d.minPurchase ?? null,
      },
      como(ctx.compras)
    )
  )
  return r.codigos[0]!
}

const comprarConCupon = (offerId: string, customerId: string, couponCode: string | null, quantity = 1) =>
  sinEmpresa('prueba', (tx) => abrirOrdenClienteEnTx(tx, { customerId, offerId, quantity, couponCode }, como(customerId)))
const confirmar = (orderId: string, amountSeen: string) => sinEmpresa('prueba', (tx) => confirmarPagoEnTx(tx, { orderId, amountSeen }, como(ctx.finanzas)))
const ordenDe = (id: string) => prisma.supplyV2CustomerOrder.findUniqueOrThrow({ where: { id } })
const cuponDe = (code: string) => prisma.supplyV2Coupon.findFirstOrThrow({ where: { code } })

async function redimir(entitlementId: string, customerId: string): Promise<string> {
  const s = await sinEmpresa('prueba', (tx) => abrirSesionQrEnTx(tx, { entitlementId, customerId, branchId: ctx.sucursal }, como(customerId)))
  const r = await sinEmpresa('prueba', (tx) => confirmarEntregaEnTx(tx, { nonce: s.nonce, empleado: ctx.empleado, branchId: ctx.sucursal }, como(ctx.empleado.userId)))
  return r.id
}

before(async () => {
  const [compras, finanzas, c1, c2, c3, pedro] = await Promise.all(
    (
      [
        ['compras', 'SUPERADMIN'],
        ['finanzas', 'SUPERADMIN'],
        ['c1', 'CLIENTE'],
        ['c2', 'CLIENTE'],
        ['c3', 'CLIENTE'],
        ['pedro', 'ADMINISTRADOR'],
      ] as const
    ).map(([k, role]) => prisma.user.create({ data: { supabaseId: `sb-s7-${k}-${sufijo}`, email: `s7-${k}-${sufijo}@prueba.test`, name: `s7 ${k}`, role }, select: { id: true } }))
  )
  ctx.compras = compras.id
  ctx.finanzas = finanzas.id
  ctx.cliente = c1.id
  ctx.cliente2 = c2.id
  ctx.cliente3 = c3.id
  const empresa = await prisma.company.create({ data: { name: `Resto S7 ${sufijo}`, slug: `resto-s7-${sufijo}`, type: 'restaurante', capacidades: { overrides: { MEMBEGO_SUPPLIER: true } } }, select: { id: true } })
  ctx.sucursal = (await prisma.sucursal.create({ data: { companyId: empresa.id, nombre: 'Naco' }, select: { id: true } })).id
  await prisma.user.update({ where: { id: pedro.id }, data: { companyId: empresa.id } })

  await sinEmpresa('prueba', async (tx) => {
    const p = await vincularEmpresaComoProveedorEnTx(tx, empresa.id, {}, como(ctx.compras))
    ctx.supplierId = p.id
    ctx.empleado = { userId: pedro.id, companyId: empresa.id, supplierId: p.id }
    ctx.itemId = (await crearItemCatalogoEnTx(tx, { supplierId: p.id, type: 'PRODUCT', name: `Pizza Pepperoni S7 ${sufijo}`, category: 'Pizzas', publicPrice: 1200 }, como(ctx.compras))).id
    ctx.itemOtro = (await crearItemCatalogoEnTx(tx, { supplierId: p.id, type: 'PRODUCT', name: `Hamburguesa S7 ${sufijo}`, category: 'Pizzas', publicPrice: 900 }, como(ctx.compras))).id
    const a = await crearAcuerdoEnTx(tx, { supplierId: p.id, type: 'COMMISSION', scope: 'CATEGORY', category: 'Pizzas', commissionPercentage: 8, startsAt: new Date(ahora.getTime() - DIA) }, como(ctx.compras))
    await activarAcuerdoEnTx(tx, a.id, como(ctx.finanzas))
  })
  ctx.offerId = await oferta(ctx.itemId, 'Pizza Membego')
  ctx.offerOtra = await oferta(ctx.itemOtro, 'Hamburguesa Membego', 800)
})

// ── Ciclo de vida de una campaña (§4, §23) ──────────────────────────────────

test('ciclo: borrador → revisión → aprobación de OTRA persona → publicada; sin ofertas no se aprueba', async () => {
  const c = await sinEmpresa('prueba', (tx) =>
    crearCampanaEnTx(
      tx,
      { name: `Campaña vacía ${sufijo}`, organizer: 'MEMBEGO', funding: 'MEMBEGO', budgetTotal: 5000, audience: 'ALL', startsAt: new Date(ahora.getTime() - DIA), endsAt: new Date(ahora.getTime() + 10 * DIA) },
      como(ctx.compras)
    )
  )
  assert.equal(c.status, 'DRAFT')
  assert.match(c.code, /^MBG-CP-\d{4}-\d{6}$/)
  // Sin ofertas, y luego sin promoción, no pasa a revisión.
  await assert.rejects(sinEmpresa('prueba', (tx) => enviarARevisionEnTx(tx, c.id, como(ctx.compras))), /sin ofertas/)
  await sinEmpresa('prueba', (tx) => agregarOfertaEnTx(tx, { campaignId: c.id, offerId: ctx.offerId }, como(ctx.compras)))
  await assert.rejects(sinEmpresa('prueba', (tx) => enviarARevisionEnTx(tx, c.id, como(ctx.compras))), /no rebajaría nada/)
  await sinEmpresa('prueba', (tx) => adjuntarPromocionEnTx(tx, { campaignId: c.id, offerId: ctx.offerId, valueType: 'FIXED_AMOUNT', membegoValue: 100, budgetTotal: 5000 }, como(ctx.compras)))
  await sinEmpresa('prueba', (tx) => enviarARevisionEnTx(tx, c.id, como(ctx.compras)))

  // Publicar sin aprobar está prohibido, y quien la creó no la aprueba.
  await assert.rejects(sinEmpresa('prueba', (tx) => publicarCampanaEnTx(tx, c.id, como(ctx.finanzas))), /se aprueba antes/)
  await assert.rejects(sinEmpresa('prueba', (tx) => aprobarCampanaEnTx(tx, c.id, como(ctx.compras))), /no la aprueba la misma persona/)
  const ap = await sinEmpresa('prueba', (tx) => aprobarCampanaEnTx(tx, c.id, como(ctx.finanzas)))
  assert.equal(ap.autoaprobada, false)
  const pub = await sinEmpresa('prueba', (tx) => publicarCampanaEnTx(tx, c.id, como(ctx.finanzas)))
  assert.equal(pub.status, 'ACTIVE')
  // Al publicar, sus promociones quedan activas: si no, no rebajarían nada.
  const bs = await prisma.supplyV2Benefit.findMany({ where: { campaignId: c.id } })
  assert.ok(bs.every((b) => b.status === 'ACTIVE'))
  // Y el historial de la campaña lo cuenta todo.
  const eventos = await prisma.supplyV2CampaignEvent.findMany({ where: { campaignId: c.id }, select: { type: true } })
  for (const t of ['CREATED', 'OFFER_ADDED', 'BENEFIT_ATTACHED', 'SUBMITTED', 'APPROVED', 'PUBLISHED']) {
    assert.ok(eventos.some((e) => e.type === t), `falta el evento ${t}`)
  }
  await sinEmpresa('prueba', (tx) => cancelarCampanaEnTx(tx, c.id, 'fin de la prueba de ciclo', como(ctx.finanzas)))
})

test('una propuesta de proveedor se devuelve a borrador con su motivo y solo admite sus ofertas', async () => {
  const c = await sinEmpresa('prueba', (tx) =>
    crearCampanaEnTx(
      tx,
      { name: `Propuesta ${sufijo}`, organizer: 'SUPPLIER', supplierId: ctx.supplierId, funding: 'SUPPLIER', audience: 'ALL', startsAt: new Date(ahora.getTime() - DIA), endsAt: new Date(ahora.getTime() + 10 * DIA) },
      como(ctx.compras)
    )
  )
  await sinEmpresa('prueba', (tx) => agregarOfertaEnTx(tx, { campaignId: c.id, offerId: ctx.offerId }, como(ctx.compras)))
  await sinEmpresa('prueba', (tx) => adjuntarPromocionEnTx(tx, { campaignId: c.id, offerId: ctx.offerId, valueType: 'FIXED_AMOUNT', supplierValue: 100 }, como(ctx.compras)))
  await sinEmpresa('prueba', (tx) => enviarARevisionEnTx(tx, c.id, como(ctx.compras)))
  await sinEmpresa('prueba', (tx) => rechazarCampanaEnTx(tx, c.id, 'El descuento propuesto no cubre el mínimo de la categoría', como(ctx.finanzas)))
  const vuelta = await prisma.supplyV2Campaign.findUniqueOrThrow({ where: { id: c.id } })
  assert.deepEqual([vuelta.status, vuelta.reviewNotes], ['DRAFT', 'El descuento propuesto no cubre el mínimo de la categoría'])
  // Y una campaña del proveedor no puede llevar ofertas de otro proveedor.
  const otroItem = await sinEmpresa('prueba', async (tx) => {
    const otro = await vincularEmpresaComoProveedorEnTx(tx, (await prisma.company.create({ data: { name: `Otro S7 ${sufijo}`, slug: `otro-s7-${sufijo}`, type: 'restaurante', capacidades: { overrides: { MEMBEGO_SUPPLIER: true } } }, select: { id: true } })).id, {}, como(ctx.compras))
    const item = await crearItemCatalogoEnTx(tx, { supplierId: otro.id, type: 'PRODUCT', name: `Ajena S7 ${sufijo}`, category: 'Pizzas', publicPrice: 500 }, como(ctx.compras))
    const ac = await crearAcuerdoEnTx(tx, { supplierId: otro.id, type: 'COMMISSION', scope: 'CATALOG', commissionPercentage: 5, startsAt: new Date(ahora.getTime() - DIA) }, como(ctx.compras))
    await activarAcuerdoEnTx(tx, ac.id, como(ctx.finanzas))
    return item.id
  })
  const ofertaAjena = await oferta(otroItem, 'Ajena Membego', 500)
  // Da igual si salta la regla del organizador o la de la financiación: una
  // campaña de un proveedor no lleva ofertas de otro.
  await assert.rejects(sinEmpresa('prueba', (tx) => agregarOfertaEnTx(tx, { campaignId: c.id, offerId: ofertaAjena }, como(ctx.compras))), /tienen que ser suyas|sus propias ofertas/)
})

test('§17 · una campaña que financia Membego exige techo; sin él queda la autorización en la bitácora', async () => {
  await assert.rejects(
    sinEmpresa('prueba', (tx) =>
      crearCampanaEnTx(tx, { name: `Sin tope ${sufijo}`, organizer: 'MEMBEGO', funding: 'MEMBEGO', budgetTotal: null, audience: 'ALL', startsAt: new Date(ahora.getTime() - DIA) }, como(ctx.compras))
    ),
    /presupuesto máximo/
  )
  const c = await sinEmpresa('prueba', (tx) =>
    crearCampanaEnTx(
      tx,
      { name: `Sin tope autorizada ${sufijo}`, organizer: 'MEMBEGO', funding: 'MEMBEGO', budgetTotal: null, budgetWaiverReason: 'Autorizado por finanzas: lanzamiento con control semanal', audience: 'ALL', startsAt: new Date(ahora.getTime() - DIA) },
      como(ctx.compras)
    )
  )
  const fila = await prisma.supplyV2Campaign.findUniqueOrThrow({ where: { id: c.id } })
  assert.equal(fila.budgetTotal, null)
  assert.equal(fila.budgetWaiverById, ctx.compras)
  assert.ok(fila.budgetWaiverAt)
  assert.equal((await prisma.supplyV2CampaignEvent.count({ where: { campaignId: c.id, type: 'BUDGET_WAIVED' } })), 1)
  assert.ok((await prisma.auditLog.count({ where: { accion: 'SUPPLY_V2_CAMPAIGN_BUDGET_WAIVED', entidadId: c.id } })) >= 1)
  // La base lo sostiene: quitarle la autorización a una campaña sin techo no pasa.
  await assert.rejects(prisma.$executeRaw`UPDATE "supply_v2_campaigns" SET "budgetWaiverById" = NULL WHERE "id" = ${c.id}`, /supply_v2_campaigns_shape/)
})

test('§16 · los beneficios de la campaña no pueden comprometer más que su techo', async () => {
  const c = await sinEmpresa('prueba', (tx) =>
    crearCampanaEnTx(tx, { name: `Techo ${sufijo}`, organizer: 'MEMBEGO', funding: 'MEMBEGO', budgetTotal: 1000, audience: 'ALL', startsAt: new Date(ahora.getTime() - DIA) }, como(ctx.compras))
  )
  await sinEmpresa('prueba', (tx) => agregarOfertaEnTx(tx, { campaignId: c.id, offerId: ctx.offerId }, como(ctx.compras)))
  await sinEmpresa('prueba', (tx) => agregarOfertaEnTx(tx, { campaignId: c.id, offerId: ctx.offerOtra }, como(ctx.compras)))
  await sinEmpresa('prueba', (tx) => adjuntarPromocionEnTx(tx, { campaignId: c.id, offerId: ctx.offerId, valueType: 'FIXED_AMOUNT', membegoValue: 100, budgetTotal: 700 }, como(ctx.compras)))
  // La segunda promoción no cabe: 700 + 500 > 1 000.
  await assert.rejects(
    sinEmpresa('prueba', (tx) => adjuntarPromocionEnTx(tx, { campaignId: c.id, offerId: ctx.offerOtra, valueType: 'FIXED_AMOUNT', membegoValue: 100, budgetTotal: 500 }, como(ctx.compras))),
    /sumarían 1200.00/
  )
  // Y una promoción sin tope tampoco, porque rompería el techo.
  await assert.rejects(
    sinEmpresa('prueba', (tx) => adjuntarPromocionEnTx(tx, { campaignId: c.id, offerId: ctx.offerOtra, valueType: 'FIXED_AMOUNT', membegoValue: 100, budgetTotal: null }, como(ctx.compras))),
    /no pueden ir sin tope/
  )
  await sinEmpresa('prueba', (tx) => adjuntarPromocionEnTx(tx, { campaignId: c.id, offerId: ctx.offerOtra, valueType: 'FIXED_AMOUNT', membegoValue: 100, budgetTotal: 300 }, como(ctx.compras)))
  const p = await sinEmpresa('prueba', (tx) => presupuestoDeCampanaEnTx(tx, c.id))
  assert.equal(p.comprometido.toFixed(2), '1000.00')
  assert.equal(p.disponible!.toFixed(2), '1000.00', 'nada reservado ni consumido todavía')
})

test('§5 · el asistente guarda la campaña COMPLETA: sus ofertas y una promoción por oferta dentro del techo', async () => {
  const c = await sinEmpresa('prueba', (tx) =>
    crearCampanaCompletaEnTx(
      tx,
      {
        name: `Asistente ${sufijo}`,
        organizer: 'MEMBEGO',
        funding: 'MEMBEGO',
        budgetTotal: 3000,
        audience: 'ALL',
        startsAt: new Date(ahora.getTime() - DIA),
        maxPerCustomer: 1,
        offerIds: [ctx.offerId, ctx.offerOtra],
        promocion: { valueType: 'FIXED_AMOUNT', membegoValue: 300, requiresCoupon: true },
      },
      como(ctx.compras)
    )
  )
  assert.equal(c.ofertas, 2)
  assert.equal(c.promociones, 2)
  // Lo que la persona marcó quedó guardado: sin ofertas la campaña no se
  // podría ni aprobar, y eso era el agujero que tenía el asistente.
  const ofertas = await prisma.supplyV2CampaignOffer.findMany({ where: { campaignId: c.id }, include: { benefit: { select: { budgetTotal: true, requiresCoupon: true } } } })
  assert.equal(ofertas.length, 2)
  assert.ok(ofertas.every((o) => o.benefitId !== null), 'cada oferta nace con su promoción')
  assert.ok(ofertas.every((o) => o.benefit!.requiresCoupon), 'la promoción de cupón exige el código')
  // §16 · el reparto cuadra EXACTO con el techo aprobado: ni un centavo más.
  const p = await sinEmpresa('prueba', (tx) => presupuestoDeCampanaEnTx(tx, c.id))
  assert.equal(p.aprobado!.toFixed(2), '3000.00')
  assert.equal(p.comprometido.toFixed(2), '3000.00')
  assert.equal(p.algunBeneficioSinTope, false)
})

test('§16 · ajustar la promoción rebalancea el techo, nunca lo rompe y nunca baja de lo ya movido', async () => {
  const c = await sinEmpresa('prueba', (tx) =>
    crearCampanaCompletaEnTx(
      tx,
      {
        name: `Rebalanceo ${sufijo}`,
        organizer: 'MEMBEGO',
        funding: 'MEMBEGO',
        budgetTotal: 3000,
        audience: 'ALL',
        startsAt: new Date(ahora.getTime() - DIA),
        maxPerCustomer: 1,
        offerIds: [ctx.offerId, ctx.offerOtra],
        promocion: { valueType: 'FIXED_AMOUNT', membegoValue: 300 },
      },
      como(ctx.compras)
    )
  )
  // Nace a partes iguales: 1 500 + 1 500.
  const techos = async () => {
    const bs = await prisma.supplyV2Benefit.findMany({ where: { campaignId: c.id }, select: { budgetTotal: true }, orderBy: { code: 'asc' } })
    return bs.map((b) => b.budgetTotal!.toFixed(2))
  }
  assert.deepEqual(await techos(), ['1500.00', '1500.00'])

  // Subir una por encima del techo de la campaña se rechaza (§16).
  await assert.rejects(
    sinEmpresa('prueba', (tx) => ajustarPromocionEnTx(tx, { campaignId: c.id, offerId: ctx.offerId, valueType: 'FIXED_AMOUNT', membegoValue: 300, budgetTotal: 2500 }, como(ctx.compras))),
    /sumarían 4000.00/
  )
  // Rebalanceo válido: 1 000 + 2 000 = 3 000.
  await sinEmpresa('prueba', (tx) => ajustarPromocionEnTx(tx, { campaignId: c.id, offerId: ctx.offerOtra, valueType: 'FIXED_AMOUNT', membegoValue: 300, budgetTotal: 1000 }, como(ctx.compras)))
  await sinEmpresa('prueba', (tx) => ajustarPromocionEnTx(tx, { campaignId: c.id, offerId: ctx.offerId, valueType: 'FIXED_AMOUNT', membegoValue: 300, budgetTotal: 2000, requiresCoupon: true }, como(ctx.compras)))
  const p = await sinEmpresa('prueba', (tx) => presupuestoDeCampanaEnTx(tx, c.id))
  assert.equal(p.comprometido.toFixed(2), '3000.00')

  // Se publica, se vende una vez con el cupón y a partir de ahí el valor se
  // congela: lo que rebajó una compra hecha no se reescribe.
  const benefitId = (await prisma.supplyV2CampaignOffer.findFirstOrThrow({ where: { campaignId: c.id, offerId: ctx.offerId }, select: { benefitId: true } })).benefitId!
  await sinEmpresa('prueba', (tx) => enviarARevisionEnTx(tx, c.id, como(ctx.compras)))
  await sinEmpresa('prueba', (tx) => aprobarCampanaEnTx(tx, c.id, como(ctx.finanzas)))
  await sinEmpresa('prueba', (tx) => publicarCampanaEnTx(tx, c.id, como(ctx.finanzas)))
  const codigo = await cupon({ campaignId: c.id, benefitId, kind: 'PUBLIC', codigo: `REBAL${sufijo.toUpperCase()}` })
  const orden = await comprarConCupon(ctx.offerId, ctx.cliente3, codigo)
  await confirmar(orden.id, orden.total)

  await assert.rejects(
    sinEmpresa('prueba', (tx) => ajustarPromocionEnTx(tx, { campaignId: c.id, offerId: ctx.offerId, valueType: 'FIXED_AMOUNT', membegoValue: 400, budgetTotal: 2000 }, como(ctx.compras))),
    /ya se usó en compras/
  )
  // Y el techo no puede bajar de lo que esa promoción ya movió (300).
  await assert.rejects(
    sinEmpresa('prueba', (tx) => ajustarPromocionEnTx(tx, { campaignId: c.id, offerId: ctx.offerId, valueType: 'FIXED_AMOUNT', membegoValue: 300, budgetTotal: 100 }, como(ctx.compras))),
    /no puede bajar de ahí/
  )
  // Bajar a 500 sí: queda por encima de lo movido y dentro del techo.
  await sinEmpresa('prueba', (tx) => ajustarPromocionEnTx(tx, { campaignId: c.id, offerId: ctx.offerId, valueType: 'FIXED_AMOUNT', membegoValue: 300, budgetTotal: 500, requiresCoupon: true }, como(ctx.compras)))
  const b = await prisma.supplyV2Benefit.findUniqueOrThrow({ where: { id: benefitId }, select: { budgetTotal: true, budgetConsumed: true, membegoValue: true } })
  assert.equal(b.budgetTotal!.toFixed(2), '500.00')
  assert.equal(b.budgetConsumed.toFixed(2), '300.00')
  assert.equal(b.membegoValue.toFixed(2), '300.00', 'el valor de la promoción sigue intacto')
})

// ── A · cupón público con dos clientes (§31 A) ──────────────────────────────

test('A · cupón público: dos clientes lo usan, los límites se respetan y el tercero se queda fuera', async () => {
  const of = await oferta(ctx.itemId, 'Pizza A')
  const c = await campanaConPromocion({ nombre: 'Semana Gastronómica A', funding: 'MEMBEGO', membego: 300, presupuesto: 5000, offerId: of, exigeCupon: true, maxRedemptions: 2, maxPerCustomer: 1 })
  const code = await cupon({ campaignId: c.campaignId, benefitId: c.benefitId, kind: 'PUBLIC', codigo: `COMIDA15${sufijo.toUpperCase()}`, maxRedemptions: 2, maxPerCustomer: 1 })

  const o1 = await comprarConCupon(of, ctx.cliente, code)
  assert.equal(o1.total, '700.00')
  await confirmar(o1.id, '700.00')
  const o2 = await comprarConCupon(of, ctx.cliente2, code)
  await confirmar(o2.id, '700.00')

  const k = await cuponDe(code)
  assert.deepEqual([k.timesRedeemed, k.status], [2, 'EXHAUSTED'], 'al llegar a su tope el cupón se marca agotado solo')
  // El tercer cliente ya no puede: el tope del cupón y el de la campaña están llenos.
  await assert.rejects(comprarConCupon(of, ctx.cliente3, code), /agotó|límite/i)
  // Y el mismo cliente tampoco repite.
  await assert.rejects(comprarConCupon(of, ctx.cliente, code), /agotó|usaste|límite/i)

  // La aplicación del cupón cuelga de la reserva del beneficio: el dinero se
  // cuenta UNA vez, no como un descuento aparte.
  const aplicaciones = await prisma.supplyV2CouponRedemption.findMany({ where: { couponId: k.id }, include: { reservation: true } })
  assert.equal(aplicaciones.length, 2)
  for (const a of aplicaciones) {
    assert.equal(a.status, 'APPLIED')
    assert.equal(a.reservation.status, 'APPLIED')
    assert.equal(a.membegoAmount.toFixed(2), a.reservation.membegoAmount.toFixed(2))
  }
  // Y el presupuesto de la campaña se lee de su promoción, sin segundo contador.
  const p = await sinEmpresa('prueba', (tx) => presupuestoDeCampanaEnTx(tx, c.campaignId))
  assert.equal(p.consumido.toFixed(2), '600.00')
  assert.equal(p.reservado.toFixed(2), '0.00')
})

test('A · una promoción de cupón NO se abre sin el código, ni mandando el id del beneficio', async () => {
  const of = await oferta(ctx.itemId, 'Pizza solo cupón')
  const c = await campanaConPromocion({ nombre: 'Solo con código', funding: 'MEMBEGO', membego: 200, presupuesto: 2000, offerId: of, exigeCupon: true })
  await assert.rejects(
    sinEmpresa('prueba', (tx) => abrirOrdenClienteEnTx(tx, { customerId: ctx.cliente, offerId: of, quantity: 1, benefitId: c.benefitId }, como(ctx.cliente))),
    /se usa con su código/
  )
  // Sin cupón se compra, pero a precio completo.
  const o = await comprarConCupon(of, ctx.cliente, null)
  assert.equal(o.total, '1000.00')
  await sinEmpresa('prueba', (tx) => cancelarOrdenClienteEnTx(tx, o.id, ctx.cliente, como(ctx.cliente)))
})

// ── B · cupón privado (§31 B) ──────────────────────────────────────────────

test('B · cupón privado: el de otra persona se rechaza aunque se sepa el código', async () => {
  const of = await oferta(ctx.itemId, 'Pizza B')
  const c = await campanaConPromocion({ nombre: 'Bienvenida B', funding: 'MEMBEGO', membego: 200, presupuesto: 2000, offerId: of, exigeCupon: true })
  const code = await cupon({ campaignId: c.campaignId, benefitId: c.benefitId, kind: 'PRIVATE', customerIds: [ctx.cliente] })

  await assert.rejects(comprarConCupon(of, ctx.cliente2, code), /no existe o no se puede usar/)
  // El mensaje no distingue «no existe» de «no es tuyo»: quien prueba códigos
  // a mano no puede usar el formulario como un oráculo.
  await assert.rejects(comprarConCupon(of, ctx.cliente2, 'NOEXISTE9999'), /no existe o no se puede usar/)
  // Su dueño sí lo usa.
  const o = await comprarConCupon(of, ctx.cliente, code)
  assert.equal(o.total, '800.00')
  await confirmar(o.id, '800.00')
  assert.equal((await cuponDe(code)).timesRedeemed, 1)
  // Un cupón privado SIEMPRE tiene dueño: la base lo sostiene.
  await assert.rejects(prisma.$executeRaw`UPDATE "supply_v2_coupons" SET "customerId" = NULL WHERE "code" = ${code}`, /supply_v2_coupons_limits/)
})

// ── C · el último uso bajo concurrencia (§31 C) ────────────────────────────

test('C · dos clientes a la vez por el último uso del cupón: solo uno pasa', async () => {
  const of = await oferta(ctx.itemId, 'Pizza C')
  const c = await campanaConPromocion({ nombre: 'Último uso C', funding: 'MEMBEGO', membego: 250, presupuesto: 5000, offerId: of, exigeCupon: true, maxRedemptions: 10, maxPerCustomer: 1 })
  const code = await cupon({ campaignId: c.campaignId, benefitId: c.benefitId, kind: 'PUBLIC', maxRedemptions: 1, maxPerCustomer: 1 })

  const res = await Promise.allSettled([comprarConCupon(of, ctx.cliente, code), comprarConCupon(of, ctx.cliente2, code)])
  const ok = res.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
  assert.equal(ok.length, 1, 'el candado del cupón serializa los dos checkouts')
  const fallo = res.find((r) => r.status === 'rejected') as PromiseRejectedResult
  assert.match(String(fallo.reason), /límite|agot/i)
  assert.equal(await prisma.supplyV2CouponRedemption.count({ where: { coupon: { code }, status: { in: ['RESERVED', 'APPLIED'] } } }), 1)
})

// ── D · presupuesto al límite bajo concurrencia (§31 D) ────────────────────

test('D · dos compras simultáneas por el saldo final del presupuesto: ninguna lo sobregira', async () => {
  const of = await oferta(ctx.itemId, 'Pizza D')
  // Presupuesto para una sola aplicación de 300.
  const c = await campanaConPromocion({ nombre: 'Presupuesto D', funding: 'MEMBEGO', membego: 300, presupuesto: 300, offerId: of, maxPerCustomer: 1, maxRedemptions: 10 })
  const res = await Promise.allSettled([comprarConCupon(of, ctx.cliente, null), comprarConCupon(of, ctx.cliente2, null)])
  const ok = res.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
  // Sin cupón, la promoción se aplica sola: una pasa con rebaja y la otra
  // tendría que quedarse sin presupuesto.
  const conRebaja = (await Promise.all(ok.map(async (o) => (await ordenDe(o.id)).membegoSubsidyTotal.toFixed(2)))).filter((t) => t !== '0.00')
  assert.equal(conRebaja.length, 1, 'solo una compra consume el presupuesto')
  const p = await sinEmpresa('prueba', (tx) => presupuestoDeCampanaEnTx(tx, c.campaignId))
  assert.equal(p.reservado.plus(p.consumido).toFixed(2), '300.00', 'ni un peso por encima del techo')
  // La base es la última palabra.
  await assert.rejects(prisma.$executeRaw`UPDATE "supply_v2_benefits" SET "budgetConsumed" = 400 WHERE "id" = ${c.benefitId}`, /supply_v2_benefits_budget/)
  for (const o of ok) await sinEmpresa('prueba', (tx) => cancelarOrdenClienteEnTx(tx, o.id, (o.id === ok[0]!.id ? ctx.cliente : ctx.cliente2), como(null)).catch(() => undefined))
})

// ── E · cancelación y expiración (§31 E) ───────────────────────────────────

test('E · el checkout vencido libera el cupón y el presupuesto, sin duplicar nada', async () => {
  const of = await oferta(ctx.itemId, 'Pizza E')
  const c = await campanaConPromocion({ nombre: 'Liberación E', funding: 'MEMBEGO', membego: 300, presupuesto: 3000, offerId: of, exigeCupon: true, maxPerCustomer: 2 })
  const code = await cupon({ campaignId: c.campaignId, benefitId: c.benefitId, kind: 'PUBLIC', maxRedemptions: 5, maxPerCustomer: 2 })

  const o = await comprarConCupon(of, ctx.cliente, code)
  let p = await sinEmpresa('prueba', (tx) => presupuestoDeCampanaEnTx(tx, c.campaignId))
  assert.equal(p.reservado.toFixed(2), '300.00')
  assert.equal((await prisma.supplyV2CouponRedemption.findFirstOrThrow({ where: { orderId: o.id } })).status, 'RESERVED')

  // Expira el checkout: se devuelven las dos cosas.
  await sinEmpresa('prueba', (tx) => expirarOrdenEnTx(tx, o.id, como(null), new Date(ahora.getTime() + 2 * DIA)))
  p = await sinEmpresa('prueba', (tx) => presupuestoDeCampanaEnTx(tx, c.campaignId))
  assert.equal(p.reservado.toFixed(2), '0.00')
  assert.equal(p.consumido.toFixed(2), '0.00', 'expirar no consume presupuesto')
  assert.equal((await prisma.supplyV2CouponRedemption.findFirstOrThrow({ where: { orderId: o.id } })).status, 'RELEASED')
  assert.equal((await cuponDe(code)).timesRedeemed, 0, 'el uso vuelve: el cliente no pierde su cupón por no pagar')

  // Y el cupón se puede volver a usar.
  const o2 = await comprarConCupon(of, ctx.cliente, code)
  await confirmar(o2.id, '700.00')
  assert.equal((await cuponDe(code)).timesRedeemed, 1)
  // Cancelar una compra pagada no se puede desde aquí; cancelar la reserva sí
  // libera, y los movimientos del presupuesto no se duplican.
  const movs = await prisma.supplyV2BenefitMovement.findMany({ where: { benefitId: c.benefitId }, select: { type: true, reservedDelta: true, consumedDelta: true } })
  const reservado = movs.reduce((t, m) => t.plus(m.reservedDelta), D(0))
  const consumido = movs.reduce((t, m) => t.plus(m.consumedDelta), D(0))
  assert.equal(reservado.toFixed(2), '0.00')
  assert.equal(consumido.toFixed(2), '300.00')
})

test('E · un cupón en un checkout en curso no se puede cancelar a la ligera', async () => {
  const of = await oferta(ctx.itemId, 'Pizza E2')
  const c = await campanaConPromocion({ nombre: 'Cancelar E2', funding: 'MEMBEGO', membego: 100, presupuesto: 1000, offerId: of, exigeCupon: true })
  const code = await cupon({ campaignId: c.campaignId, benefitId: c.benefitId, kind: 'PUBLIC' })
  const o = await comprarConCupon(of, ctx.cliente, code)
  const k = await cuponDe(code)
  await assert.rejects(sinEmpresa('prueba', (tx) => cancelarCuponEnTx(tx, k.id, 'ya no', como(ctx.finanzas))), /checkout en curso/)
  // Y la campaña tampoco se cancela con reservas vivas.
  await assert.rejects(sinEmpresa('prueba', (tx) => cancelarCampanaEnTx(tx, c.campaignId, 'ya no', como(ctx.finanzas))), /checkout\(s\) en curso/)
  await sinEmpresa('prueba', (tx) => cancelarOrdenClienteEnTx(tx, o.id, ctx.cliente, como(ctx.cliente)))
  await sinEmpresa('prueba', (tx) => cancelarCuponEnTx(tx, k.id, 'campaña corregida', como(ctx.finanzas)))
  assert.equal((await cuponDe(code)).status, 'CANCELLED')
  await assert.rejects(comprarConCupon(of, ctx.cliente, code), /canceló|no se puede usar/)
})

// ── F · economía de la demostración del enunciado (§31 F, DEMOSTRACIÓN) ────

test('F · DEMOSTRACIÓN: 1 000 − 100 (proveedor) − 300 (Membego) → paga 600, contractual 900, comisión 72, neto 828', async () => {
  const of = await oferta(ctx.itemId, 'Pizza Semana Gastronómica')
  const c = await campanaConPromocion({ nombre: 'Semana Gastronómica Membego', funding: 'SHARED', membego: 300, proveedor: 100, presupuesto: 3000, offerId: of, exigeCupon: true, maxPerCustomer: 1 })
  const code = await cupon({ campaignId: c.campaignId, benefitId: c.benefitId, kind: 'PUBLIC', codigo: `GASTRO${sufijo.toUpperCase()}` })

  const o = await comprarConCupon(of, ctx.cliente, code)
  assert.equal(o.total, '600.00')
  const pago = await confirmar(o.id, '600.00')
  const orden = await ordenDe(o.id)
  assert.deepEqual(
    [orden.total.toFixed(2), orden.contractualValue.toFixed(2), orden.supplierDiscountTotal.toFixed(2), orden.membegoSubsidyTotal.toFixed(2), orden.commissionAmount?.toFixed(2), orden.supplierNet?.toFixed(2)],
    ['600.00', '900.00', '100.00', '300.00', '72.00', '828.00']
  )
  // La atribución queda CONGELADA en el pedido, con la campaña y el cupón.
  assert.equal(orden.campaignId, c.campaignId)
  assert.equal(orden.couponCodeSnapshot, code)

  // El derecho, el QR y la entrega son los de siempre.
  const entitlementId = pago.entitlements[0]!.id
  const d = await prisma.supplyV2Entitlement.findUniqueOrThrow({ where: { id: entitlementId } })
  assert.deepEqual([d.status, d.customerUnitPrice.toFixed(2), d.contractualUnitValue.toFixed(2), d.supplierNet?.toFixed(2)], ['ACTIVE', '600.00', '900.00', '828.00'])
  const redencionId = await redimir(entitlementId, ctx.cliente)
  assert.equal((await prisma.supplyV2Entitlement.findUniqueOrThrow({ where: { id: entitlementId } })).status, 'REDEEMED')

  // La obligación con el proveedor es el neto CONTRACTUAL: 828, no 600.
  const ob = await prisma.supplyV2SupplierObligation.findUniqueOrThrow({ where: { redemptionId: redencionId } })
  assert.equal(ob.outstandingAmount.toFixed(2), '828.00')

  // Economía: el descuento del proveedor y el subsidio de Membego, cada uno
  // por su nombre, y la contribución tras el subsidio puede ser negativa.
  const e = await calcularEconomia({ ventana: 'RANGO', desde: new Date(ahora.getTime() - DIA), hasta: new Date(ahora.getTime() + DIA), supplierId: ctx.supplierId })
  assert.ok(e.supplierDiscount.greaterThanOrEqualTo(100))
  assert.ok(e.membegoSubsidy.greaterThanOrEqualTo(300))
  assert.equal(e.promotionalCost.toFixed(2), e.membegoSubsidy.toFixed(2))
  assert.equal(e.contributionAfterSubsidy.toFixed(2), e.grossMargin.minus(e.membegoSubsidy).toFixed(2))

  // Y la campaña registra EXACTAMENTE una venta con sus cifras.
  const ficha = await fichaCampana(c.campaignId)
  assert.equal(ficha!.metricas.ventasConfirmadas, 1)
  assert.equal(ficha!.metricas.gmv, '1000.00')
  assert.equal(ficha!.metricas.valorContractual, '900.00')
  assert.equal(ficha!.metricas.aportacionProveedor, '100.00')
  assert.equal(ficha!.metricas.subsidioMembego, '300.00')
  assert.equal(ficha!.metricas.cobradoAlCliente, '600.00')
  assert.equal(ficha!.metricas.comision, '72.00')
  assert.equal(ficha!.metricas.netoProveedor, '828.00')
  assert.equal(ficha!.metricas.derechosEmitidos, 1)
  assert.equal(ficha!.metricas.derechosRedimidos, 1)
  assert.equal(ficha!.metricas.contribucionTrasSubsidio, '-228.00', 'comisión 72 − subsidio 300')
})

// ── G · comisión y liquidación de una venta de campaña (§31 G) ─────────────

test('G · la venta de campaña genera la obligación contractual y se liquida por ella', async () => {
  const periodo = { periodStart: new Date(ahora.getTime() - 7 * DIA), periodEnd: new Date(ahora.getTime() + 7 * DIA) }
  const l = await sinEmpresa('prueba', (tx) => generarLiquidacionEnTx(tx, { supplierId: ctx.supplierId, frequency: 'MANUAL', ...periodo }, como(ctx.compras)))
  const liq = await prisma.supplyV2Settlement.findUniqueOrThrow({ where: { id: l.id }, include: { lines: true } })
  const conDescuento = liq.lines.find((x) => x.supplierDiscountAmount.greaterThan(0))
  assert.ok(conDescuento, 'la entrega de la campaña compartida está en la liquidación')
  assert.equal(conDescuento!.contractualAmount.toFixed(2), '900.00')
  assert.equal(conDescuento!.supplierDiscountAmount.toFixed(2), '100.00')
  assert.equal(conDescuento!.membegoSubsidyAmount.toFixed(2), '300.00')
  assert.equal(conDescuento!.customerPaidAmount.toFixed(2), '600.00')
  assert.equal(conDescuento!.grossAmount.toFixed(2), '1000.00', 'GMV = contractual + descuento del proveedor')
  assert.equal(conDescuento!.supplierNet.toFixed(2), '828.00', 'el bono de Membego no rebaja el neto del proveedor')
  // La identidad de la línea cierra, con lo ya adelantado en su sitio.
  assert.equal(
    conDescuento!.grossAmount.minus(conDescuento!.supplierDiscountAmount).minus(conDescuento!.commissionAmount).minus(conDescuento!.alreadyPaidAmount).toFixed(2),
    conDescuento!.supplierNet.toFixed(2)
  )
})

// ── H · atribución sin GMV duplicado (§31 H) ───────────────────────────────

test('H · una oferta en DOS campañas: el pedido se atribuye a una sola y el GMV no se duplica', async () => {
  const of = await oferta(ctx.itemId, 'Pizza H')
  const c1 = await campanaConPromocion({ nombre: 'H primera', funding: 'MEMBEGO', membego: 400, presupuesto: 4000, offerId: of, maxPerCustomer: 1 })
  const c2 = await campanaConPromocion({ nombre: 'H segunda', funding: 'MEMBEGO', membego: 200, presupuesto: 2000, offerId: of, maxPerCustomer: 1 })

  const o = await comprarConCupon(of, ctx.cliente3, null)
  await confirmar(o.id, (await ordenDe(o.id)).total.toFixed(2))
  const orden = await ordenDe(o.id)
  // Se aplicó UNA promoción y el pedido pertenece a UNA campaña.
  assert.ok(orden.campaignId === c1.campaignId || orden.campaignId === c2.campaignId)
  assert.equal(await prisma.supplyV2BenefitReservation.count({ where: { orderId: o.id, status: 'APPLIED' } }), 1)

  const f1 = await fichaCampana(c1.campaignId)
  const f2 = await fichaCampana(c2.campaignId)
  const enUna = f1!.metricas.pedidos + f2!.metricas.pedidos
  assert.equal(enUna, 1, 'el pedido aparece en una sola campaña, no en las dos')
  const gmv = Number(f1!.metricas.gmv) + Number(f2!.metricas.gmv)
  assert.equal(gmv, 1000, 'el GMV no se cuenta dos veces')
})

// ── I · compatibilidad con los Slices anteriores (§31 I) ───────────────────

test('I · un pedido SIN campaña funciona igual que antes: nada congelado, nada atribuido', async () => {
  const of = await oferta(ctx.itemId, 'Pizza I')
  const o = await comprarConCupon(of, ctx.cliente, null)
  assert.equal(o.total, '1000.00')
  const pago = await confirmar(o.id, '1000.00')
  const orden = await ordenDe(o.id)
  assert.deepEqual(
    [orden.campaignId, orden.couponCodeSnapshot, orden.contractualValue.toFixed(2), orden.membegoSubsidyTotal.toFixed(2), orden.supplierDiscountTotal.toFixed(2), orden.commissionAmount?.toFixed(2), orden.supplierNet?.toFixed(2)],
    [null, null, '1000.00', '0.00', '0.00', '80.00', '920.00']
  )
  const d = await prisma.supplyV2Entitlement.findUniqueOrThrow({ where: { id: pago.entitlements[0]!.id } })
  assert.deepEqual([d.customerUnitPrice.toFixed(2), d.contractualUnitValue.toFixed(2)], ['1000.00', '1000.00'])
  assert.equal(await prisma.supplyV2CouponRedemption.count({ where: { orderId: o.id } }), 0)
})

// ── J · reversas y liquidaciones ya pagadas (§31 J) ────────────────────────

test('J · cancelar una campaña no toca las liquidaciones ni las entregas ya hechas', async () => {
  const of = await oferta(ctx.itemId, 'Pizza J')
  const c = await campanaConPromocion({ nombre: 'Cierre J', funding: 'MEMBEGO', membego: 200, presupuesto: 2000, offerId: of, maxPerCustomer: 1 })
  const o = await comprarConCupon(of, ctx.cliente2, null)
  const pago = await confirmar(o.id, '800.00')
  const redencionId = await redimir(pago.entitlements[0]!.id, ctx.cliente2)
  const obAntes = await prisma.supplyV2SupplierObligation.findUniqueOrThrow({ where: { redemptionId: redencionId } })

  await sinEmpresa('prueba', (tx) => cancelarCampanaEnTx(tx, c.campaignId, 'cerramos la campaña antes de tiempo', como(ctx.finanzas)))
  const campana = await prisma.supplyV2Campaign.findUniqueOrThrow({ where: { id: c.campaignId } })
  assert.equal(campana.status, 'CANCELLED')
  // Lo aplicado queda aplicado: el presupuesto consumido no se devuelve solo.
  const p = await sinEmpresa('prueba', (tx) => presupuestoDeCampanaEnTx(tx, c.campaignId))
  assert.equal(p.consumido.toFixed(2), '200.00')
  // Y la obligación con el proveedor sigue intacta, importe incluido.
  const obDespues = await prisma.supplyV2SupplierObligation.findUniqueOrThrow({ where: { redemptionId: redencionId } })
  assert.deepEqual([obDespues.status, obDespues.outstandingAmount.toFixed(2)], [obAntes.status, obAntes.outstandingAmount.toFixed(2)])
  // El derecho entregado tampoco se toca.
  assert.equal((await prisma.supplyV2Entitlement.findUniqueOrThrow({ where: { id: pago.entitlements[0]!.id } })).status, 'REDEEMED')
  // Sus promociones y cupones vivos quedan cerrados, así que no se puede seguir comprando con ellos.
  assert.equal((await prisma.supplyV2Benefit.findUniqueOrThrow({ where: { id: c.benefitId } })).status, 'CANCELLED')
  await assert.rejects(comprarConCupon(of, ctx.cliente3, null).then(async (x) => {
    const t = (await ordenDe(x.id)).membegoSubsidyTotal.toFixed(2)
    if (t !== '0.00') throw new Error(`la promoción cancelada siguió rebajando ${t}`)
    await sinEmpresa('prueba', (tx) => cancelarOrdenClienteEnTx(tx, x.id, ctx.cliente3, como(ctx.cliente3)))
    throw new Error('SIN_REBAJA')
  }), /SIN_REBAJA/)
})

test('J · pausar la campaña quita la promoción del checkout y reactivarla la devuelve', async () => {
  const of = await oferta(ctx.itemId, 'Pizza pausa')
  const c = await campanaConPromocion({ nombre: 'Pausa', funding: 'MEMBEGO', membego: 150, presupuesto: 1500, offerId: of, maxPerCustomer: 3 })
  const conRebaja = await comprarConCupon(of, ctx.cliente, null)
  assert.equal(conRebaja.total, '850.00')
  await sinEmpresa('prueba', (tx) => cancelarOrdenClienteEnTx(tx, conRebaja.id, ctx.cliente, como(ctx.cliente)))

  await sinEmpresa('prueba', (tx) => pausarCampanaEnTx(tx, c.campaignId, como(ctx.compras)))
  assert.equal((await prisma.supplyV2Benefit.findUniqueOrThrow({ where: { id: c.benefitId } })).status, 'PAUSED', 'la promoción se pausa con su campaña')
  const sinRebaja = await comprarConCupon(of, ctx.cliente, null)
  assert.equal(sinRebaja.total, '1000.00', 'pausada no rebaja nada')
  await sinEmpresa('prueba', (tx) => cancelarOrdenClienteEnTx(tx, sinRebaja.id, ctx.cliente, como(ctx.cliente)))

  const { reanudarCampanaEnTx } = await import('../../src/modules/supply-v2/campaigns/service')
  await sinEmpresa('prueba', (tx) => reanudarCampanaEnTx(tx, c.campaignId, como(ctx.compras)))
  const otra = await comprarConCupon(of, ctx.cliente, null)
  assert.equal(otra.total, '850.00')
  await sinEmpresa('prueba', (tx) => cancelarOrdenClienteEnTx(tx, otra.id, ctx.cliente, como(ctx.cliente)))
})

// ── Vigencia, horario y barrido (§7) ───────────────────────────────────────

test('la vigencia la decide el SERVIDOR en cada compra, no el cron', async () => {
  const of = await oferta(ctx.itemId, 'Pizza horario')
  // Una ventana de un minuto que NO incluye el minuto actual: la campaña está
  // ACTIVA y vigente por fecha, y aun así la promoción no se aplica porque el
  // servidor comprueba la hora en cada compra (el cron no la protege).
  const ahoraLocal = minutosLocales(ahora)
  const desde = (ahoraLocal + 120) % 1439
  const c = await campanaConPromocion({ nombre: 'Fuera de horario', funding: 'MEMBEGO', membego: 300, presupuesto: 3000, offerId: of, exigeCupon: true, activeFromMinute: desde, activeToMinute: desde + 1 })
  const code = await cupon({ campaignId: c.campaignId, benefitId: c.benefitId, kind: 'PUBLIC' })
  const r = await sinEmpresa('prueba', (tx) =>
    resolverCuponEnTx(tx, { codigo: code, customerId: ctx.cliente, oferta: { id: of, salePrice: D(1000), currency: 'DOP' }, quantity: 1 })
  )
  assert.equal(r.motivo, 'FUERA_DE_HORARIO')
  // Y comprar con ese cupón se para por lo mismo, no por otra razón.
  await assert.rejects(comprarConCupon(of, ctx.cliente, code), /solo vale en su horario/)

  // Una campaña vencida la cierra el barrido, y mientras tanto no se aplica.
  const vencida = await campanaConPromocion({ nombre: 'Vencida', funding: 'MEMBEGO', membego: 100, presupuesto: 1000, offerId: of, endsAt: new Date(ahora.getTime() + 60_000) })
  const barrido = await sinEmpresa('prueba', (tx) => barridoCampanasEnTx(tx, como(null), new Date(ahora.getTime() + DIA)))
  assert.ok(barrido.terminadas >= 1)
  const cerrada = await prisma.supplyV2Campaign.findUniqueOrThrow({ where: { id: vencida.campaignId } })
  assert.equal(cerrada.status, 'COMPLETED')
  assert.equal((await prisma.supplyV2Benefit.findUniqueOrThrow({ where: { id: vencida.benefitId } })).status, 'EXPIRED')
  // Completar dos veces no hace nada: es idempotente.
  assert.equal(await sinEmpresa('prueba', (tx) => completarCampanaEnTx(tx, vencida.campaignId, como(null), new Date(ahora.getTime() + DIA))), false)
})

test('una campaña programada se activa por el barrido cuando llega su fecha', async () => {
  const of = await oferta(ctx.itemId, 'Pizza programada')
  const c = await sinEmpresa('prueba', (tx) =>
    crearCampanaEnTx(tx, { name: `Programada ${sufijo}`, organizer: 'MEMBEGO', funding: 'MEMBEGO', budgetTotal: 1000, audience: 'ALL', startsAt: new Date(ahora.getTime() + 2 * DIA), endsAt: new Date(ahora.getTime() + 30 * DIA) }, como(ctx.compras))
  )
  await sinEmpresa('prueba', (tx) => agregarOfertaEnTx(tx, { campaignId: c.id, offerId: of }, como(ctx.compras)))
  await sinEmpresa('prueba', (tx) => adjuntarPromocionEnTx(tx, { campaignId: c.id, offerId: of, valueType: 'FIXED_AMOUNT', membegoValue: 100, budgetTotal: 1000 }, como(ctx.compras)))
  await sinEmpresa('prueba', (tx) => enviarARevisionEnTx(tx, c.id, como(ctx.compras)))
  await sinEmpresa('prueba', (tx) => aprobarCampanaEnTx(tx, c.id, como(ctx.finanzas)))
  const pub = await sinEmpresa('prueba', (tx) => publicarCampanaEnTx(tx, c.id, como(ctx.finanzas)))
  assert.equal(pub.status, 'SCHEDULED', 'publicar no adelanta la vigencia')
  // Programada: todavía no rebaja nada.
  const antes = await comprarConCupon(of, ctx.cliente2, null)
  assert.equal(antes.total, '1000.00')
  await sinEmpresa('prueba', (tx) => cancelarOrdenClienteEnTx(tx, antes.id, ctx.cliente2, como(ctx.cliente2)))
  const r = await sinEmpresa('prueba', (tx) => barridoCampanasEnTx(tx, como(null), new Date(ahora.getTime() + 3 * DIA)))
  assert.ok(r.activadas >= 1)
  assert.equal((await prisma.supplyV2Campaign.findUniqueOrThrow({ where: { id: c.id } })).status, 'ACTIVE')
})

// ── Público objetivo y «Mis cupones» (§13, §21) ────────────────────────────

test('público objetivo: un cupón de bienvenida no vale para quien ya compró', async () => {
  const of = await oferta(ctx.itemId, 'Pizza bienvenida')
  const c = await campanaConPromocion({ nombre: 'Bienvenida pública', funding: 'MEMBEGO', membego: 200, presupuesto: 2000, offerId: of, exigeCupon: true, audience: 'NEW_CUSTOMERS' })
  const code = await cupon({ campaignId: c.campaignId, benefitId: c.benefitId, kind: 'PUBLIC', maxRedemptions: 50 })
  // `ctx.cliente` ya compró en pruebas anteriores: queda fuera del público.
  assert.ok((await prisma.supplyV2CustomerOrder.count({ where: { customerId: ctx.cliente, status: 'PAID' } })) > 0)
  await assert.rejects(comprarConCupon(of, ctx.cliente, code), /otro grupo de clientes/)
})

test('«Mis cupones» del cliente: lo que tiene, por qué no puede usar alguno, y nunca presupuesto', async () => {
  const of = await oferta(ctx.itemId, 'Pizza mis cupones')
  const c = await campanaConPromocion({ nombre: 'Mis cupones', funding: 'MEMBEGO', membego: 150, presupuesto: 1500, offerId: of, exigeCupon: true })
  const mio = await cupon({ campaignId: c.campaignId, benefitId: c.benefitId, kind: 'PRIVATE', customerIds: [ctx.cliente2] })
  const ajeno = await cupon({ campaignId: c.campaignId, benefitId: c.benefitId, kind: 'PRIVATE', customerIds: [ctx.cliente3] })

  const mios = await misCupones(ctx.cliente2)
  assert.ok(mios.some((k) => k.code === mio), 'mi cupón privado aparece')
  assert.ok(!mios.some((k) => k.code === ajeno), 'el cupón de otra persona NO aparece')
  for (const k of mios) {
    assert.ok(!Object.keys(k).some((x) => /budget|presupuesto/i.test(x)), `el DTO del cliente no habla de presupuesto (${k.code})`)
  }
  const elMio = mios.find((k) => k.code === mio)!
  assert.equal(elMio.usable, true)
  assert.ok(elMio.ofertas.length > 0, 'dice dónde usarlo')
})

// ── Generación de cupones (§10) ────────────────────────────────────────────

test('generación: un lote aleatorio deja rastro, los códigos no se repiten y el formato se valida', async () => {
  const of = await oferta(ctx.itemId, 'Pizza lote')
  const c = await campanaConPromocion({ nombre: 'Lote', funding: 'MEMBEGO', membego: 100, presupuesto: 5000, offerId: of, exigeCupon: true })
  const r = await sinEmpresa('prueba', (tx) =>
    generarCuponesEnTx(tx, { campaignId: c.campaignId, benefitId: c.benefitId, kind: 'PUBLIC', cantidad: 25, prefijo: 'BIENVENIDO', lote: 'Lote de bienvenida', maxPerCustomer: 1 }, como(ctx.compras))
  )
  assert.equal(r.generados, 25)
  assert.equal(new Set(r.codigos).size, 25, 'ningún código repetido')
  assert.ok(r.codigos.every((x) => x.startsWith('BIENVENIDO')))
  const lote = await prisma.supplyV2CampaignDistribution.findUniqueOrThrow({ where: { id: r.distributionId! } })
  assert.deepEqual([lote.requested, lote.generated, lote.prefix], [25, 25, 'BIENVENIDO'])

  // Un código a medida repetido se avisa, no se duplica en silencio.
  const code = `UNICO${sufijo.toUpperCase()}`
  await cupon({ campaignId: c.campaignId, benefitId: c.benefitId, kind: 'PUBLIC', codigo: code })
  await assert.rejects(cupon({ campaignId: c.campaignId, benefitId: c.benefitId, kind: 'PUBLIC', codigo: code }), /ya existe/)
  // Y el mismo código en minúsculas es el MISMO cupón, no otro.
  await assert.rejects(cupon({ campaignId: c.campaignId, benefitId: c.benefitId, kind: 'PUBLIC', codigo: code.toLowerCase() }), /ya existe/)
  // Formato: menos de cuatro caracteres no es un código.
  await assert.rejects(cupon({ campaignId: c.campaignId, benefitId: c.benefitId, kind: 'PUBLIC', codigo: 'AB' }), /entre 4 y 32/)
  // Un cupón no puede abrir la promoción de otra campaña.
  const otra = await campanaConPromocion({ nombre: 'Otra campaña', funding: 'MEMBEGO', membego: 100, presupuesto: 1000, offerId: ctx.offerOtra })
  await assert.rejects(cupon({ campaignId: c.campaignId, benefitId: otra.benefitId, kind: 'PUBLIC' }), /no es de esta campaña/)
})

test('asignar una campaña a un cliente es idempotente: un reintento no duplica asignaciones', async () => {
  const of = await oferta(ctx.itemId, 'Pizza asignada')
  const c = await campanaConPromocion({ nombre: 'Asignada', funding: 'MEMBEGO', membego: 250, presupuesto: 2500, offerId: of, requiereAsignacion: true, audience: 'SELECTED' })
  const primera = await sinEmpresa('prueba', (tx) => asignarCampanaAClienteEnTx(tx, { campaignId: c.campaignId, customerId: ctx.cliente3 }, como(ctx.compras)))
  assert.equal(primera.asignados, 1)
  const segunda = await sinEmpresa('prueba', (tx) => asignarCampanaAClienteEnTx(tx, { campaignId: c.campaignId, customerId: ctx.cliente3 }, como(ctx.compras)))
  assert.deepEqual([segunda.asignados, segunda.repetidos], [0, 1])
  assert.equal(await prisma.supplyV2CustomerBenefit.count({ where: { benefit: { campaignId: c.campaignId }, customerId: ctx.cliente3 } }), 1)
  // Y quien no está en la lista no la puede usar.
  await assert.rejects(
    sinEmpresa('prueba', (tx) => abrirOrdenClienteEnTx(tx, { customerId: ctx.cliente, offerId: of, quantity: 1, benefitId: c.benefitId }, como(ctx.cliente))),
    /no está en tu cuenta/
  )
})

test('la base sostiene los topes del cupón y la forma de la campaña', async () => {
  const unico = await prisma.$queryRaw<{ indexname: string }[]>`SELECT indexname FROM pg_indexes WHERE tablename = 'supply_v2_coupons' AND indexname = 'supply_v2_coupons_code_upper'`
  assert.equal(unico.length, 1, 'el índice único que ignora mayúsculas existe')
  const viva = await prisma.$queryRaw<{ indexname: string }[]>`SELECT indexname FROM pg_indexes WHERE tablename = 'supply_v2_coupon_redemptions' AND indexname = 'supply_v2_coupon_redemptions_viva_por_cliente'`
  assert.equal(viva.length, 1, 'el índice parcial contra dos aplicaciones vivas existe')
  const k = await prisma.supplyV2Coupon.findFirstOrThrow({ orderBy: { createdAt: 'desc' }, select: { id: true } })
  await assert.rejects(prisma.$executeRaw`UPDATE "supply_v2_coupons" SET "timesRedeemed" = 99, "maxRedemptions" = 1 WHERE "id" = ${k.id}`, /supply_v2_coupons_limits/)
  await assert.rejects(prisma.$executeRaw`UPDATE "supply_v2_coupons" SET "maxPerCustomer" = 0 WHERE "id" = ${k.id}`, /supply_v2_coupons_limits/)
})
