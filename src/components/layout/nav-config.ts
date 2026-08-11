import {
  Activity,
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
  Car,
  FlaskConical,
  Landmark,
  Package,
  Plug,
  MessageCircle,
  UserCog,
  BarChart3,
  ClipboardList,
  History,
  User,
  LifeBuoy,
  Newspaper,
  TrendingUp,
  TriangleAlert,
  HeartPulse,
  Scale,
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
 * DS 2.0 · Un contexto de trabajo del menú.
 *
 * Existe por el superadmin: su navegación son 45 enlaces porque mezcla los
 * módulos de la plataforma con el panel completo de una empresa. Son dos
 * trabajos distintos y no deberían pintarse a la vez. Con contextos, el
 * menú muestra uno y ofrece cambiar al otro.
 *
 * Los demás roles tienen UN solo contexto, así que el selector ni aparece.
 */
export interface NavContext {
  id: string
  label: string
  groups: NavGroup[]
}

/**
 * Navegación del panel de empresa — OCHO DOMINIOS DE TRABAJO (DS 2.0 · Fase 0).
 *
 * La reagrupación anterior (Fase A) ya había ordenado los módulos por área,
 * pero seguían siendo 33 enlaces pintados a la vez. El cambio de esta fase no
 * es sumar ni quitar destinos —las 33 rutas siguen todas aquí— sino que el
 * menú presente DOMINIOS y no el inventario completo de funcionalidades.
 *
 * Tres movimientos respecto a la versión anterior, y por qué:
 *
 * - PLANES sale de "Configuración" y entra en "Beneficios". Un plan es el
 *   producto que la empresa vende, no un ajuste del sistema. Tenerlo junto a
 *   Empleados y Personalización era lo que hacía que Planes y Membresías se
 *   sintieran el mismo concepto: ahora Planes vive con lo que se ofrece y
 *   Membresías con quién lo tiene.
 *
 * - PAGOS, COMPROBANTES y REGISTROS salen de "Ingresos" y entran en
 *   "Operaciones". Los tres son trabajo de mostrador —confirmar, emitir,
 *   registrar—, no lectura de números. "Analítica" queda para leer.
 *
 * - Las dos entradas llamadas "Campañas" se desambiguaron. Existían
 *   /admin/campanas y /admin/audiencia/campanas con etiqueta IDÉNTICA en el
 *   mismo menú. La Fase 0 renombró la segunda y la MANTUVO aquí porque
 *   ninguna página enlazaba hacia ella: quitarla la habría dejado accesible
 *   solo escribiendo la URL. La Fase 11 le dio pestañas a Audiencia —resumen,
 *   segmentos y campañas segmentadas son una sola sección— así que ya sale
 *   del menú sin quedar huérfana. Es el motivo por el que la condición se
 *   escribió: para poder retirarla cuando dejara de ser cierta.
 *
 * Se conservan las decisiones de la Fase A: "Referidos" e "Invitaciones"
 * siguen fusionadas en "Invita y Gana"; "Ofertas" sigue siendo el punto de
 * entrada único al hub que agrupa Promociones, Banners y Regalos VIP.
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
      { href: '/admin/clientes', label: 'Directorio', icon: Users },
      { href: '/admin/membresias', label: 'Membresías', icon: CreditCard },
      // Bloque 2 de la auditoría: el destino que faltaba para los avisos del
      // Resumen. Va aquí, junto a Directorio y Membresías, porque la pregunta
      // que responde —«¿a quién llamo hoy?»— es de la gestión de clientes.
      { href: '/admin/riesgo', label: 'En riesgo', icon: TriangleAlert },
      { href: '/admin/audiencia/segmentos', label: 'Segmentos', icon: SlidersHorizontal },
      { href: '/admin/citas', label: 'Citas', icon: CalendarDays },
      { href: '/admin/actividad', label: 'Actividad', icon: History },
    ],
  },
  {
    id: 'beneficios',
    label: 'Beneficios',
    items: [
      { href: '/admin/planes', label: 'Planes', icon: Package },
      { href: '/admin/ofertas', label: 'Ofertas', icon: Tag },
      { href: '/admin/invitaciones', label: 'Invita y Gana', icon: Share2 },
      { href: '/admin/gamificacion', label: 'Ruleta de premios', icon: Trophy },
      { href: '/admin/crecimiento', label: 'Crecimiento', icon: Rocket },
      { href: '/admin/regalos', label: 'Regalos P2P', icon: HeartHandshake },
    ],
  },
  {
    id: 'marketing',
    label: 'Marketing',
    items: [
      { href: '/admin/campanas', label: 'Campañas', icon: Flag },
      { href: '/admin/publicaciones', label: 'Publicaciones', icon: Newspaper },
      { href: '/admin/notificaciones', label: 'Notificaciones', icon: Bell },
      { href: '/admin/automatizaciones', label: 'Automatizaciones', icon: Zap },
    ],
  },
  {
    id: 'operaciones',
    label: 'Operaciones',
    items: [
      { href: '/admin/scanner', label: 'Escanear QR', icon: ScanLine },
      { href: '/admin/pagos', label: 'Pagos', icon: Wallet },
      { href: '/admin/facturas', label: 'Comprobantes', icon: ReceiptText },
      { href: '/admin/registros', label: 'Registros', icon: FileText },
      { href: '/admin/sucursales', label: 'Sucursales', icon: Building2 },
    ],
  },
  {
    id: 'analitica',
    label: 'Analítica',
    items: [
      { href: '/admin/reportes', label: 'Reportes', icon: BarChart3 },
      { href: '/admin/retencion', label: 'Retención', icon: HeartPulse },
      { href: '/admin/conciliacion', label: 'Conciliación', icon: Scale },
      { href: '/admin/audiencia', label: 'Audiencia', icon: TrendingUp },
      { href: '/admin/adquisicion', label: 'Origen de clientes', icon: Compass },
      { href: '/admin/seguimiento', label: 'Seguimiento', icon: QrCode },
    ],
  },
  {
    id: 'empresa',
    label: 'Empresa',
    items: [
      { href: '/admin/perfil', label: 'Perfil público', icon: Store },
      { href: '/admin/personalizacion', label: 'Personalización', icon: Palette },
      { href: '/admin/empleados', label: 'Empleados', icon: UserCog },
      { href: '/admin/metodos-pago', label: 'Métodos de pago', icon: Landmark },
      // «Aplicaciones» vivía aquí: un launchpad de sistemas especializados
      // CONSTRUIDOS DENTRO de MembeGo. Se retira porque esa idea cambió — los
      // sistemas de cada oficio se construyen aparte y se conectan por
      // contrato (`docs/platform/satelite.md`). Los sistemas conectados de una
      // empresa ya se alcanzan por el App Launcher de la cabecera, que lee de
      // la base qué tiene habilitado y no de un catálogo en el código.
    ],
  },
  {
    id: 'soporte',
    label: 'Soporte',
    items: [
      { href: '/admin/tickets', label: 'Tickets', icon: LifeBuoy },
      { href: '/admin/comunicacion', label: 'Comunicación', icon: MessageCircle },
    ],
  },
]

/**
 * Navegación del cliente — CINCO DOMINIOS (DS 2.0 · Fase 0).
 *
 * Mismas 14 rutas que antes, reordenadas para que los dominios coincidan con
 * los de la barra inferior en móvil: quien navega en el teléfono y luego en
 * el escritorio encuentra las cosas en el mismo sitio conceptual.
 *
 * DECISIÓN QUE NO SE TOCA: "Explorar empresas" (/cliente/explorar) y "Mis
 * empresas" (/cliente/empresas) siguen FUERA del menú. No es un olvido — es
 * la decisión de marca única: el cliente vive dentro de SU negocio. Ambas
 * rutas existen, funcionan y están enlazadas desde el Home, el selector de
 * empresa y el final del registro. Abrir el marketplace en el menú es una
 * decisión de producto que corresponde a la Fase 4, cuando esas pantallas
 * estén rediseñadas, no a un cambio de configuración de navegación.
 */
/**
 * NAVEGACIÓN DEL CLIENTE · tres dominios y una cuenta.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA SEPARACIÓN QUE FALTABA: LO QUE SE ADQUIERE vs. LO QUE YA SE TIENE
 *
 * «Planes» vivía dentro del grupo «Mis beneficios», al lado de «Mis
 * membresías». No es un detalle de orden: son cosas opuestas.
 *
 *   · Un PLAN es un catálogo. Algo que todavía se puede comprar.
 *   · Una MEMBRESÍA es una instancia. Algo que YA es tuyo.
 *
 * Puestos juntos, quien entra a «Mis beneficios» a ver qué tiene se encuentra
 * un escaparate de lo que no tiene. Y quien busca comprar no lo busca ahí.
 *
 * Por eso los grupos son ahora:
 *
 *   DESCUBRIR    lo que puedes conseguir      (ofertas, planes, cerca de ti)
 *   MI MEMBEGO   lo que ya es tuyo            (beneficios, membresías, regalos)
 *   ACTIVIDAD    lo que ya hiciste            (citas, pagos, historial)
 *   CUENTA       tú                           (perfil, empresas, vehículos)
 *
 * ────────────────────────────────────────────────────────────────────────────
 * NINGUNA RUTA SE MUEVE
 *
 * Esto reagrupa etiquetas, no direcciones. Todos los `href` son los mismos que
 * antes, así que ningún enlace compartido, marcador o notificación deja de
 * funcionar y no hace falta ni una redirección. Mover rutas es otro trabajo y
 * tiene otro riesgo.
 */
const CLIENTE_NAV: NavGroup[] = [
  {
    id: 'inicio',
    label: 'Inicio',
    // Enlace directo a la vista real (evita el salto de redirect por
    // /cliente/dashboard -> /mis-membresias).
    items: [{ href: '/cliente/inicio', label: 'Inicio', icon: LayoutDashboard }],
  },
  {
    id: 'descubrir',
    label: 'Descubrir',
    items: [
      { href: '/cliente/promociones', label: 'Ofertas', icon: Megaphone },
      // Aquí, y no en «Mis beneficios»: un plan es lo que puedes contratar,
      // no lo que tienes contratado.
      { href: '/cliente/planes', label: 'Planes', icon: Package },
      { href: '/cliente/cerca', label: 'Cerca de mí', icon: Compass },
    ],
  },
  {
    id: 'mi-membego',
    label: 'Mi Membego',
    items: [
      { href: '/cliente/mis-promociones', label: 'Mis beneficios', icon: Ticket },
      { href: '/mis-membresias', label: 'Mis membresías', icon: WalletCards },
      { href: '/cliente/regalos', label: 'Regalos', icon: HeartHandshake },
      // Unificación: el antiguo módulo "Referidos" vive dentro de Invita y Gana.
      { href: '/cliente/invita-y-gana', label: 'Invita y Gana', icon: Gift },
      { href: '/cliente/ruleta', label: 'Ruleta de premios', icon: Trophy },
    ],
  },
  {
    id: 'actividad',
    label: 'Actividad',
    items: [
      { href: '/cliente/citas', label: 'Mis citas', icon: CalendarDays },
      { href: '/cliente/pagos', label: 'Mis pagos', icon: Wallet },
      { href: '/cliente/historial', label: 'Historial', icon: History },
    ],
  },
  {
    id: 'cuenta',
    label: 'Cuenta',
    items: [
      { href: '/cliente/perfil', label: 'Perfil', icon: User },
      // La pantalla existía y NO estaba en ningún menú: se llegaba solo desde
      // una notificación o desde una tarjeta de empresa. Una pantalla a la que
      // no se puede navegar es una pantalla que casi nadie encuentra.
      { href: '/cliente/empresas', label: 'Mis empresas', icon: Store },
      // Fase 7: entra al menú ahora que existe la pantalla. En la Fase 0 se
      // quedó fuera a propósito — solo había `/cliente/vehiculos/nuevo` y
      // enlazar a una página inexistente habría sido peor que no enlazar.
      { href: '/cliente/vehiculos', label: 'Mis vehículos', icon: Car },
      { href: '/cliente/ayuda', label: 'Ayuda', icon: LifeBuoy },
    ],
  },
]

/**
 * Plataforma Membego — lo que solo el superadmin puede hacer.
 *
 * Es el PRIMER contexto del superadmin. El segundo es el panel de empresa
 * completo (ADMIN_NAV), que sigue derivándose por composición: añadir una
 * sección al panel admin la añade automáticamente allí, sin copias manuales
 * que diverjan.
 */
const SUPERADMIN_PLATAFORMA: NavGroup[] = [
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
      { href: '/superadmin/demo', label: 'Demostración', icon: FlaskConical },
      { href: '/superadmin/usuarios', label: 'Usuarios', icon: UserCog },
      { href: '/superadmin/planes', label: 'Planes globales', icon: Package },
      { href: '/superadmin/membresias', label: 'Membresías globales', icon: CreditCard },
      { href: '/superadmin/operaciones', label: 'Operaciones', icon: ClipboardList },
      { href: '/superadmin/campanas', label: 'Campañas conjuntas', icon: Megaphone },
      { href: '/superadmin/capacidades', label: 'Capacidades', icon: SlidersHorizontal },
      { href: '/superadmin/integraciones', label: 'Integraciones', icon: Plug },
      { href: '/superadmin/observabilidad', label: 'Observabilidad', icon: Activity },
      { href: '/superadmin/auditoria', label: 'Auditoría', icon: History },
      { href: '/superadmin/reportes', label: 'Reportes globales', icon: BarChart3 },
    ],
  },
]

