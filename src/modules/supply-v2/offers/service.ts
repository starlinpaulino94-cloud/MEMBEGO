import type { Tx } from '@/lib/tenant'
import { auditarEnTx, type ContextoAuditoria } from '../core/auditoria'
import { fallo } from '../core/errores'
import { estadoInicialOferta, exigirTransicion, TRANSICIONES_OFERTA } from '../core/estados'
import { siguienteNumero } from '../core/numeracion'
import { calcularPrecioOferta } from '../core/precios'
import { asignarEnTx, liberarAsignacionEnTx } from '../allocations/service'
import { slugDeOferta, validarOferta, type DatosOferta } from './domain'

/**
 * MEMBEGO SUPPLY 2.0 · OFERTAS (§7–§16, §38–§39).
 *
 * Crear deja un BORRADOR sin tocar supply. PUBLICAR es la transacción que
 * aparta: asignación FEFO + AVAILABLE → ALLOCATED + estado ACTIVE o
 * SCHEDULED. Un borrador abandonado no bloquea inventario (§12).
 */

export interface OfertaCreada {
  id: string
  code: string
  slug: string
  status: string
}

export async function crearOfertaEnTx(tx: Tx, d: DatosOferta, ctx: ContextoAuditoria): Promise<OfertaCreada> {
  if (!ctx.actorId) fallo('SIN_ACTOR', 'Una oferta necesita quién la crea.')
  const error = validarOferta(d)
  if (error) fallo('OFERTA_INVALIDA', error)

  const item = await tx.supplyV2CatalogItem.findUnique({
    where: { id: d.catalogItemId },
    select: { id: true, name: true, status: true, supplierId: true, currency: true, supplier: { select: { status: true, companyId: true } } },
  })
  if (!item) fallo('ITEM_NO_ENCONTRADO', 'El producto no existe.')
  if (item.status !== 'ACTIVE') fallo('ITEM_INACTIVO', 'El producto no está activo.')
  if (item.supplier.status !== 'ACTIVE') fallo('PROVEEDOR_INACTIVO', 'El proveedor no está activo.')

  const precio = calcularPrecioOferta(d.publicPrice, d.salePrice)
  const code = await siguienteNumero(tx, 'MBG-OF', async (prefijo) => {
    const u = await tx.supplyV2Offer.findFirst({ where: { code: { startsWith: prefijo } }, orderBy: { code: 'desc' }, select: { code: true } })
    return u?.code ?? null
  })
  const creada = await tx.supplyV2Offer.create({
    data: {
      supplierId: item.supplierId,
      catalogItemId: item.id,
      code,
      slug: slugDeOferta(d.title, code),
      title: d.title.trim(),
      description: d.description?.trim() || null,
      sourceType: 'PREPURCHASED_SUPPLY',
      publicPrice: precio.publicPrice,
      salePrice: precio.salePrice,
      currency: item.currency,
      quantityLimit: d.quantity,
      perCustomerLimit: d.perCustomerLimit ?? 1,
      startsAt: d.startsAt,
      endsAt: d.endsAt ?? null,
      imagePath: d.imagePath ?? null,
      status: 'DRAFT',
      createdById: ctx.actorId,
    },
    select: { id: true, code: true, slug: true, status: true },
  })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_OFFER_CREATED', 'SupplyV2Offer', creada.id, {
    code: creada.code,
    catalogItemId: item.id,
    quantity: d.quantity,
    publicPrice: precio.publicPrice.toString(),
    salePrice: precio.salePrice.toString(),
  }, item.supplier.companyId)
  return creada
}

/**
 * PUBLICAR (§16): aparta el supply y activa. Idempotente: publicar una oferta
 * ya publicada devuelve lo que hay sin asignar dos veces.
 */
export async function publicarOfertaEnTx(tx: Tx, offerId: string, ctx: ContextoAuditoria): Promise<{ id: string; status: string; allocationId: string }> {
  if (!ctx.actorId) fallo('SIN_ACTOR', 'Publicar una oferta necesita quién la publica.')
  await tx.$queryRaw`SELECT "id" FROM "supply_v2_offers" WHERE "id" = ${offerId} FOR UPDATE`
  const o = await tx.supplyV2Offer.findUnique({
    where: { id: offerId },
    select: { id: true, code: true, title: true, status: true, allocationId: true, catalogItemId: true, quantityLimit: true, startsAt: true, endsAt: true, supplier: { select: { companyId: true } } },
  })
  if (!o) fallo('OFERTA_NO_ENCONTRADA', 'La oferta no existe.')
  if (o.allocationId && o.status !== 'DRAFT') return { id: o.id, status: o.status, allocationId: o.allocationId }
  if (o.status !== 'DRAFT') fallo('OFERTA_NO_PUBLICABLE', `Una oferta ${o.status} no se puede publicar.`)
  if (o.endsAt && o.endsAt <= new Date()) fallo('OFERTA_VENCIDA', 'La vigencia de la oferta ya pasó: cambia la fecha de fin antes de publicar.')

  const asignacion = await asignarEnTx(
    tx,
    { catalogItemId: o.catalogItemId, quantity: o.quantityLimit, purpose: 'OFFER', startsAt: o.startsAt, endsAt: o.endsAt, referenceLabel: `la oferta ${o.code} «${o.title}»` },
    ctx
  )
  const status = estadoInicialOferta(o.startsAt)
  exigirTransicion(TRANSICIONES_OFERTA, o.status, status, 'Oferta')
  await tx.supplyV2Offer.update({
    where: { id: o.id },
    data: { status, allocationId: asignacion.id, publishedById: ctx.actorId, publishedAt: new Date() },
  })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_OFFER_PUBLISHED', 'SupplyV2Offer', o.id, {
    code: o.code,
    antes: 'DRAFT',
    despues: status,
    allocationId: asignacion.id,
    lines: asignacion.lines,
  }, o.supplier.companyId)
  return { id: o.id, status, allocationId: asignacion.id }
}

