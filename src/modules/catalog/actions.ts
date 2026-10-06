'use server'

/**
 * COMMERCE CORE · catálogo — acciones (Fase 1, sin interfaz todavía).
 *
 * Todas detrás de `requireSection('catalogo', <función>)`: la capacidad
 * CATALOGO_UNIFICADO y los permisos por empleado gobiernan cada mutación. La
 * empresa sale SIEMPRE de la sesión (`resolveCompanyId`), nunca de lo que
 * mande el navegador, y todo corre en `conEmpresa`.
 *
 * Devuelven un resultado, no lanzan: el mensaje de un `CatalogoError` se
 * enseña tal cual; cualquier otro error se traduce a uno genérico para no
 * filtrar detalles de la base.
 */

import { revalidatePath } from 'next/cache'
import type { CatalogItemStatus } from '@prisma/client'
import { conEmpresa } from '@/lib/tenant'
import { requireSection } from '@/lib/auth/guards'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { getRequestMeta } from '@/lib/server-utils'
import { createAdminClient } from '@/lib/supabase/admin'
import { uniqueFileName } from '@/lib/storage'
import { rutaCatalogo } from '@/lib/storage-rutas'
import { detectarTipoImagen, EXTENSION_DE_IMAGEN } from '@/lib/imagen-tipo'
import type { SessionUser } from '@/types'
import type { ContextoAuditoria } from './auditoria'
import type { DatosItem, DatosVariante } from './domain'
import { CatalogoError } from './errores'
import {
  actualizarItemEnTx,
  actualizarVarianteEnTx,
  agregarVarianteEnTx,
  cambiarEstadoItemEnTx,
  crearItemEnTx,
  eliminarVarianteEnTx,
  type CambiosItem,
  type CambiosVariante,
} from './service'
import {
  asignarCategoriasEnTx,
  crearCategoriaEnTx,
  eliminarCategoriaEnTx,
  eliminarImagenEnTx,
  exigirCupoDeImagen,
  ponerPortadaEnTx,
  prefijoImagenesItem,
  registrarImagenEnTx,
} from './medios'
import { urlPublicaCatalogo } from './formato'

export type ResultadoCatalogo<T = unknown> = ({ ok: true } & T) | { ok: false; error: string }

const RUTA = '/admin/catalogo'
const ESTADOS: readonly CatalogItemStatus[] = ['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED']

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

async function contexto(
  funcion: string
): Promise<{ user: SessionUser; companyId: string; ctx: ContextoAuditoria } | { error: string }> {
  const user = await requireSection('catalogo', funcion)
  if (!user) return { error: 'No autorizado.' }
  const companyId = await resolveCompanyId(user)
  if (!companyId) return { error: 'Selecciona una empresa activa.' }
  const meta = await getRequestMeta()
  return { user, companyId, ctx: { actorId: user.metadata.dbUserId ?? null, ...meta } }
}

function aError(e: unknown): { ok: false; error: string } {
  if (e instanceof CatalogoError) return { ok: false, error: e.message }
  console.error('[catalogo]', e instanceof Error ? e.message : e)
  return { ok: false, error: 'No se pudo completar la operación. Intenta de nuevo.' }
}

export async function crearItemCatalogo(
  entrada: DatosItem
): Promise<ResultadoCatalogo<{ id: string; slug: string }>> {
  const c = await contexto('crear')
  if ('error' in c) return { ok: false, error: c.error }
  if (!esObjeto(entrada)) return { ok: false, error: 'Datos no válidos.' }
  try {
    const r = await conEmpresa(c.companyId, (tx) => crearItemEnTx(tx, c.companyId, entrada, c.ctx))
    revalidatePath(RUTA)
    return { ok: true, id: r.id, slug: r.slug }
  } catch (e) {
    return aError(e)
  }
}

export async function actualizarItemCatalogo(itemId: string, cambios: CambiosItem): Promise<ResultadoCatalogo> {
  const c = await contexto('editar')
  if ('error' in c) return { ok: false, error: c.error }
  if (typeof itemId !== 'string' || !esObjeto(cambios)) return { ok: false, error: 'Datos no válidos.' }
  try {
    await conEmpresa(c.companyId, (tx) => actualizarItemEnTx(tx, c.companyId, itemId, cambios, c.ctx))
    revalidatePath(RUTA)
    return { ok: true }
  } catch (e) {
    return aError(e)
  }
}