// Lista plana del superadmin: plataforma + panel de empresa (sin el "Inicio"
// del admin, que duplicaría el suyo). Sigue siendo la unión de TODO lo que
// puede abrir — la usan el buscador de comandos y la resolución de títulos,
// que necesitan el universo completo aunque el menú pinte un solo contexto.
const SUPERADMIN_NAV: NavGroup[] = [
  ...SUPERADMIN_PLATAFORMA,
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

/**
 * Contextos de trabajo del menú lateral.
 *
 * Solo el superadmin tiene más de uno: "Plataforma Membego" (sus 12 módulos
 * globales) y "Panel de empresa" (los 33 del admin). Antes se pintaban los
 * 45 enlaces juntos, mezclando dos trabajos que no se hacen a la vez.
 *
 * Para todos los demás roles devuelve un único contexto, de modo que el
 * selector no llega ni a renderizarse. `navForRole` sigue devolviendo la
 * lista plana completa: el buscador de comandos y el título del header
 * necesitan el universo entero, no el contexto visible.
 */
export function navContextsForRole(role: AppRole): NavContext[] {
  if (role === 'SUPERADMIN') {
    return [
      { id: 'plataforma', label: 'Plataforma Membego', groups: SUPERADMIN_PLATAFORMA },
      {
        id: 'empresa',
        label: 'Panel de empresa',
        groups: ADMIN_NAV.filter((g) => g.id !== 'inicio'),
      },
    ]
  }
  return [{ id: 'principal', label: 'Principal', groups: navForRole(role) }]
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

/** Flattened links for breadcrumb/title resolution. */
export function allLinks(groups: NavGroup[]): NavLink[] {
  return groups.flatMap((g) => g.items)
}

/** Etiquetas de los sub-segmentos comunes para el último nivel del breadcrumb. */
const ETIQUETAS_SEGMENTO: Record<string, string> = {
  nuevo: 'Nuevo',
  nueva: 'Nueva',
  nuevos: 'Nuevos',
  editar: 'Editar',
  plantillas: 'Plantillas',
  segmentos: 'Segmentos',
  campanas: 'Campañas',
}

export interface Miga {
  /** Dominio de trabajo: "Marketing", "Operaciones"… */
  dominio: string | null
  /** Módulo dentro del dominio, con su ruta para volver. */
  seccion: NavLink | null
  /** Subpágina: "Nuevo", "Editar", "Detalle"… */
  hoja: string | null
}

/**
 * Resuelve dónde está el usuario, en los términos de la arquitectura de
 * navegación: DOMINIO → módulo → subpágina.
 *
 * El header mostraba antes "MembeGo / Campañas", que responde a "¿qué página
 * es esta?" pero no a "¿dónde estoy?". Con ocho dominios, saber que Campañas
 * vive en Marketing es justamente lo que evita la sensación de haber abierto
 * una página suelta de una lista enorme.
 *
 * La sección se elige por el `href` MÁS LARGO que casa con la ruta, para que
 * /admin/audiencia/campanas resuelva a "Campañas segmentadas" y no a
 * "Audiencia", que también casa por prefijo.
 */
export function migasDeRuta(groups: NavGroup[], pathname: string): Miga {
  let mejor: { grupo: NavGroup; item: NavLink } | null = null
  for (const grupo of groups) {
    for (const item of grupo.items) {
      if (pathname !== item.href && !pathname.startsWith(item.href + '/')) continue
      if (!mejor || item.href.length > mejor.item.href.length) mejor = { grupo, item }
    }
  }
  if (!mejor) return { dominio: null, seccion: null, hoja: null }

  // Un dominio de un solo módulo (Inicio) no aporta nada repetido dos veces.
  const dominio =
    mejor.grupo.items.length > 1 && mejor.grupo.label !== mejor.item.label
      ? mejor.grupo.label
      : null

  const resto = pathname.slice(mejor.item.href.length).split('/').filter(Boolean)
  if (resto.length === 0) return { dominio, seccion: mejor.item, hoja: null }

  // Último segmento legible: etiqueta conocida, o "Detalle" para los ids.
  const conNombre = [...resto].reverse().find((s) => ETIQUETAS_SEGMENTO[s])
  return {
    dominio,
    seccion: mejor.item,
    hoja: conNombre ? ETIQUETAS_SEGMENTO[conNombre] : 'Detalle',
  }
}
