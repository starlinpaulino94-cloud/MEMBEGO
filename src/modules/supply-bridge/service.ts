import type { CatalogItemStatus } from '@prisma/client'
import type { Tx } from '@/lib/tenant'
import { ofertaParaPuenteEnTx } from '@/modules/supply-v2/marketplace/read-model'
import { CAPACIDADES_PUENTE, diferencias, itemDeseado, type ItemActual, type OfertaOrigen } from './domain'
import { fallo } from './errores'

/**
 * SUPPLY BRIDGE · la sincronización Supply V2 → catálogo unificado (Fase 2.5).
 *
 * UNIDIRECCIONAL e IDEMPOTENTE: Supply es el master, el ítem puente es su
 * reflejo y la empresa no lo edita (`itemEditable` del catálogo lo rechaza por
 * `source = SUPPLY`). Correr dos veces la misma sincronización no cambia nada la
 * segunda; dos corriendo a la vez sobre la misma oferta se serializan con un
 * candado de transacción.
 *
 * Todo corre en la transacción de quien llama, que cruza empresas a propósito
 * (`sinEmpresa`): el puente lee de Supply y escribe en la empresa de la casa.
 *
 * El puente solo llama a Supply por su read model público
 * (`ofertaParaPuenteEnTx`: el mismo DTO cerrado que ve el cliente, sin costos
 * ni lotes) y Commerce Core no importa nada de aquí: la dependencia va de
 * `supply-bridge` hacia los dos, nunca al revés.
 */

export type ResultadoSincronizacion = {
  resultado: 'SIN_CASA' | 'OMITIDA' | 'CONFLICTO' | 'CREADO' | 'ACTUALIZADO' | 'SIN_CAMBIOS'
  itemId: string | null
  /** Qué campos cambiaron (vacío si no hubo cambios). */
  cambios: string[]
}

export interface CasaMembego {
  id: string
  name: string
  slug: string
}

/** La empresa de la casa, o null si el superadmin no ha designado ninguna. */
export async function casaMembegoEnTx(tx: Tx): Promise<CasaMembego | null> {
  return tx.company.findFirst({ where: { esCasaMembego: true }, select: { id: true, name: true, slug: true } })
}

/** Un slug libre en la empresa de la casa: el de la oferta, o con su código si estuviera ocupado. */
async function slugLibre(tx: Tx, casaId: string, deseado: string, codigo: string): Promise<string> {
  const candidatos = [deseado, `${deseado}-${codigo.toLowerCase()}`]
  for (const slug of candidatos) {
    const ocupado = await tx.catalogItem.findFirst({ where: { companyId: casaId, slug }, select: { id: true } })
    if (!ocupado) return slug
  }
  return `${deseado}-${Date.now().toString(36)}`
}

function aOrigen(o: Awaited<ReturnType<typeof ofertaParaPuenteEnTx>> & object, descripcion: string | null): OfertaOrigen {
  return {
    slug: o.oferta.slug,
    code: o.oferta.code,
    title: o.oferta.title,
    description: descripcion,
    supplier: o.oferta.supplier,
    currency: o.oferta.currency,
    publicPrice: o.oferta.publicPrice,
    salePrice: o.oferta.salePrice,
    status: o.status,
    available: o.oferta.available,
    remaining: o.oferta.remaining,
    unlimited: o.oferta.unlimited,
  }
}

/**
 * Refleja UNA oferta en el catálogo de la casa: crea el ítem la primera vez que
 * deja de ser borrador y después lo mantiene al día (nombre, descripción,
 * precio, estado, disponibilidad). Sin empresa de la casa no hace nada.
 */
