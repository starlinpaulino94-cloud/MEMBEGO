'use server'

import { revalidatePath } from 'next/cache'
import { requireSection } from '@/lib/auth/guards'
import { conEmpresa } from '@/lib/tenant'

// ── State ──────────────────────────────────────────────────────────────────

export interface AutoReplyActionState {
  error?: string
  success?: boolean
  data?: unknown
}

// ── Actions ────────────────────────────────────────────────────────────────

/**
 * Obtiene todas las configuraciones de auto-reply de la empresa.
 */
export async function getAutoReplyConfigs(companyId: string) {
  const user = await requireSection('clientes', 'auto_reply_leer')
  if (!user) return { error: 'No autorizado.' }

  if (user.metadata.companyId !== companyId) {
    return { error: 'Empresa no válida.' }
  }

  try {
    const configs = await conEmpresa(companyId, (tx) =>
      tx.autoReplyConfig.findMany({
        where: { companyId },
        orderBy: [{ orden: 'asc' }, { createdAt: 'asc' }],
      })
    )
    return { success: true, data: configs }
  } catch (e) {
    console.error('[connect] getAutoReplyConfigs', e)
    return { error: 'Error al obtener configuraciones de auto-reply.' }
  }
}

/**
 * Crea una nueva configuración de auto-reply.
 */
export async function createAutoReplyConfig(
  companyId: string,
  data: {
    nombre: string
    keywords?: string[]
    esBienvenida?: boolean
    tipoRespuesta?: string
    contenido: string
    catalogoPath?: string | null
    activa?: boolean
    orden?: number
  }
): Promise<AutoReplyActionState> {
  const user = await requireSection('clientes', 'auto_reply_crear')
  if (!user) return { error: 'No autorizado.' }

  if (user.metadata.companyId !== companyId) {
    return { error: 'Empresa no válida.' }
  }

  const nombre = data.nombre?.trim()
  if (!nombre) return { error: 'El nombre es requerido.' }

  const contenido = data.contenido?.trim()
  if (!contenido) return { error: 'El contenido es requerido.' }

  try {
    const config = await conEmpresa(companyId, (tx) =>
      tx.autoReplyConfig.create({
        data: {
          companyId,
          nombre,
          keywords: data.keywords ?? [],
          esBienvenida: data.esBienvenida ?? false,
          tipoRespuesta: data.tipoRespuesta ?? 'TEXTO',
          contenido,
          catalogoPath: data.catalogoPath ?? null,
          activa: data.activa ?? true,
          orden: data.orden ?? 0,
        },
      })
    )

    revalidatePath('/admin/connect')
    return { success: true, data: config }
  } catch (e) {
    console.error('[connect] createAutoReplyConfig', e)
    return { error: 'Error al crear la configuración de auto-reply.' }
  }
}

/**
 * Actualiza una configuración de auto-reply existente.
 */
export async function updateAutoReplyConfig(
  id: string,
  companyId: string,
  data: {
    nombre?: string
    keywords?: string[]
    esBienvenida?: boolean
    tipoRespuesta?: string
    contenido?: string
    catalogoPath?: string | null
    activa?: boolean
    orden?: number
  }
): Promise<AutoReplyActionState> {
  const user = await requireSection('clientes', 'auto_reply_editar')
  if (!user) return { error: 'No autorizado.' }

  if (user.metadata.companyId !== companyId) {
    return { error: 'Empresa no válida.' }
  }

  if (!id) return { error: 'ID de configuración requerido.' }

  try {
    const existing = await conEmpresa(companyId, (tx) =>
      tx.autoReplyConfig.findFirst({
        where: { id, companyId },
        select: { id: true },
      })
    )
    if (!existing) return { error: 'Configuración no encontrada.' }

    const updateData: Record<string, unknown> = {}
    if (data.nombre !== undefined) updateData.nombre = data.nombre.trim()
    if (data.keywords !== undefined) updateData.keywords = data.keywords
    if (data.esBienvenida !== undefined) updateData.esBienvenida = data.esBienvenida
    if (data.tipoRespuesta !== undefined) updateData.tipoRespuesta = data.tipoRespuesta
    if (data.contenido !== undefined) updateData.contenido = data.contenido.trim()
    if (data.catalogoPath !== undefined) updateData.catalogoPath = data.catalogoPath
    if (data.activa !== undefined) updateData.activa = data.activa
    if (data.orden !== undefined) updateData.orden = data.orden

    const config = await conEmpresa(companyId, (tx) =>
      tx.autoReplyConfig.update({
        where: { id },
        data: updateData,
      })
    )

    revalidatePath('/admin/connect')
    return { success: true, data: config }
  } catch (e) {
    console.error('[connect] updateAutoReplyConfig', e)
    return { error: 'Error al actualizar la configuración de auto-reply.' }
  }
}

/**
 * Elimina una configuración de auto-reply.
 */
export async function deleteAutoReplyConfig(
  id: string,
  companyId: string
): Promise<AutoReplyActionState> {
  const user = await requireSection('clientes', 'auto_reply_eliminar')
  if (!user) return { error: 'No autorizado.' }

  if (user.metadata.companyId !== companyId) {
    return { error: 'Empresa no válida.' }
  }

  if (!id) return { error: 'ID de configuración requerido.' }

  try {
    const existing = await conEmpresa(companyId, (tx) =>
      tx.autoReplyConfig.findFirst({
        where: { id, companyId },
        select: { id: true },
      })
    )
    if (!existing) return { error: 'Configuración no encontrada.' }

    await conEmpresa(companyId, (tx) =>
      tx.autoReplyConfig.delete({ where: { id } })
    )

    revalidatePath('/admin/connect')
    return { success: true }
  } catch (e) {
    console.error('[connect] deleteAutoReplyConfig', e)
    return { error: 'Error al eliminar la configuración de auto-reply.' }
  }
}
