import type { Tx } from '@/lib/tenant'
import { auditarCatalogo, type ContextoAuditoria } from './auditoria'
import { elegirSlugLibre, slugDeNombre } from './domain'
import { fallo } from './errores'
import { itemEditable } from './service'

/**
 * COMMERCE CORE · catálogo — imágenes y categorías (F1.2).
 *
 * Mismo contrato que `service.ts`: dentro de la transacción de quien llama,
 * filtrando siempre por `companyId`, y sin importar nada de `supply-v2`. Las
 * imágenes y las categorías cuelgan de un ítem EDITABLE: uno archivado o que
 * viene de Supply no las recibe.
 */

export const MAX_IMAGENES_POR_ITEM = 10
export const MAX_CATEGORIAS_POR_ITEM = 20
export const MAX_NOMBRE_CATEGORIA = 80

// ── Imágenes ─────────────────────────────────────────────────────────────────

/** Prefijo de Storage que DEBE llevar toda imagen de este ítem. */
export function prefijoImagenesItem(companyId: string, itemId: string): string {
  return `${companyId}/catalogo/${itemId}/`
}

/**
 * Antes de subir nada: ¿puede este ítem recibir otra imagen? Devuelve cuántas
 * lleva. Se llama ANTES de gastar ancho de banda y cuota de Storage.
 */
export async function exigirCupoDeImagen(tx: Tx, companyId: string, itemId: string): Promise<number> {
  await itemEditable(tx, companyId, itemId)
  const total = await tx.catalogItemImage.count({ where: { catalogItemId: itemId, companyId } })
  if (total >= MAX_IMAGENES_POR_ITEM) {
    fallo('IMAGENES_LLENAS', `Un producto admite hasta ${MAX_IMAGENES_POR_ITEM} imágenes.`)
  }
  return total
}

/**
 * Registra una imagen YA subida. La ruta debe ser de esta empresa y de este
 * ítem: lo que llega aquí lo escribió el servidor, pero esta puerta no se
 * fía de quien la llame.
 */
export async function registrarImagenEnTx(
  tx: Tx,
  companyId: string,
  itemId: string,
  path: string,
  alt: string | null,
  ctx: ContextoAuditoria
): Promise<{ id: string; position: number }> {
  if (!path.startsWith(prefijoImagenesItem(companyId, itemId)) || path.includes('..')) {
    fallo('IMAGEN_INVALIDA', 'La ruta de la imagen no corresponde a este producto.')
  }
  await exigirCupoDeImagen(tx, companyId, itemId)
  const ultima = await tx.catalogItemImage.findFirst({
    where: { catalogItemId: itemId, companyId },
    orderBy: { position: 'desc' },
    select: { position: true },
  })
  const position = (ultima?.position ?? -1) + 1
  const fila = await tx.catalogItemImage.create({
    data: { companyId, catalogItemId: itemId, path, alt: alt?.trim().slice(0, 160) || null, position },
    select: { id: true },
  })
  await auditarCatalogo(tx, ctx, companyId, 'CATALOG_ITEM_UPDATED', 'CatalogItem', itemId, {
    cambio: 'imagen_agregada',
    imagenId: fila.id,
  })
  return { id: fila.id, position }
}

/** Quita la fila y devuelve la ruta, para que quien llama borre también el archivo. */
export async function eliminarImagenEnTx(
  tx: Tx,
  companyId: string,
  imagenId: string,
  ctx: ContextoAuditoria
): Promise<{ path: string }> {
  const imagen = await tx.catalogItemImage.findFirst({ where: { id: imagenId, companyId } })
  if (!imagen) fallo('IMAGEN_NO_ENCONTRADA', 'La imagen no existe.')
  await itemEditable(tx, companyId, imagen.catalogItemId)
  await tx.catalogItemImage.delete({ where: { id: imagen.id } })
  await auditarCatalogo(tx, ctx, companyId, 'CATALOG_ITEM_UPDATED', 'CatalogItem', imagen.catalogItemId, {
    cambio: 'imagen_eliminada',
    imagenId: imagen.id,
  })
  return { path: imagen.path }
}

