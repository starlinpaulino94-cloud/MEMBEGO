import type { AppRole } from '@/types'
import { funcionPermitida, resolverPermisosUsuario, seccionPermitida } from '@/lib/auth/permissions'
import { sinEmpresa } from '@/lib/tenant'
import { PRESETS_ROL_PROVEEDOR, ROLES_DE_PROVEEDOR, type RolDeProveedor } from '../suppliers/acceso-dominio'
import { ORIGEN_INVITACION_PROVEEDOR, preparacionDelProveedorEnTx } from '../suppliers/acceso'

/**
 * SUPPLIER & FULFILLMENT COMMERCE · lecturas del portal del proveedor
 * (Supplier Lite). Solo lo de la empresa de la sesión.
 */

export interface MiembroDelProveedor {
  id: string
  name: string | null
  email: string
  appRole: AppRole
  /** Preset que mejor describe sus permisos (null = ajustes a medida). */
  rol: RolDeProveedor | null
  puedeEscanear: boolean
  puedeVerLiquidaciones: boolean
  createdAt: Date
}

export interface InvitacionPendienteDelProveedor {
  id: string
  email: string
  appRole: AppRole
  rol: RolDeProveedor | null
  expiraEn: Date
}

/** El preset cuyo rol y funciones coinciden con lo que la cuenta tiene. */
export function rolDeProveedorDe(appRole: AppRole, permisosRaw: unknown): RolDeProveedor | null {
  const permisos = resolverPermisosUsuario(permisosRaw)
  if (!seccionPermitida(appRole, 'supply', permisos)) return null
  for (const rol of ROLES_DE_PROVEEDOR) {
    const preset = PRESETS_ROL_PROVEEDOR[rol]
    if (preset.appRole !== appRole && !(rol === 'SUPPLIER_OWNER' && appRole === 'ADMIN_EMPRESA')) continue
    const negadasCoinciden = (['escanear', 'ventas_adicionales', 'inventario', 'liquidaciones', 'personal', 'configuracion', 'solicitud_merchant'] as const).every(
      (f) => funcionPermitida(appRole, 'supply', f, permisos) === !preset.negadas.includes(f)
    )
    if (negadasCoinciden) return rol
  }
  return null
}

export async function equipoDelProveedor(companyId: string): Promise<{ miembros: MiembroDelProveedor[]; invitaciones: InvitacionPendienteDelProveedor[] }> {
  const [usuarios, invitaciones] = await sinEmpresa('Supply: el personal del proveedor de la sesión', (tx) =>
    Promise.all([
      tx.user.findMany({
        where: { companyId, role: { notIn: ['CLIENTE', 'VENDEDOR'] } },
        orderBy: { createdAt: 'asc' },
        select: { id: true, name: true, email: true, role: true, permisos: true, createdAt: true },
      }),
      tx.invitacion.findMany({
        where: { companyId, estado: 'PENDIENTE' },
        orderBy: { createdAt: 'desc' },
        select: { id: true, email: true, rol: true, permisos: true, expiraEn: true, origen: true },
      }),
    ])
  )
  return {
    miembros: usuarios.map((u) => {
      const permisos = resolverPermisosUsuario(u.permisos)
      return {
        id: u.id,
        name: u.name,
        email: u.email,
        appRole: u.role,
        rol: rolDeProveedorDe(u.role, u.permisos),
        puedeEscanear: seccionPermitida(u.role, 'supply', permisos) && funcionPermitida(u.role, 'supply', 'escanear', permisos),
        puedeVerLiquidaciones: seccionPermitida(u.role, 'supply', permisos) && funcionPermitida(u.role, 'supply', 'liquidaciones', permisos),
        createdAt: u.createdAt,
      }
    }),
    invitaciones: invitaciones.map((i) => ({
      id: i.id,
      email: i.email,
      appRole: i.rol,
      rol: i.origen === ORIGEN_INVITACION_PROVEEDOR ? rolDeProveedorDe(i.rol, i.permisos) : null,
      expiraEn: i.expiraEn,
    })),
  }
}

/** Lo que la pantalla de Configuración del portal necesita (una sola lectura). */
export async function configuracionDelProveedor(supplierId: string) {
  return sinEmpresa('Supply: configuración del proveedor de la sesión', async (tx) => {
    const [preparacion, ficha] = await Promise.all([
      preparacionDelProveedorEnTx(tx, supplierId),
      tx.supplyV2Supplier.findUniqueOrThrow({ where: { id: supplierId }, select: { termsAcceptedAt: true, termsAcceptedById: true, qrTestCode: true, qrTestedAt: true, accessStatus: true } }),
    ])
    return { preparacion, ficha }
  })
}

/**
 * Supplier → Merchant (§39–§41): la última solicitud del proveedor, el
 * formulario prellenado y si ya es Merchant. Lectura de plataforma con
 * razón: el proveedor solo recibe lo SUYO (la consulta filtra por su id).
 */
export async function solicitudMerchantDelProveedor(supplierId: string) {
  const { prellenadoDeSolicitudEnTx, ultimaSolicitudEnTx, yaEsMerchantEnTx } = await import('../suppliers/solicitud-merchant')
  return sinEmpresa('Supply: la solicitud de empresa Membego del proveedor', async (tx) => ({
    solicitud: await ultimaSolicitudEnTx(tx, supplierId),
    prellenado: await prellenadoDeSolicitudEnTx(tx, supplierId),
    yaMerchant: await yaEsMerchantEnTx(tx, supplierId),
  }))
}
