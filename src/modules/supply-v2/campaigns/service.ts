import { Prisma } from '@prisma/client'
import type { SupplyV2CampaignEventType } from '@prisma/client'
import type { Tx } from '@/lib/tenant'
import { auditarEnTx, type ContextoAuditoria } from '../core/auditoria'
import { decimal, redondear2 } from '../core/dinero'
import { fallo } from '../core/errores'
import { exigirTransicion } from '../core/estados'
import { siguienteNumero } from '../core/numeracion'
import { esAutoaprobacion, MOTIVO_AUTOAPROBACION } from '../core/segregacion'
import { crearBeneficioEnTx, type BeneficioCreado } from '../benefits/service'
import { calcularRepartoLinea } from '../core/financiacion'
import type { Decimal } from '../core/dinero'
import { validarBeneficio, type DatosBeneficio } from '../benefits/domain'
import {
  cabeEnElPresupuesto,
  CAMPANA_CERRADA,
  estadoAlPublicar,
  presupuestoDeCampana,
  TRANSICIONES_CAMPANA,
  validarCampana,
  type DatosCampana,
} from './domain'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 7 · CAMPAÑAS: servicios transaccionales (§4–§17, §23).
 *
 * TODO dentro de la `tx` de quien llama. La campaña no mueve dinero por su
 * cuenta: crea y agrupa BENEFICIOS del Slice 6, y el dinero lo mueven ellos
 * con su ledger y sus candados. Aquí se gobierna el CICLO DE VIDA (borrador →
 * revisión → publicada → pausada → terminada) y el TECHO del presupuesto.
 *
 * Orden de candados cuando hay que tocar varias cosas: CAMPAÑA (`FOR UPDATE`)
 * → beneficio → asignación. El mismo orden que el Slice 6 extendido por
 * arriba, así que no hay abrazo mortal con un checkout en curso.
 */

const CERO = new Prisma.Decimal(0)

async function bloquearCampana(tx: Tx, campaignId: string) {
  await tx.$queryRaw`SELECT "id" FROM "supply_v2_campaigns" WHERE "id" = ${campaignId} FOR UPDATE`
  const c = await tx.supplyV2Campaign.findUnique({
    where: { id: campaignId },
    include: { supplier: { select: { companyId: true, commercialName: true } }, benefits: { select: { id: true, status: true, budgetTotal: true, budgetReserved: true, budgetConsumed: true } } },
  })
  if (!c) fallo('CAMPANA_NO_ENCONTRADA', 'La campaña no existe.')
  return c
}

/** Bitácora propia de la campaña (§29): con esto se reconstruye la operación. */
async function evento(tx: Tx, campaignId: string, type: SupplyV2CampaignEventType, detail: string | null, payload: Prisma.InputJsonValue | null, actorId: string | null): Promise<void> {
  await tx.supplyV2CampaignEvent.create({ data: { campaignId, type, detail, payload: payload ?? undefined, actorId } })
}

// ── Alta (§4, §17, §23) ─────────────────────────────────────────────────────

export interface CampanaCreada {
  id: string
  code: string
  status: string
}

export async function crearCampanaEnTx(tx: Tx, d: DatosCampana, ctx: ContextoAuditoria): Promise<CampanaCreada> {
  if (!ctx.actorId) fallo('SIN_ACTOR', 'Una campaña necesita quién la crea.')
  const error = validarCampana(d)
  if (error) fallo('CAMPANA_INVALIDA', error)

  let currency = 'DOP'
  let companyId: string | null = null
  if (d.supplierId) {
    const s = await tx.supplyV2Supplier.findUnique({ where: { id: d.supplierId }, select: { id: true, status: true, currency: true, companyId: true } })
    if (!s) fallo('PROVEEDOR_NO_ENCONTRADO', 'El proveedor no existe.')
    if (s.status !== 'ACTIVE') fallo('PROVEEDOR_INACTIVO', 'El proveedor no está activo.')
    currency = s.currency
    companyId = s.companyId
  }

  const sinTope = d.budgetTotal == null || d.budgetTotal === ''
  const code = await siguienteNumero(tx, 'MBG-CP', async (prefijo) => {
    const u = await tx.supplyV2Campaign.findFirst({ where: { code: { startsWith: prefijo } }, orderBy: { code: 'desc' }, select: { code: true } })
    return u?.code ?? null
  }, d.startsAt)

  const c = await tx.supplyV2Campaign.create({
    data: {
      code,
      name: d.name.trim(),
      description: d.description?.trim() || null,
      objective: d.objective?.trim() || null,
      organizer: d.organizer,
      supplierId: d.supplierId ?? null,
      funding: d.funding,
      currency,
      budgetTotal: sinTope ? null : redondear2(decimal(d.budgetTotal!)),
      // §17 · sin techo solo con autorización escrita, y queda quién la dio.
      ...(sinTope && d.funding !== 'SUPPLIER'
        ? { budgetWaiverReason: d.budgetWaiverReason!.trim(), budgetWaiverById: ctx.actorId, budgetWaiverAt: new Date() }
        : {}),
      audience: d.audience,
      startsAt: d.startsAt,
      endsAt: d.endsAt ?? null,
      activeFromMinute: d.activeFromMinute ?? null,
      activeToMinute: d.activeToMinute ?? null,
      maxRedemptions: d.maxRedemptions ?? null,
      maxPerCustomer: d.maxPerCustomer ?? 1,
      status: 'DRAFT',
      createdById: ctx.actorId,
    },
    select: { id: true, code: true, status: true },
  })
  await evento(tx, c.id, 'CREATED', `Campaña creada como borrador (${d.organizer === 'SUPPLIER' ? 'propuesta del proveedor' : 'organiza Membego'}).`, {
    funding: d.funding,
    audience: d.audience,
    budgetTotal: sinTope ? null : String(d.budgetTotal),
  }, ctx.actorId)
  if (sinTope && d.funding !== 'SUPPLIER') {
    await evento(tx, c.id, 'BUDGET_WAIVED', d.budgetWaiverReason!.trim(), null, ctx.actorId)
    await auditarEnTx(tx, ctx, 'SUPPLY_V2_CAMPAIGN_BUDGET_WAIVED', 'SupplyV2Campaign', c.id, { code: c.code, motivo: d.budgetWaiverReason!.trim() }, companyId)
  }
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_CAMPAIGN_CREATED', 'SupplyV2Campaign', c.id, {
    code: c.code,
    name: d.name.trim(),
    organizer: d.organizer,
    funding: d.funding,
    audience: d.audience,
    budgetTotal: sinTope ? null : String(d.budgetTotal),
    supplierId: d.supplierId ?? null,
  }, companyId)
  return c
}

