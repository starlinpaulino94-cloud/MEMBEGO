import { Prisma } from '@prisma/client'
import type { CatalogItemStatus } from '@prisma/client'
import type { Tx } from '@/lib/tenant'
import { siguienteNumero } from '@/lib/commerce-primitives/numeracion'
import { auditarCatalogo, type ContextoAuditoria } from './auditoria'
import {
  elegirSlugLibre,
  motivoParaNoPublicar,
  normalizarCapacidades,
  puedeCambiarEstadoItem,
  slugDeNombre,
  validarItem,
  validarVariante,
  MAX_DESCRIPCION,
  MAX_NOMBRE_ITEM,
  MAX_VARIANTES_POR_ITEM,
  type DatosItem,
  type DatosVariante,
  type VarianteNormalizada,
} from './domain'
import { fallo } from './errores'

/**
 * COMMERCE CORE · catálogo — servicio (Fase 1).
 *
 * Todo corre DENTRO de la transacción `tx` que abre quien llama (con
 * `conEmpresa`), y cada consulta filtra además por `companyId` aunque la RLS
 * ya lo haga: con la Capa 2 apagada, ese filtro es lo único que separa a una
 * empresa de otra.
 *
 * LA REGLA QUE ESTE ARCHIVO CUIDA: crear un ítem crea su variante en la MISMA
 * transacción. Un ítem sin variante no se puede confirmar (lo impide también
 * un disparador diferido en la base), pero aquí ni se intenta.
 */

export interface VarianteCreada {
  id: string
  name: string
  sku: string
  isDefault: boolean
}

export interface ItemCreado {
  id: string
  slug: string
  status: CatalogItemStatus
  variants: VarianteCreada[]
}

/** Nombre que el sistema da a la variante automática y el que pasa a tener al dejar de ser la única. */
const NOMBRE_VARIANTE_DEFAULT = 'Default'
const NOMBRE_VARIANTE_ESTANDAR = 'Estándar'

const dec = (v: string | null): Prisma.Decimal | null => (v == null ? null : new Prisma.Decimal(v))

// ── SKU ──────────────────────────────────────────────────────────────────────

/**
 * Siguiente SKU automático de la empresa: `SKU-<AÑO>-<SECUENCIA>`.
 *
 * El cerrojo es POR EMPRESA (`catalogo:<companyId>`): dos altas simultáneas de
 * la misma empresa se turnan, y empresas distintas no se esperan entre sí. El
 * último número se busca con una expresión regular y no con `startsWith`
 * porque un SKU que la empresa escribió a mano (`SKU-2026-ABC`) empieza igual
 * y, ordenado como texto, ganaría al último numérico: el siguiente saldría
 * como `…-000001` y chocaría.
 */
export async function siguienteSku(tx: Tx, companyId: string, fecha = new Date()): Promise<string> {
  return siguienteNumero(
    tx,
    'SKU',
    async (prefijo) => {
      const filas = await tx.$queryRaw<{ sku: string }[]>`
        SELECT "sku" FROM "catalog_variants"
        WHERE "companyId" = ${companyId} AND "sku" ~ ${'^' + prefijo + '[0-9]{6,}$'}
        ORDER BY "sku" DESC LIMIT 1`
      return filas[0]?.sku ?? null
    },
    fecha,
    `catalogo:${companyId}`
  )
}

async function exigirSkuLibre(tx: Tx, companyId: string, sku: string, exceptoId?: string): Promise<void> {
  const repetido = await tx.catalogVariant.findFirst({
    where: { companyId, sku, ...(exceptoId ? { id: { not: exceptoId } } : {}) },
    select: { id: true },
  })
  if (repetido) fallo('SKU_DUPLICADO', `El SKU ${sku} ya existe en tu catálogo.`)
}

async function exigirBarcodeLibre(tx: Tx, companyId: string, barcode: string, exceptoId?: string): Promise<void> {
  const repetido = await tx.catalogVariant.findFirst({
    where: { companyId, barcode, ...(exceptoId ? { id: { not: exceptoId } } : {}) },
    select: { id: true },
  })
  if (repetido) fallo('BARCODE_DUPLICADO', `El código de barras ${barcode} ya existe en tu catálogo.`)
}

