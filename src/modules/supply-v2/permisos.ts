import 'server-only'

import type { SessionUser } from '@/types'
import { getUser } from '@/lib/auth'
import { rolPuede } from './contracts/adapters'
import { SUPPLY_V2_PERMISSION_LABELS, type SupplyV2Permission } from './contracts/gateways'

export type { SupplyV2Permission }

/**
 * MEMBEGO SUPPLY 2.0 · guardia de servidor (§41).
 *
 * Toda mutación pasa por aquí ANTES de abrir la transacción. Las server
 * actions se despachan por id sobre cualquier ruta, así que el middleware no
 * las protege: esta es la barrera real.
 */
export interface ActorSupplyV2 {
  user: SessionUser
  /** Id en `users`: lo que se guarda como creador, aprobador o receptor. */
  id: string
}

export async function exigirPermisoSupplyV2(permission: SupplyV2Permission): Promise<ActorSupplyV2> {
  const user = await getUser()
  if (!user) throw new Error('Se requiere iniciar sesión.')
  if (!rolPuede(user.metadata.role, permission)) {
    throw new Error(`Se requiere ${SUPPLY_V2_PERMISSION_LABELS[permission]} (rol de plataforma).`)
  }
  if (!user.metadata.dbUserId) throw new Error('La sesión no tiene un usuario asociado.')
  return { user, id: user.metadata.dbUserId }
}

export async function puedeSupplyV2(permission: SupplyV2Permission): Promise<boolean> {
  const user = await getUser()
  return Boolean(user && rolPuede(user.metadata.role, permission))
}

/** Cliente de la plataforma: sesión con rol CLIENTE y usuario en `users`. */
export interface ClienteSupplyV2 {
  user: SessionUser
  id: string
}

export async function exigirCliente(): Promise<ClienteSupplyV2> {
  const user = await getUser()
  if (!user) throw new Error('Inicia sesión para continuar.')
  if (user.metadata.role !== 'CLIENTE') throw new Error('Solo un cliente puede comprar ofertas de Membego.')
  if (!user.metadata.dbUserId) throw new Error('La sesión no tiene un usuario asociado.')
  return { user, id: user.metadata.dbUserId }
}