// ── Ofertas participantes (§8) ──────────────────────────────────────────────

/**
 * Añade una oferta a la campaña. La oferta NO cambia: conserva su proveedor,
 * su precio, su acuerdo y su disponibilidad (§8). Si la campaña financia parte
 * con el proveedor, la oferta tiene que ser de ese proveedor.
 */
export async function agregarOfertaEnTx(tx: Tx, d: { campaignId: string; offerId: string; featured?: boolean; position?: number }, ctx: ContextoAuditoria): Promise<{ id: string; repetida: boolean }> {
  const c = await bloquearCampana(tx, d.campaignId)
  if (CAMPANA_CERRADA.includes(c.status)) fallo('CAMPANA_CERRADA', `Una campaña ${c.status} no admite ofertas nuevas.`)
  const o = await tx.supplyV2Offer.findUnique({ where: { id: d.offerId }, select: { id: true, title: true, status: true, supplierId: true, currency: true, sourceType: true } })
  if (!o) fallo('OFERTA_NO_ENCONTRADA', 'La oferta no existe.')
  if (['ENDED', 'CANCELLED'].includes(o.status)) fallo('OFERTA_CERRADA', 'Esa oferta ya terminó.')
  if (o.currency !== c.currency) fallo('MONEDA_DISTINTA', 'La oferta está en otra moneda que la campaña.')
  if (c.funding !== 'MEMBEGO' && c.supplierId && o.supplierId !== c.supplierId) {
    fallo('OFERTA_DE_OTRO_PROVEEDOR', 'En una campaña que financia el proveedor, las ofertas tienen que ser suyas.')
  }
  if (c.organizer === 'SUPPLIER' && o.supplierId !== c.supplierId) {
    fallo('OFERTA_DE_OTRO_PROVEEDOR', 'Un proveedor solo puede proponer sus propias ofertas.')
  }
  const previa = await tx.supplyV2CampaignOffer.findUnique({ where: { campaignId_offerId: { campaignId: c.id, offerId: o.id } }, select: { id: true } })
  if (previa) return { id: previa.id, repetida: true }
  const fila = await tx.supplyV2CampaignOffer.create({
    data: { campaignId: c.id, offerId: o.id, featured: d.featured ?? false, position: d.position ?? 0 },
    select: { id: true },
  })
  await evento(tx, c.id, 'OFFER_ADDED', `Oferta «${o.title}» añadida.`, { offerId: o.id }, ctx.actorId)
  return { id: fila.id, repetida: false }
}

export async function quitarOfertaEnTx(tx: Tx, d: { campaignId: string; offerId: string }, ctx: ContextoAuditoria): Promise<void> {
  const c = await bloquearCampana(tx, d.campaignId)
  if (CAMPANA_CERRADA.includes(c.status)) fallo('CAMPANA_CERRADA', `Una campaña ${c.status} ya no se edita.`)
  const fila = await tx.supplyV2CampaignOffer.findUnique({ where: { campaignId_offerId: { campaignId: c.id, offerId: d.offerId } }, select: { id: true, benefitId: true } })
  if (!fila) return
  if (fila.benefitId) {
    const vivas = await tx.supplyV2BenefitReservation.count({ where: { benefitId: fila.benefitId, status: { in: ['ACTIVE', 'APPLIED'] } } })
    if (vivas > 0) fallo('OFERTA_CON_USOS', 'Esa oferta ya tiene compras con el beneficio de la campaña: no se puede quitar sin perder el rastro. Pausa la campaña.')
  }
  await tx.supplyV2CampaignOffer.delete({ where: { id: fila.id } })
  await evento(tx, c.id, 'OFFER_REMOVED', 'Oferta retirada de la campaña.', { offerId: d.offerId }, ctx.actorId)
}

// ── La promoción: un beneficio del Slice 6, dentro del techo (§6, §16) ──────

export interface PromocionDeCampana {
  campaignId: string
  /** Oferta a la que aplica; debe estar en la campaña. */
  offerId: string
  nombre?: string | null
  valueType: 'FIXED_AMOUNT' | 'PERCENTAGE'
  membegoValue?: number | string | null
  supplierValue?: number | string | null
  maxMembegoAmount?: number | string | null
  maxSupplierAmount?: number | string | null
  /** Techo del subsidio de esta promoción; tiene que caber en el de la campaña. */
  budgetTotal?: number | string | null
  perCustomerLimit?: number | null
  /** true cuando la promoción solo se abre con cupón (§9). */
  requiresCoupon?: boolean
  /** true cuando hay que asignarla cliente por cliente. */
  requiresAssignment?: boolean
}