async function crearVarianteFila(
  tx: Tx,
  companyId: string,
  catalogItemId: string,
  v: VarianteNormalizada,
  opciones: { isDefault: boolean; position: number }
): Promise<VarianteCreada> {
  if (v.sku) await exigirSkuLibre(tx, companyId, v.sku)
  if (v.barcode) await exigirBarcodeLibre(tx, companyId, v.barcode)
  const sku = v.sku ?? (await siguienteSku(tx, companyId))
  const fila = await tx.catalogVariant.create({
    data: {
      companyId,
      catalogItemId,
      name: v.name,
      sku,
      barcode: v.barcode,
      price: new Prisma.Decimal(v.price),
      cost: dec(v.cost),
      compareAtPrice: dec(v.compareAtPrice),
      attributes: v.attributes,
      isDefault: opciones.isDefault,
      status: v.status,
      position: opciones.position,
    },
    select: { id: true, name: true, sku: true, isDefault: true },
  })
  return fila
}

// ── Ítems ────────────────────────────────────────────────────────────────────

/**
 * Crea un ítem y sus variantes. Sin `variants` es un ítem SIMPLE: nace con una
 * variante `isDefault` (nombre «Default», SKU automático salvo que se dé uno).
 * Nace en BORRADOR: publicarlo es una decisión aparte.
 */
export async function crearItemEnTx(
  tx: Tx,
  companyId: string,
  entrada: DatosItem,
  ctx: ContextoAuditoria
): Promise<ItemCreado> {
  const v = validarItem(entrada)
  if (!v.ok) fallo('ITEM_INVALIDO', v.error)
  const d = v.datos

  // El slug se elige ANTES de insertar y bajo cerrojo: dentro de una
  // transacción de PostgreSQL un INSERT que choca aborta la transacción
  // entera, así que no se puede «probar y reintentar». El índice único sigue
  // siendo la última red.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'catalogo:slug:' + companyId}))`
  const base = slugDeNombre(d.name)
  const ocupados = new Set(
    (
      await tx.catalogItem.findMany({
        where: { companyId, slug: { startsWith: base } },
        select: { slug: true },
      })
    ).map((x) => x.slug)
  )
  const slug = elegirSlugLibre(base, ocupados)

  const item = await tx.catalogItem.create({
    data: {
      companyId,
      name: d.name,
      slug,
      description: d.description,
      type: d.type,
      currency: d.currency,
      capabilities: { ...d.capabilities },
      status: 'DRAFT',
    },
    select: { id: true, slug: true, status: true },
  })

  const variants: VarianteCreada[] = []
  for (const [i, variante] of d.variantes.entries()) {
    variants.push(await crearVarianteFila(tx, companyId, item.id, variante, { isDefault: d.simple, position: i }))
  }

  await auditarCatalogo(tx, ctx, companyId, 'CATALOG_ITEM_CREATED', 'CatalogItem', item.id, {
    name: d.name,
    type: d.type,
    simple: d.simple,
    variantes: variants.length,
  })
  return { ...item, variants }
}

/** El ítem de ESTA empresa, editable: existe, no viene de Supply y no está archivado. */
export async function itemEditable(tx: Tx, companyId: string, itemId: string) {
  const item = await tx.catalogItem.findFirst({
    where: { id: itemId, companyId },
    select: { id: true, name: true, description: true, type: true, status: true, source: true, capabilities: true },
  })
  if (!item) fallo('ITEM_NO_ENCONTRADO', 'El producto no existe.')
  if (item.source === 'SUPPLY') {
    fallo('ITEM_SOLO_LECTURA', 'Este producto viene de Membego Supply y no se edita aquí.')
  }
  if (item.status === 'ARCHIVED') fallo('ITEM_ARCHIVADO', 'El producto está archivado. Restáuralo para editarlo.')
  return item
}

export interface CambiosItem {
  name?: string
  description?: string | null
  capabilities?: unknown
}

