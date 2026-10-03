import { Prisma } from '@prisma/client'
import type { Tx } from '@/lib/tenant'
import { auditarEnTx, type ContextoAuditoria } from '../core/auditoria'
import { fallo } from '../core/errores'
import { estadoInicialOferta, exigirTransicion, OFERTA_EDITABLE, TRANSICIONES_OFERTA } from '../core/estados'
import { siguienteNumero } from '../core/numeracion'
import { mismoMonto, type Monto } from '../core/dinero'
import { OFFER_STATUS_LABELS } from '../core/catalogo'
import { resolverPrecioDeDatos, type PrecioResuelto } from '../core/precios'
import { asignarEnTx, liberarAsignacionEnTx } from '../allocations/service'
import { resolverAcuerdoComisionDeItemEnTx } from '../agreements/service'
import { edicionCambiaElPrecio, slugDeOferta, unidadesLibresComision, validarEdicionOferta, validarOferta, validarOfertaComision, type DatosEdicionOferta, type DatosOferta, type DatosOfertaComision } from './domain'

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

  const precio = resolverPrecioDeDatos(d)
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
      priceMode: precio.mode,
      priceModePercentage: precio.percentage,
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
 * Slice 5 (§10–§12) · OFERTA A COMISIÓN: sin PO, sin recepción, sin lote, sin
 * asignación. Exige un acuerdo a comisión vigente que cubra el producto
 * (ITEM > CATEGORY > CATALOG) y congela acuerdo, versión y porcentaje en la
 * oferta. La disponibilidad es propia (sin tope, cantidad fija o capacidad).
 */
export async function crearOfertaComisionEnTx(tx: Tx, d: DatosOfertaComision, ctx: ContextoAuditoria): Promise<OfertaCreada & { commissionPercentage: string; agreementCode: string; commissionScope: string }> {
  if (!ctx.actorId) fallo('SIN_ACTOR', 'Una oferta necesita quién la crea.')
  const error = validarOfertaComision(d)
  if (error) fallo('OFERTA_INVALIDA', error)
  const item = await tx.supplyV2CatalogItem.findUnique({
    where: { id: d.catalogItemId },
    select: { id: true, name: true, status: true, supplierId: true, currency: true, supplier: { select: { status: true, companyId: true } } },
  })
  if (!item) fallo('ITEM_NO_ENCONTRADO', 'El producto no existe.')
  if (item.status !== 'ACTIVE') fallo('ITEM_INACTIVO', 'El producto no está activo.')
  if (item.supplier.status !== 'ACTIVE') fallo('PROVEEDOR_INACTIVO', 'El proveedor no está activo.')
  const acuerdo = await resolverAcuerdoComisionDeItemEnTx(tx, item.id)
  if (!acuerdo) fallo('SIN_ACUERDO_COMISION', 'Este producto no tiene un acuerdo a comisión vigente (por producto, categoría o catálogo). Crea y activa uno antes de vender a comisión.')

  const precio = resolverPrecioDeDatos(d)
  const code = await siguienteNumero(tx, 'MBG-OF', async (prefijo) => {
    const u = await tx.supplyV2Offer.findFirst({ where: { code: { startsWith: prefijo } }, orderBy: { code: 'desc' }, select: { code: true } })
    return u?.code ?? null
  })
  const sinTope = d.availabilityMode === 'UNLIMITED'
  const creada = await tx.supplyV2Offer.create({
    data: {
      supplierId: item.supplierId,
      catalogItemId: item.id,
      code,
      slug: slugDeOferta(d.title, code),
      title: d.title.trim(),
      description: d.description?.trim() || null,
      sourceType: 'COMMISSION',
      publicPrice: precio.publicPrice,
      salePrice: precio.salePrice,
      priceMode: precio.mode,
      priceModePercentage: precio.percentage,
      currency: item.currency,
      // quantityLimit es informativo en comisión: lo que manda es availabilityMode/Quantity.
      quantityLimit: sinTope ? 0 : d.availabilityQuantity!,
      perCustomerLimit: d.perCustomerLimit ?? 1,
      agreementId: acuerdo.agreementId,
      agreementVersionId: acuerdo.agreementVersionId,
      commissionPercentage: acuerdo.commissionPercentage,
      commissionScope: acuerdo.scope,
      availabilityMode: d.availabilityMode,
      availabilityQuantity: sinTope ? null : d.availabilityQuantity!,
      startsAt: d.startsAt,
      endsAt: d.endsAt ?? null,
      imagePath: d.imagePath ?? null,
      status: 'DRAFT',
      createdById: ctx.actorId,
    },
    select: { id: true, code: true, slug: true, status: true },
  })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_COMMISSION_OFFER_CREATED', 'SupplyV2Offer', creada.id, {
    code: creada.code,
    catalogItemId: item.id,
    agreementId: acuerdo.agreementId,
    agreementCode: acuerdo.code,
    agreementVersionId: acuerdo.agreementVersionId,
    commissionPercentage: acuerdo.commissionPercentage.toFixed(2),
    commissionScope: acuerdo.scope,
    availabilityMode: d.availabilityMode,
    availabilityQuantity: sinTope ? null : d.availabilityQuantity,
    publicPrice: precio.publicPrice.toString(),
    salePrice: precio.salePrice.toString(),
  }, item.supplier.companyId)
  return { ...creada, commissionPercentage: acuerdo.commissionPercentage.toFixed(2), agreementCode: acuerdo.code, commissionScope: acuerdo.scope }
}