/**
 * Crea la promoción de una oferta de la campaña como BENEFICIO del Slice 6
 * (§6): el motor económico, el presupuesto, el ledger y los candados son los
 * de allí. Aquí solo se comprueba que cabe en el techo de la campaña y se
 * cuelga de ella.
 */
export async function adjuntarPromocionEnTx(tx: Tx, d: PromocionDeCampana, ctx: ContextoAuditoria): Promise<BeneficioCreado> {
  const c = await bloquearCampana(tx, d.campaignId)
  if (CAMPANA_CERRADA.includes(c.status)) fallo('CAMPANA_CERRADA', `Una campaña ${c.status} ya no se edita.`)
  const participa = await tx.supplyV2CampaignOffer.findUnique({ where: { campaignId_offerId: { campaignId: c.id, offerId: d.offerId } }, select: { id: true, benefitId: true } })
  if (!participa) fallo('OFERTA_FUERA_DE_CAMPANA', 'Esa oferta no participa en la campaña: añádela primero.')
  if (participa.benefitId) fallo('PROMOCION_YA_PUESTA', 'Esa oferta ya tiene su promoción en esta campaña.')

  // §16 · el techo de la campaña manda sobre la suma de los techos de sus beneficios.
  const p = presupuestoDeCampana(c.budgetTotal, c.benefits)
  const noCabe = cabeEnElPresupuesto(p, d.budgetTotal ?? null)
  if (noCabe) fallo('PRESUPUESTO_DE_CAMPANA', noCabe)

  const datos: DatosBeneficio = {
    name: d.nombre?.trim() || `${c.name} · promoción`,
    description: c.description,
    objective: c.objective,
    funding: c.funding,
    valueType: d.valueType,
    membegoValue: d.membegoValue ?? null,
    supplierValue: d.supplierValue ?? null,
    maxMembegoAmount: d.maxMembegoAmount ?? null,
    maxSupplierAmount: d.maxSupplierAmount ?? null,
    scope: 'SPECIFIC_OFFER',
    offerId: d.offerId,
    supplierId: c.supplierId,
    budgetTotal: d.budgetTotal ?? null,
    perCustomerLimit: d.perCustomerLimit ?? c.maxPerCustomer,
    requiresAssignment: d.requiresAssignment ?? false,
    requiresCoupon: d.requiresCoupon ?? false,
    combinable: false,
    startsAt: c.startsAt,
    endsAt: c.endsAt,
  }
  const b = await crearBeneficioEnTx(tx, datos, ctx)
  await tx.supplyV2Benefit.update({ where: { id: b.id }, data: { campaignId: c.id } })
  await tx.supplyV2CampaignOffer.update({ where: { id: participa.id }, data: { benefitId: b.id } })
  await evento(tx, c.id, 'BENEFIT_ATTACHED', `Promoción ${b.code} para una oferta de la campaña.`, {
    benefitId: b.id,
    offerId: d.offerId,
    budgetTotal: d.budgetTotal != null ? String(d.budgetTotal) : null,
    requiresCoupon: d.requiresCoupon ?? false,
  }, ctx.actorId)
  return b
}

/**
 * Slice 7 (§16) · AJUSTA la promoción que ya tiene una oferta de la campaña.
 *
 * El asistente reparte el techo de la campaña entre sus promociones a partes
 * iguales; luego hay que poder rebalancearlo, cambiar el valor mientras nadie
 * lo ha usado todavía y decidir si se abre con cupón. Es el MISMO beneficio
 * del Slice 6: no se crea otro, no hay segundo presupuesto ni segundo ledger.
 *
 * Lo que NO se deja tocar:
 *  · lo que rebaja (valor, tipo, topes) cuando ya hay reservas vivas o
 *    aplicadas: el dinero de una compra hecha no se reescribe;
 *  · un techo por debajo de lo ya reservado o consumido;
 *  · la suma de los techos por encima del presupuesto aprobado (§16).
 *
 * Candados en el orden de siempre: CAMPAÑA → beneficio.
 */
