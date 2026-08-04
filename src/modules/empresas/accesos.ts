import { sinEmpresa } from '@/lib/tenant'
import { ADMIN_ROLES } from '@/types'
import type { AppRole } from '@/types'

/**
 * QUIÉN PUEDE ENTRAR A CADA EMPRESA.
 *
 * El modelo ya existía: `User.companyId` es la empresa ACTIVA (la que la
 * persona está viendo ahora mismo) y `UserCompanyAccess` es la lista de
 * empresas a las que puede cambiar con el selector de arriba del panel.
 *
 * Este archivo es la parte de lectura, y el sitio donde vive la regla que
 * evita el problema descrito en `garantizarAccesoAlHogar`.
 */

/** Roles de staff que pueden entrar al panel; el superadmin no necesita fila. */
const ROLES_VINCULABLES: AppRole[] = ADMIN_ROLES.filter((r) => r !== 'SUPERADMIN')

export interface AdminVinculable {
  id: string
  name: string
  email: string
  role: string
  /** Empresa donde trabaja normalmente, para distinguir homónimos. */
  empresa: string | null
}

/** Administradores existentes a los que se les puede dar acceso a una empresa. */
export async function getAdminsVinculables(): Promise<AdminVinculable[]> {
  try {
    const filas = await sinEmpresa('empresas: listar admins vinculables (cross-tenant)', (tx) =>
      tx.user.findMany({
        where: { role: { in: ROLES_VINCULABLES } },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          company: { select: { name: true } },
        },
      })
    )
    return filas.map((f) => ({
      id: f.id,
      name: f.name,
      email: f.email,
      role: f.role,
      empresa: f.company?.name ?? null,
    }))
  } catch {
    return []
  }
}

export interface AccesoEmpresa {
  userId: string
  name: string
  email: string
  role: string
  /** true = esta empresa es la que tiene abierta ahora mismo. */
  activaAhora: boolean
}

/** Quién tiene acceso a esta empresa (por acceso explícito o por ser su casa). */
export async function getAccesosDeEmpresa(companyId: string): Promise<AccesoEmpresa[]> {
  try {
    const usuarios = await sinEmpresa(
      'empresas: quién tiene acceso a la empresa (usuarios de otras empresas incluidos)',
      (tx) =>
        tx.user.findMany({
          where: {
            role: { in: ROLES_VINCULABLES },
            OR: [{ companyId }, { empresasAcceso: { some: { companyId } } }],
          },
          orderBy: { name: 'asc' },
          select: { id: true, name: true, email: true, role: true, companyId: true },
        })
    )
    return usuarios.map((u) => ({
      userId: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      activaAhora: u.companyId === companyId,
    }))
  } catch {
    return []
  }
}

/**
 * EL SEGURO CONTRA QUEDARSE ENCERRADO.
 *
 * El selector de empresas se arma con: las filas de `UserCompanyAccess` + la
 * empresa activa. Parece completo, pero tiene un agujero: si la empresa de
 * siempre de una persona NO tiene fila en `UserCompanyAccess` (el caso normal
 * hasta ahora — se llegaba a ella por `User.companyId` y ya), en cuanto cambia
 * a otra empresa su empresa de siempre desaparece de la lista. Deja de ser la
 * activa, nunca tuvo fila, y el selector ya no la puede ofrecer: la persona se
 * queda encerrada en la empresa a la que acaba de entrar.
 *
 * Antes esto no salía a la luz porque casi nadie tenía dos empresas. Vincular
 * un administrador existente a una empresa de práctica lo provoca a la primera:
 * entra a practicar y no puede volver a su negocio.
 *
 * Por eso, al dar acceso a una empresa nueva, se escribe TAMBIÉN la fila de su
 * empresa de siempre. Es idempotente y no le da acceso a nada que no tuviera
 * ya: solo hace explícito lo que era implícito.
 */
export function filasDeAcceso(
  userId: string,
  companyIdNuevo: string,
  companyIdActual: string | null
): { userId: string; companyId: string }[] {
  const ids = new Set([companyIdNuevo])
  if (companyIdActual) ids.add(companyIdActual)
  return [...ids].map((companyId) => ({ userId, companyId }))
}
