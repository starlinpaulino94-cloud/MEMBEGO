/**
 * Todos los roles, como VALOR además de como tipo: hay listas (por ejemplo
 * quién puede abrir un sistema satélite) que se definen por exclusión y con la
 * lista escrita a mano se olvidan roles nuevos.
 */
export const ROLES_APP = [
  'SUPERADMIN',
  'ADMINISTRADOR',
  'GERENTE',
  'CAJERO',
  'RECEPCION',
  'MARKETING',
  'SUPERVISOR',
  'EMPLEADO',
  'CLIENTE',
  'ADMIN_EMPRESA',
] as const

export type AppRole =
  | 'SUPERADMIN'
  | 'ADMINISTRADOR'
  | 'GERENTE'
  | 'CAJERO'
  | 'RECEPCION'
  | 'MARKETING'
  | 'SUPERVISOR'
  | 'EMPLEADO'
  | 'CLIENTE'
  // Vendedor de Excursiones (acceso externo: hoteles, taxistas, promotores).
  // Solo alcanza /vendedor — nunca el panel de la empresa ni el escáner.
  | 'VENDEDOR'
  // Legacy (se mantiene para no romper usuarios existentes)
  | 'ADMIN_EMPRESA'

export type MembershipEstado =
  | 'PENDIENTE'
  | 'PENDIENTE_PAGO'
  | 'RECHAZADA'
  | 'ACTIVA'
  | 'VENCIDA'
  | 'CANCELADA'

export type PaymentEstado = 'PENDIENTE' | 'APROBADO' | 'RECHAZADO' | 'CANCELADO'
export type PaymentMetodo = 'TRANSFERENCIA' | 'PRESENCIAL'
export type QrTokenEstado = 'ACTIVO' | 'CONSUMIDO' | 'REVOCADO'
export type ReceiptTipo = 'PAGO' | 'CONSUMO'

export interface AppMetadata {
  role: AppRole
  dbUserId: string
  clienteId?: string | null
  companyId?: string | null
  sucursalId?: string | null
  /**
   * Módulo de PERMISOS: ajustes por empleado espejados en el token para el
   * gate de VISTA del proxy (llegan con el refresco del token). La fuente de
   * verdad vive en `users.permisos` y la leen VIVA las server actions.
   */
  permisos?: unknown
}

export interface SessionUser {
  supabaseId: string
  email: string
  metadata: AppMetadata
}

// Redirección por defecto al iniciar sesión, según rol.
// Los roles administrativos van al panel /admin;
// RECEPCION y EMPLEADO van al escáner;
// CLIENTE va a su panel.
export const ROLE_HOME: Record<AppRole, string> = {
  SUPERADMIN: '/superadmin/dashboard',
  ADMINISTRADOR: '/admin/dashboard',
  GERENTE: '/admin/dashboard',
  CAJERO: '/admin/dashboard',
  RECEPCION: '/empleado/scanner',
  MARKETING: '/admin/dashboard',
  SUPERVISOR: '/admin/dashboard',
  EMPLEADO: '/empleado/scanner',
  // Directo a /mis-membresias: /cliente/dashboard era solo un redirect y
  // duplicaba middleware + layout justo después del login.
  CLIENTE: '/cliente/inicio',
  VENDEDOR: '/vendedor',
  // Legacy
  ADMIN_EMPRESA: '/admin/dashboard',
}

// Roles que pueden acceder al panel administrativo /admin/*. El acceso FINO
// por sección (qué puede ver Marketing vs Supervisor) se resuelve en
// src/lib/auth/permissions.ts; aquí solo se controla la entrada al panel.
export const ADMIN_ROLES: AppRole[] = [
  'SUPERADMIN',
  'ADMINISTRADOR',
  'GERENTE',
  'CAJERO',
  'MARKETING',
  'SUPERVISOR',
  'ADMIN_EMPRESA', // legacy
]

// Roles con acceso COMPLETO al panel (todas las secciones). Marketing y
// Supervisor quedan fuera: su acceso está acotado por sección.
export const FULL_ADMIN_ROLES: AppRole[] = [
  'SUPERADMIN',
  'ADMINISTRADOR',
  'GERENTE',
  'CAJERO',
  'ADMIN_EMPRESA', // legacy
]

