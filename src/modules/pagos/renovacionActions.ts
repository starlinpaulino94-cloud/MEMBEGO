'use server'

import { revalidatePath } from 'next/cache'
import { getUser } from '@/lib/auth'
import { getRequestMeta } from '@/lib/server-utils'
import {
  activarRenovacionDelCliente,
  desactivarRenovacionDelCliente,
  type PedidoDeCliente,
} from '@/modules/pagos/renovacionPuerta'

/**
 * LAS ACCIONES WEB DE LA RENOVACIÓN AUTOMÁTICA.
 *
 * Solo traducen: saben quién es la persona (la sesión) y leen el formulario. Todo
 * lo demás —el límite de peticiones, la aceptación explícita, si la empresa puede
 * cobrar, de quién es la membresía— vive en `renovacionPuerta.ts`, que comparte
 * con la API de la app móvil para que las dos superficies respondan igual.
 */

export interface RenovacionActionState {
  error?: string
  success?: boolean
}

async function clienteActual(): Promise<PedidoDeCliente | null> {
  const user = await getUser()
  if (!user || user.metadata.role !== 'CLIENTE' || !user.metadata.clienteId) return null
  return { supabaseId: user.supabaseId, clienteId: user.metadata.clienteId }
}

export async function activarRenovacionAction(
  _prev: RenovacionActionState,
  formData: FormData
): Promise<RenovacionActionState> {
  const quien = await clienteActual()
  if (!quien) return { error: 'No autorizado.' }
  const membershipId = String(formData.get('membershipId') ?? '')
  const meta = await getRequestMeta()
  const r = await activarRenovacionDelCliente(quien, {
    membershipId,
    tarjetaId: String(formData.get('tarjetaId') ?? ''),
    acepto: formData.get('acepto') === 'on',
    textoVersionVista: String(formData.get('textoVersion') ?? '') || null,
    ip: meta.ipAddress?.split(',')[0]?.trim() ?? null,
    userAgent: meta.userAgent,
  })
  if (!r.ok) return { error: r.error }
  revalidatePath(`/membresia/${membershipId}`)
  return { success: true }
}

export async function desactivarRenovacionAction(
  _prev: RenovacionActionState,
  formData: FormData
): Promise<RenovacionActionState> {
  const quien = await clienteActual()
  if (!quien) return { error: 'No autorizado.' }
  const membershipId = String(formData.get('membershipId') ?? '')
  const r = await desactivarRenovacionDelCliente(quien, membershipId)
  if (!r.ok) return { error: r.error }
  revalidatePath(`/membresia/${membershipId}`)
  return { success: true }
}