export async function ajustarPromocionEnTx(tx: Tx, d: PromocionDeCampana, ctx: ContextoAuditoria): Promise<BeneficioCreado> {
  const c = await bloquearCampana(tx, d.campaignId)
  if (CAMPANA_CERRADA.includes(c.status)) fallo('CAMPANA_CERRADA', `Una campaña ${c.status} ya no se edita.`)
  const participa = await tx.supplyV2CampaignOffer.findUnique({
    where: { campaignId_offerId: { campaignId: c.id, offerId: d.offerId } },
    select: { id: true, benefitId: true },
  })
  if (!participa?.benefitId) fallo('PROMOCION_NO_PUESTA', 'Esa oferta todavía no tiene promoción en la campaña.')
  await tx.$queryRaw`SELECT "id" FROM "supply_v2_benefits" WHERE "id" = ${participa.benefitId} FOR UPDATE`
  const b = await tx.supplyV2Benefit.findUnique({
    where: { id: participa.benefitId },
    select: {
      id: true,
      code: true,
      name: true,
      status: true,
      valueType: true,
      membegoValue: true,
      supplierValue: true,
      maxMembegoAmount: true,
      maxSupplierAmount: true,
      budgetTotal: true,
      budgetReserved: true,
      budgetConsumed: true,
      perCustomerLimit: true,
      requiresCoupon: true,
      requiresAssignment: true,
    },
  })
  if (!b) fallo('BENEFICIO_NO_ENCONTRADO', 'La promoción de esa oferta ya no existe.')

  // El dinero de lo ya comprado no se reescribe.
  const vivas = await tx.supplyV2BenefitReservation.count({ where: { benefitId: b.id, status: { in: ['ACTIVE', 'APPLIED'] } } })
  const valorNuevo = (actual: Decimal, propuesto: number | string | null | undefined) =>
    propuesto == null || propuesto === '' ? actual : redondear2(decimal(propuesto))
  const membegoValue = valorNuevo(b.membegoValue, d.membegoValue)
  const supplierValue = valorNuevo(b.supplierValue, d.supplierValue)
  const maxMembegoAmount = d.maxMembegoAmount == null || d.maxMembegoAmount === '' ? b.maxMembegoAmount : redondear2(decimal(d.maxMembegoAmount))
  const maxSupplierAmount = d.maxSupplierAmount == null || d.maxSupplierAmount === '' ? b.maxSupplierAmount : redondear2(decimal(d.maxSupplierAmount))
  const cambiaLoQueRebaja =
    d.valueType !== b.valueType ||
    !membegoValue.equals(b.membegoValue) ||
    !supplierValue.equals(b.supplierValue) ||
    String(maxMembegoAmount ?? '') !== String(b.maxMembegoAmount ?? '') ||
    String(maxSupplierAmount ?? '') !== String(b.maxSupplierAmount ?? '')
  if (vivas > 0 && cambiaLoQueRebaja) {
    fallo('PROMOCION_CON_USOS', 'Esa promoción ya se usó en compras: lo que rebaja no se puede cambiar. Pausa la campaña y configura otra.')
  }

  const techoNuevo = d.budgetTotal == null || d.budgetTotal === '' ? null : redondear2(decimal(d.budgetTotal))
  // §16 · la suma de los techos, SIN contar el de esta promoción, más el nuevo.
  const p = presupuestoDeCampana(c.budgetTotal, c.benefits.filter((x) => x.id !== b.id))
  const noCabe = cabeEnElPresupuesto(p, techoNuevo)
  if (noCabe) fallo('PRESUPUESTO_DE_CAMPANA', noCabe)
  const movido = decimal(b.budgetReserved).plus(b.budgetConsumed)
  if (techoNuevo && techoNuevo.lessThan(movido)) {
    fallo('PRESUPUESTO_POR_DEBAJO', `Esa promoción ya movió ${movido.toFixed(2)}: su presupuesto no puede bajar de ahí.`)
  }

  // La forma se valida con el MISMO validador del Slice 6.
  const datos: DatosBeneficio = {
    name: d.nombre?.trim() || b.name,
    funding: c.funding,
    valueType: d.valueType,
    membegoValue: membegoValue.toFixed(2),
    supplierValue: supplierValue.toFixed(2),
    maxMembegoAmount: maxMembegoAmount ? maxMembegoAmount.toFixed(2) : null,
    maxSupplierAmount: maxSupplierAmount ? maxSupplierAmount.toFixed(2) : null,
    scope: 'SPECIFIC_OFFER',
    offerId: d.offerId,
    supplierId: c.supplierId,
    budgetTotal: techoNuevo ? techoNuevo.toFixed(2) : null,
    perCustomerLimit: d.perCustomerLimit ?? b.perCustomerLimit,
    requiresAssignment: d.requiresAssignment ?? b.requiresAssignment,
    requiresCoupon: d.requiresCoupon ?? b.requiresCoupon,
    combinable: false,
    startsAt: c.startsAt,
    endsAt: c.endsAt,
  }
  const error = validarBeneficio(datos)
  if (error) fallo('BENEFICIO_INVALIDO', error)

  await tx.supplyV2Benefit.update({
    where: { id: b.id },
    data: {
      name: datos.name,
      valueType: datos.valueType,
      membegoValue,
      supplierValue,
      maxMembegoAmount,
      maxSupplierAmount,
      budgetTotal: techoNuevo,
      perCustomerLimit: datos.perCustomerLimit ?? 1,
      requiresAssignment: datos.requiresAssignment ?? false,
      requiresCoupon: datos.requiresCoupon ?? false,
    },
  })
  await evento(tx, c.id, 'BENEFIT_ATTACHED', `Promoción ${b.code} ajustada.`, {
    benefitId: b.id,
    offerId: d.offerId,
    budgetTotal: techoNuevo ? techoNuevo.toFixed(2) : null,
    requiresCoupon: datos.requiresCoupon ?? false,
    ajuste: true,
  }, ctx.actorId)
  return { id: b.id, code: b.code, status: b.status }
}

/**
 * Slice 7 (§5) · LO QUE EL ASISTENTE GUARDA DE UNA VEZ.
 *
 * El asistente recoge la campaña, las ofertas participantes y la promoción en
 * ocho pasos, así que al terminar tiene que quedar TODO guardado: una campaña
 * sin sus ofertas no se puede aprobar, y las ofertas que la persona marcó no
 * pueden perderse entre pantallas.
 *
 * El presupuesto de la campaña se reparte en partes iguales entre sus
 * promociones (el centavo sobrante va a la primera), de modo que la suma de los
 * techos es exactamente el techo aprobado (§16). Después se puede ajustar
 * promoción por promoción desde la ficha.
 */
