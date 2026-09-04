'use server'

import { revalidatePath } from 'next/cache'
import { requireSection } from '@/lib/auth/guards'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { Prisma } from '@prisma/client'
import type {
  ConversacionCanal,
  ConversacionEstado,
  MensajeDireccion,
  MensajeTipo,
} from './conversaciones-queries'

// ── State ──────────────────────────────────────────────────────────────────

export interface ConversacionActionState {
  error?: string
  success?: boolean
  conversacionId?: string
  mensajeId?: string
}

// ── Constants ──────────────────────────────────────────────────────────────

const VALID_CANALES: readonly ConversacionCanal[] = [
  'WHATSAPP', 'INSTAGRAM', 'MESSENGER', 'EMAIL',
] as const

const VALID_MENSAJE_TIPOS: readonly MensajeTipo[] = [
  'TEXTO', 'IMAGEN', 'DOCUMENTO', 'AUDIO', 'UBICACION',
] as const

// ── Helpers ────────────────────────────────────────────────────────────────

/** Verifica que la conversación pertenezca a la empresa del usuario. */
async function conversacionDeMiEmpresa(
  conversacionId: string,
  companyId: string
) {
  return sinEmpresa('conversacion por id sin conocer la empresa', (tx) =>
    tx.conversacion.findUnique({
      where: { id: conversacionId },
      select: { id: true, companyId: true },
    })
  ).then((conv) => {
    if (!conv) return null
    return conv.companyId === companyId ? conv : null
  })
}

// ── Actions ────────────────────────────────────────────────────────────────

/**
 * Crea una conversación nueva para un lead en la empresa del usuario.
 */
export async function createConversacion(
  _prev: ConversacionActionState,
  formData: FormData
): Promise<ConversacionActionState> {
  const user = await requireSection('clientes', 'conversacion_crear')
  if (!user) return { error: 'No autorizado.' }

  const companyId = user.metadata.companyId
  if (!companyId) return { error: 'Empresa no especificada.' }

  const leadId = String(formData.get('leadId') ?? '').trim()
  if (!leadId) return { error: 'Lead no especificado.' }

  const canal = String(formData.get('canal') ?? 'WHATSAPP')
  if (!(VALID_CANALES as readonly string[]).includes(canal)) {
    return { error: `Canal inválido: ${canal}` }
  }

  const canalThreadId = String(formData.get('canalThreadId') ?? '').trim() || null

  // Verificar que el lead pertenece a la empresa
  const lead = await sinEmpresa('conversacion: verificar lead', (tx) =>
    tx.lead.findUnique({
      where: { id: leadId },
      select: { id: true, companyId: true },
    })
  )
  if (!lead || lead.companyId !== companyId) {
    return { error: 'Lead no encontrado.' }
  }

  try {
    const conv = await conEmpresa(companyId, (tx) =>
      tx.conversacion.create({
        data: {
          companyId,
          leadId,
          canal,
          canalThreadId,
        },
      })
    )

    revalidatePath('/admin/crm')
    revalidatePath(`/admin/crm/conversaciones`)
    return { success: true, conversacionId: conv.id }
  } catch (e) {
    console.error('[crm] createConversacion', e)
    return { error: 'Ocurrió un error al crear la conversación.' }
  }
}

/**
 * Envía un mensaje en una conversación existente.
 */
export async function sendMessage(
  _prev: ConversacionActionState,
  formData: FormData
): Promise<ConversacionActionState> {
  const user = await requireSection('clientes', 'conversacion_enviar')
  if (!user) return { error: 'No autorizado.' }

  const companyId = user.metadata.companyId
  if (!companyId) return { error: 'Empresa no especificada.' }

  const conversacionId = String(formData.get('conversacionId') ?? '').trim()
  if (!conversacionId) return { error: 'Conversación no especificada.' }

  const existing = await conversacionDeMiEmpresa(conversacionId, companyId)
  if (!existing) return { error: 'Conversación no encontrada.' }

  const contenido = String(formData.get('contenido') ?? '').trim()
  if (!contenido) return { error: 'El contenido del mensaje es requerido.' }

  const tipo = String(formData.get('tipo') ?? 'TEXTO')
  if (!(VALID_MENSAJE_TIPOS as readonly string[]).includes(tipo)) {
    return { error: `Tipo de mensaje inválido: ${tipo}` }
  }

  const metadataRaw = String(formData.get('metadata') ?? '').trim()
  let metadata: Prisma.InputJsonValue | typeof Prisma.JsonNull = Prisma.JsonNull
  if (metadataRaw) {
    try {
      metadata = JSON.parse(metadataRaw) as Prisma.InputJsonValue
    } catch {
      return { error: 'Metadata inválida (debe ser JSON).' }
    }
  }

  const proveedorMsgId = String(formData.get('proveedorMsgId') ?? '').trim() || null

  try {
    const msg = await conEmpresa(companyId, (tx) =>
      tx.mensaje.create({
        data: {
          conversacionId,
          direccion: 'SALIENTE',
          tipo,
          contenido,
          metadata,
          proveedorMsgId,
          estado: 'ENVIADO',
          creadoPor: user.metadata.dbUserId ?? null,
        },
      })
    )

    // Actualizar la conversación con el último mensaje
    await conEmpresa(companyId, (tx) =>
      tx.conversacion.update({
        where: { id: conversacionId },
        data: {
          ultimoMensaje: contenido.slice(0, 200),
          ultimaFecha: new Date(),
        },
      })
    )

    revalidatePath('/admin/crm')
    revalidatePath(`/admin/crm/conversaciones`)
    return { success: true, mensajeId: msg.id, conversacionId }
  } catch (e) {
    console.error('[crm] sendMessage', e)
    return { error: 'Ocurrió un error al enviar el mensaje.' }
  }
}

