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