/**
 * Publicar, pausar, archivar o restaurar. La función de permiso depende del
 * destino (archivar y publicar se conceden por separado), así que el destino
 * se valida ANTES de pedir la guardia.
 */
export async function cambiarEstadoItemCatalogo(itemId: string, estado: CatalogItemStatus): Promise<ResultadoCatalogo> {
  if (typeof itemId !== 'string' || !ESTADOS.includes(estado)) return { ok: false, error: 'Datos no válidos.' }
  // Archivar y publicar se conceden por separado; restaurar a borrador es editar.
  const funcion = estado === 'ARCHIVED' ? 'archivar' : estado === 'DRAFT' ? 'editar' : 'publicar'
  const c = await contexto(funcion)
  if ('error' in c) return { ok: false, error: c.error }
  try {
    await conEmpresa(c.companyId, (tx) => cambiarEstadoItemEnTx(tx, c.companyId, itemId, estado, c.ctx))
    revalidatePath(RUTA)
    return { ok: true }
  } catch (e) {
    return aError(e)
  }
}

export async function agregarVarianteCatalogo(
  itemId: string,
  datos: DatosVariante
): Promise<ResultadoCatalogo<{ id: string; sku: string }>> {
  const c = await contexto('variante')
  if ('error' in c) return { ok: false, error: c.error }
  if (typeof itemId !== 'string' || !esObjeto(datos)) return { ok: false, error: 'Datos no válidos.' }
  try {
    const r = await conEmpresa(c.companyId, (tx) => agregarVarianteEnTx(tx, c.companyId, itemId, datos, c.ctx))
    revalidatePath(RUTA)
    return { ok: true, id: r.id, sku: r.sku }
  } catch (e) {
    return aError(e)
  }
}

export async function actualizarVarianteCatalogo(
  varianteId: string,
  cambios: CambiosVariante
): Promise<ResultadoCatalogo> {
  const c = await contexto('variante')
  if ('error' in c) return { ok: false, error: c.error }
  if (typeof varianteId !== 'string' || !esObjeto(cambios)) return { ok: false, error: 'Datos no válidos.' }
  try {
    await conEmpresa(c.companyId, (tx) => actualizarVarianteEnTx(tx, c.companyId, varianteId, cambios, c.ctx))
    revalidatePath(RUTA)
    return { ok: true }
  } catch (e) {
    return aError(e)
  }
}

export async function eliminarVarianteCatalogo(varianteId: string): Promise<ResultadoCatalogo> {
  const c = await contexto('variante')
  if ('error' in c) return { ok: false, error: c.error }
  if (typeof varianteId !== 'string') return { ok: false, error: 'Datos no válidos.' }
  try {
    await conEmpresa(c.companyId, (tx) => eliminarVarianteEnTx(tx, c.companyId, varianteId, c.ctx))
    revalidatePath(RUTA)
    return { ok: true }
  } catch (e) {
    return aError(e)
  }
}

// ── Imágenes ─────────────────────────────────────────────────────────────────

const BUCKET = 'promociones'
const MAX_MB = 5
const MAX_BYTES = MAX_MB * 1024 * 1024

/**
 * Sube una imagen al ítem. Escribe con el cliente de SERVICIO, que ignora las
 * políticas de Storage: por eso la autorización ocurre ANTES de crearlo (sesión,
 * permiso, empresa de la sesión, ítem de esa empresa, cupo), y el tipo y la
 * extensión los decide la FIRMA del archivo, no `file.type` ni `file.name`.
 * Mismo criterio que `subirImagenExcursion`.
 */