/** Edita nombre, descripción y capacidades. El slug NO cambia: un enlace compartido no debe morir. */
export async function actualizarItemEnTx(
  tx: Tx,
  companyId: string,
  itemId: string,
  cambios: CambiosItem,
  ctx: ContextoAuditoria
): Promise<void> {
  const item = await itemEditable(tx, companyId, itemId)

  const data: Prisma.CatalogItemUpdateInput = {}
  const antes: Record<string, string | null> = {}
  const despues: Record<string, string | null> = {}

  if (cambios.name !== undefined) {
    const name = cambios.name.trim()
    if (!name) fallo('ITEM_INVALIDO', 'El producto necesita un nombre.')
    if (name.length > MAX_NOMBRE_ITEM) fallo('ITEM_INVALIDO', 'El nombre es demasiado largo.')
    if (name !== item.name) {
      data.name = name
      antes.name = item.name
      despues.name = name
    }
  }
  if (cambios.description !== undefined) {
    const description = cambios.description?.trim() || null
    if (description && description.length > MAX_DESCRIPCION) fallo('ITEM_INVALIDO', 'La descripción es demasiado larga.')
    if (description !== item.description) {
      data.description = description
      antes.description = item.description
      despues.description = description
    }
  }
  if (cambios.capabilities !== undefined) {
    const nuevas = normalizarCapacidades(item.type, cambios.capabilities)
    // Dejar de controlar inventario con existencias a la vista las esconde: el
    // saldo seguiría ahí, sin pantalla que lo muestre ni operación que lo mueva.
    if (normalizarCapacidades(item.type, item.capabilities).trackInventory && !nuevas.trackInventory) {
      const conExistencias = await tx.inventoryLevel.count({
        where: { companyId, variant: { catalogItemId: item.id }, OR: [{ onHand: { gt: 0 } }, { reserved: { gt: 0 } }, { damaged: { gt: 0 } }] },
      })
      if (conExistencias > 0) {
        fallo('ITEM_CON_EXISTENCIAS', 'Este producto todavía tiene existencias registradas. Déjalas en cero (venta, ajuste o baja) antes de dejar de controlar su inventario.')
      }
    }
    data.capabilities = { ...nuevas }
    despues.capabilities = 'actualizadas'
  }
  if (Object.keys(data).length === 0) return

  await tx.catalogItem.update({ where: { id: item.id }, data })
  await auditarCatalogo(tx, ctx, companyId, 'CATALOG_ITEM_UPDATED', 'CatalogItem', item.id, { antes, despues })
}

/**
 * Cambia el estado del ítem por la tabla de transiciones. Publicarlo exige una
 * variante activa; la primera vez que se activa se anota `publishedAt`.
 */
export async function cambiarEstadoItemEnTx(
  tx: Tx,
  companyId: string,
  itemId: string,
  hasta: CatalogItemStatus,
  ctx: ContextoAuditoria
): Promise<void> {
  const item = await tx.catalogItem.findFirst({
    where: { id: itemId, companyId },
    select: { id: true, status: true, source: true, publishedAt: true },
  })
  if (!item) fallo('ITEM_NO_ENCONTRADO', 'El producto no existe.')
  if (item.source === 'SUPPLY') {
    fallo('ITEM_SOLO_LECTURA', 'Este producto viene de Membego Supply y no se edita aquí.')
  }
  if (!puedeCambiarEstadoItem(item.status, hasta)) {
    fallo('TRANSICION_INVALIDA', `No se puede pasar de ${item.status} a ${hasta}.`)
  }
  if (hasta === 'ACTIVE') {
    const variantes = await tx.catalogVariant.findMany({
      where: { catalogItemId: item.id, companyId },
      select: { status: true },
    })
    const motivo = motivoParaNoPublicar(variantes)
    if (motivo) fallo('NO_SE_PUEDE_PUBLICAR', motivo)
  }

  await tx.catalogItem.update({
    where: { id: item.id },
    data: { status: hasta, ...(hasta === 'ACTIVE' && !item.publishedAt ? { publishedAt: new Date() } : {}) },
  })
  await auditarCatalogo(tx, ctx, companyId, 'CATALOG_ITEM_STATUS_CHANGED', 'CatalogItem', item.id, {
    antes: item.status,
    despues: hasta,
  })
}

// ── Variantes ────────────────────────────────────────────────────────────────

