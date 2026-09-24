import 'server-only'

import type { SessionUser } from '@/types'
import { getUser } from '@/lib/auth'
import { requireSection } from '@/lib/auth/guards'
import { capacidadesDeEmpresa } from '@/modules/capacidades/catalogo'
import { prisma } from '@/lib/prisma'

/**
 * MEMBEGO SUPPLY · permisos (Fase 41) y aislamiento multi-inquilino (Fase 42).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DOS LADOS DE LA MESA, DOS AUTORIZACIONES DISTINTAS
 *
 *  · LADO MEMBEGO (plataforma). Firmar contratos, aprobar compras, asignar
 *    unidades, pagar proveedores. Solo SUPERADMIN. Un compromiso financiero de
 *    RD$300.000 no puede nacer del clic de cualquiera con sesión.
 *
 *  · LADO PROVEEDOR (la empresa). Ver sus compromisos, escanear, reportar
 *    incidencias, consultar su liquidación. Va por la sección `supply` del
 *    RBAC existente + la capacidad MEMBEGO_SUPPLIER de la empresa.
 *
 * Los nombres del prompt (`MEMBEGO_SUPPLY_APPROVE`, `SUPPLIER_REDEEM`…) se
 * mantienen como vocabulario porque es lo que se lee en la documentación y en
 * los contratos, pero cada uno se RESUELVE contra el RBAC que ya existe. Crear
 * un segundo sistema de permisos en paralelo sería exactamente el "no
 * dupliques" de la Fase 71.
 */

export const PERMISOS_SUPPLY = [
  'MEMBEGO_SUPPLY_VIEW',
  'MEMBEGO_SUPPLY_CREATE',
  'MEMBEGO_SUPPLY_APPROVE',
  'MEMBEGO_SUPPLY_ALLOCATE',
  'SUPPLIER_VIEW_COMMITMENTS',
  'SUPPLIER_REDEEM',
  'SUPPLIER_REPORT_INCIDENT',
  'SUPPLIER_VIEW_SETTLEMENT',
] as const
export type PermisoSupply = (typeof PERMISOS_SUPPLY)[number]

export const PERMISO_SUPPLY_LABELS: Record<PermisoSupply, string> = {
  MEMBEGO_SUPPLY_VIEW: 'Ver el supply de la plataforma',
  MEMBEGO_SUPPLY_CREATE: 'Crear acuerdos y órdenes de compra',
  MEMBEGO_SUPPLY_APPROVE: 'Aprobar compromisos financieros',
  MEMBEGO_SUPPLY_ALLOCATE: 'Asignar unidades a campañas',
  SUPPLIER_VIEW_COMMITMENTS: 'Ver los compromisos de la empresa con Membego',
  SUPPLIER_REDEEM: 'Escanear y entregar vouchers de Membego',
  SUPPLIER_REPORT_INCIDENT: 'Reportar incidencias de cumplimiento',
  SUPPLIER_VIEW_SETTLEMENT: 'Ver liquidaciones con Membego',
}

/** Permisos que solo tiene el lado plataforma. */
export const PERMISOS_DE_PLATAFORMA: readonly PermisoSupply[] = [
  'MEMBEGO_SUPPLY_VIEW',
  'MEMBEGO_SUPPLY_CREATE',
  'MEMBEGO_SUPPLY_APPROVE',
  'MEMBEGO_SUPPLY_ALLOCATE',
]

/** Permisos del lado proveedor. */
export const PERMISOS_DE_PROVEEDOR: readonly PermisoSupply[] = [
  'SUPPLIER_VIEW_COMMITMENTS',
  'SUPPLIER_REDEEM',
  'SUPPLIER_REPORT_INCIDENT',
  'SUPPLIER_VIEW_SETTLEMENT',
]

// ── Lado plataforma ─────────────────────────────────────────────────────────

/**
 * Usuario con mando sobre el supply de la plataforma, o null.
 *
 * NO redirige: se usa desde server actions, donde un `redirect` se traga el
 * error y el usuario ve la pantalla recargarse sin explicación.
 */
export async function usuarioDePlataforma(): Promise<SessionUser | null> {
  const user = await getUser()
  if (!user || user.metadata.role !== 'SUPERADMIN') return null
  return user
}

/** Igual, pero lanza con un mensaje que se puede enseñar. */
export async function exigirPlataforma(permiso: PermisoSupply): Promise<SessionUser> {
  const user = await usuarioDePlataforma()
  if (!user) {
    throw new Error(`Se requiere ${PERMISO_SUPPLY_LABELS[permiso]} (rol de plataforma).`)
  }
  return user
}

// ── Lado proveedor ──────────────────────────────────────────────────────────

/**
 * ¿Esta empresa puede actuar como proveedora de Membego?
 *
 * Es la capacidad, no el `type` ni una columna nueva: la Fase 1 pide que la
 * MISMA organización sea comercio y proveedora sin duplicar identidad,
 * usuarios, sucursales ni catálogo, y `companies.capacidades` es justo el
 * mecanismo que ya existe para eso.
 */
export async function empresaEsProveedora(companyId: string): Promise<boolean> {
  const empresa = await prisma.company.findUnique({
    where: { id: companyId },
    select: { type: true, tipoNegocioCodigo: true, capacidades: true },
  })
  if (!empresa) return false
  return capacidadesDeEmpresa(empresa).activas.has('MEMBEGO_SUPPLIER')
}

/** ¿Y puede además ESCANEAR y entregar? */
export async function empresaCumpleSupply(companyId: string): Promise<boolean> {
  const empresa = await prisma.company.findUnique({
    where: { id: companyId },
    select: { type: true, tipoNegocioCodigo: true, capacidades: true },
  })
  if (!empresa) return false
  const activas = capacidadesDeEmpresa(empresa).activas
  return activas.has('MEMBEGO_SUPPLY_FULFILLMENT') || activas.has('MEMBEGO_SUPPLIER')
}

/**
 * Guardia del portal del proveedor: sesión con acceso a la sección `supply`
 * Y empresa con la capacidad encendida. Las dos cosas, siempre.
 *
 * El superadmin pasa la primera por rol, pero NO se salta la segunda: si la
 * empresa no es proveedora, no hay compromisos que enseñar y una pantalla
 * vacía con datos de otro inquilino es peor que un "no autorizado".
 */
export async function guardiaProveedor(
  companyId: string,
  funcion?: string
): Promise<SessionUser | null> {
  const user = await requireSection('supply', funcion)
  if (!user) return null
  if (!(await empresaEsProveedora(companyId))) return null
  return user
}

// ── Aislamiento (Fase 42) ───────────────────────────────────────────────────

/**
 * Filtro OBLIGATORIO de toda consulta del portal del proveedor.
 *
 * El proveedor A nunca puede ver los compromisos del proveedor B, y eso no se
 * confía a que quien escribe la consulta se acuerde: se pide este objeto y se
 * esparce en el `where`. Tres cierres independientes:
 *
 *   1. este filtro en la aplicación,
 *   2. `conEmpresa()` poniendo `app.company_id` para las políticas RLS,
 *   3. la clave foránea `proveedorId`, denormalizada A PROPÓSITO en lotes,
 *      derechos, vouchers, redenciones e incidencias para que el aislamiento
 *      nunca dependa de tres saltos de join.
 */
export function ambitoProveedor(companyId: string): { proveedorId: string } {
  if (!companyId) throw new Error('ambitoProveedor: falta la empresa.')
  return { proveedorId: companyId }
}