export async function sincronizarOfertaEnTx(tx: Tx, offerId: string): Promise<ResultadoSincronizacion> {
  // Una sola sincronización de esta oferta a la vez (la acción tras el cambio y el cron pueden coincidir).
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'supply_bridge:' + offerId}, 0))`

  const casa = await casaMembegoEnTx(tx)
  if (!casa) return { resultado: 'SIN_CASA', itemId: null, cambios: [] }

  const origen = await ofertaParaPuenteEnTx(tx, offerId)
  if (!origen) return { resultado: 'OMITIDA', itemId: null, cambios: [] }
  // El texto libre de la oferta viene del read model como `description`.
  const deseado = itemDeseado(aOrigen(origen, origen.oferta.description))
  const existente = await tx.catalogItem.findUnique({
    where: { supplyV2OfferId: offerId },
    select: {
      id: true,
      companyId: true,
      name: true,
      description: true,
      currency: true,
      status: true,
      publishedAt: true,
      variants: { select: { id: true, price: true, compareAtPrice: true, status: true }, orderBy: { position: 'asc' } },
    },
  })

  if (!deseado) return { resultado: 'OMITIDA', itemId: existente?.id ?? null, cambios: [] }
  if (existente && existente.companyId !== casa.id) {
    // La casa cambió con ítems ya sincronizados: no se mueven entre empresas a escondidas.
    return { resultado: 'CONFLICTO', itemId: existente.id, cambios: [] }
  }

  if (!existente) {
    const slug = await slugLibre(tx, casa.id, deseado.slug, origen.oferta.code)
    const item = await tx.catalogItem.create({
      data: {
        companyId: casa.id,
        name: deseado.name,
        slug,
        description: deseado.description,
        type: 'VOUCHER',
        status: deseado.status,
        source: 'SUPPLY',
        currency: deseado.currency,
        capabilities: { ...CAPACIDADES_PUENTE },
        publishedAt: deseado.status === 'ACTIVE' ? new Date() : null,
        supplyV2OfferId: offerId,
      },
      select: { id: true },
    })
    // Ítem y variante en la MISMA transacción: la base rechaza un ítem sin variante al confirmar.
    await tx.catalogVariant.createMany({
      data: [
        {
          companyId: casa.id,
          catalogItemId: item.id,
          name: deseado.variant.name,
          sku: deseado.variant.sku,
          price: deseado.variant.price,
          compareAtPrice: deseado.variant.compareAtPrice,
          status: deseado.variant.status,
          isDefault: true,
          position: 0,
        },
      ],
    })
    await tx.auditLog.create({
      data: { companyId: casa.id, userId: null, accion: 'CATALOG_ITEM_CREATED', entidadTipo: 'CatalogItem', entidadId: item.id, payload: { origen: 'supply-bridge', ofertaId: offerId, oferta: origen.oferta.code } },
    })
    return { resultado: 'CREADO', itemId: item.id, cambios: [] }
  }

  const variante = existente.variants[0] ?? null
  const actual: ItemActual = {
    name: existente.name,
    description: existente.description,
    currency: existente.currency,
    status: existente.status,
    variant: variante ? { price: variante.price.toFixed(2), compareAtPrice: variante.compareAtPrice?.toFixed(2) ?? null, status: variante.status } : null,
  }
  const cambios = diferencias(actual, deseado)
  if (cambios.length === 0) return { resultado: 'SIN_CAMBIOS', itemId: existente.id, cambios }
  if (!variante) fallo('ITEM_SIN_VARIANTE', 'El ítem puente no tiene variante (la base lo impide: revisar la integridad).')

  await tx.catalogItem.update({
    where: { id: existente.id },
    data: {
      name: deseado.name,
      description: deseado.description,
      currency: deseado.currency,
      status: deseado.status as CatalogItemStatus,
      ...(deseado.status === 'ACTIVE' && !existente.publishedAt ? { publishedAt: new Date() } : {}),
    },
  })
  await tx.catalogVariant.update({
    where: { id: variante.id },
    data: { price: deseado.variant.price, compareAtPrice: deseado.variant.compareAtPrice, status: deseado.variant.status },
  })
  await tx.auditLog.create({
    data: { companyId: casa.id, userId: null, accion: 'CATALOG_ITEM_UPDATED', entidadTipo: 'CatalogItem', entidadId: existente.id, payload: { origen: 'supply-bridge', ofertaId: offerId, cambios } },
  })
  return { resultado: 'ACTUALIZADO', itemId: existente.id, cambios }
}

/**
 * Sin empresa de la casa, nada debe quedar publicado por el puente: archiva
 * todos los ítems puente (se conservan; si se vuelve a designar una casa, la
 * siguiente sincronización los reactiva). Devuelve cuántos archivó.
 */
export async function archivarPuenteEnTx(tx: Tx): Promise<number> {
  const r = await tx.catalogItem.updateMany({ where: { source: 'SUPPLY', status: { not: 'ARCHIVED' } }, data: { status: 'ARCHIVED' } })
  return r.count
}

export interface EstadoPuente {
  casa: CasaMembego | null
  /** Ítems puente por estado. */
  items: Record<CatalogItemStatus, number>
  /** Ofertas no borrador que todavía no tienen su ítem (esperan una sincronización). */
  pendientes: number
}

export async function estadoDelPuenteEnTx(tx: Tx): Promise<EstadoPuente> {
  const casa = await casaMembegoEnTx(tx)
  const grupos = await tx.catalogItem.groupBy({ by: ['status'], where: { source: 'SUPPLY' }, _count: { _all: true } })
  const items: Record<CatalogItemStatus, number> = { DRAFT: 0, ACTIVE: 0, PAUSED: 0, ARCHIVED: 0 }
  for (const g of grupos) items[g.status] = g._count._all
  const pendientes = await tx.supplyV2Offer.count({ where: { status: { not: 'DRAFT' }, itemPuente: null } })
  return { casa, items, pendientes }
}

export interface ContextoPuente {
  actorId: string | null
  ipAddress?: string | null
  userAgent?: string | null
}

/**
 * Designa (o retira, con `null`) la empresa de la casa. No se cambia de casa
 * mientras haya ítems puente colgando de otra: moverlos entre empresas es una
 * migración, no un clic. Retirarla archiva los ítems puente.
 */
export async function designarCasaEnTx(tx: Tx, companyId: string | null, ctx: ContextoPuente): Promise<{ archivados: number }> {
  const actual = await casaMembegoEnTx(tx)
  if (companyId === null) {
    if (!actual) return { archivados: 0 }
    await tx.company.update({ where: { id: actual.id }, data: { esCasaMembego: false } })
    const archivados = await archivarPuenteEnTx(tx)
    await tx.auditLog.create({
      data: { companyId: actual.id, userId: ctx.actorId, accion: 'SUPPLY_BRIDGE_HOUSE_CHANGED', entidadTipo: 'Company', entidadId: actual.id, payload: { antes: actual.id, despues: null, archivados }, ipAddress: ctx.ipAddress ?? null, userAgent: ctx.userAgent ?? null },
    })
    return { archivados }
  }

  const empresa = await tx.company.findUnique({ where: { id: companyId }, select: { id: true, esDemo: true, isActive: true } })
  if (!empresa) fallo('EMPRESA_NO_ENCONTRADA', 'La empresa no existe.')
  if (empresa.esDemo) fallo('EMPRESA_DEMO', 'Una empresa de demostración no puede ser la de la casa.')
  if (actual?.id === empresa.id) return { archivados: 0 }

  const ajenos = await tx.catalogItem.count({ where: { source: 'SUPPLY', companyId: { not: empresa.id } } })
  if (ajenos > 0) {
    fallo('CASA_CON_ITEMS', `Hay ${ajenos} ítem(s) puente colgando de la empresa de la casa actual. Retira esa empresa primero (se archivan) y vuelve a designar.`)
  }
  if (actual) await tx.company.update({ where: { id: actual.id }, data: { esCasaMembego: false } })
  await tx.company.update({ where: { id: empresa.id }, data: { esCasaMembego: true } })
  await tx.auditLog.create({
    data: { companyId: empresa.id, userId: ctx.actorId, accion: 'SUPPLY_BRIDGE_HOUSE_CHANGED', entidadTipo: 'Company', entidadId: empresa.id, payload: { antes: actual?.id ?? null, despues: empresa.id }, ipAddress: ctx.ipAddress ?? null, userAgent: ctx.userAgent ?? null },
  })
  return { archivados: 0 }
}

