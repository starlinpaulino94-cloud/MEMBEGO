import { cache } from 'react'
import { redirect } from 'next/navigation'
import { getUser } from '@/lib/auth'
import { ADMIN_ROLES, FULL_ADMIN_ROLES, ROLE_HOME, type AppRole, type SessionUser } from '@/types'
import {
  ROLES_EXENTOS_PERMISOS,
  funcionPermitida,
  puedeEntrarAlPanel,
  resolverPermisosUsuario,
  seccionPermitida,
  type AdminSection,
  type PermisosUsuario,
} from '@/lib/auth/permissions'
import { anotarFallo } from '@/lib/prisma-errors'

function setSentryContext(user: SessionUser) {
  import('@sentry/nextjs')
    .then((Sentry) => {
      Sentry.setUser({ id: user.metadata.dbUserId || user.supabaseId, email: user.email })
      Sentry.setTag('user.role', user.metadata.role)
      if (user.metadata.companyId) Sentry.setTag('company.id', user.metadata.companyId)
    })
    .catch(anotarFallo('auth:sentry-contexto'))
}

export async function requireUser(): Promise<SessionUser> {
  // getUser() revalida el token contra el servidor de Supabase en cada
  // request (a diferencia de getSession(), que solo decodifica la cookie sin
  // verificar la firma). Es el método recomendado para decisiones de
  // autorización en código de servidor.
  const user = await getUser()
  if (!user) redirect('/login')

  setSentryContext(user)
  return user
}

export async function requireRole(
  roles: AppRole | AppRole[]
): Promise<SessionUser> {
  const user = await requireUser()
  const allowed = Array.isArray(roles) ? roles : [roles]
  if (!allowed.includes(user.metadata.role)) {
    redirect('/login')
  }
  return user
}

/**
 * Guard NO-redirect para server actions: devuelve el usuario admin PLENO
 * (rol en FULL_ADMIN_ROLES) o null.
 *
 * Fail-closed por diseño: los roles acotados (MARKETING, SUPERVISOR) NO pasan
 * este guard. Como una server action se despacha por su ID sobre cualquier
 * path permitido, el gate por sección del middleware NO la protege; por eso
 * las mutaciones exigen admin pleno por defecto. Las pocas acciones que un rol
 * acotado sí puede ejecutar usan `requireSection(...)` en su lugar.
 */
/**
 * Los ajustes de permisos de un usuario, UNA SOLA LECTURA POR PETICIÓN.
 *
 * `requireSection` lee la base viva a propósito: negarle algo a alguien surte
 * efecto en su siguiente clic, sin esperar al refresco del token. El precio es
 * una consulta por llamada, y desde que cada sección tiene guardia en su
 * layout ADEMÁS de en sus páginas y sus actions, una misma pantalla la pedía
 * dos y tres veces.
 *
 * `cache` de React deduplica dentro de una misma petición y no entre
 * peticiones: se mantiene intacto lo que hace que esto valga —cada request
 * vuelve a preguntar— y desaparece lo que solo era repetirse.
 */
const permisosVivos = cache(async (dbUserId: string): Promise<PermisosUsuario | null> => {
  const { prisma } = await import('@/lib/prisma')
  const fila = await prisma.user.findUnique({
    where: { id: dbUserId },
    select: { permisos: true },
  })
  // `undefined` = no hay fila para ese id. Distinto de «sin ajustes», y quien
  // llama tiene que poder negar en ese caso en vez de tratarlo como «hereda».
  if (!fila) throw new Error('usuario sin fila')
  return resolverPermisosUsuario(fila.permisos)
})

/**
 * Puerta del PANEL DE EMPRESA para el layout de `/admin`.
 *
 * Igual que la del proxy y por el mismo motivo: el rol la abre de par en par,
 * y a quien no lo tiene se la abre una seccion CONCEDIDA —solo para lo
 * concedido, porque dentro sigue mandando `requireSection` una por una—.
 *
 * Lee los permisos VIVOS de la base, no del token: quitarle a alguien su
 * ultima seccion concedida le cierra el panel en su siguiente clic, sin
 * esperar a que su sesion se refresque. Ante cualquier duda —sin fila en la
 * base, fallo de la consulta— se le manda a su casa.
 */
