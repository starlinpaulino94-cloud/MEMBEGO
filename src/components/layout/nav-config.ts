import {
  WalletCards,
  LayoutDashboard,
  Users,
  CreditCard,
  Megaphone,
  Gift,
  Rocket,
  ScanLine,
  Wallet,
  Building2,
  Landmark,
  Package,
  MessageCircle,
  UserCog,
  BarChart3,
  ClipboardList,
  History,
  User,
  ShieldCheck,
  LifeBuoy,
  Newspaper,
  TrendingUp,
  Store,
  Bell,
  Flag,
  Zap,
  Ticket,
  Banknote,
  ReceiptText,
  FileText,
  HeartHandshake,
  Trophy,
  CalendarDays,
  Palette,
  Share2,
  Tag,
  QrCode,
  Compass,
  LayoutGrid,
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react'
import type { AppRole } from '@/types'
import { adminSectionForPath, canAccessAdminSection } from '@/lib/auth/permissions'

export interface NavLink {
  href: string
  label: string
  icon: LucideIcon
}

export interface NavGroup {
  /** Id estable del grupo (persistencia del estado colapsado). */
  id: string
  label: string
  items: NavLink[]
}

/**
 * Navegación del panel de empresa — reagrupada por ÁREA DE TRABAJO en 7 zonas
 * claras (Auditoría del panel · Fase A). Cada grupo responde a una intención:
 * ¿quién es mi cliente? (Clientes) · ¿cuánto entra? (Ingresos) · ¿qué comunico
 * y ofrezco? (Marketing) · el mostrador (Operación) · ¿qué dicen los números?
 * (Análisis) · configurar el negocio (Configuración).
 *
 * Decisiones de la Fase A:
 * - "Referidos" e "Invitaciones" eran el MISMO concepto ("Invita y Gana"): se
 *   fusionan en una sola entrada que abre las campañas (/admin/invitaciones);
 *   el panel de rendimiento (/admin/referidos) queda enlazado desde ahí.
 * - Cada ítem tiene un ícono único (antes Regalos VIP/Referidos compartían Gift
 *   y Banners/Personalización compartían Sparkles).
 * - La fusión de la CREACIÓN de ofertas (Promociones/Banners/Regalos VIP) es la
 *   Fase D; aquí solo se reagrupan bajo "Marketing".
 */
const ADMIN_NAV: NavGroup[] = [
  {
    id: 'inicio',
    label: 'Inicio',
    items: [{ href: '/admin/dashboard', label: 'Resumen', icon: LayoutDashboard }],
  },
  {
    id: 'clientes',
    label: 'Clientes',
    items: [
      { href: '/admin/clientes', label: 'Clientes', icon: Users },
      { href: '/admin/membresias', label: 'Membresías', icon: CreditCard },
      { href: '/admin/citas', label: 'Citas', icon: CalendarDays },
      { href: '/admin/regalos', label: 'Regalos P2P', icon: HeartHandshake },
    ],
  },
  {
    id: 'ingresos',
    label: 'Ingresos',
    items: [
      { href: '/admin/pagos', label: 'Pagos', icon: Wallet },
      { href: '/admin/facturas', label: 'Facturas', icon: ReceiptText },
      { href: '/admin/registros', label: 'Registros', icon: FileText },
      { href: '/admin/metodos-pago', label: 'Métodos de pago', icon: Landmark },
    ],
  },
  {
    id: 'marketing',
    label: 'Marketing',
    items: [
      // "Ofertas" es el punto de entrada ÚNICO (Auditoría · Fase D): el hub
      // /admin/ofertas agrupa Promociones (pública), Banners (relámpago) y
      // Regalos VIP. Los tres siguen siendo módulos/tablas independientes,
      // accesibles desde el hub y por URL directa.
      { href: '/admin/ofertas', label: 'Ofertas', icon: Tag },
      { href: '/admin/publicaciones', label: 'Publicaciones', icon: Newspaper },
      { href: '/admin/invitaciones', label: 'Invita y Gana', icon: Share2 },
      { href: '/admin/gamificacion', label: 'Ruleta de premios', icon: Trophy },
      { href: '/admin/notificaciones', label: 'Notificaciones', icon: Bell },
      { href: '/admin/automatizaciones', label: 'Automatizaciones', icon: Zap },
      { href: '/admin/campanas', label: 'Campañas', icon: Flag },
    ],
  },
  {
    id: 'operacion',
    label: 'Operación',
    items: [
      { href: '/admin/scanner', label: 'Escanear QR', icon: ScanLine },
      { href: '/admin/sucursales', label: 'Sucursales', icon: Building2 },
    ],
  },
  {
    id: 'analisis',
    label: 'Análisis',
    items: [
      { href: '/admin/reportes', label: 'Reportes', icon: BarChart3 },
      { href: '/admin/seguimiento', label: 'Seguimiento', icon: QrCode },
      { href: '/admin/audiencia', label: 'Audiencia', icon: TrendingUp },
      { href: '/admin/adquisicion', label: 'Origen de clientes', icon: Compass },
      { href: '/admin/crecimiento', label: 'Crecimiento', icon: Rocket },
    ],
  },
  {
    // Plataforma modular · E2: puerta de entrada al segundo nivel (los
    // sistemas del negocio). El launchpad muestra las apps de la empresa.
    id: 'aplicaciones',
    label: 'Aplicaciones',
    items: [{ href: '/admin/aplicaciones', label: 'Aplicaciones', icon: LayoutGrid }],
  },
  {
    id: 'configuracion',
    label: 'Configuración',
    items: [
      { href: '/admin/perfil', label: 'Perfil público', icon: Store },
      { href: '/admin/personalizacion', label: 'Personalización', icon: Palette },
      { href: '/admin/planes', label: 'Planes', icon: Package },
      { href: '/admin/empleados', label: 'Empleados', icon: UserCog },
      { href: '/admin/comunicacion', label: 'Comunicación', icon: MessageCircle },
      { href: '/admin/tickets', label: 'Tickets', icon: LifeBuoy },
    ],
  },
]

const CLIENTE_NAV: NavGroup[] = [
  {
    id: 'inicio',
    label: 'Inicio',
    // Enlace directo a la vista real (evita el salto de redirect por
    // /cliente/dashboard -> /mis-membresias).
    items: [
      { href: '/cliente/inicio', label: 'Inicio', icon: LayoutDashboard },
      { href: '/mis-membresias', label: 'Mis membresías', icon: WalletCards },
      { href: '/cliente/citas', label: 'Mis citas', icon: CalendarDays },
    ],
  },
  {
    id: 'membresia',
    label: 'Membresía',
    items: [
      { href: '/cliente/planes', label: 'Planes', icon: Package },
      { href: '/cliente/pagos', label: 'Mis pagos', icon: Wallet },
    ],
  },
  {
    id: 'beneficios',
    label: 'Beneficios',
    // Marca única: sin "Explorar empresas" ni "Mis empresas" en el menú (el
    // cliente vive dentro de SU negocio). Las rutas siguen activas por URL
    // para cuando el marketplace se abra con más empresas.
    items: [
      { href: '/cliente/promociones', label: 'Promociones', icon: Megaphone },
      { href: '/cliente/mis-promociones', label: 'Mis beneficios', icon: Ticket },
      { href: '/cliente/regalos', label: 'Regalos', icon: HeartHandshake },
      // Unificación: el antiguo módulo "Referidos" vive dentro de Invita y Gana.
      { href: '/cliente/invita-y-gana', label: 'Invita y Gana', icon: Gift },
      { href: '/cliente/ruleta', label: 'Ruleta de premios', icon: Trophy },
    ],
  },
  {
    id: 'cuenta',
    label: 'Cuenta',
    items: [
      { href: '/cliente/historial', label: 'Historial', icon: History },
      { href: '/cliente/perfil', label: 'Perfil', icon: User },
      { href: '/cliente/ayuda', label: 'Ayuda', icon: LifeBuoy },
    ],
  },
]

// El superadmin ve su sección de plataforma + el panel de empresa completo.
// Derivado por composición de ADMIN_NAV: añadir una sección al panel admin la
// añade automáticamente aquí (antes era una copia manual que divergía).
const SUPERADMIN_NAV: NavGroup[] = [
  {
    id: 'inicio',
    label: 'Inicio',
    items: [{ href: '/superadmin/dashboard', label: 'Resumen', icon: LayoutDashboard }],
  },
  {
    id: 'plataforma',
    label: 'Plataforma',
    items: [
      { href: '/superadmin/empresas', label: 'Empresas', icon: Building2 },
      { href: '/superadmin/usuarios', label: 'Usuarios', icon: UserCog },
      { href: '/superadmin/planes', label: 'Planes globales', icon: Package },
      { href: '/superadmin/membresias', label: 'Membresías globales', icon: CreditCard },
      { href: '/superadmin/operaciones', label: 'Operaciones', icon: ClipboardList },
      { href: '/superadmin/capacidades', label: 'Capacidades', icon: SlidersHorizontal },
      { href: '/superadmin/reportes', label: 'Reportes globales', icon: BarChart3 },
    ],
  },
  // Panel de empresa completo, sin el grupo "Inicio" (el superadmin ya tiene el suyo).
  ...ADMIN_NAV.filter((g) => g.id !== 'inicio'),
]

const EMPLEADO_NAV: NavGroup[] = [
  {
    id: 'operaciones',
    label: 'Operaciones',
    items: [
      { href: '/empleado/scanner', label: 'Escanear QR', icon: ScanLine },
      { href: '/empleado/caja', label: 'Caja', icon: Banknote },
    ],
  },
]

/** Deja solo los enlaces cuya sección puede abrir el rol (Marketing/Supervisor). */
function filterNavBySection(groups: NavGroup[], role: AppRole): NavGroup[] {
  return groups
    .map((g) => ({
      ...g,
      items: g.items.filter((it) => {
        const section = adminSectionForPath(it.href)
        return section ? canAccessAdminSection(role, section) : false
      }),
    }))
    .filter((g) => g.items.length > 0)
}

/**
 * Oculta del menú los enlaces cuya ruta esté en `hidden` (módulos sin
 * contenido todavía) y descarta los grupos que queden vacíos. Ver
 * `getNavOcultoCliente`.
 */
export function filtrarNavOculto(groups: NavGroup[], hidden: string[]): NavGroup[] {
  if (hidden.length === 0) return groups
  const set = new Set(hidden)
  return groups
    .map((g) => ({ ...g, items: g.items.filter((it) => !set.has(it.href)) }))
    .filter((g) => g.items.length > 0)
}

/** Resolve the sidebar navigation for any role. */
export function navForRole(role: AppRole): NavGroup[] {
  switch (role) {
    case 'CLIENTE':
      return CLIENTE_NAV
    case 'SUPERADMIN':
      return SUPERADMIN_NAV
    case 'EMPLEADO':
    case 'RECEPCION':
      return EMPLEADO_NAV
    case 'MARKETING':
    case 'SUPERVISOR':
      // Roles acotados: mismo panel admin pero solo sus secciones.
      return filterNavBySection(ADMIN_NAV, role)
    default:
      // ADMINISTRADOR, GERENTE, CAJERO, ADMIN_EMPRESA
      return ADMIN_NAV
  }
}

export function roleLabel(role: AppRole): string {
  switch (role) {
    case 'CLIENTE':
      return 'Cliente'
    case 'SUPERADMIN':
      return 'Superadmin'
    case 'EMPLEADO':
      return 'Empleado'
    case 'RECEPCION':
      return 'Recepción'
    case 'GERENTE':
      return 'Gerente'
    case 'CAJERO':
      return 'Cajero'
    case 'MARKETING':
      return 'Marketing'
    case 'SUPERVISOR':
      return 'Supervisor'
    default:
      return 'Administrador'
  }
}

/** Icon per role, accessed by property (avoids "component created during render"). */
export const ROLE_ICONS: Record<AppRole, LucideIcon> = {
  SUPERADMIN: ShieldCheck,
  ADMINISTRADOR: ShieldCheck,
  GERENTE: ShieldCheck,
  CAJERO: ShieldCheck,
  ADMIN_EMPRESA: ShieldCheck,
  MARKETING: Megaphone,
  SUPERVISOR: ShieldCheck,
  RECEPCION: ScanLine,
  EMPLEADO: ScanLine,
  CLIENTE: User,
}

/** Flattened links for breadcrumb/title resolution. */
export function allLinks(groups: NavGroup[]): NavLink[] {
  return groups.flatMap((g) => g.items)
}
