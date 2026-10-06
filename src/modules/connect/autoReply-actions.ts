'use server'

import { revalidatePath } from 'next/cache'
import { requireSection } from '@/lib/auth/guards'
import { conEmpresa } from '@/lib/tenant'
import { getRequestMeta } from '@/lib/server-utils'
import { Prisma } from '@prisma/client'

// ── State ──────────────────────────────────────────────────────────────────

export interface AutoReplyActionState {
  error?: string
  success?: boolean
  data?: unknown
}

// ── Actions ────────────────────────────────────────────────────────────────

/**
 * Asienta en la bitácora un cambio en las respuestas automáticas.
 *
 * Estas reglas CONTESTAN EN NOMBRE DE LA EMPRESA a quien escribe por WhatsApp
 * o redes. Cambiar una cambia lo que el negocio le dice a sus clientes sin que
 * nadie lo lea antes de que salga, y hasta hoy eso no dejaba ni una línea.
 *
 * Fail-open y fuera de la transacción, por lo mismo que `auditarProspecto` en
 * `modules/crm/lead-actions.ts`: los valores del enum viven en la migración
 * `20260930_crm_auditoria`, que se aplica a mano, y una bitácora no puede
 * impedir que la empresa configure su propia respuesta.
 */
async function auditarAutoRespuesta(
  companyId: string,
  userId: string | null,
  accion: 'AUTO_RESPUESTA_CREADA' | 'AUTO_RESPUESTA_ACTUALIZADA' | 'AUTO_RESPUESTA_ELIMINADA',
  configId: string,
  payload: Prisma.InputJsonObject
) {
  try {
    const meta = await getRequestMeta()
    await conEmpresa(companyId, (tx) =>
      tx.auditLog.create({
        data: {
          companyId,
          userId,
          accion,
          entidadTipo: 'AutoReplyConfig',
          entidadId: configId,
          payload,
          ...meta,
        },
      })
    )
  } catch (e) {
    console.error('[connect] no se pudo auditar', accion, e)
  }
}

/**
 * Obtiene todas las configuraciones de auto-reply de la empresa.
 */
export async function getAutoReplyConfigs(companyId: string) {
  const user = await requireSection('leads', 'auto_reply_leer')
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
  const user = await requireSection('leads', 'auto_reply_crear')
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

    await auditarAutoRespuesta(companyId, user.metadata.dbUserId ?? null, 'AUTO_RESPUESTA_CREADA', config.id, {
      regla: nombre,
      esBienvenida: data.esBienvenida ?? false,
      activa: data.activa ?? true,
    })

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
  const user = await requireSection('leads', 'auto_reply_editar')
  if (!user) return { error: 'No autorizado.' }

  if (user.metadata.companyId !== companyId) {
    return { error: 'Empresa no válida.' }
  }

  if (!id) return { error: 'ID de configuración requerido.' }

  try {
    const existing = await conEmpresa(companyId, (tx) =>
      tx.autoReplyConfig.findFirst({
        where: { id, companyId },
        // `nombre` para que el asiento diga CUÁL regla, no solo un id.
        select: { id: true, nombre: true },
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

    await auditarAutoRespuesta(companyId, user.metadata.dbUserId ?? null, 'AUTO_RESPUESTA_ACTUALIZADA', id, {
      regla: existing.nombre,
      // Los nombres de los campos tocados, no su contenido: el texto de la
      // respuesta vive en la regla y ahí se lee.
      campos: Object.keys(updateData),
    })

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
  const user = await requireSection('leads', 'auto_reply_eliminar')
  if (!user) return { error: 'No autorizado.' }

  if (user.metadata.companyId !== companyId) {
    return { error: 'Empresa no válida.' }
  }

  if (!id) return { error: 'ID de configuración requerido.' }

  try {
    const existing = await conEmpresa(companyId, (tx) =>
      tx.autoReplyConfig.findFirst({
        where: { id, companyId },
        // `nombre` para que el asiento diga CUÁL regla, no solo un id.
        select: { id: true, nombre: true },
      })
    )
    if (!existing) return { error: 'Configuración no encontrada.' }

    await conEmpresa(companyId, (tx) =>
      tx.autoReplyConfig.delete({ where: { id } })
    )

    // Aquí el borrado es DE VERDAD (no blando como el de prospectos): este
    // asiento es lo único que va a quedar de que esa regla existió.
    await auditarAutoRespuesta(companyId, user.metadata.dbUserId ?? null, 'AUTO_RESPUESTA_ELIMINADA', id, {
      regla: existing.nombre,
    })

    revalidatePath('/admin/connect')
    return { success: true }
  } catch (e) {
    console.error('[connect] deleteAutoReplyConfig', e)
    return { error: 'Error al eliminar la configuración de auto-reply.' }
  }
}
