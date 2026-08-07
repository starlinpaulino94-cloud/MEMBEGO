'use server'

import { revalidatePath } from 'next/cache'
import { requireSection } from '@/lib/auth/guards'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { SegmentoServicio } from './segmentos'
import {
  estimarAudiencia,
  estimarSegmento as estimarSegmentoServicio,
  type Estimacion,
} from './estimador'
import { CampanaDirigidaService } from './campanas'
import type { SegmentoRaiz } from './arbol'
import type { CampanaCanal } from '@prisma/client'

/**
 * Server actions del constructor de segmentos y campañas dirigidas.
 * Guard: `requireSection('audiencia')` (admin pleno o MARKETING) — barrera real,
 * el middleware no protege las server actions.
 */

export interface ActionState {
  error?: string
  success?: boolean
  id?: string
  estimacion?: Estimacion
}

interface Autorizacion {
  companyId: string
  userId: string
}

async function autorizar(): Promise<Autorizacion | { error: string }> {
  const user = await requireSection('audiencia')
  if (!user) return { error: 'No autorizado.' }
  const companyId = user.metadata.companyId ?? (await resolveCompanyId(user))
  if (!companyId) return { error: 'Selecciona la empresa primero.' }
  return { companyId, userId: user.metadata.dbUserId ?? '' }
}

function mensaje(e: unknown): string {
  return e instanceof Error ? e.message : 'Error inesperado.'
}

function parseRaiz(raw: unknown): SegmentoRaiz {
  const texto = String(raw ?? '')
  if (!texto) return { operador: 'AND', condiciones: [], grupos: [] }
  try {
    return JSON.parse(texto) as SegmentoRaiz
  } catch {
    throw new Error('El árbol de condiciones no es válido.')
  }
}

function parseJsonList<T>(raw: unknown): T[] {
  const texto = String(raw ?? '')
  if (!texto) return []
  try {
    const v = JSON.parse(texto)
    return Array.isArray(v) ? (v as T[]) : []
  } catch {
    return []
  }
}

function parseFecha(raw: unknown): Date | null {
  const texto = String(raw ?? '')
  if (!texto || Number.isNaN(Date.parse(texto))) return null
  return new Date(texto)
}

// ─── Segmentos ────────────────────────────────────────────────────────────────

export async function crearSegmentoAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    const auth = await autorizar()
    if ('error' in auth) return { error: auth.error }
    const nombre = String(formData.get('nombre') ?? '')
    const descripcion = String(formData.get('descripcion') ?? '')
    const raiz = parseRaiz(formData.get('raiz'))
    const id = await SegmentoServicio.crear(auth.companyId, auth.userId, {
      nombre,
      descripcion,
      raiz,
    })
    revalidatePath('/admin/audiencia/segmentos')
    return { success: true, id }
  } catch (e) {
    return { error: mensaje(e) }
  }
}

export async function actualizarSegmentoAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    const auth = await autorizar()
    if ('error' in auth) return { error: auth.error }
    const segmentoId = String(formData.get('segmentoId') ?? '')
    const nombre = String(formData.get('nombre') ?? '')
    const descripcion = String(formData.get('descripcion') ?? '')
    const raiz = parseRaiz(formData.get('raiz'))
    await SegmentoServicio.actualizar(auth.companyId, segmentoId, { nombre, descripcion, raiz })
    revalidatePath('/admin/audiencia/segmentos')
    revalidatePath(`/admin/audiencia/segmentos/${segmentoId}/editar`)
    return { success: true, id: segmentoId }
  } catch (e) {
    return { error: mensaje(e) }
  }
}

export async function archivarSegmentoAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    const auth = await autorizar()
    if ('error' in auth) return { error: auth.error }
    await SegmentoServicio.archivar(auth.companyId, String(formData.get('segmentoId') ?? ''))
    revalidatePath('/admin/audiencia/segmentos')
    return { success: true }
  } catch (e) {
    return { error: mensaje(e) }
  }
}

export async function eliminarSegmentoAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    const auth = await autorizar()
    if ('error' in auth) return { error: auth.error }
    await SegmentoServicio.eliminar(auth.companyId, String(formData.get('segmentoId') ?? ''))
    revalidatePath('/admin/audiencia/segmentos')
    return { success: true }
  } catch (e) {
    return { error: mensaje(e) }
  }
}

/** Estimación de un segmento GUARDADO (panel de la lista o detalle). */
export async function estimarSegmentoAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    const auth = await autorizar()
    if ('error' in auth) return { error: auth.error }
    const estimacion = await estimarSegmentoServicio(
      auth.companyId,
      String(formData.get('segmentoId') ?? '')
    )
    revalidatePath('/admin/audiencia/segmentos')
    return { success: true, estimacion }
  } catch (e) {
    return { error: mensaje(e) }
  }
}

/** Vista previa en vivo del constructor (el segmento aún no se guarda). */
export async function estimarAudienciaAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    const auth = await autorizar()
    if ('error' in auth) return { error: auth.error }
    const raiz = parseRaiz(formData.get('raiz'))
    const estimacion = await estimarAudiencia(auth.companyId, raiz)
    return { success: true, estimacion }
  } catch (e) {
    return { error: mensaje(e) }
  }
}

