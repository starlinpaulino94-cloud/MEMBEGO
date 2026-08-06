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
  // Vistas de cliente fuera del prefijo /cliente (grupo (cliente)).
  { prefix: '/mis-membresias', roles: ['CLIENTE'] },
  { prefix: '/membresia', roles: ['CLIENTE'] },
]

/** Etiqueta corta de cada rol de staff, para selects/badges administrativos. */
export const ROL_STAFF_LABEL: Record<string, string> = {
  ADMINISTRADOR: 'Administrador',
  GERENTE: 'Gerente',
  CAJERO: 'Cajero',
  RECEPCION: 'Recepción',
  MARKETING: 'Marketing',
  SUPERVISOR: 'Supervisor',
  EMPLEADO: 'Empleado',
}