/**
 * Agrega una variante a un ítem. Si el ítem solo tenía la variante automática,
 * esa deja de serlo: «default» significa «la única, creada por el sistema», y
 * con una segunda ya no es ninguna de las dos cosas.
 */
export async function agregarVarianteEnTx(
  tx: Tx,
  companyId: string,
  itemId: string,
  entrada: DatosVariante,
  ctx: ContextoAuditoria
): Promise<VarianteCreada> {
  const item = await itemEditable(tx, companyId, itemId)
  if (!entrada.name?.trim()) fallo('VARIANTE_INVALIDA', 'La variante necesita un nombre (p. ej. «M / Rojo»).')
  const v = validarVariante(entrada)
  if (!v.ok) fallo('VARIANTE_INVALIDA', v.error)

  const existentes = await tx.catalogVariant.findMany({
    where: { catalogItemId: item.id, companyId },
    select: { id: true, name: true, isDefault: true, position: true },
  })
  if (existentes.length >= MAX_VARIANTES_POR_ITEM) {
    fallo('VARIANTE_INVALIDA', `Un producto admite hasta ${MAX_VARIANTES_POR_ITEM} variantes.`)
  }
  if (existentes.some((e) => !e.isDefault && e.name.toLowerCase() === v.datos.name.toLowerCase())) {
    fallo('VARIANTE_INVALIDA', `Ya hay una variante llamada «${v.datos.name}».`)
  }

  // La automática se baja ANTES de insertar la nueva: el disparador diferido
  // revisa al confirmar, pero el índice único «una default por ítem» y el
  // orden de las filas se llevan mejor así.
  // Y si todavía lleva el nombre que le puso el SISTEMA («Default»), se le da uno
  // que la persona entienda en una lista de variantes. Un nombre que ella
  // misma eligió no se toca.
  if (v.datos.name.toLowerCase() !== NOMBRE_VARIANTE_ESTANDAR.toLowerCase()) {
    await tx.catalogVariant.updateMany({
      where: { catalogItemId: item.id, companyId, isDefault: true, name: NOMBRE_VARIANTE_DEFAULT },
      data: { name: NOMBRE_VARIANTE_ESTANDAR },
    })
  }
  await tx.catalogVariant.updateMany({ where: { catalogItemId: item.id, companyId, isDefault: true }, data: { isDefault: false } })
  const position = existentes.reduce((m, e) => Math.max(m, e.position), -1) + 1
  const creada = await crearVarianteFila(tx, companyId, item.id, v.datos, { isDefault: false, position })

  await auditarCatalogo(tx, ctx, companyId, 'CATALOG_VARIANT_CHANGED', 'CatalogVariant', creada.id, {
    accion: 'creada',
    itemId: item.id,
    sku: creada.sku,
    despues: { price: v.datos.price, status: v.datos.status },
  })
  return creada
}

export type CambiosVariante = Partial<DatosVariante>