/**
 * PUBLICAR (§16): aparta el supply y activa. Idempotente: publicar una oferta
 * ya publicada devuelve lo que hay sin asignar dos veces.
 * Slice 5: una oferta a COMISIÓN no aparta nada; al publicar se vuelve a
 * resolver el acuerdo (sigue vigente y cubre el producto) y se congela.
 */
export async function publicarOfertaEnTx(tx: Tx, offerId: string, ctx: ContextoAuditoria): Promise<{ id: string; status: string; allocationId: string | null }> {
  if (!ctx.actorId) fallo('SIN_ACTOR', 'Publicar una oferta necesita quién la publica.')
  await tx.$queryRaw`SELECT "id" FROM "supply_v2_offers" WHERE "id" = ${offerId} FOR UPDATE`
  const o = await tx.supplyV2Offer.findUnique({
    where: { id: offerId },
    select: { id: true, code: true, title: true, status: true, sourceType: true, allocationId: true, catalogItemId: true, quantityLimit: true, startsAt: true, endsAt: true, supplier: { select: { companyId: true } } },
  })
  if (!o) fallo('OFERTA_NO_ENCONTRADA', 'La oferta no existe.')
  if (o.status !== 'DRAFT' && (o.allocationId || o.sourceType === 'COMMISSION')) return { id: o.id, status: o.status, allocationId: o.allocationId }
  if (o.status !== 'DRAFT') fallo('OFERTA_NO_PUBLICABLE', `Una oferta ${o.status} no se puede publicar.`)
  if (o.endsAt && o.endsAt <= new Date()) fallo('OFERTA_VENCIDA', 'La vigencia de la oferta ya pasó: cambia la fecha de fin antes de publicar.')

  if (o.sourceType === 'COMMISSION') {
    const acuerdo = await resolverAcuerdoComisionDeItemEnTx(tx, o.catalogItemId)
    if (!acuerdo) fallo('SIN_ACUERDO_COMISION', 'El producto ya no tiene un acuerdo a comisión vigente: no se puede publicar.')
    const status = estadoInicialOferta(o.startsAt)
    exigirTransicion(TRANSICIONES_OFERTA, o.status, status, 'Oferta')
    await tx.supplyV2Offer.update({
      where: { id: o.id },
      data: { status, agreementId: acuerdo.agreementId, agreementVersionId: acuerdo.agreementVersionId, commissionPercentage: acuerdo.commissionPercentage, commissionScope: acuerdo.scope, publishedById: ctx.actorId, publishedAt: new Date() },
    })
    await auditarEnTx(tx, ctx, 'SUPPLY_V2_OFFER_PUBLISHED', 'SupplyV2Offer', o.id, {
      code: o.code,
      antes: 'DRAFT',
      despues: status,
      sourceType: 'COMMISSION',
      agreementId: acuerdo.agreementId,
      agreementVersionId: acuerdo.agreementVersionId,
      commissionPercentage: acuerdo.commissionPercentage.toFixed(2),
      commissionScope: acuerdo.scope,
      allocationId: null,
    }, o.supplier.companyId)
    return { id: o.id, status, allocationId: null }
  }

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

/**
 * EDITAR una oferta ya publicada (§7–§15).
 *
 * Hasta ahora una errata en un título obligaba a cancelar la oferta y publicar
 * otra, con código y enlace nuevos. Esto lo arregla, con dos guardas:
 *
 *  · El TÍTULO, la descripción y la imagen se cambian siempre. La línea de la
 *    orden congela `titleSnapshot`, así que ningún recibo emitido se mueve.
 *  · El PRECIO solo se cambia si no hay checkouts en curso. Quien ya tiene una
 *    reserva viva está a punto de pagar lo que la pantalla le prometió.
 *
 * La guarda mira solo reservas ACTIVE, y no APPLIED como su hermana
 * `ajustarPromocionEnTx`: allí el ledger del beneficio sigue moviéndose tras el
 * pago, mientras que aquí una orden pagada ya congeló sus importes en la línea
 * y es intocable por construcción. Esa diferencia es justo lo que hace que
 * editar precios sea seguro.
 *
 * `quantityLimit` NO se edita: ver `validarEdicionOferta`.
 */
export async function editarOfertaEnTx(
  tx: Tx,
  offerId: string,
  d: DatosEdicionOferta,
  ctx: ContextoAuditoria
): Promise<{ id: string; code: string; cambios: string[] }> {
  await tx.$queryRaw`SELECT "id" FROM "supply_v2_offers" WHERE "id" = ${offerId} FOR UPDATE`
  const o = await tx.supplyV2Offer.findUnique({
    where: { id: offerId },
    select: {
      id: true, code: true, status: true, allocationId: true, title: true, description: true, imagePath: true,
      publicPrice: true, salePrice: true, priceMode: true, priceModePercentage: true,
      quantityLimit: true, perCustomerLimit: true, startsAt: true, endsAt: true,
      supplier: { select: { companyId: true } },
    },
  })
  if (!o) fallo('OFERTA_NO_ENCONTRADA', 'La oferta no existe.')
  if (!OFERTA_EDITABLE.includes(o.status)) {
    fallo('OFERTA_NO_EDITABLE', `Una oferta ${OFFER_STATUS_LABELS[o.status].toLowerCase()} ya no se edita: publica una nueva.`)
  }

  const error = validarEdicionOferta(d, {
    publicPrice: o.publicPrice.toFixed(2),
    salePrice: o.salePrice.toFixed(2),
    priceMode: o.priceMode,
    priceModePercentage: o.priceModePercentage?.toString() ?? null,
    quantityLimit: o.quantityLimit,
    startsAt: o.startsAt,
  })
  if (error) fallo('EDICION_INVALIDA', error)

  // `startsAt` solo antes de arrancar: con la oferta viva ya decidió su estado.
  if (d.startsAt !== undefined && !['DRAFT', 'SCHEDULED'].includes(o.status)) {
    fallo('EDICION_INVALIDA', 'La fecha de inicio no se cambia con la oferta ya publicada.')
  }

  // El precio se RESUELVE entero cuando la edición toca cualquiera de sus
  // cuatro piezas, nunca se escribe campo a campo. Subir el precio de lista de
  // una oferta al 35 % tiene que recalcular el precio Membego: dejarlo como
  // estaba cobraría un descuento que ya no es el 35 % y que nadie eligió.
  const tocaElPrecio =
    d.publicPrice !== undefined || d.salePrice !== undefined || d.priceMode !== undefined || d.priceModePercentage !== undefined
  let resuelto: PrecioResuelto | null = null
  if (tocaElPrecio) {
    try {
      resuelto = resolverPrecioDeDatos({
        publicPrice: d.publicPrice ?? o.publicPrice,
        salePrice: d.salePrice ?? o.salePrice,
        priceMode: d.priceMode ?? o.priceMode,
        priceModePercentage: d.priceModePercentage !== undefined ? d.priceModePercentage : o.priceModePercentage,
      })
    } catch (e) {
      fallo('EDICION_INVALIDA', e instanceof Error ? e.message : 'El precio no es válido.')
    }
  }
  if (edicionCambiaElPrecio(resuelto, o)) {
    const vivas = o.allocationId
      ? await tx.supplyV2OrderReservation.count({ where: { allocationLine: { allocationId: o.allocationId }, status: 'ACTIVE' } })
      : await tx.supplyV2CommissionReservation.count({ where: { offerId: o.id, status: 'ACTIVE' } })
    if (vivas > 0) {
      fallo('OFERTA_CON_CHECKOUTS', 'Hay checkouts en curso sobre esta oferta: su precio no se puede cambiar ahora. Pausa la oferta y espera a que se paguen o expiren.')
    }
  }

  const data: Prisma.SupplyV2OfferUpdateInput = {}
  const cambios: string[] = []
  const anota = (campo: string, antes: unknown, despues: unknown) => {
    if (String(antes ?? '') !== String(despues ?? '')) cambios.push(campo)
  }
  // El dinero NO se compara como texto: `'600'` y `'600.00'` son el mismo
  // precio y `anota` los daría por distintos.
  const anotaMonto = (campo: string, antes: Prisma.Decimal, despues: Monto) => {
    if (!mismoMonto(antes, despues)) cambios.push(campo)
  }
  if (d.title !== undefined) { anota('título', o.title, d.title.trim()); data.title = d.title.trim() }
  if (d.description !== undefined) { anota('descripción', o.description, d.description); data.description = d.description }
  if (d.imagePath !== undefined) { anota('imagen', o.imagePath, d.imagePath); data.imagePath = d.imagePath }
  if (resuelto) {
    anotaMonto('precio público', o.publicPrice, resuelto.publicPrice)
    anotaMonto('precio Membego', o.salePrice, resuelto.salePrice)
    anota('modo de precio', o.priceMode, resuelto.mode)
    anota('porcentaje', o.priceModePercentage?.toString() ?? null, resuelto.percentage?.toString() ?? null)
    data.publicPrice = resuelto.publicPrice
    data.salePrice = resuelto.salePrice
    data.priceMode = resuelto.mode
    data.priceModePercentage = resuelto.percentage
  }
  if (d.perCustomerLimit !== undefined) { anota('máximo por persona', o.perCustomerLimit, d.perCustomerLimit); data.perCustomerLimit = d.perCustomerLimit }
  if (d.startsAt !== undefined) { anota('inicio', o.startsAt.toISOString(), d.startsAt.toISOString()); data.startsAt = d.startsAt }
  if (d.endsAt !== undefined) { anota('fin', o.endsAt?.toISOString() ?? null, d.endsAt?.toISOString() ?? null); data.endsAt = d.endsAt }

  if (cambios.length === 0) return { id: o.id, code: o.code, cambios: [] }

  await tx.supplyV2Offer.update({ where: { id: o.id }, data })
  // La asignación guarda su propia vigencia: dejarla desfasada haría que el
  // dato mintiera aunque hoy nadie la lea para decidir.
  if (d.endsAt !== undefined && o.allocationId) {
    await tx.supplyV2Allocation.update({ where: { id: o.allocationId }, data: { endsAt: d.endsAt } })
  }
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_OFFER_UPDATED', 'SupplyV2Offer', o.id, { code: o.code, cambios }, o.supplier.companyId)
  return { id: o.id, code: o.code, cambios }
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
    : await tx.supplyV2CommissionReservation.count({ where: { offerId: o.id, status: 'ACTIVE' } })
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
    select: { id: true, status: true, sourceType: true, availabilityMode: true, availabilityQuantity: true, allocation: { select: { allocatedQuantity: true, issuedQuantity: true, releasedQuantity: true, reservedQuantity: true } } },
  })
  if (!o || o.status !== 'ACTIVE') return
  if (o.sourceType === 'COMMISSION') {
    const libres = await unidadesLibresDeOfertaComisionEnTx(tx, o)
    if (libres === 0) await tx.supplyV2Offer.update({ where: { id: o.id }, data: { status: 'SOLD_OUT' } })
    return
  }
  if (!o.allocation) return
  const a = o.allocation
  if (a.issuedQuantity + a.releasedQuantity >= a.allocatedQuantity && a.reservedQuantity === 0) {
    await tx.supplyV2Offer.update({ where: { id: o.id }, data: { status: 'SOLD_OUT' } })
    await tx.supplyV2Allocation.updateMany({ where: { offer: { id: o.id } }, data: { status: 'EXHAUSTED' } })
  }
}

/** Slice 5 (§14): tope − (reservas ACTIVE + CONSUMED). `null` sin tope. Llamar con la oferta bloqueada cuando importe. */
export async function unidadesLibresDeOfertaComisionEnTx(tx: Tx, o: { id: string; availabilityMode: 'UNLIMITED' | 'FIXED_QUANTITY' | 'CAPACITY' | null; availabilityQuantity: number | null }): Promise<number | null> {
  if (!o.availabilityMode || o.availabilityMode === 'UNLIMITED') return null
  const r = await tx.supplyV2CommissionReservation.aggregate({ where: { offerId: o.id, status: { in: ['ACTIVE', 'CONSUMED'] } }, _sum: { quantity: true } })
  return unidadesLibresComision(o, r._sum.quantity ?? 0)
}