export async function crearCampanaCompletaEnTx(
  tx: Tx,
  d: DatosCampana & {
    offerIds: string[]
    promocion?: {
      valueType: 'FIXED_AMOUNT' | 'PERCENTAGE'
      membegoValue?: number | string | null
      supplierValue?: number | string | null
      maxMembegoAmount?: number | string | null
      requiresCoupon?: boolean
      requiresAssignment?: boolean
    } | null
  },
  ctx: ContextoAuditoria
): Promise<CampanaCreada & { ofertas: number; promociones: number }> {
  const campana = await crearCampanaEnTx(tx, d, ctx)
  let ofertas = 0
  for (const offerId of d.offerIds) {
    const r = await agregarOfertaEnTx(tx, { campaignId: campana.id, offerId }, ctx)
    if (!r.repetida) ofertas++
  }
  let promociones = 0
  if (d.promocion && ofertas > 0) {
    const techo = d.budgetTotal != null && d.budgetTotal !== '' ? redondear2(decimal(d.budgetTotal)) : null
    // Reparto en centavos para que la suma cuadre exactamente con el techo.
    const centavos = techo ? techo.times(100).toNumber() : 0
    const base = techo ? Math.floor(centavos / d.offerIds.length) : 0
    const resto = techo ? centavos - base * d.offerIds.length : 0
    for (const [i, offerId] of d.offerIds.entries()) {
      const parte = techo ? new Prisma.Decimal(base + (i === 0 ? resto : 0)).dividedBy(100) : null
      await adjuntarPromocionEnTx(
        tx,
        {
          campaignId: campana.id,
          offerId,
          valueType: d.promocion.valueType,
          membegoValue: d.promocion.membegoValue ?? null,
          supplierValue: d.promocion.supplierValue ?? null,
          maxMembegoAmount: d.promocion.maxMembegoAmount ?? null,
          budgetTotal: parte ? parte.toFixed(2) : null,
          requiresCoupon: d.promocion.requiresCoupon ?? false,
          requiresAssignment: d.promocion.requiresAssignment ?? false,
        },
        ctx
      )
      promociones++
    }
  }
  return { ...campana, ofertas, promociones }
}

// ── Revisión, publicación y ciclo de vida (§4, §23) ─────────────────────────

/** Manda la campaña a revisión: a partir de aquí ya no se edita a la ligera. */
export async function enviarARevisionEnTx(tx: Tx, campaignId: string, ctx: ContextoAuditoria): Promise<void> {
  const c = await bloquearCampana(tx, campaignId)
  if (c.status === 'PENDING_APPROVAL') return
  exigirTransicion(TRANSICIONES_CAMPANA, c.status, 'PENDING_APPROVAL', 'Campaña')
  const ofertas = await tx.supplyV2CampaignOffer.count({ where: { campaignId: c.id } })
  if (ofertas === 0) fallo('CAMPANA_SIN_OFERTAS', 'Una campaña sin ofertas no se puede aprobar: añade al menos una.')
  const conPromocion = await tx.supplyV2CampaignOffer.count({ where: { campaignId: c.id, benefitId: { not: null } } })
  if (conPromocion === 0) fallo('CAMPANA_SIN_PROMOCION', 'Ninguna oferta de la campaña tiene promoción: no rebajaría nada.')
  await tx.supplyV2Campaign.update({ where: { id: c.id }, data: { status: 'PENDING_APPROVAL' } })
  await evento(tx, c.id, 'SUBMITTED', `Enviada a revisión con ${ofertas} oferta(s).`, { ofertas, conPromocion }, ctx.actorId)
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_CAMPAIGN_SUBMITTED', 'SupplyV2Campaign', c.id, { code: c.code, ofertas, conPromocion }, c.supplier?.companyId ?? null)
}

export interface CampanaAprobada {
  id: string
  code: string
  status: string
  /** true si la aprobó quien la creó por ser la única persona autorizada. */
  autoaprobada: boolean
  repetida: boolean
}

/**
 * APROBAR (§4, §27): otra persona autorizada. Con una sola persona autorizada
 * la regla no protege nada y solo dejaría el trabajo atascado, así que pasa y
 * queda el rastro (`core/segregacion.ts`). Aprobar NO publica: publicar es un
 * permiso distinto, porque es lo que la hace visible al cliente.
 */
export async function aprobarCampanaEnTx(tx: Tx, campaignId: string, ctx: ContextoAuditoria): Promise<CampanaAprobada> {
  if (!ctx.actorId) fallo('SIN_ACTOR', 'Aprobar una campaña necesita quién la aprueba.')
  const c = await bloquearCampana(tx, campaignId)
  if (c.approvedAt) return { id: c.id, code: c.code, status: c.status, autoaprobada: false, repetida: true }
  if (c.status !== 'PENDING_APPROVAL') fallo('CAMPANA_NO_APROBABLE', `Una campaña ${c.status} no está esperando aprobación.`)
  const autoaprobada = esAutoaprobacion(c.createdById, ctx.actorId)

  await tx.supplyV2Campaign.update({ where: { id: c.id }, data: { approvedById: ctx.actorId, approvedAt: new Date() } })
  await evento(tx, c.id, 'APPROVED', autoaprobada ? MOTIVO_AUTOAPROBACION : 'Aprobada por una segunda persona autorizada.', {
    autoaprobada: autoaprobada,
  }, ctx.actorId)
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_CAMPAIGN_APPROVED', 'SupplyV2Campaign', c.id, {
    code: c.code,
    createdById: c.createdById,
    autoaprobada: autoaprobada,
    budgetTotal: c.budgetTotal?.toFixed(2) ?? null,
    ...(autoaprobada ? { motivo: MOTIVO_AUTOAPROBACION } : {}),
  }, c.supplier?.companyId ?? null)
  return { id: c.id, code: c.code, status: c.status, autoaprobada: autoaprobada, repetida: false }
}