/** Edita una variante. `undefined` = no tocar; `null` = vaciar (costo, precio anterior, código). */
export async function actualizarVarianteEnTx(
  tx: Tx,
  companyId: string,
  varianteId: string,
  cambios: CambiosVariante,
  ctx: ContextoAuditoria
): Promise<void> {
  const actual = await tx.catalogVariant.findFirst({ where: { id: varianteId, companyId } })
  if (!actual) fallo('VARIANTE_NO_ENCONTRADA', 'La variante no existe.')
  const item = await itemEditable(tx, companyId, actual.catalogItemId)

  const fusion: DatosVariante = {
    name: cambios.name !== undefined ? cambios.name : actual.name,
    sku: cambios.sku !== undefined ? cambios.sku : actual.sku,
    barcode: cambios.barcode !== undefined ? cambios.barcode : actual.barcode,
    price: cambios.price !== undefined ? cambios.price : actual.price.toFixed(2),
    cost: cambios.cost !== undefined ? cambios.cost : actual.cost?.toFixed(2) ?? null,
    compareAtPrice:
      cambios.compareAtPrice !== undefined ? cambios.compareAtPrice : actual.compareAtPrice?.toFixed(2) ?? null,
    attributes:
      cambios.attributes !== undefined ? cambios.attributes : (actual.attributes as Record<string, unknown>),
    status: cambios.status !== undefined ? cambios.status : actual.status,
  }
  const v = validarVariante(fusion)
  if (!v.ok) fallo('VARIANTE_INVALIDA', v.error)
  const d = v.datos

  if (d.sku && d.sku !== actual.sku) await exigirSkuLibre(tx, companyId, d.sku, actual.id)
  if (d.barcode && d.barcode !== actual.barcode) await exigirBarcodeLibre(tx, companyId, d.barcode, actual.id)

  if (item.status === 'ACTIVE' && actual.status === 'ACTIVE' && d.status !== 'ACTIVE') {
    await exigirOtraActiva(tx, companyId, item.id, actual.id)
  }

  await tx.catalogVariant.update({
    where: { id: actual.id },
    data: {
      name: d.name,
      sku: d.sku ?? actual.sku,
      barcode: d.barcode,
      price: new Prisma.Decimal(d.price),
      cost: dec(d.cost),
      compareAtPrice: dec(d.compareAtPrice),
      attributes: d.attributes,
      status: d.status,
    },
  })
  await auditarCatalogo(tx, ctx, companyId, 'CATALOG_VARIANT_CHANGED', 'CatalogVariant', actual.id, {
    accion: 'editada',
    itemId: item.id,
    sku: d.sku ?? actual.sku,
    antes: { price: actual.price.toFixed(2), status: actual.status },
    despues: { price: d.price, status: d.status },
  })
}

/** Un ítem ACTIVO no puede quedarse sin nada que vender. */
async function exigirOtraActiva(tx: Tx, companyId: string, itemId: string, excepto: string): Promise<void> {
  const otra = await tx.catalogVariant.findFirst({
    where: { catalogItemId: itemId, companyId, status: 'ACTIVE', id: { not: excepto } },
    select: { id: true },
  })
  if (!otra) {
    fallo('SIN_VARIANTE_ACTIVA', 'El producto está publicado y esta es su única variante activa. Pausa el producto primero.')
  }
}

/**
 * Quita una variante. La ÚLTIMA no se puede quitar (todo ítem tiene al menos
 * una) y, cuando ya haya pedidos o inventario que la referencien, la base
 * tampoco lo permitirá: lo que se hace entonces es DESCONTINUARLA.
 */
export async function eliminarVarianteEnTx(
  tx: Tx,
  companyId: string,
  varianteId: string,
  ctx: ContextoAuditoria
): Promise<void> {
  const actual = await tx.catalogVariant.findFirst({ where: { id: varianteId, companyId } })
  if (!actual) fallo('VARIANTE_NO_ENCONTRADA', 'La variante no existe.')
  const item = await itemEditable(tx, companyId, actual.catalogItemId)

  const total = await tx.catalogVariant.count({ where: { catalogItemId: item.id, companyId } })
  if (total <= 1) fallo('ULTIMA_VARIANTE', 'Un producto necesita al menos una variante. Archiva el producto si ya no se vende.')
  if (item.status === 'ACTIVE' && actual.status === 'ACTIVE') await exigirOtraActiva(tx, companyId, item.id, actual.id)

  // El historial de inventario es contabilidad: con movimientos no se borra
  // (la base lo impide con FK RESTRICT); se descontinúa. Un saldo SIN movimientos
  // (solo se configuró un umbral) no es historial y se retira con la variante.
  const movimientos = await tx.inventoryMovement.count({ where: { companyId, level: { catalogVariantId: actual.id } } })
  if (movimientos > 0) {
    fallo('VARIANTE_CON_INVENTARIO', 'Esta variante tiene historial de inventario y no se puede borrar. Márcala como descontinuada.')
  }
  await tx.inventoryLevel.deleteMany({ where: { companyId, catalogVariantId: actual.id } })

  await tx.catalogVariant.delete({ where: { id: actual.id } })
  await auditarCatalogo(tx, ctx, companyId, 'CATALOG_VARIANT_CHANGED', 'CatalogVariant', actual.id, {
    accion: 'eliminada',
    itemId: item.id,
    sku: actual.sku,
    antes: { price: actual.price.toFixed(2), status: actual.status },
  })
}