// ─── Campañas dirigidas ───────────────────────────────────────────────────────

/** Variantes de un argumento para `<form action={fn}>` en páginas server. */
export async function archivarSegmento(formData: FormData): Promise<void> {
  await archivarSegmentoAction({}, formData)
}

export async function eliminarSegmento(formData: FormData): Promise<void> {
  await eliminarSegmentoAction({}, formData)
}

export async function estimarSegmento(formData: FormData): Promise<void> {
  await estimarSegmentoAction({}, formData)
}

function canalesDeForm(formData: FormData): CampanaCanal[] {
  return parseJsonList<CampanaCanal>(formData.get('canales'))
}

export async function crearCampanaAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    const auth = await autorizar()
    if ('error' in auth) return { error: auth.error }
    const id = await CampanaDirigidaService.crear(auth.companyId, auth.userId, {
      nombre: String(formData.get('nombre') ?? ''),
      mensaje: String(formData.get('mensaje') ?? ''),
      canales: canalesDeForm(formData),
      programadaEn: parseFecha(formData.get('programadaEn')),
      maxPorDia: Number(formData.get('maxPorDia') ?? 1),
      maxPorSemana: Number(formData.get('maxPorSemana') ?? 2),
      prioridad: Number(formData.get('prioridad') ?? 0),
      segmentoId: String(formData.get('segmentoId') ?? '') || null,
      sucursalId: String(formData.get('sucursalId') ?? '') || null,
      radioKm: Number(formData.get('radioKm') ?? 0) || null,
    })
    revalidatePath('/admin/audiencia/campanas')
    return { success: true, id }
  } catch (e) {
    return { error: mensaje(e) }
  }
}

export async function actualizarCampanaAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    const auth = await autorizar()
    if ('error' in auth) return { error: auth.error }
    const campanaId = String(formData.get('campanaId') ?? '')
    await CampanaDirigidaService.actualizar(auth.companyId, campanaId, {
      nombre: String(formData.get('nombre') ?? ''),
      mensaje: String(formData.get('mensaje') ?? ''),
      canales: canalesDeForm(formData),
      programadaEn: parseFecha(formData.get('programadaEn')),
      maxPorDia: Number(formData.get('maxPorDia') ?? 1),
      maxPorSemana: Number(formData.get('maxPorSemana') ?? 2),
      prioridad: Number(formData.get('prioridad') ?? 0),
      segmentoId: String(formData.get('segmentoId') ?? '') || null,
      sucursalId: String(formData.get('sucursalId') ?? '') || null,
      radioKm: Number(formData.get('radioKm') ?? 0) || null,
    })
    revalidatePath('/admin/audiencia/campanas')
    revalidatePath(`/admin/audiencia/campanas/${campanaId}`)
    return { success: true, id: campanaId }
  } catch (e) {
    return { error: mensaje(e) }
  }
}

export async function programarCampanaAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    const auth = await autorizar()
    if ('error' in auth) return { error: auth.error }
    const campanaId = String(formData.get('campanaId') ?? '')
    const estimacion = await CampanaDirigidaService.programar(
      auth.companyId,
      campanaId,
      formData.has('programadaEn') ? parseFecha(formData.get('programadaEn')) : undefined
    )
    revalidatePath('/admin/audiencia/campanas')
    revalidatePath(`/admin/audiencia/campanas/${campanaId}`)
    return { success: true, id: campanaId, estimacion }
  } catch (e) {
    return { error: mensaje(e) }
  }
}

export async function activarCampanaAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    const auth = await autorizar()
    if ('error' in auth) return { error: auth.error }
    const campanaId = String(formData.get('campanaId') ?? '')
    const estimacion = await CampanaDirigidaService.activar(auth.companyId, campanaId)
    revalidatePath('/admin/audiencia/campanas')
    revalidatePath(`/admin/audiencia/campanas/${campanaId}`)
    return { success: true, id: campanaId, estimacion }
  } catch (e) {
    return { error: mensaje(e) }
  }
}

export async function pausarCampanaAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    const auth = await autorizar()
    if ('error' in auth) return { error: auth.error }
    await CampanaDirigidaService.pausar(auth.companyId, String(formData.get('campanaId') ?? ''))
    revalidatePath(`/admin/audiencia/campanas/${String(formData.get('campanaId') ?? '')}`)
    return { success: true }
  } catch (e) {
    return { error: mensaje(e) }
  }
}

export async function finalizarCampanaAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    const auth = await autorizar()
    if ('error' in auth) return { error: auth.error }
    await CampanaDirigidaService.finalizar(auth.companyId, String(formData.get('campanaId') ?? ''))
    revalidatePath(`/admin/audiencia/campanas/${String(formData.get('campanaId') ?? '')}`)
    return { success: true }
  } catch (e) {
    return { error: mensaje(e) }
  }
}
