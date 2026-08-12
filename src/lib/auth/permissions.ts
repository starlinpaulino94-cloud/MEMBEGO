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
  // Bitácora de actividad: toda acción con su fecha y hora exactas.
  'actividad',
  // Bloque 2 de la auditoría: quién está a punto de irse y cuánto cuesta
  // perderlo, y el reporte de retención con el pasivo de usos sin consumir.
  'riesgo',
  'retencion',
  // Comprobaciones cruzadas entre membresías, transacciones y caja.
  'conciliacion',
  'adquisicion',
  'audiencia',
  'invitaciones',
  'marketing',
  'gamificacion',
  'personalizacion',
  // `/admin/app/<vertical>/*`. El launchpad `/admin/aplicaciones` se retiró
  // —los sistemas de cada oficio se construyen aparte y se conectan por
  // contrato—, pero las pantallas de Car Wash siguen en el repositorio para su
  // extracción y su guardia tiene que seguir existiendo. Ya no se enlazan desde
  // ningún sitio: son alcanzables por URL y nada más.
  'app',
] as const

// Tipo derivado de la lista: una sola fuente de verdad (evita drift).
export type AdminSection = (typeof ADMIN_SECTIONS)[number]

// Secciones permitidas por rol acotado (Decisión 2 del plan de onboarding).
// MARKETING = difusión; SUPERVISOR = operación. Ambos incluyen 'dashboard'
// como aterrizaje. Todo lo no listado queda denegado (fail-closed).
const RESTRICTED_ACCESS: Partial<Record<AppRole, AdminSection[]>> = {
  // 'riesgo' entra en los dos: Marketing lo necesita para saber a quién
  // dirigir una campaña de retención, y Supervisión para repartir las llamadas.
  MARKETING: ['dashboard', 'ofertas', 'promociones', 'publicaciones', 'campanas', 'marketing', 'audiencia', 'adquisicion', 'notificaciones', 'automatizaciones', 'riesgo', 'retencion'],
  // Sin 'aplicaciones': el módulo se retiró a propósito (los genéricos —QR,
  // citas, seguimiento— volvieron al menú lateral como secciones propias).
  SUPERVISOR: ['dashboard', 'reportes', 'seguimiento', 'registros', 'actividad', 'clientes', 'membresias', 'pagos', 'scanner', 'citas', 'app', 'riesgo', 'retencion', 'conciliacion'],
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
