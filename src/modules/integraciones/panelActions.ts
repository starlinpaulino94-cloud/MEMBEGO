'use server'

import { revalidatePath } from 'next/cache'
import { getUser } from '@/lib/auth'
import { reintentarPendientes } from '@/modules/integraciones/despacho'
import { revivirFallidos, sondearWebhook, type ResultadoSonda } from '@/modules/integraciones/panel'

/**
 * Acciones del panel de integraciones. Solo SUPERADMIN: tocan una URL externa
 * y mueven la cola de eventos de todos los sistemas conectados.
 *
 * Guard NO-redirect (devuelven error en el estado, no `redirect`): una server
 * action se despacha por su id desde cualquier path, así que el gate del
 * middleware no la protege — la comprobación tiene que estar aquí dentro.
 */

async function soloSuperadmin(): Promise<boolean> {
  const user = await getUser()
  return user?.metadata.role === 'SUPERADMIN'
}

export interface SondaState {
  error?: string
  resultado?: ResultadoSonda
}

export async function sondearWebhookAction(
  _prev: SondaState,
  formData: FormData
): Promise<SondaState> {
  if (!(await soloSuperadmin())) return { error: 'No autorizado.' }
  const sistemaId = String(formData.get('sistemaId') ?? '')
  if (!sistemaId) return { error: 'Falta el sistema.' }

  const res = await sondearWebhook(sistemaId)
  if ('error' in res) return { error: res.error }
  return { resultado: res }
}

export interface ReintentoState {
  error?: string
  mensaje?: string
}

/**
 * Fuerza el reenvío de la cola sin esperar al cron diario. Es la acción que
 * cierra el ciclo: el equipo del satélite arregla su ruta y aquí mismo se
 * comprueba, en vez de esperar a las 5 de la mañana para saber si sirvió.
 */
export async function reintentarPendientesAction(
  _prev: ReintentoState,
  formData: FormData
): Promise<ReintentoState> {
  if (!(await soloSuperadmin())) return { error: 'No autorizado.' }

  // Los FALLIDO solo se reviven si se pide: revivirlos siempre convertiría un
  // botón de "reintentar" en un bucle infinito sobre eventos muertos.
  const sistemaId = String(formData.get('sistemaId') ?? '')
  const revivir = formData.get('revivir') === '1'
  let revividos = 0
  if (revivir && sistemaId) revividos = await revivirFallidos(sistemaId)

  const { enviados, fallidos } = await reintentarPendientes()
  revalidatePath('/superadmin/integraciones')

  const partes = [
    revividos > 0 ? `${revividos} devuelto${revividos === 1 ? '' : 's'} a la cola` : '',
    `${enviados} entregado${enviados === 1 ? '' : 's'}`,
    fallidos > 0 ? `${fallidos} agotó sus intentos` : '',
  ].filter(Boolean)

  return { mensaje: partes.join(' · ') }
}