export async function subirImagenCatalogo(
  itemId: string,
  file: File
): Promise<ResultadoCatalogo<{ id: string; url: string | null }>> {
  const c = await contexto('editar')
  if ('error' in c) return { ok: false, error: c.error }
  if (typeof itemId !== 'string' || !itemId) return { ok: false, error: 'Datos no válidos.' }
  if (!file || typeof file.arrayBuffer !== 'function') return { ok: false, error: 'Archivo no válido.' }
  if (file.size > MAX_BYTES) return { ok: false, error: `La imagen no puede superar ${MAX_MB} MB.` }

  try {
    await conEmpresa(c.companyId, (tx) => exigirCupoDeImagen(tx, c.companyId, itemId))

    const buffer = Buffer.from(await file.arrayBuffer())
    if (buffer.length > MAX_BYTES) return { ok: false, error: `La imagen no puede superar ${MAX_MB} MB.` }
    const tipo = detectarTipoImagen(buffer)
    if (!tipo) return { ok: false, error: 'Formato no permitido. Usa JPG, PNG o WebP.' }

    const path = rutaCatalogo(c.companyId, itemId, uniqueFileName(EXTENSION_DE_IMAGEN[tipo]))
    const supabase = createAdminClient()
    const { error } = await supabase.storage.from(BUCKET).upload(path, buffer, { contentType: tipo, upsert: false })
    if (error) {
      console.error('[catalogo-imagen] upload:', error.message)
      return { ok: false, error: 'No se pudo subir la imagen. Intenta de nuevo.' }
    }

    try {
      const r = await conEmpresa(c.companyId, (tx) => registrarImagenEnTx(tx, c.companyId, itemId, path, null, c.ctx))
      revalidatePath(RUTA)
      return { ok: true, id: r.id, url: urlPublicaCatalogo(path) }
    } catch (e) {
      // El archivo ya está en Storage y la fila no se pudo escribir: no dejar huérfanos.
      await supabase.storage.from(BUCKET).remove([path]).catch(() => undefined)
      throw e
    }
  } catch (e) {
    return aError(e)
  }
}

export async function eliminarImagenCatalogo(imagenId: string): Promise<ResultadoCatalogo> {
  const c = await contexto('editar')
  if ('error' in c) return { ok: false, error: c.error }
  if (typeof imagenId !== 'string') return { ok: false, error: 'Datos no válidos.' }
  try {
    const { path, itemId } = await conEmpresa(c.companyId, async (tx) => {
      const imagen = await tx.catalogItemImage.findFirst({
        where: { id: imagenId, companyId: c.companyId },
        select: { catalogItemId: true },
      })
      const r = await eliminarImagenEnTx(tx, c.companyId, imagenId, c.ctx)
      return { path: r.path, itemId: imagen?.catalogItemId ?? '' }
    })
    // Solo se borra del bucket lo que cuelga del ítem de ESTA empresa.
    if (path.startsWith(prefijoImagenesItem(c.companyId, itemId))) {
      await createAdminClient().storage.from(BUCKET).remove([path]).catch(() => undefined)
    }
    revalidatePath(RUTA)
    return { ok: true }
  } catch (e) {
    return aError(e)
  }
}

export async function ponerPortadaCatalogo(imagenId: string): Promise<ResultadoCatalogo> {
  const c = await contexto('editar')
  if ('error' in c) return { ok: false, error: c.error }
  if (typeof imagenId !== 'string') return { ok: false, error: 'Datos no válidos.' }
  try {
    await conEmpresa(c.companyId, (tx) => ponerPortadaEnTx(tx, c.companyId, imagenId, c.ctx))
    revalidatePath(RUTA)
    return { ok: true }
  } catch (e) {
    return aError(e)
  }
}

// ── Categorías ───────────────────────────────────────────────────────────────

export async function crearCategoriaCatalogo(
  nombre: string
): Promise<ResultadoCatalogo<{ id: string; name: string }>> {
  const c = await contexto('editar')
  if ('error' in c) return { ok: false, error: c.error }
  try {
    const r = await conEmpresa(c.companyId, (tx) => crearCategoriaEnTx(tx, c.companyId, nombre))
    revalidatePath(RUTA)
    return { ok: true, id: r.id, name: r.name }
  } catch (e) {
    return aError(e)
  }
}

export async function eliminarCategoriaCatalogo(categoriaId: string): Promise<ResultadoCatalogo> {
  const c = await contexto('editar')
  if ('error' in c) return { ok: false, error: c.error }
  if (typeof categoriaId !== 'string') return { ok: false, error: 'Datos no válidos.' }
  try {
    await conEmpresa(c.companyId, (tx) => eliminarCategoriaEnTx(tx, c.companyId, categoriaId))
    revalidatePath(RUTA)
    return { ok: true }
  } catch (e) {
    return aError(e)
  }
}

export async function asignarCategoriasCatalogo(itemId: string, categoriaIds: string[]): Promise<ResultadoCatalogo> {
  const c = await contexto('editar')
  if ('error' in c) return { ok: false, error: c.error }
  if (typeof itemId !== 'string' || !Array.isArray(categoriaIds)) return { ok: false, error: 'Datos no válidos.' }
  try {
    await conEmpresa(c.companyId, (tx) => asignarCategoriasEnTx(tx, c.companyId, itemId, categoriaIds, c.ctx))
    revalidatePath(RUTA)
    return { ok: true }
  } catch (e) {
    return aError(e)
  }
}