export async function requirePanel(): Promise<SessionUser> {
  const user = await requireUser()
  const role = user.metadata.role
  if (ADMIN_ROLES.includes(role)) return user

  let permisos: PermisosUsuario | null = null
  if (user.metadata.dbUserId) {
    try {
      permisos = await permisosVivos(user.metadata.dbUserId)
    } catch {
      permisos = null
    }
  }
  if (!puedeEntrarAlPanel(role, permisos)) redirect(ROLE_HOME[role] ?? '/login')
  return user
}

export async function requireAdminUser(): Promise<SessionUser | null> {
  const user = await getUser()
  if (!user || !FULL_ADMIN_ROLES.includes(user.metadata.role)) return null
  return user
}

/**
 * Guard NO-redirect para server actions acotadas por sección: devuelve el
 * usuario si su rol puede acceder a `section` (admin pleno o rol acotado con
 * esa sección permitida), o null. Segunda barrera server-side que NO depende
 * del path del request (a diferencia del middleware).
 */
/**
 * ¿Puede ESTE usuario (ya autenticado por otra guardia) ejecutar la función?
 * Para acciones que guardan con `requireAdminUser` u otra barrera y solo
 * necesitan sumarle el chequeo del módulo de Permisos. Lee la base en vivo,
 * igual que requireSection.
 */
export async function usuarioPuedeFuncion(
  user: SessionUser,
  section: AdminSection,
  funcion: string
): Promise<boolean> {
  const role = user.metadata.role
  if (ROLES_EXENTOS_PERMISOS.includes(role)) return true
  if (!user.metadata.dbUserId) return false
  try {
    const permisos = await permisosVivos(user.metadata.dbUserId)
    return funcionPermitida(role, section, funcion, permisos)
  } catch {
    return false
  }
}

export async function requireSection(
  section: AdminSection,
  /**
   * Función concreta dentro de la sección (catálogo en `funciones.ts`).
   * Sin ella, la guardia decide solo a nivel de módulo.
   */
  funcion?: string
): Promise<SessionUser | null> {
  const user = await getUser()
  if (!user) return null
  const role = user.metadata.role

  // Permisos POR EMPLEADO (módulo de Permisos): se leen VIVOS de la base —
  // negarle algo a alguien surte efecto en su próximo clic, sin esperar el
  // refresco del token. Los roles exentos ni consultan la columna. La base
  // sigue siendo el rol; el ajuste concede o niega encima.
  let permisos: PermisosUsuario | null = null
  if (!ROLES_EXENTOS_PERMISOS.includes(role) && user.metadata.dbUserId) {
    try {
      permisos = await permisosVivos(user.metadata.dbUserId)
    } catch {
      return null
    }
  }
  if (!seccionPermitida(role, section, permisos)) return null
  if (funcion && !funcionPermitida(role, section, funcion, permisos)) return null

  // Plataforma modular · E1: capa de CAPACIDADES por empresa (rol Y capacidad
  // deben permitir). El superadmin no se gatea; el resolutor es fail-open
  // (empresa sin configurar o migración pendiente = todo lo actual permitido).
  if (user.metadata.role !== 'SUPERADMIN') {
    const { seccionPermitidaPorCapacidades } = await import('@/modules/capacidades/resolver')
    if (!(await seccionPermitidaPorCapacidades(user.metadata.companyId, section))) {
      return null
    }
  }
  return user
}

/**
 * ¿Puede esta persona usar ESTA función, sin negarle la pantalla entera?
 *
 * `requireSection` responde sí/no al acceso: si falta el permiso, no hay
 * página. Esto responde otra pregunta, la que hace falta DENTRO de una
 * pantalla que sí se puede ver: «además de entrar, ¿puede ver las cifras de
 * dinero?». Un encargado de turno tiene que poder abrir el reporte de
 * operación sin ver cuánto factura el negocio.
 *
 * Devuelve `false` ante cualquier duda —sin sesión, sin permisos legibles, un
 * fallo de la consulta—. Negar por defecto es la única respuesta segura
 * cuando no se sabe.
 */
export async function puedeFuncion(section: AdminSection, funcion: string): Promise<boolean> {
  return (await requireSection(section, funcion)) !== null
}