async function ofertaBloqueada(tx: Tx, offerId: string) {
  await tx.$queryRaw`SELECT "id" FROM "supply_v2_offers" WHERE "id" = ${offerId} FOR UPDATE`
  const o = await tx.supplyV2Offer.findUnique({
    where: { id: offerId },
    select: { id: true, code: true, status: true, allocationId: true, supplier: { select: { companyId: true } } },
  })
  if (!o) fallo('OFERTA_NO_ENCONTRADA', 'La oferta no existe.')
  return o
}

export async function pausarOfertaEnTx(tx: Tx, offerId: string, ctx: ContextoAuditoria): Promise<void> {
  const o = await ofertaBloqueada(tx, offerId)
  exigirTransicion(TRANSICIONES_OFERTA, o.status, 'PAUSED', 'Oferta')
  await tx.supplyV2Offer.update({ where: { id: o.id }, data: { status: 'PAUSED' } })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_OFFER_PAUSED', 'SupplyV2Offer', o.id, { code: o.code, antes: o.status, despues: 'PAUSED' }, o.supplier.companyId)
}

export async function reanudarOfertaEnTx(tx: Tx, offerId: string, ctx: ContextoAuditoria): Promise<void> {
  const o = await ofertaBloqueada(tx, offerId)
  exigirTransicion(TRANSICIONES_OFERTA, o.status, 'ACTIVE', 'Oferta')
  await tx.supplyV2Offer.update({ where: { id: o.id }, data: { status: 'ACTIVE' } })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_OFFER_RESUMED', 'SupplyV2Offer', o.id, { code: o.code, antes: o.status, despues: 'ACTIVE' }, o.supplier.companyId)
}

/** Finalizar (§39) o cancelar (§38): libera lo no usado; lo emitido queda emitido. */
export async function cerrarOfertaEnTx(
  tx: Tx,
  offerId: string,
  modo: 'ENDED' | 'CANCELLED',
  motivo: string,
  ctx: ContextoAuditoria
): Promise<{ liberadas: number }> {
  const o = await ofertaBloqueada(tx, offerId)
  if (o.status === modo) return { liberadas: 0 }
  exigirTransicion(TRANSICIONES_OFERTA, o.status, modo, 'Oferta')
  const reservasVivas = o.allocationId
    ? await tx.supplyV2OrderReservation.count({ where: { allocationLine: { allocationId: o.allocationId }, status: 'ACTIVE' } })
    : 0
  if (reservasVivas > 0 && modo === 'CANCELLED') {
    fallo('OFERTA_CON_RESERVAS', 'Hay checkouts en curso sobre esta oferta: pausa la oferta y espera a que se paguen o expiren antes de cancelarla.')
  }
  let liberadas = 0
  if (o.allocationId) {
    liberadas = (await liberarAsignacionEnTx(tx, o.allocationId, motivo, modo, ctx)).liberadas
  }
  await tx.supplyV2Offer.update({ where: { id: o.id }, data: { status: modo, endedAt: new Date() } })
  await auditarEnTx(tx, ctx, modo === 'ENDED' ? 'SUPPLY_V2_OFFER_ENDED' : 'SUPPLY_V2_OFFER_CANCELLED', 'SupplyV2Offer', o.id, {
    code: o.code,
    antes: o.status,
    despues: modo,
    motivo,
    liberadas,
  }, o.supplier.companyId)
  return { liberadas }
}

/** Marca SOLD_OUT cuando ya no queda nada por vender ni por reservar (derivado, §18). */
export async function marcarAgotadaSiCorrespondeEnTx(tx: Tx, offerId: string): Promise<void> {
  const o = await tx.supplyV2Offer.findUnique({
    where: { id: offerId },
    select: { id: true, status: true, allocation: { select: { allocatedQuantity: true, issuedQuantity: true, releasedQuantity: true, reservedQuantity: true } } },
  })
  if (!o?.allocation || o.status !== 'ACTIVE') return
  const a = o.allocation
  if (a.issuedQuantity + a.releasedQuantity >= a.allocatedQuantity && a.reservedQuantity === 0) {
    await tx.supplyV2Offer.update({ where: { id: o.id }, data: { status: 'SOLD_OUT' } })
    await tx.supplyV2Allocation.updateMany({ where: { offer: { id: o.id } }, data: { status: 'EXHAUSTED' } })
  }
}
