import 'server-only'

import type { SessionUser } from '@/types'
import { getUser } from '@/lib/auth'
import { requireSection } from '@/lib/auth/guards'
import { sinEmpresa } from '@/lib/tenant'
import { rolPuede } from './contracts/adapters'
import { SUPPLY_V2_PERMISSION_LABELS, type SupplyV2Permission } from './contracts/gateways'

export type { SupplyV2Permission }

/**
 * MEMBEGO SUPPLY · guardia de servidor (§41).
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

// ── Slice 3 · el PROVEEDOR que escanea (§14, §18, §45, §47) ──────────────────

/**
 * Empleado de un proveedor de Membego Supply. La EMPRESA sale de la
 * sesión (nunca del formulario) y el proveedor se resuelve desde ella:
 * `SupplyV2Supplier.companyId` es único. La sección `supply` y la capacidad
 * MEMBEGO_SUPPLIER se comparten con el portal de Supply V1: quien puede entrar
 * al portal del proveedor puede escanear.
 */
export interface ProveedorSupplyV2 {
  user: SessionUser
  /** Id en `users` del empleado. */
  id: string
  companyId: string
  supplierId: string
  supplierName: string
}

export async function proveedorDeLaSesion(): Promise<ProveedorSupplyV2 | null> {
  const user = await requireSection('supply')
  if (!user) return null
  const companyId = user.metadata.companyId
  if (!companyId || !user.metadata.dbUserId) return null
  const supplier = await sinEmpresa('Supply: resolver el proveedor de la empresa de la sesión', (tx) =>
    tx.supplyV2Supplier.findUnique({ where: { companyId }, select: { id: true, status: true, commercialName: true } })
  )
  if (!supplier || supplier.status !== 'ACTIVE') return null
  return { user, id: user.metadata.dbUserId, companyId, supplierId: supplier.id, supplierName: supplier.commercialName }
}

export async function exigirProveedorSupplyV2(): Promise<ProveedorSupplyV2> {
  const p = await proveedorDeLaSesion()
  if (!p) throw new Error('Tu empresa no está habilitada para entregar beneficios de Membego Supply.')
  return p
}
