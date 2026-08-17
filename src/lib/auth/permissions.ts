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
  // Módulo de EXCURSIONES (ventas, vendedores y comisiones). Detrás de la
  // capacidad EXCURSIONES: sin ella encendida, requireSection la niega.
  'excursiones',
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

// ── Permisos POR EMPLEADO (módulo de Permisos, 14-08-2026) ───────────────────
//
// El rol da el punto de partida; los permisos del empleado lo AJUSTAN en las
// dos direcciones: conceder una sección que su rol no trae, o negarle una que
// sí trae — y dentro de una sección permitida, negar funciones concretas.
//
// Se guardan como DIFERENCIAS contra el rol (mismo patrón que los overrides
// de capacidades): si mañana cambia lo que un rol trae de serie, los
// empleados sin ajuste lo heredan solo.

export interface PermisosUsuario {
  v: 1
  /** Sección → true (conceder más allá del rol) | false (negar pese al rol). */
  secciones?: Record<string, boolean>
  /** Sección → función → false (negada). Solo se guardan negaciones. */
  funciones?: Record<string, Record<string, boolean>>
}

/**
 * Roles a los que los ajustes NO se aplican al RESOLVER: solo el superadmin.
 *
 * DECISIÓN DE PRODUCTO (15-08-2026, dueño de la plataforma): en esta etapa la
 * plataforma tiene control total sobre lo que cada empresa puede usar — así
 * que los ajustes SÍ aplican a los ADMINISTRADORES de empresa… pero solo el
 * superadmin puede ponérselos (ver `puedeEditarPermisos`): un admin sigue
 * sin poder bloquear a otro admin ni a sí mismo. El candado cambió de "los
 * admins son intocables" a "a los admins solo los toca la plataforma".
 */
export const ROLES_EXENTOS_PERMISOS: readonly AppRole[] = ['SUPERADMIN']

const ROLES_ADMIN_EMPRESA: readonly AppRole[] = ['ADMINISTRADOR', 'ADMIN_EMPRESA']

/**
 * ¿Puede `editor` ajustar los permisos de `objetivo`?
 *  · SUPERADMIN → a cualquiera menos a otro superadmin.
 *  · Admin de empresa → a su equipo, nunca a otro admin (ni a la plataforma).
 *  · Nadie se edita a sí mismo (eso lo valida el caller con los ids).
 */
export function puedeEditarPermisos(editor: AppRole, objetivo: AppRole): boolean {
  if (objetivo === 'SUPERADMIN') return false
  if (editor === 'SUPERADMIN') return true
  if (ROLES_ADMIN_EMPRESA.includes(editor)) return !ROLES_ADMIN_EMPRESA.includes(objetivo)
  return false
}

/** Normaliza el JSON guardado (tolerante a null/basura). Null = sin ajustes. */
export function resolverPermisosUsuario(raw: unknown): PermisosUsuario | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as { secciones?: unknown; funciones?: unknown }
  const secciones: Record<string, boolean> = {}
  if (r.secciones && typeof r.secciones === 'object') {
    for (const [k, v] of Object.entries(r.secciones as Record<string, unknown>)) {
      if ((ADMIN_SECTIONS as readonly string[]).includes(k) && typeof v === 'boolean') {
        secciones[k] = v
      }
    }
  }
  const funciones: Record<string, Record<string, boolean>> = {}
  if (r.funciones && typeof r.funciones === 'object') {
    for (const [sec, fns] of Object.entries(r.funciones as Record<string, unknown>)) {
      if (!(ADMIN_SECTIONS as readonly string[]).includes(sec)) continue
      if (!fns || typeof fns !== 'object') continue
      const limpio: Record<string, boolean> = {}
      for (const [f, v] of Object.entries(fns as Record<string, unknown>)) {
        if (v === false) limpio[f] = false
      }
      if (Object.keys(limpio).length) funciones[sec] = limpio
    }
  }
  if (!Object.keys(secciones).length && !Object.keys(funciones).length) return null
  return { v: 1, secciones, funciones }
}

/**
 * ¿Puede ESTE empleado abrir esta sección? Rol como base, ajuste encima.
 * Los roles exentos ignoran los ajustes (nunca pueden quedar bloqueados).
 */
export function seccionPermitida(
  role: AppRole,
  section: AdminSection,
  permisos: PermisosUsuario | null | undefined
): boolean {
  const base = canAccessAdminSection(role, section)
  if (ROLES_EXENTOS_PERMISOS.includes(role)) return base
  return permisos?.secciones?.[section] ?? base
}

/**
 * ¿Puede ejecutar esta FUNCIÓN de la sección? Exige la sección permitida y
 * que la función no esté negada. Las funciones no negadas se permiten: la
 * negación es la excepción, no la regla.
 */
export function funcionPermitida(
  role: AppRole,
  section: AdminSection,
  funcion: string,
  permisos: PermisosUsuario | null | undefined
): boolean {
  if (!seccionPermitida(role, section, permisos)) return false
  if (ROLES_EXENTOS_PERMISOS.includes(role)) return true
  return permisos?.funciones?.[section]?.[funcion] !== false
}

/**
 * Convierte la SELECCIÓN del formulario (estado efectivo deseado por sección
 * y función) en el JSON de diferencias contra el rol. Devuelve null si no
 * queda ningún ajuste (la columna se limpia).
 */
export function permisosDesdeSeleccion(
  role: AppRole,
  seleccion: {
    secciones: Partial<Record<AdminSection, boolean>>
    funcionesNegadas: Partial<Record<AdminSection, string[]>>
  }
): PermisosUsuario | null {
  const secciones: Record<string, boolean> = {}
  for (const [sec, efectivo] of Object.entries(seleccion.secciones)) {
    if (typeof efectivo !== 'boolean') continue
    const base = canAccessAdminSection(role, sec as AdminSection)
    if (efectivo !== base) secciones[sec] = efectivo
  }
  const funciones: Record<string, Record<string, boolean>> = {}
  for (const [sec, negadas] of Object.entries(seleccion.funcionesNegadas)) {
    if (!negadas?.length) continue
    funciones[sec] = Object.fromEntries(negadas.map((f) => [f, false]))
  }
  if (!Object.keys(secciones).length && !Object.keys(funciones).length) return null
  return { v: 1, secciones, funciones }
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
