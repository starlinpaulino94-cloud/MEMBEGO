import { FULL_ADMIN_ROLES, type AppRole } from '@/types'

/**
 * Autorización FINA del panel /admin por sección (Onboarding Fase 2 · O-5).
 *
 * Los roles de `FULL_ADMIN_ROLES` (admin/gerente/cajero/superadmin) acceden a
 * TODAS las secciones. Los roles acotados (MARKETING, SUPERVISOR) solo a las
 * suyas. La fuente de verdad se consume en el middleware (navegación), en la
 * navegación (para no mostrar lo que no pueden abrir) y en los guards de las
 * server actions sensibles (`requireSection`), que son la barrera real: el
 * gate del middleware no protege las actions (se despachan por ID sobre
 * cualquier path permitido).
 */
export const ADMIN_SECTIONS = [
  'dashboard',
  'clientes',
  'membresias',
  'promociones',
  'publicaciones',
  'campanas',
  'referidos',
  'crecimiento',
  'scanner',
  'pagos',
  'citas',
  'ofertas',
  'perfil',
  'sucursales',
  'metodos-pago',
  'planes',
  'notificaciones',
  'automatizaciones',
  'comunicacion',
  'tickets',
  'empleados',
  'registros',
  'regalos',
  'seguimiento',
  'reportes',
  'adquisicion',
  'audiencia',
  'invitaciones',
  'marketing',
  'gamificacion',
  'personalizacion',
  // Plataforma modular · E2: launchpad de aplicaciones y shells de negocio
  // (/admin/aplicaciones y /admin/app/<categoria>).
  'aplicaciones',
  'app',
] as const

// Tipo derivado de la lista: una sola fuente de verdad (evita drift).
export type AdminSection = (typeof ADMIN_SECTIONS)[number]

// Secciones permitidas por rol acotado (Decisión 2 del plan de onboarding).
// MARKETING = difusión; SUPERVISOR = operación. Ambos incluyen 'dashboard'
// como aterrizaje. Todo lo no listado queda denegado (fail-closed).
const RESTRICTED_ACCESS: Partial<Record<AppRole, AdminSection[]>> = {
  MARKETING: ['dashboard', 'ofertas', 'promociones', 'publicaciones', 'campanas', 'marketing', 'audiencia', 'adquisicion', 'notificaciones', 'automatizaciones'],
  SUPERVISOR: ['dashboard', 'reportes', 'seguimiento', 'registros', 'clientes', 'membresias', 'pagos', 'scanner', 'citas', 'aplicaciones', 'app'],
}

/** ¿Puede este rol abrir esta sección del panel? */
export function canAccessAdminSection(role: AppRole, section: AdminSection): boolean {
  if (FULL_ADMIN_ROLES.includes(role)) return true
  return RESTRICTED_ACCESS[role]?.includes(section) ?? false
}

/**
 * Deriva la sección de un path del panel: `/admin/promociones/nuevo` →
 * `promociones`. Solo `/admin` exacto → `dashboard`. Devuelve null si el path
 * no es de /admin, tiene un segmento vacío (p. ej. `/admin//x`) o la sección
 * no es reconocida — en esos casos el llamador debe denegar (fail-closed).
 */
export function adminSectionForPath(path: string): AdminSection | null {
  if (path === '/admin') return 'dashboard'
  if (!path.startsWith('/admin/')) return null
  const seg = path.split('/')[2]
  if (!seg) return null
  return (ADMIN_SECTIONS as readonly string[]).includes(seg) ? (seg as AdminSection) : null
}