/** Rechazar una propuesta: vuelve a borrador con el motivo escrito (§23). */
export async function rechazarCampanaEnTx(tx: Tx, campaignId: string, motivo: string, ctx: ContextoAuditoria): Promise<void> {
  if (!motivo?.trim()) fallo('MOTIVO_OBLIGATORIO', 'Rechazar una campaña exige un motivo.')
  const c = await bloquearCampana(tx, campaignId)
  if (c.status !== 'PENDING_APPROVAL') fallo('CAMPANA_NO_RECHAZABLE', `Una campaña ${c.status} no está en revisión.`)
  await tx.supplyV2Campaign.update({ where: { id: c.id }, data: { status: 'DRAFT', reviewNotes: motivo.trim() } })
  await evento(tx, c.id, 'REJECTED', motivo.trim(), null, ctx.actorId)
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_CAMPAIGN_REJECTED', 'SupplyV2Campaign', c.id, { code: c.code, motivo: motivo.trim() }, c.supplier?.companyId ?? null)
}

/**
 * PUBLICAR: la campaña se hace visible y sus promociones empiezan a valer.
 * Exige aprobación previa y activa los beneficios que todavía estén en
 * borrador, porque publicar sin ellos dejaría una campaña que no rebaja nada.
 */
export async function publicarCampanaEnTx(tx: Tx, campaignId: string, ctx: ContextoAuditoria, ahora = new Date()): Promise<{ id: string; code: string; status: 'SCHEDULED' | 'ACTIVE'; beneficios: number; repetida: boolean }> {
  if (!ctx.actorId) fallo('SIN_ACTOR', 'Publicar una campaña necesita quién la publica.')
  const c = await bloquearCampana(tx, campaignId)
  if (c.status === 'ACTIVE' || c.status === 'SCHEDULED') {
    return { id: c.id, code: c.code, status: c.status as 'SCHEDULED' | 'ACTIVE', beneficios: c.benefits.length, repetida: true }
  }
  if (!c.approvedAt) fallo('CAMPANA_SIN_APROBAR', 'Una campaña se aprueba antes de publicarse.')
  const destino = estadoAlPublicar(c.startsAt, ahora)
  exigirTransicion(TRANSICIONES_CAMPANA, c.status, destino, 'Campaña')

  // Los beneficios de la campaña se activan con ella: ya los aprobó quien
  // aprobó la campaña, y dejarlos en borrador haría que no rebajaran nada.
  let activados = 0
  for (const b of c.benefits) {
    if (b.status !== 'DRAFT') continue
    await tx.supplyV2Benefit.update({ where: { id: b.id }, data: { status: 'ACTIVE', approvedById: c.approvedById ?? ctx.actorId, approvedAt: c.approvedAt } })
    activados++
  }
  await tx.supplyV2Campaign.update({ where: { id: c.id }, data: { status: destino, publishedById: ctx.actorId, publishedAt: new Date() } })
  await evento(tx, c.id, 'PUBLISHED', destino === 'SCHEDULED' ? `Publicada; empieza el ${c.startsAt.toISOString().slice(0, 10)}.` : 'Publicada y activa.', { beneficiosActivados: activados }, ctx.actorId)
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_CAMPAIGN_PUBLISHED', 'SupplyV2Campaign', c.id, { code: c.code, destino, beneficiosActivados: activados }, c.supplier?.companyId ?? null)
  return { id: c.id, code: c.code, status: destino, beneficios: c.benefits.length, repetida: false }
}

/** Pausar: deja de valer para compras nuevas; lo reservado sigue su curso. */
export async function pausarCampanaEnTx(tx: Tx, campaignId: string, ctx: ContextoAuditoria): Promise<void> {
  const c = await bloquearCampana(tx, campaignId)
  if (c.status === 'PAUSED') return
  exigirTransicion(TRANSICIONES_CAMPANA, c.status, 'PAUSED', 'Campaña')
  await tx.supplyV2Campaign.update({ where: { id: c.id }, data: { status: 'PAUSED' } })
  // Los beneficios se pausan con ella: si siguieran activos, la promoción
  // seguiría aplicándose por el id del beneficio aunque la campaña esté quieta.
  await tx.supplyV2Benefit.updateMany({ where: { campaignId: c.id, status: 'ACTIVE' }, data: { status: 'PAUSED' } })
  await evento(tx, c.id, 'PAUSED', 'Campaña pausada.', null, ctx.actorId)
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_CAMPAIGN_PAUSED', 'SupplyV2Campaign', c.id, { code: c.code, antes: c.status }, c.supplier?.companyId ?? null)
}

export async function reanudarCampanaEnTx(tx: Tx, campaignId: string, ctx: ContextoAuditoria, ahora = new Date()): Promise<void> {
  const c = await bloquearCampana(tx, campaignId)
  if (c.status === 'ACTIVE' || c.status === 'SCHEDULED') return
  const destino = estadoAlPublicar(c.startsAt, ahora)
  exigirTransicion(TRANSICIONES_CAMPANA, c.status, destino === 'SCHEDULED' ? 'ACTIVE' : destino, 'Campaña')
  if (c.endsAt && c.endsAt <= ahora) fallo('CAMPANA_VENCIDA', 'La campaña ya terminó: amplía su vigencia antes de reactivarla.')
  await tx.supplyV2Campaign.update({ where: { id: c.id }, data: { status: destino } })
  await tx.supplyV2Benefit.updateMany({ where: { campaignId: c.id, status: 'PAUSED' }, data: { status: 'ACTIVE' } })
  await evento(tx, c.id, 'RESUMED', 'Campaña reactivada.', null, ctx.actorId)
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_CAMPAIGN_RESUMED', 'SupplyV2Campaign', c.id, { code: c.code, destino }, c.supplier?.companyId ?? null)
}

/**
 * CANCELAR: nunca con checkouts en curso (§27 del Slice 6: el presupuesto
 * reservado tiene que volver por su camino). Lo aplicado queda aplicado; los
 * cupones vivos se cancelan.
 */