/**
 * Cierra una conversación.
 */
export async function closeConversacion(
  _prev: ConversacionActionState,
  formData: FormData
): Promise<ConversacionActionState> {
  const user = await requireSection('clientes', 'conversacion_cerrar')
  if (!user) return { error: 'No autorizado.' }

  const companyId = user.metadata.companyId
  if (!companyId) return { error: 'Empresa no especificada.' }

  const conversacionId = String(formData.get('conversacionId') ?? '').trim()
  if (!conversacionId) return { error: 'Conversación no especificada.' }

  const existing = await conversacionDeMiEmpresa(conversacionId, companyId)
  if (!existing) return { error: 'Conversación no encontrada.' }

  try {
    await conEmpresa(companyId, (tx) =>
      tx.conversacion.update({
        where: { id: conversacionId },
        data: { estado: 'CERRADA' },
      })
    )

    revalidatePath('/admin/crm')
    revalidatePath(`/admin/crm/conversaciones`)
    return { success: true, conversacionId }
  } catch (e) {
    console.error('[crm] closeConversacion', e)
    return { error: 'Ocurrió al cerrar la conversación.' }
  }
}

/**
 * Reabre una conversación cerrada.
 */
export async function reopenConversacion(
  _prev: ConversacionActionState,
  formData: FormData
): Promise<ConversacionActionState> {
  const user = await requireSection('clientes', 'conversacion_reabrir')
  if (!user) return { error: 'No autorizado.' }

  const companyId = user.metadata.companyId
  if (!companyId) return { error: 'Empresa no especificada.' }

  const conversacionId = String(formData.get('conversacionId') ?? '').trim()
  if (!conversacionId) return { error: 'Conversación no especificada.' }

  const existing = await conversacionDeMiEmpresa(conversacionId, companyId)
  if (!existing) return { error: 'Conversación no encontrada.' }

  try {
    await conEmpresa(companyId, (tx) =>
      tx.conversacion.update({
        where: { id: conversacionId },
        data: { estado: 'ABIERTA' },
      })
    )

    revalidatePath('/admin/crm')
    revalidatePath(`/admin/crm/conversaciones`)
    return { success: true, conversacionId }
  } catch (e) {
    console.error('[crm] reopenConversacion', e)
    return { error: 'Ocurrió al reabrir la conversación.' }
  }
}

/**
 * Marca los mensajes no leídos de una conversación como leídos.
 */
export async function markAsRead(
  _prev: ConversacionActionState,
  formData: FormData
): Promise<ConversacionActionState> {
  const user = await requireSection('clientes', 'conversacion_leer')
  if (!user) return { error: 'No autorizado.' }

  const companyId = user.metadata.companyId
  if (!companyId) return { error: 'Empresa no especificada.' }

  const conversacionId = String(formData.get('conversacionId') ?? '').trim()
  if (!conversacionId) return { error: 'Conversación no especificada.' }

  const existing = await conversacionDeMiEmpresa(conversacionId, companyId)
  if (!existing) return { error: 'Conversación no encontrada.' }

  try {
    await conEmpresa(companyId, async (tx) => {
      // Marcar mensajes entrantes no leídos como leídos
      await tx.mensaje.updateMany({
        where: {
          conversacionId,
          direccion: 'ENTRANTE',
          estado: { not: 'LEIDO' },
        },
        data: { estado: 'LEIDO' },
      })

      // Resetear contador de no leídos
      await tx.conversacion.update({
        where: { id: conversacionId },
        data: { noLeidos: 0 },
      })
    })

    revalidatePath('/admin/crm')
    revalidatePath(`/admin/crm/conversaciones`)
    return { success: true, conversacionId }
  } catch (e) {
    console.error('[crm] markAsRead', e)
    return { error: 'Ocurrió al marcar como leído.' }
  }
}