/** La imagen elegida pasa a ser la primera (la portada); el resto conserva su orden. */
export async function ponerPortadaEnTx(
  tx: Tx,
  companyId: string,
  imagenId: string,
  ctx: ContextoAuditoria
): Promise<void> {
  const elegida = await tx.catalogItemImage.findFirst({ where: { id: imagenId, companyId } })
  if (!elegida) fallo('IMAGEN_NO_ENCONTRADA', 'La imagen no existe.')
  await itemEditable(tx, companyId, elegida.catalogItemId)
  const todas = await tx.catalogItemImage.findMany({
    where: { catalogItemId: elegida.catalogItemId, companyId },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    select: { id: true },
  })
  const orden = [elegida.id, ...todas.map((t) => t.id).filter((id) => id !== elegida.id)]
  for (const [position, id] of orden.entries()) {
    await tx.catalogItemImage.update({ where: { id }, data: { position } })
  }
  await auditarCatalogo(tx, ctx, companyId, 'CATALOG_ITEM_UPDATED', 'CatalogItem', elegida.catalogItemId, {
    cambio: 'portada',
    imagenId: elegida.id,
  })
}

// ── Categorías ───────────────────────────────────────────────────────────────

export async function listarCategoriasEnTx(tx: Tx, companyId: string) {
  return tx.catalogCategory.findMany({
    where: { companyId },
    orderBy: [{ position: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true, slug: true, _count: { select: { items: true } } },
  })
}

export async function crearCategoriaEnTx(
  tx: Tx,
  companyId: string,
  nombre: string
): Promise<{ id: string; name: string; slug: string }> {
  const name = typeof nombre === 'string' ? nombre.trim() : ''
  if (!name) fallo('CATEGORIA_INVALIDA', 'La categoría necesita un nombre.')
  if (name.length > MAX_NOMBRE_CATEGORIA) fallo('CATEGORIA_INVALIDA', 'El nombre de la categoría es demasiado largo.')

  // Bajo cerrojo por empresa, por la misma razón que el slug de los ítems: un
  // INSERT que choca aborta la transacción entera.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'catalogo:categoria:' + companyId}))`
  const repetida = await tx.catalogCategory.findFirst({
    where: { companyId, name: { equals: name, mode: 'insensitive' } },
    select: { id: true },
  })
  if (repetida) fallo('CATEGORIA_DUPLICADA', `Ya tienes una categoría llamada «${name}».`)

  const base = slugDeNombre(name)
  const ocupados = new Set(
    (await tx.catalogCategory.findMany({ where: { companyId, slug: { startsWith: base } }, select: { slug: true } })).map(
      (c) => c.slug
    )
  )
  const slug = elegirSlugLibre(base, ocupados)
  return tx.catalogCategory.create({ data: { companyId, name, slug }, select: { id: true, name: true, slug: true } })
}

/** Borra la categoría; los ítems NO se borran, solo pierden la etiqueta (cascada de la tabla puente). */
export async function eliminarCategoriaEnTx(tx: Tx, companyId: string, categoriaId: string): Promise<void> {
  const c = await tx.catalogCategory.findFirst({ where: { id: categoriaId, companyId }, select: { id: true } })
  if (!c) fallo('CATEGORIA_NO_ENCONTRADA', 'La categoría no existe.')
  await tx.catalogCategory.delete({ where: { id: c.id } })
}

/** Deja al ítem con EXACTAMENTE estas categorías (todas de su empresa). */
export async function asignarCategoriasEnTx(
  tx: Tx,
  companyId: string,
  itemId: string,
  categoriaIds: readonly string[],
  ctx: ContextoAuditoria
): Promise<void> {
  await itemEditable(tx, companyId, itemId)
  const ids = [...new Set(categoriaIds.filter((x) => typeof x === 'string' && x))]
  if (ids.length > MAX_CATEGORIAS_POR_ITEM) {
    fallo('CATEGORIA_INVALIDA', `Un producto admite hasta ${MAX_CATEGORIAS_POR_ITEM} categorías.`)
  }
  if (ids.length > 0) {
    const propias = await tx.catalogCategory.count({ where: { companyId, id: { in: ids } } })
    if (propias !== ids.length) fallo('CATEGORIA_NO_ENCONTRADA', 'Alguna categoría no existe.')
  }
  await tx.catalogItemCategory.deleteMany({ where: { catalogItemId: itemId, companyId } })
  if (ids.length > 0) {
    await tx.catalogItemCategory.createMany({
      data: ids.map((categoryId) => ({ companyId, catalogItemId: itemId, categoryId })),
    })
  }
  await auditarCatalogo(tx, ctx, companyId, 'CATALOG_ITEM_UPDATED', 'CatalogItem', itemId, {
    cambio: 'categorias',
    categorias: ids.length,
  })
}