export async function cancelarCampanaEnTx(tx: Tx, campaignId: string, motivo: string, ctx: ContextoAuditoria): Promise<void> {
  if (!motivo?.trim()) fallo('MOTIVO_OBLIGATORIO', 'Cancelar una campaña exige un motivo.')
  const c = await bloquearCampana(tx, campaignId)
  if (c.status === 'CANCELLED') return
  exigirTransicion(TRANSICIONES_CAMPANA, c.status, 'CANCELLED', 'Campaña')
  const vivas = await tx.supplyV2BenefitReservation.count({ where: { benefit: { campaignId: c.id }, status: 'ACTIVE' } })
  if (vivas > 0) fallo('CAMPANA_CON_RESERVAS', `Hay ${vivas} checkout(s) en curso con esta campaña: pausa la campaña y espera a que se paguen o expiren.`)
  const ahora = new Date()
  await tx.supplyV2Campaign.update({ where: { id: c.id }, data: { status: 'CANCELLED', cancelledAt: ahora, cancelledReason: motivo.trim() } })
  await tx.supplyV2Benefit.updateMany({ where: { campaignId: c.id, status: { in: ['DRAFT', 'ACTIVE', 'PAUSED', 'EXHAUSTED'] } }, data: { status: 'CANCELLED', cancelledAt: ahora, cancelledReason: `Campaña cancelada: ${motivo.trim()}` } })
  await tx.supplyV2CustomerBenefit.updateMany({ where: { benefit: { campaignId: c.id }, status: 'AVAILABLE' }, data: { status: 'CANCELLED', cancelledAt: ahora } })
  await tx.supplyV2Coupon.updateMany({ where: { campaignId: c.id, status: { in: ['ACTIVE', 'EXHAUSTED'] } }, data: { status: 'CANCELLED' } })
  await evento(tx, c.id, 'CANCELLED', motivo.trim(), null, ctx.actorId)
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_CAMPAIGN_CANCELLED', 'SupplyV2Campaign', c.id, { code: c.code, antes: c.status, motivo: motivo.trim() }, c.supplier?.companyId ?? null)
}

/** Cerrar una campaña cumplida: lo aplicado queda, lo vivo se cierra. */
export async function completarCampanaEnTx(tx: Tx, campaignId: string, ctx: ContextoAuditoria, ahora = new Date()): Promise<boolean> {
  const c = await bloquearCampana(tx, campaignId)
  if (CAMPANA_CERRADA.includes(c.status)) return false
  exigirTransicion(TRANSICIONES_CAMPANA, c.status, 'COMPLETED', 'Campaña')
  await tx.supplyV2Campaign.update({ where: { id: c.id }, data: { status: 'COMPLETED', completedAt: ahora } })
  await tx.supplyV2Benefit.updateMany({ where: { campaignId: c.id, status: { in: ['ACTIVE', 'PAUSED', 'EXHAUSTED'] } }, data: { status: 'EXPIRED' } })
  await tx.supplyV2CustomerBenefit.updateMany({ where: { benefit: { campaignId: c.id }, status: 'AVAILABLE' }, data: { status: 'EXPIRED' } })
  await tx.supplyV2Coupon.updateMany({ where: { campaignId: c.id, status: 'ACTIVE' }, data: { status: 'EXPIRED' } })
  await evento(tx, c.id, 'COMPLETED', 'Campaña terminada por vigencia.', null, ctx.actorId)
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_CAMPAIGN_COMPLETED', 'SupplyV2Campaign', c.id, { code: c.code }, c.supplier?.companyId ?? null)
  return true
}

/**
 * Cron (§7): activa las programadas que ya empezaron y cierra las vencidas. El
 * cron MANTIENE estados; la vigencia real la comprueba el servidor en cada
 * checkout, así que una pasada tarde no deja valer una campaña terminada.
 */
export async function barridoCampanasEnTx(tx: Tx, ctx: ContextoAuditoria, ahora = new Date(), limite = 200): Promise<{ activadas: number; terminadas: number }> {
  const programadas = await tx.supplyV2Campaign.findMany({
    where: { status: 'SCHEDULED', startsAt: { lte: ahora }, OR: [{ endsAt: null }, { endsAt: { gt: ahora } }] },
    select: { id: true },
    take: limite,
  })
  let activadas = 0
  for (const p of programadas) {
    const c = await bloquearCampana(tx, p.id)
    if (c.status !== 'SCHEDULED') continue
    await tx.supplyV2Campaign.update({ where: { id: c.id }, data: { status: 'ACTIVE' } })
    await tx.supplyV2Benefit.updateMany({ where: { campaignId: c.id, status: 'DRAFT' }, data: { status: 'ACTIVE', approvedById: c.approvedById, approvedAt: c.approvedAt } })
    await evento(tx, c.id, 'RESUMED', 'Activada por el barrido: su fecha de inicio llegó.', null, null)
    activadas++
  }
  const vencidas = await tx.supplyV2Campaign.findMany({
    where: { status: { in: ['SCHEDULED', 'ACTIVE', 'PAUSED'] }, endsAt: { lte: ahora } },
    select: { id: true },
    take: limite,
  })
  let terminadas = 0
  for (const v of vencidas) {
    if (await completarCampanaEnTx(tx, v.id, ctx, ahora)) terminadas++
  }
  return { activadas, terminadas }
}

// ── Público objetivo: asignar la promoción a una lista (§14) ────────────────

/**
 * Asigna los beneficios de la campaña a un cliente (público SELECTED o
 * reparto dirigido). Reutiliza la asignación del Slice 6, que ya es
 * idempotente: un reintento no crea una segunda asignación (§14).
 */