// Roles que un administrador puede asignar al invitar a un miembro del equipo
// (Onboarding Fase 2C). Excluye SUPERADMIN, CLIENTE y el legacy ADMIN_EMPRESA.
export const INVITABLE_ROLES: AppRole[] = [
  'ADMINISTRADOR',
  'GERENTE',
  'CAJERO',
  'RECEPCION',
  'MARKETING',
  'SUPERVISOR',
  'EMPLEADO',
]

// Roles que pueden acceder al escáner /empleado/*
export const SCANNER_ROLES: AppRole[] = [
  'SUPERADMIN',
  'ADMINISTRADOR',
  'GERENTE',
  'CAJERO',
  'RECEPCION',
  'EMPLEADO',
  'ADMIN_EMPRESA', // legacy
]

/**
 * Fuente única de verdad para la protección de rutas por prefijo.
 * La consume el edge (`src/proxy.ts`) y debe mantenerse alineada con los
 * guards de cada layout de route-group. Agregar un rol nuevo se hace aquí,
 * en un solo lugar, para evitar drift entre el edge y los layouts.
 */
export const ROUTE_PROTECTION: { prefix: string; roles: AppRole[] }[] = [
  { prefix: '/superadmin', roles: ['SUPERADMIN'] },
  { prefix: '/admin', roles: ADMIN_ROLES },
  // El asistente de configuración/publicación es solo del dueño (admin pleno),
  // no de los roles acotados de equipo.
  { prefix: '/onboarding', roles: FULL_ADMIN_ROLES },
  { prefix: '/empleado', roles: SCANNER_ROLES },
  { prefix: '/cliente', roles: ['CLIENTE'] },
  // Panel del vendedor de Excursiones: un solo rol, y ese rol no entra a
  // ningún otro sitio. El aislamiento del externo es estructural.
  { prefix: '/vendedor', roles: ['VENDEDOR'] },
  // Vistas de cliente fuera del prefijo /cliente (grupo (cliente)).
  { prefix: '/mis-membresias', roles: ['CLIENTE'] },
  { prefix: '/membresia', roles: ['CLIENTE'] },
]

/**
 * Etiqueta corta de cada rol INVITABLE, para el select de «qué rol le doy».
 *
 * Es deliberadamente incompleto: aquí solo están los roles que se pueden
 * ASIGNAR desde un formulario. `SUPERADMIN` no se asigna así (se otorga desde
 * la lista de usuarios, con su confirmación), `CLIENTE` no es staff y
 * `ADMIN_EMPRESA` es histórico. Para PINTAR un rol cualquiera está `ROL_LABEL`.
 */
export const ROL_STAFF_LABEL: Record<string, string> = {
  ADMINISTRADOR: 'Administrador',
  GERENTE: 'Gerente',
  CAJERO: 'Cajero',
  RECEPCION: 'Recepción',
  MARKETING: 'Marketing',
  SUPERVISOR: 'Supervisor',
  EMPLEADO: 'Empleado',
}

/**
 * TODOS los roles con nombre legible. El mapa canónico para mostrar.
 *
 * Existe porque la pantalla de usuarios del superadmin tenía su propia copia
 * —`ROL_STAFF_LABEL` más dos entradas escritas a mano allí mismo—, que era la
 * tercera copia local de un mapa de este panel. Copias así no dan error: se
 * separan. Una pantalla dice «Administrador (legacy)» y la de al lado
 * «ADMIN_EMPRESA», y nadie sabe si son lo mismo.
 *
 * Se construye SOBRE el mapa de staff en lugar de repetir sus siete entradas:
 * si mañana «Recepción» pasa a llamarse otra cosa, se cambia en un sitio.
 */
export const ROL_LABEL: Record<string, string> = {
  ...ROL_STAFF_LABEL,
  SUPERADMIN: 'Superadmin',
  CLIENTE: 'Cliente',
  VENDEDOR: 'Vendedor (excursiones)',
  ADMIN_EMPRESA: 'Administrador (legacy)',
}