export async function asignarCampanaAClienteEnTx(
  tx: Tx,
  d: { campaignId: string; customerId: string; usesAllowed?: number | null; note?: string | null },
  ctx: ContextoAuditoria
): Promise<{ asignados: number; repetidos: number }> {
  if (!ctx.actorId) fallo('SIN_ACTOR', 'Asignar una campaña necesita quién la asigna.')
  const c = await bloquearCampana(tx, d.campaignId)
  if (CAMPANA_CERRADA.includes(c.status)) fallo('CAMPANA_CERRADA', `Una campaña ${c.status} no se asigna.`)
  const cliente = await tx.user.findUnique({ where: { id: d.customerId }, select: { id: true, role: true } })
  if (!cliente || cliente.role !== 'CLIENTE') fallo('CLIENTE_NO_ENCONTRADO', 'El cliente no existe o no es un cliente de Membego.')
  const { asignarBeneficioEnTx } = await import('../benefits/service')
  let asignados = 0
  let repetidos = 0
  for (const b of c.benefits) {
    if (b.status === 'CANCELLED' || b.status === 'EXPIRED') continue
    const r = await asignarBeneficioEnTx(tx, { benefitId: b.id, customerId: d.customerId, usesAllowed: d.usesAllowed ?? null, expiresAt: c.endsAt, note: d.note ?? `Campaña ${c.code}` }, ctx)
    if (r.repetida) repetidos++
    else asignados++
  }
  if (asignados > 0) {
    await evento(tx, c.id, 'AUDIENCE_ASSIGNED', `Campaña asignada a un cliente (${asignados} promoción(es)).`, { customerId: d.customerId }, ctx.actorId)
  }
  return { asignados, repetidos }
}

/**
 * Slice 7 (§20, §25) · LA PROMOCIÓN QUE SE APLICA SOLA.
 *
 * Una campaña con un descuento sin código tiene que rebajar sin que el cliente
 * haga nada: si no, el marketplace anunciaría una promoción que no se aplica.
 * Cuando una oferta participa en VARIAS campañas se elige UNA con la regla
 * determinista del §25 —la que más rebaja, luego la que empezó antes, luego por
 * código—, de modo que dos cálculos del mismo caso dan el mismo resultado y la
 * venta no se puede atribuir a dos campañas.
 *
 * Aquí NO se reserva nada: solo se decide el candidato. La elegibilidad final y
 * el presupuesto los resuelve `reservarBeneficioEnTx` con el candado puesto, en
 * modo opcional: si ya no cabe, la compra sigue a precio normal.
 */
export async function promocionAutomaticaEnTx(
  tx: Tx,
  d: { offerId: string; customerId: string; quantity: number; sourceType: 'PREPURCHASED_SUPPLY' | 'COMMISSION'; salePrice: Decimal; commissionPercentage: Decimal | null; commissionBase: 'CONTRACTUAL_SALE_VALUE' | 'CUSTOMER_PAID_AMOUNT' | null },
  ahora = new Date()
): Promise<{ benefitId: string; campaignId: string } | null> {
  const participaciones = await tx.supplyV2CampaignOffer.findMany({
    where: {
      offerId: d.offerId,
      benefitId: { not: null },
      campaign: { status: 'ACTIVE', startsAt: { lte: ahora }, OR: [{ endsAt: null }, { endsAt: { gt: ahora } }] },
      // Sin código y sin asignación: esas dos las pide el cliente a propósito.
      benefit: { status: 'ACTIVE', requiresCoupon: false, requiresAssignment: false },
    },
    include: {
      campaign: { select: { id: true, code: true, startsAt: true, endsAt: true, activeFromMinute: true, activeToMinute: true, audience: true } },
      benefit: true,
    },
  })
  if (participaciones.length === 0) return null
  const { fueraDePublico, fueraDeVigencia, campanaAtribuida } = await import('./domain')
  const { historialDelClienteEnTx } = await import('./coupons')
  const historial = await historialDelClienteEnTx(tx, d.customerId, null)

  const candidatas: { campaignId: string; campaignCode: string; startsAt: Date; beneficio: Decimal; benefitId: string }[] = []
  for (const p of participaciones) {
    if (!p.benefit) continue
    if (fueraDeVigencia(p.campaign, ahora) !== null) continue
    if (fueraDePublico(p.campaign.audience, historial)) continue
    let reparto
    try {
      reparto = calcularRepartoLinea({
        saleUnitPrice: d.salePrice,
        quantity: d.quantity,
        beneficio: p.benefit,
        sourceType: d.sourceType,
        commissionPercentage: d.commissionPercentage,
        commissionBase: d.commissionBase,
      })
    } catch {
      continue
    }
    if (reparto.benefitApplied.lessThanOrEqualTo(0)) continue
    candidatas.push({ campaignId: p.campaign.id, campaignCode: p.campaign.code, startsAt: p.campaign.startsAt, beneficio: reparto.benefitApplied, benefitId: p.benefit.id })
  }
  const elegida = campanaAtribuida(candidatas)
  if (!elegida) return null
  const ganadora = candidatas.find((c) => c.campaignId === elegida.campaignId)!
  return { benefitId: ganadora.benefitId, campaignId: ganadora.campaignId }
}

/** Suma de lo reservado y consumido de la campaña, leída de sus beneficios (§16). */
export async function presupuestoDeCampanaEnTx(tx: Tx, campaignId: string) {
  const c = await tx.supplyV2Campaign.findUniqueOrThrow({
    where: { id: campaignId },
    select: { budgetTotal: true, benefits: { select: { budgetTotal: true, budgetReserved: true, budgetConsumed: true } } },
  })
  return presupuestoDeCampana(c.budgetTotal, c.benefits)
}

export { CERO as CERO_CAMPANAS }
