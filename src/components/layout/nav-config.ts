import {
  Activity,
  BarChart3,
  Banknote,
  Bell,
  Blocks,
  Building2,
  CalendarDays,
  Car,
  ClipboardList,
  Compass,
  Contact,
  CreditCard,
  FileText,
  Flag,
  FlaskConical,
  Gift,
  HeartHandshake,
  HeartPulse,
  History,
  Inbox,
  Landmark,
  LayoutDashboard,
  LifeBuoy,
  Megaphone,
  MessageCircle,
  Newspaper,
  Package,
  Palette,
  Plug,
  QrCode,
  ReceiptText,
  Rocket,
  ScanLine,
  Scale,
  Settings,
  Share2,
  SlidersHorizontal,
  Store,
  Tag,
  Ticket,
  TrendingUp,
  TriangleAlert,
  Trophy,
  User,
  UserCog,
  Users,
  Wallet,
  WalletCards,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { FULL_ADMIN_ROLES, type AppRole } from '@/types'
import {
  adminSectionForPath,
  seccionPermitida,
  type PermisosUsuario,
} from '@/lib/auth/permissions'

/**
 * ════════════════════════════════════════════════════════════════════════════
 * LA NAVEGACIÓN ES UN DATO, NO UN COMPONENTE.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Este archivo es la ÚNICA fuente de verdad del menú: espacios, grupos,
 * módulos, rutas, iconos, descripciones, roles, capacidades contratadas, tipos
 * de empresa, contadores, elementos principales, palabras clave del buscador y
 * prefijos históricos. Todo declarado; nada calculado dentro de un `.tsx`.
 *
 * LA REGLA QUE LO SOSTIENE: ningún componente visual puede escribir
 * `if (role === 'ADMINISTRADOR')`. La visibilidad se resuelve con los helpers
 * puros del final (`canSeeItem`, `visibleWorkspaces`, `workspaceOf`…), que se
 * prueban sin navegador y sin base de datos. Un condicional de rol suelto en
 * una vista es una regla que nadie puede probar y que se olvida al copiarla.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ESCONDER NO ES AUTORIZAR
 *
 * Todo lo de aquí decide qué se OFRECE, jamás qué se puede hacer. La barrera
 * real siguen siendo `requireRole` / `requireSection` en las páginas, las
 * server actions y los endpoints. Si esta configuración desapareciera entera,
 * nadie ganaría un permiso: solo se quedaría sin menú.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESPACIOS Y NO UNA LISTA
 *
 * El panel de empresa son 33 destinos y el del superadministrador 45. Pintados
 * a la vez son un inventario, no un menú: se lee de arriba abajo cada vez
 * porque nada dice dónde mirar. Con dos niveles —un riel de espacios y un
 * panel con SOLO lo del espacio activo— la búsqueda ocurre dentro de seis u
 * ocho entradas, no dentro de cuarenta.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PESO EN EL NAVEGADOR
 *
 * Este módulo lo importa el shell, que es cliente. Por eso NO importa el
 * catálogo de capacidades (`@/modules/capacidades/catalogo`, 469 líneas de
 * datos con su resolutor) ni nada que arrastre Prisma: las capacidades y los
 * tipos de empresa se declaran aquí como uniones de texto y una prueba
 * (`tests/navegacion-espacios.test.ts`) comprueba que siguen siendo un
 * subconjunto del catálogo real. Sincronía verificada, cero kilobytes.
 */

// ── Vocabulario ─────────────────────────────────────────────────────────────

/**
 * Capacidades que hoy encienden o apagan una entrada del menú.
 *
 * Es un SUBCONJUNTO declarado a mano de `CAPACIDADES` del catálogo. No se
 * importa el catálogo entero para no meterlo en el paquete del navegador; la
 * prueba de sincronía se encarga de que no se separen.
 */
export type CapacidadNav = 'CITAS' | 'SEGUIMIENTO' | 'RULETA' | 'EXCURSIONES' | 'POS_CAJA'

/** Verticales de negocio (espejo de `CATEGORIAS`, por el mismo motivo). */
export type TipoEmpresaNav = 'CAR_WASH' | 'BARBERIA' | 'RESTAURANTE' | 'GYM' | 'EXCURSIONES'

/**
 * Ámbito del menú. Es lo que impide mezclar la plataforma con una empresa:
 * en PLATFORM solo se ofrecen módulos globales, en COMPANY solo empresariales.
 * El cambio de uno a otro es una navegación explícita, nunca un icono más.
 */
export type ScopeNav = 'PLATFORM' | 'COMPANY'

/**
 * Contadores que puede llevar una entrada del menú.
 *
 * Son CLAVES, no números: la configuración dice qué contador le corresponde a
 * cada módulo y quien renderiza recibe los valores por separado. Así la
 * configuración sigue siendo un dato puro y los conteos siguen siendo reales.
 *
 * `platformIncidents` existe aunque hoy ningún conteo la alimente: no hay una
 * fuente de verdad de «incidentes abiertos» y un badge sin dato NO se pinta
 * (fail-closed). Cuando exista la fuente, se conecta en `badgesDeNavegacion`.
 */
export const CLAVES_BADGE = [
  'platformOpenTickets',
  'companyOpenTickets',
  'platformIncidents',
  'solicitudes',
  'colaAtascada',
] as const
export type ClaveBadge = (typeof CLAVES_BADGE)[number]

export interface NavLink {
  href: string
  /** Nombre corto: es el que se pinta en el panel y tiene que caber. */
  label: string
  icon: LucideIcon
  /** Una línea de qué hace. Se usa en el flyout, los tooltips y el buscador. */
  description?: string
  /** Restringe a estos roles exactos. Ausente = lo deciden sección y capacidad. */
  roles?: readonly AppRole[]
  /** Rango mínimo (ver `rankOf`). Ausente = sin mínimo. */
  rangoMinimo?: number
  /** Capacidad contratada que enciende el módulo. Ausente = siempre encendido. */
  capacidad?: CapacidadNav
  /** Verticales donde tiene sentido. Ausente = todas. */
  tiposEmpresa?: readonly TipoEmpresaNav[]
  /** Contador real que se pinta al lado. Sin dato, no se pinta nada. */
  badge?: ClaveBadge
  /** Etiqueta corta y estática: "Nuevo", "Beta". */
  etiqueta?: string
  /** Aterrizaje del espacio: a dónde va el riel al pulsar su icono. */
  principal?: boolean
  /** Sinónimos para el buscador (lo que la gente escribe, no lo que dice el menú). */
  keywords?: readonly string[]
  /**
   * Prefijos ADICIONALES que también pertenecen a este módulo: rutas
   * históricas y direcciones que no cuelgan de `href`. Cuentan igual que
   * `href` para la coincidencia por prefijo más largo, así que un enlace
   * antiguo compartido por WhatsApp sigue resolviendo su espacio y sus migas.
   */
  prefijos?: readonly string[]
}

export interface NavGroup {
  /** Id estable del grupo. */
  id: string
  label: string
  items: NavLink[]
}

/**
 * UN ESPACIO: el primer nivel del menú.
 *
 * Es una parcela de trabajo entera, no una carpeta. Al cambiar de espacio, el
 * segundo nivel se reemplaza por completo — ése es justamente el punto: quien
 * está atendiendo el mostrador no tiene delante los informes de marketing.
 */
export interface Workspace {
  id: string
  label: string
  /** Etiqueta corta del riel: tiene que caber en ~76 px. Sin ella, el label. */
  short?: string
  icon: LucideIcon
  description?: string
  /**
   * Ámbito del espacio. Sin ámbito no se filtra por ámbito: los menús de
   * cliente y mostrador no conocen esta separación y siguen como estaban.
   */
  scope?: ScopeNav
  /**
   * Ancla el espacio al PIE del riel. Es para Configuración / Administración:
   * se usan poco y desde cualquier sitio, así que tienen que estar siempre en
   * el mismo píxel y no bailar según cuántos espacios haya arriba.
   */
  anclado?: boolean
  roles?: readonly AppRole[]
  rangoMinimo?: number
  capacidad?: CapacidadNav
  tiposEmpresa?: readonly TipoEmpresaNav[]
  groups: NavGroup[]
}

/**
 * TODO lo que hace falta para decidir qué ve esta persona.
 *
 * Se construye en el servidor (que es quien conoce permisos y capacidades) y
 * viaja al cliente como datos planos. No lleva la sesión, ni el correo, ni
 * nada sensible: rol, capacidades encendidas, vertical y la lista de rutas ya
 * negadas.
 */
export interface ContextoNav {
  role: AppRole
  /**
   * Ámbito visible. PLATFORM = solo módulos globales; COMPANY = solo módulos
   * de empresa. Ausente = no filtrar por ámbito (cliente, mostrador y lista
   * plana histórica). Lo fijan los layouts de cada panel en el servidor.
   */
  scope?: ScopeNav
  /**
   * Capacidades contratadas. `undefined` = no se pudieron leer, y entonces NO
   * se filtra por capacidad (fail-open). Es la misma regla que el resolutor
   * del servidor: una empresa viva no puede perder módulos porque una consulta
   * fallara. La puerta cerrada la sigue poniendo `requireSection`.
   */
  capacidades?: readonly CapacidadNav[]
  /** Vertical de la empresa. `undefined` = no filtrar por tipo. */
  tipoEmpresa?: TipoEmpresaNav | null
  /** Ajustes por empleado. Se aplican encima del rol. */
  permisos?: PermisosUsuario | null
  /** Rutas ya descartadas por quien construyó el contexto. */
  ocultas?: readonly string[]
}

// ── Grupos del panel de empresa ─────────────────────────────────────────────

/**
 * Los NUEVE dominios del panel de empresa. Se mantienen tal cual estaban: esta
 * fase reagrupa dominios en ESPACIOS, no mueve módulos entre dominios ni
 * cambia una sola ruta. Mover destinos es otro trabajo y tiene otro riesgo.
 */
const G_INICIO: NavGroup = {
  id: 'inicio',
  label: 'Inicio',
  items: [
    {
      href: '/admin/dashboard',
      label: 'Resumen',
      icon: LayoutDashboard,
      description: 'Cómo va el negocio hoy.',
      principal: true,
      keywords: ['panel', 'dashboard', 'inicio', 'home'],
    },
  ],
}

const G_CLI_GESTION: NavGroup = {
  id: 'clientes-gestion',
  label: 'Gestión',
  items: [
    {
      href: '/admin/clientes',
      label: 'Directorio',
      icon: Users,
      description: 'Clientes vinculados a la empresa.',
      principal: true,
      keywords: ['clientes', 'personas', 'directorio', 'contactos'],
    },
    {
      href: '/admin/membresias',
      label: 'Membresías',
      icon: CreditCard,
      description: 'Membresías adquiridas por clientes.',
      keywords: ['membresias', 'suscripciones', 'renovar'],
    },
    {
      href: '/admin/riesgo',
      label: 'En riesgo',
      icon: TriangleAlert,
      description: 'Clientes que requieren atención.',
      keywords: ['riesgo', 'fuga', 'churn', 'retener'],
    },
    {
      href: '/admin/audiencia/segmentos',
      label: 'Segmentos',
      icon: SlidersHorizontal,
      description: 'Agrupaciones de clientes para análisis y acciones.',
      keywords: ['segmentos', 'audiencia', 'filtros'],
    },
  ],
}

const G_CLI_RELACION: NavGroup = {
  id: 'clientes-relacion',
  label: 'Relación',
  items: [
    {
      href: '/admin/citas',
      label: 'Citas',
      icon: CalendarDays,
      description: 'Agenda y citas de la empresa.',
      capacidad: 'CITAS',
      keywords: ['citas', 'agenda', 'reservas', 'turnos'],
    },
    {
      href: '/admin/actividad',
      label: 'Actividad',
      icon: History,
      description: 'Historial real de acciones y eventos.',
      keywords: ['actividad', 'bitacora', 'historial', 'log'],
    },
  ],
}

const G_EXCURSIONES: NavGroup = {
  id: 'excursiones',
  label: 'Parques y Tours',
  items: [
    {
      href: '/admin/excursiones',
      label: 'Parques y Tours',
      icon: Compass,
      description: 'Ventas, vendedores, cupos y comisiones.',
      capacidad: 'EXCURSIONES',
      principal: true,
      keywords: ['excursiones', 'tours', 'parques', 'actividades', 'combos'],
    },
  ],
}

const G_OFERTA: NavGroup = {
  id: 'beneficios-oferta',
  label: 'Oferta comercial',
  items: [
    {
      href: '/admin/planes',
      label: 'Planes',
      icon: Package,
      description: 'Productos de membresía que vende la empresa.',
      principal: true,
      keywords: ['planes', 'precios', 'catalogo', 'productos'],
    },
    {
      href: '/admin/ofertas',
      label: 'Ofertas',
      icon: Tag,
      description: 'Promociones y beneficios publicados.',
      keywords: ['ofertas', 'promociones', 'descuentos', 'banners'],
    },
    {
      href: '/admin/invitaciones',
      label: 'Invita y Gana',
      icon: Share2,
      description: 'Programa de recomendación de clientes.',
      keywords: ['referidos', 'invitaciones', 'invita', 'gana'],
    },
  ],
}

const G_FIDELIZACION: NavGroup = {
  id: 'beneficios-fidelizacion',
  label: 'Fidelización',
  items: [
    {
      href: '/admin/gamificacion',
      label: 'Ruleta',
      icon: Trophy,
      description: 'Premios y mecánicas de gamificación.',
      capacidad: 'RULETA',
      keywords: ['ruleta', 'gamificacion', 'premios', 'juego'],
    },
    {
      href: '/admin/crecimiento',
      label: 'Crecimiento',
      icon: Rocket,
      description: 'Acciones para aumentar recurrencia y adquisición.',
      keywords: ['crecimiento', 'growth', 'reglas'],
    },
    {
      href: '/admin/regalos',
      label: 'Regalos P2P',
      icon: HeartHandshake,
      description: 'Beneficios transferidos entre clientes.',
      keywords: ['regalos', 'p2p', 'gift'],
    },
  ],
}

const G_MKT_CONTENIDO: NavGroup = {
  id: 'marketing-contenido',
  label: 'Contenido',
  items: [
    {
      href: '/admin/campanas',
      label: 'Campañas',
      icon: Flag,
      description: 'Campañas de la empresa.',
      principal: true,
      keywords: ['campanas', 'envios', 'marketing'],
    },
    {
      href: '/admin/publicaciones',
      label: 'Publicaciones',
      icon: Newspaper,
      description: 'Contenido programado o publicado.',
      keywords: ['publicaciones', 'posts', 'muro', 'novedades'],
    },
    {
      // Ruta real que no está en el diseño de espacios: se conserva tal cual.
      // Es contenido de captación, así que vive en Contenido sin ser principal.
      href: '/admin/crm',
      label: 'Prospectos',
      icon: Contact,
      description: 'Quién preguntó y todavía no compra.',
      keywords: ['crm', 'prospectos', 'leads', 'oportunidades'],
    },
  ],
}

const G_MKT_AUTO: NavGroup = {
  id: 'marketing-automatica',
  label: 'Comunicación automática',
  items: [
    {
      href: '/admin/notificaciones',
      label: 'Notificaciones',
      icon: Bell,
      description: 'Avisos enviados a clientes.',
      keywords: ['notificaciones', 'avisos', 'push'],
    },
    {
      href: '/admin/automatizaciones',
      label: 'Automatizaciones',
      icon: Zap,
      description: 'Reglas automáticas realmente configuradas.',
      keywords: ['automatizaciones', 'flujos', 'triggers'],
    },
  ],
}

const G_ATENCION: NavGroup = {
  id: 'operacion-atencion',
  label: 'Atención diaria',
  items: [
    {
      href: '/admin/scanner',
      label: 'Escanear QR',
      icon: ScanLine,
      description: 'Validación de beneficios y membresías.',
      principal: true,
      keywords: ['escanear', 'qr', 'canjear', 'validar', 'scanner'],
    },
    {
      href: '/admin/pagos',
      label: 'Pagos',
      icon: Wallet,
      description: 'Cobros y pagos registrados.',
      keywords: ['pagos', 'cobros', 'transferencias'],
    },
    {
      href: '/admin/facturas',
      label: 'Comprobantes',
      icon: ReceiptText,
      description: 'Comprobantes emitidos por la empresa.',
      keywords: ['comprobantes', 'facturas', 'recibos', 'ncf'],
    },
    {
      href: '/admin/registros',
      label: 'Registros',
      icon: FileText,
      description: 'Movimientos operativos registrados.',
      keywords: ['registros', 'entradas', 'visitas'],
    },
  ],
}

const G_ORGANIZACION: NavGroup = {
  id: 'operacion-organizacion',
  label: 'Organización',
  items: [
    {
      href: '/admin/sucursales',
      label: 'Sucursales',
      icon: Building2,
      description: 'Sedes y puntos de operación.',
      keywords: ['sucursales', 'locales', 'tiendas', 'branches'],
    },
  ],
}

const G_ANA_RESULTADOS: NavGroup = {
  id: 'analitica-resultados',
  label: 'Resultados',
  items: [
    {
      href: '/admin/reportes',
      label: 'Reportes',
      icon: BarChart3,
      description: 'Resultados operativos y comerciales.',
      principal: true,
      keywords: ['reportes', 'informes', 'metricas', 'numeros'],
    },
    {
      href: '/admin/retencion',
      label: 'Retención',
      icon: HeartPulse,
      description: 'Permanencia y recurrencia de clientes.',
      keywords: ['retencion', 'cohortes', 'recurrencia'],
    },
    {
      href: '/admin/conciliacion',
      label: 'Conciliación',
      icon: Scale,
      description: 'Comprobación cruzada de movimientos.',
      keywords: ['conciliacion', 'cuadre', 'caja', 'diferencias'],
    },
  ],
}

const G_ANA_CONOCIMIENTO: NavGroup = {
  id: 'analitica-conocimiento',
  label: 'Conocimiento del cliente',
  items: [
    {
      href: '/admin/audiencia',
      label: 'Audiencia',
      icon: TrendingUp,
      description: 'Comportamiento de la base de clientes.',
      keywords: ['audiencia', 'comportamiento', 'segmentacion'],
    },
    {
      href: '/admin/adquisicion',
      label: 'Origen',
      icon: Compass,
      description: 'Canales de adquisición de clientes.',
      keywords: ['adquisicion', 'origen', 'canales', 'atribucion'],
    },
    {
      href: '/admin/seguimiento',
      label: 'Seguimiento',
      icon: QrCode,
      description: 'Seguimiento de recompensas y beneficios.',
      capacidad: 'SEGUIMIENTO',
      keywords: ['seguimiento', 'recompensas', 'gratis'],
    },
  ],
}

const G_ADM_EMPRESA: NavGroup = {
  id: 'administracion-empresa',
  label: 'Empresa',
  items: [
    {
      href: '/admin/perfil',
      label: 'Perfil público',
      icon: Store,
      description: 'Información pública del negocio.',
      principal: true,
      keywords: ['perfil', 'publico', 'ficha', 'negocio'],
    },
    {
      href: '/admin/personalizacion',
      label: 'Personalización',
      icon: Palette,
      description: 'Identidad visual y presentación.',
      keywords: ['personalizacion', 'marca', 'colores', 'logo', 'tema'],
    },
    {
      href: '/admin/empleados',
      label: 'Empleados',
      icon: UserCog,
      description: 'Equipo, roles y permisos.',
      keywords: ['empleados', 'equipo', 'usuarios', 'permisos', 'staff'],
    },
    {
      href: '/admin/metodos-pago',
      label: 'Métodos de pago',
      icon: Landmark,
      description: 'Formas de cobro aceptadas.',
      keywords: ['metodos', 'pago', 'cuentas', 'banco', 'cardnet'],
    },
  ],
}

const G_ADM_CONEXIONES: NavGroup = {
  id: 'administracion-conexiones',
  label: 'Conexiones',
  items: [
    {
      href: '/admin/integraciones',
      label: 'Integraciones',
      icon: Plug,
      description: 'Aplicaciones, API, webhooks y conexiones de la empresa.',
      keywords: ['integraciones', 'conectar', 'api', 'webhooks', 'connect', 'apps'],
    },
  ],
}

const G_SOPORTE: NavGroup = {
  id: 'soporte',
  label: 'Soporte',
  items: [
    {
      href: '/admin/tickets',
      label: 'Tickets',
      icon: LifeBuoy,
      description: 'Casos de soporte de la empresa.',
      badge: 'companyOpenTickets',
      principal: true,
      keywords: ['tickets', 'soporte', 'ayuda', 'incidencias'],
    },
    {
      href: '/admin/comunicacion',
      label: 'Comunicación',
      icon: MessageCircle,
      description: 'Canales de contacto y conversaciones de soporte.',
      keywords: ['comunicacion', 'mensajes', 'chat', 'conversaciones'],
    },
  ],
}

/** Los quince dominios, en el orden en que se leen. */
const GRUPOS_ADMIN: NavGroup[] = [
  G_INICIO,
  G_CLI_GESTION,
  G_CLI_RELACION,
  G_EXCURSIONES,
  G_OFERTA,
  G_FIDELIZACION,
  G_MKT_CONTENIDO,
  G_MKT_AUTO,
  G_ATENCION,
  G_ORGANIZACION,
  G_ANA_RESULTADOS,
  G_ANA_CONOCIMIENTO,
  G_ADM_EMPRESA,
  G_ADM_CONEXIONES,
  G_SOPORTE,
]

// ── Espacios del panel de empresa ───────────────────────────────────────────

const ESPACIOS_ADMIN: Workspace[] = [
  {
    id: 'inicio',
    label: 'Inicio',
    short: 'Inicio',
    icon: LayoutDashboard,
    description: 'Panel principal de la empresa.',
    scope: 'COMPANY',
    groups: [G_INICIO],
  },
  {
    id: 'clientes',
    label: 'Clientes',
    short: 'Clientes',
    icon: Users,
    description: 'Directorio, relación y actividad.',
    scope: 'COMPANY',
    groups: [G_CLI_GESTION, G_CLI_RELACION],
  },
  {
    // Un espacio entero para el vertical de excursiones: cuando la capacidad
    // está apagada desaparece del riel sin dejar hueco ni grupo vacío.
    id: 'tours',
    label: 'Parques y Tours',
    short: 'Tours',
    icon: Compass,
    description: 'Ventas, vendedores y comisiones de excursiones.',
    scope: 'COMPANY',
    capacidad: 'EXCURSIONES',
    groups: [G_EXCURSIONES],
  },
  {
    id: 'beneficios',
    label: 'Beneficios',
    short: 'Beneficios',
    icon: Gift,
    description: 'Oferta comercial y fidelización.',
    scope: 'COMPANY',
    groups: [G_OFERTA, G_FIDELIZACION],
  },
  {
    id: 'marketing',
    label: 'Marketing',
    short: 'Marketing',
    icon: Megaphone,
    description: 'Contenido y comunicación automática.',
    scope: 'COMPANY',
    groups: [G_MKT_CONTENIDO, G_MKT_AUTO],
  },
  {
    id: 'operacion',
    label: 'Operación',
    short: 'Operación',
    icon: ClipboardList,
    description: 'Atención diaria y organización.',
    scope: 'COMPANY',
    groups: [G_ATENCION, G_ORGANIZACION],
  },
  {
    id: 'analitica',
    label: 'Analítica',
    short: 'Análisis',
    icon: BarChart3,
    description: 'Resultados y conocimiento del cliente.',
    scope: 'COMPANY',
    groups: [G_ANA_RESULTADOS, G_ANA_CONOCIMIENTO],
  },
  {
    // ANCLADO al pie: se entra poco y desde cualquier sitio. Si flotara según
    // cuántos espacios tenga el rol delante, habría que buscarlo cada vez.
    id: 'administracion',
    label: 'Administración',
    short: 'Ajustes',
    icon: Settings,
    description: 'Empresa, equipo y conexiones.',
    scope: 'COMPANY',
    anclado: true,
    groups: [G_ADM_EMPRESA, G_ADM_CONEXIONES],
  },
  {
    // ANCLADO al pie, junto a Administración.
    id: 'soporte',
    label: 'Soporte',
    short: 'Soporte',
    icon: LifeBuoy,
    description: 'Casos y conversaciones de soporte.',
    scope: 'COMPANY',
    anclado: true,
    groups: [G_SOPORTE],
  },
]

// ── Espacios del cliente ────────────────────────────────────────────────────

/**
 * NINGUNA RUTA SE MUEVE. La separación entre lo que se PUEDE conseguir
 * (Descubrir), lo que YA es tuyo (Mi Membego) y lo que ya HICISTE (Actividad)
 * se mantiene exactamente como estaba: es una decisión de producto vigente y
 * `tests/navegacion-cliente.test.ts` la vigila.
 */
const G_CLI_INICIO: NavGroup = {
  id: 'inicio',
  label: 'Inicio',
  items: [
    {
      href: '/cliente/inicio',
      label: 'Inicio',
      icon: LayoutDashboard,
      description: 'Tu resumen de hoy.',
      principal: true,
      keywords: ['inicio', 'home', 'resumen'],
    },
  ],
}

const G_CLI_DESCUBRIR: NavGroup = {
  id: 'descubrir',
  label: 'Descubrir',
  items: [
    {
      href: '/cliente/promociones',
      label: 'Ofertas',
      icon: Megaphone,
      description: 'Lo que puedes aprovechar ahora.',
      principal: true,
      keywords: ['ofertas', 'promociones', 'descuentos'],
    },
    {
      href: '/cliente/excursiones',
      label: 'Actividades',
      icon: Compass,
      description: 'Parques, tours y experiencias.',
      keywords: ['excursiones', 'actividades', 'tours', 'parques'],
    },
    {
      href: '/cliente/planes',
      label: 'Planes',
      icon: Package,
      description: 'Lo que puedes contratar.',
      keywords: ['planes', 'contratar', 'membresias', 'precios'],
    },
    {
      href: '/cliente/cerca',
      label: 'Cerca de mí',
      icon: Compass,
      description: 'Negocios cerca de dónde estás.',
      keywords: ['cerca', 'mapa', 'ubicacion', 'cercanos'],
    },
  ],
}

const G_CLI_MIO: NavGroup = {
  id: 'mi-membego',
  label: 'Mi Membego',
  items: [
    {
      href: '/cliente/mis-promociones',
      label: 'Mis beneficios',
      icon: Ticket,
      description: 'Lo que ya compraste y puedes usar.',
      principal: true,
      keywords: ['beneficios', 'mis promociones', 'canjes'],
    },
    {
      href: '/mis-membresias',
      label: 'Mis membresías',
      icon: WalletCards,
      description: 'Tus membresías y su QR.',
      // El QR de una membresía vive en `/membresia/<id>`: sin este prefijo, la
      // pantalla del código —la que más se abre— no marcaba ningún módulo
      // activo ni sabía a qué espacio pertenece.
      prefijos: ['/membresia'],
      keywords: ['membresias', 'qr', 'carnet', 'wallet'],
    },
    {
      href: '/cliente/regalos',
      label: 'Regalos',
      icon: HeartHandshake,
      description: 'Lo que te han regalado.',
      keywords: ['regalos', 'gift'],
    },
    {
      href: '/cliente/invita-y-gana',
      label: 'Invita y Gana',
      icon: Gift,
      description: 'Invita y llévate premios.',
      keywords: ['invita', 'referidos', 'gana', 'amigos'],
    },
    {
      href: '/cliente/ruleta',
      label: 'Ruleta de premios',
      icon: Trophy,
      description: 'Tu tirada de premios.',
      keywords: ['ruleta', 'premios', 'juego'],
    },
  ],
}

const G_CLI_ACTIVIDAD: NavGroup = {
  id: 'actividad',
  label: 'Actividad',
  items: [
    {
      href: '/cliente/citas',
      label: 'Mis citas',
      icon: CalendarDays,
      description: 'Lo que tienes agendado.',
      principal: true,
      keywords: ['citas', 'agenda', 'reservas'],
    },
    {
      href: '/cliente/pagos',
      label: 'Mis pagos',
      icon: Wallet,
      description: 'Lo que has pagado.',
      keywords: ['pagos', 'cobros', 'recibos'],
    },
    {
      href: '/cliente/historial',
      label: 'Historial',
      icon: History,
      description: 'Todo lo que has hecho.',
      keywords: ['historial', 'actividad', 'movimientos'],
    },
    {
      href: '/cliente/mis-excursiones',
      label: 'Mis excursiones',
      icon: CalendarDays,
      description: 'Tus reservas de actividades.',
      keywords: ['excursiones', 'reservas', 'tours'],
    },
  ],
}

const G_CLI_CUENTA: NavGroup = {
  id: 'cuenta',
  label: 'Cuenta',
  items: [
    {
      href: '/cliente/perfil',
      label: 'Perfil',
      icon: User,
      description: 'Tus datos.',
      principal: true,
      keywords: ['perfil', 'cuenta', 'datos', 'mis datos'],
    },
    {
      href: '/cliente/empresas',
      label: 'Mis empresas',
      icon: Store,
      description: 'Negocios a los que perteneces.',
      keywords: ['empresas', 'negocios', 'comercios'],
    },
    {
      href: '/cliente/vehiculos',
      label: 'Mis vehículos',
      icon: Car,
      description: 'Tus vehículos registrados.',
      tiposEmpresa: ['CAR_WASH'],
      keywords: ['vehiculos', 'carros', 'placa', 'autos'],
    },
    {
      href: '/cliente/ayuda',
      label: 'Ayuda',
      icon: LifeBuoy,
      description: 'Preguntas y contacto.',
      keywords: ['ayuda', 'soporte', 'preguntas', 'faq'],
    },
  ],
}

const ESPACIOS_CLIENTE: Workspace[] = [
  {
    id: 'inicio',
    label: 'Inicio',
    icon: LayoutDashboard,
    description: 'Tu resumen.',
    groups: [G_CLI_INICIO],
  },
  {
    id: 'descubrir',
    label: 'Descubrir',
    icon: Compass,
    description: 'Lo que puedes conseguir.',
    groups: [G_CLI_DESCUBRIR],
  },
  {
    id: 'mi-membego',
    label: 'Mi Membego',
    icon: WalletCards,
    description: 'Lo que ya es tuyo.',
    groups: [G_CLI_MIO],
  },
  {
    id: 'actividad',
    label: 'Actividad',
    icon: History,
    description: 'Lo que ya hiciste.',
    groups: [G_CLI_ACTIVIDAD],
  },
  {
    id: 'cuenta',
    label: 'Cuenta',
    icon: User,
    description: 'Tú.',
    anclado: true,
    groups: [G_CLI_CUENTA],
  },
]

// ── Espacios de la plataforma (superadministrador) ──────────────────────────

const G_SA_INICIO: NavGroup = {
  id: 'resumen',
  label: 'Resumen',
  items: [
    {
      href: '/superadmin/dashboard',
      label: 'Resumen',
      icon: LayoutDashboard,
      description: 'Estado general de Membego.',
      principal: true,
      keywords: ['resumen', 'dashboard', 'plataforma'],
    },
  ],
}

const G_SA_NEGOCIO: NavGroup = {
  id: 'negocio',
  label: 'Negocio',
  items: [
    {
      href: '/superadmin/solicitudes',
      label: 'Solicitudes',
      icon: Inbox,
      description: 'Solicitudes de incorporación de empresas.',
      badge: 'solicitudes',
      principal: true,
      keywords: ['solicitudes', 'altas', 'pendientes'],
    },
    {
      href: '/superadmin/empresas',
      label: 'Empresas',
      icon: Building2,
      description: 'Empresas registradas y su estado real.',
      keywords: ['empresas', 'negocios', 'clientes'],
    },
    {
      href: '/superadmin/usuarios',
      label: 'Usuarios',
      icon: UserCog,
      description: 'Usuarios y roles de la plataforma.',
      keywords: ['usuarios', 'cuentas', 'personas'],
    },
    {
      href: '/superadmin/planes',
      label: 'Planes',
      icon: Package,
      description: 'Planes comerciales globales.',
      keywords: ['planes', 'precios'],
    },
    {
      href: '/superadmin/membresias',
      label: 'Membresías',
      icon: CreditCard,
      description: 'Membresías emitidas en la plataforma.',
      keywords: ['membresias', 'suscripciones'],
    },
  ],
}

const G_SA_OPERACION: NavGroup = {
  id: 'operacion',
  label: 'Operación',
  items: [
    {
      href: '/superadmin/operaciones',
      label: 'Operaciones',
      icon: ClipboardList,
      description: 'Operaciones globales que requieren seguimiento.',
      principal: true,
      keywords: ['operaciones', 'hoy', 'actividad'],
    },
    {
      href: '/superadmin/tickets',
      label: 'Tickets',
      icon: LifeBuoy,
      description: 'Solicitudes de soporte de las empresas.',
      badge: 'platformOpenTickets',
      keywords: ['tickets', 'soporte', 'incidencias'],
    },
    {
      href: '/superadmin/campanas',
      label: 'Campañas',
      icon: Megaphone,
      description: 'Campañas administradas por la plataforma.',
      keywords: ['campanas', 'envios'],
    },
    {
      href: '/superadmin/capacidades',
      label: 'Capacidades',
      icon: SlidersHorizontal,
      description: 'Funciones concedidas a cada empresa.',
      keywords: ['capacidades', 'modulos', 'verticales', 'interruptores'],
    },
    {
      href: '/superadmin/integraciones',
      label: 'Integraciones',
      icon: Plug,
      description: 'Sistemas satélite conectados a Membego.',
      badge: 'colaAtascada',
      keywords: ['integraciones', 'satelites', 'cola', 'webhooks', 'salud'],
    },
    {
      href: '/superadmin/connect',
      label: 'Connect',
      icon: Blocks,
      description: 'Catálogo, despliegue, publicación, salud y adopción de conexiones.',
      keywords: ['connect', 'catalogo', 'apps', 'aplicaciones', 'concesiones'],
    },
  ],
}

const G_SA_SISTEMA: NavGroup = {
  id: 'sistema',
  label: 'Sistema',
  items: [
    {
      href: '/superadmin/reportes',
      label: 'Reportes',
      icon: BarChart3,
      description: 'Indicadores globales de la plataforma.',
      principal: true,
      keywords: ['reportes', 'informes', 'metricas'],
    },
    {
      href: '/superadmin/observabilidad',
      label: 'Observabilidad',
      icon: Activity,
      description: 'Salud técnica e incidentes reales.',
      // Sin fuente de verdad de incidentes abiertos: la clave existe pero hoy
      // ningún conteo la alimenta, así que la insignia no se pinta.
      badge: 'platformIncidents',
      keywords: ['observabilidad', 'salud', 'errores', 'monitoreo'],
    },
    {
      href: '/superadmin/auditoria',
      label: 'Auditoría',
      icon: History,
      description: 'Trazabilidad de acciones sensibles.',
      keywords: ['auditoria', 'bitacora', 'log'],
    },
    {
      href: '/superadmin/demo',
      label: 'Demostración',
      icon: FlaskConical,
      description: 'Entorno explícitamente identificado como demostración.',
      keywords: ['demo', 'demostracion', 'practica', 'pruebas'],
    },
  ],
}

/**
 * LA PLATAFORMA ES UN SOLO ESPACIO. El superadministrador administra lo
 * global desde un único menú —Resumen, Negocio, Operación y Sistema son
 * GRUPOS del segundo nivel, no iconos— y entra al panel de una empresa
 * cambiando explícitamente de ámbito (scope COMPANY), nunca viendo los dos
 * mundos mezclados en el mismo menú.
 *
 * Y como es un solo espacio, NO SE PINTA CON RIEL: un riel con un único icono
 * no reparte nada. `menuEnUnaColumna` lo detecta y el shell pinta el segundo
 * nivel entero, a todo el ancho y con sus grupos rotulados — el sidebar de
 * una columna de siempre. El cambio de ámbito vive en la cabecera
 * (`ofreceEntradaAEmpresa` / `ofreceSalidaAPlataforma`), no en el menú.
 */
const ESPACIOS_PLATAFORMA: Workspace[] = [
  {
    id: 'plataforma',
    label: 'Plataforma',
    short: 'Plataforma',
    icon: Blocks,
    description: 'Administración global de Membego.',
    scope: 'PLATFORM',
    groups: [G_SA_INICIO, G_SA_NEGOCIO, G_SA_OPERACION, G_SA_SISTEMA],
  },
]

// ── Espacios del mostrador (empleado / recepción) ───────────────────────────

const ESPACIOS_EMPLEADO: Workspace[] = [
  {
    id: 'mostrador',
    label: 'Mostrador',
    icon: ScanLine,
    description: 'Atender al cliente que tienes delante.',
    groups: [
      {
        id: 'operaciones',
        label: 'Operaciones',
        items: [
          {
            href: '/empleado/scanner',
            label: 'Escanear QR',
            icon: ScanLine,
            description: 'Validar un beneficio.',
            principal: true,
            keywords: ['escanear', 'qr', 'canjear', 'validar'],
          },
          {
            href: '/empleado/caja',
            label: 'Caja',
            icon: Banknote,
            description: 'Cobrar en el mostrador.',
            capacidad: 'POS_CAJA',
            keywords: ['caja', 'cobrar', 'pos', 'punto de venta'],
          },
        ],
      },
    ],
  },
]

/**
 * Los espacios declarados para cada rol, antes de filtrar nada.
 *
 * El SUPERADMIN ve los dos mundos, PERO NUNCA JUNTOS: el ámbito del contexto
 * (`PLATFORM` en su panel, `COMPANY` cuando entra al de una empresa) decide
 * cuál se pinta. Es el cambio explícito de contexto que impide operar una
 * empresa creyendo que se está en la plataforma, y viceversa.
 */
export function workspacesForRole(role: AppRole): Workspace[] {
  switch (role) {
    case 'CLIENTE':
      return ESPACIOS_CLIENTE
    case 'SUPERADMIN':
      return [...ESPACIOS_PLATAFORMA, ...ESPACIOS_ADMIN]
    case 'EMPLEADO':
    case 'RECEPCION':
      return ESPACIOS_EMPLEADO
    default:
      // ADMINISTRADOR, GERENTE, CAJERO, MARKETING, SUPERVISOR, ADMIN_EMPRESA.
      // Lo que ve cada uno lo decide `canSeeItem`, no una lista aparte.
      return ESPACIOS_ADMIN
  }
}

// ── Rangos ──────────────────────────────────────────────────────────────────

const RANGOS: Record<AppRole, number> = {
  SUPERADMIN: 100,
  ADMINISTRADOR: 80,
  // Legacy: mismo rango que ADMINISTRADOR porque es literalmente el mismo rol
  // con el nombre viejo. Darle uno distinto habría hecho que las empresas
  // antiguas perdieran entradas del menú sin que nadie cambiara nada.
  ADMIN_EMPRESA: 80,
  GERENTE: 70,
  SUPERVISOR: 60,
  MARKETING: 55,
  CAJERO: 50,
  RECEPCION: 40,
  EMPLEADO: 30,
  VENDEDOR: 20,
  CLIENTE: 10,
}

/**
 * Rango numérico de un rol: sirve para expresar «de gerente para arriba» en la
 * configuración sin escribir la lista de roles, que se olvida de los nuevos.
 *
 * NO es autorización. Un rango alto no abre nada: solo ordena.
 */
export function rankOf(role: AppRole): number {
  return RANGOS[role] ?? 0
}

// ── Visibilidad ─────────────────────────────────────────────────────────────

/**
 * ¿Puede este rol abrir esta ruta del panel de empresa?
 *
 * Replica exactamente lo que ya hacía el menú: los roles con panel completo
 * (`FULL_ADMIN_ROLES`) pasan; los acotados (Marketing, Supervisión) solo por
 * sus secciones, y una ruta `/admin/*` cuya sección no se reconoce se DENIEGA
 * (fail-closed). Encima se aplican los ajustes por empleado.
 */
function seccionVisible(href: string, ctx: ContextoNav): boolean {
  if (!href.startsWith('/admin')) return true
  const section = adminSectionForPath(href)
  if (!section) {
    /**
     * UNA RUTA `/admin/*` QUE NO MAPEA A NINGUNA SECCIÓN.
     *
     * Hoy son dos, `/admin/crm` y `/admin/facturas`: están en el menú y su
     * primer segmento no figura en `ADMIN_SECTIONS`. Se comportan como antes
     * de esta fase — los roles con panel completo las ven, los acotados no —
     * y esa asimetría se conserva A PROPÓSITO. Cambiarla movería quién puede
     * abrir dos módulos reales, que es una decisión de autorización y no de
     * navegación; se toma en el módulo de permisos, con sus pruebas, no aquí.
     *
     * Lo que sí hace falta decir es que un ajuste por empleado NO puede
     * regular estos dos: sin sección, no hay nada que conceder ni negar.
     */
    return FULL_ADMIN_ROLES.includes(ctx.role)
  }
  // Con ajustes o sin ellos: `seccionPermitida` cae a lo que da el rol cuando
  // el empleado no tiene ninguno.
  return seccionPermitida(ctx.role, section, ctx.permisos)
}

/** ¿Está encendida la capacidad? Sin dato de capacidades no se filtra. */
function capacidadVisible(
  capacidad: CapacidadNav | undefined,
  ctx: ContextoNav
): boolean {
  if (!capacidad) return true
  if (!ctx.capacidades) return true
  return ctx.capacidades.includes(capacidad)
}

/** ¿Aplica a este vertical? Sin vertical conocido no se filtra. */
function tipoVisible(
  tipos: readonly TipoEmpresaNav[] | undefined,
  ctx: ContextoNav
): boolean {
  if (!tipos || tipos.length === 0) return true
  if (!ctx.tipoEmpresa) return true
  return tipos.includes(ctx.tipoEmpresa)
}

/** ¿Se le ofrece este módulo a esta persona? */
export function canSeeItem(item: NavLink, ctx: ContextoNav): boolean {
  if (item.roles && !item.roles.includes(ctx.role)) return false
  if (item.rangoMinimo !== undefined && rankOf(ctx.role) < item.rangoMinimo) return false
  if (ctx.ocultas?.includes(item.href)) return false
  if (!capacidadVisible(item.capacidad, ctx)) return false
  if (!tipoVisible(item.tiposEmpresa, ctx)) return false
  return seccionVisible(item.href, ctx)
}

/** Los grupos del espacio que quedan con al menos un módulo visible. */
export function visibleGroups(workspace: Workspace, ctx: ContextoNav): NavGroup[] {
  return workspace.groups
    .map((g) => ({ ...g, items: g.items.filter((it) => canSeeItem(it, ctx)) }))
    .filter((g) => g.items.length > 0)
}

/**
 * ¿Se pinta este espacio?
 *
 * UN ESPACIO SIN MÓDULOS VISIBLES NO SE PINTA. Es la regla que evita el peor
 * fallo de un menú de dos niveles: un icono en el riel que, al pulsarlo, abre
 * un panel vacío. Quien lo ve no piensa «no tengo permiso», piensa «esto está
 * roto».
 */
export function canSeeWorkspace(workspace: Workspace, ctx: ContextoNav): boolean {
  // Separación PLATFORM/COMPANY: un espacio con ámbito solo se pinta en su
  // ámbito. Sin ámbito en el contexto no se filtra (cliente, mostrador).
  if (ctx.scope && workspace.scope && workspace.scope !== ctx.scope) return false
  if (workspace.roles && !workspace.roles.includes(ctx.role)) return false
  if (workspace.rangoMinimo !== undefined && rankOf(ctx.role) < workspace.rangoMinimo) {
    return false
  }
  if (!capacidadVisible(workspace.capacidad, ctx)) return false
  if (!tipoVisible(workspace.tiposEmpresa, ctx)) return false
  return visibleGroups(workspace, ctx).length > 0
}

/** Un espacio ya resuelto: sus grupos filtrados, listo para pintar. */
export interface EspacioVisible extends Workspace {
  groups: NavGroup[]
}
/**
 * ¿Muestra la salida explícita a Plataforma? Solo cuando un superadministrador
 * está operando UNA empresa: es el cambio de ámbito en sentido contrario, y
 * también vive aquí (y no como un `role ===` en el header) para que la guardia
 * «ningún componente decide por rol» lo cubra.
 */
export function ofreceSalidaAPlataforma(ctx: ContextoNav): boolean {
  return ctx.scope === 'COMPANY' && ctx.role === 'SUPERADMIN'
}

/** Los espacios que esta persona ve, con sus grupos ya filtrados. */
export function visibleWorkspaces(ctx: ContextoNav): EspacioVisible[] {
  return workspacesForRole(ctx.role)
    .filter((w) => canSeeWorkspace(w, ctx))
    .map((w) => ({ ...w, groups: visibleGroups(w, ctx) }))
}

/**
 * ¿SE PINTA EL MENÚ EN UNA SOLA COLUMNA, SIN RIEL?
 *
 * El riel existe para REPARTIR: elegir un espacio reemplaza el segundo nivel.
 * Con un único espacio visible no hay nada que elegir, y lo que queda es un
 * icono siempre activo ocupando 68 px. En ese caso el segundo nivel se pinta
 * entero y a todo el ancho, con sus grupos como secciones rotuladas.
 *
 * Hoy es la plataforma (superadministrador) y el mostrador (empleado,
 * recepción). Se decide sobre los espacios YA filtrados y no por rol: si a un
 * rol le quedara un solo espacio por capacidades o permisos, también lo vería
 * en una columna — y si la plataforma se repartiera mañana en varios
 * espacios, el riel volvería solo.
 */
export function menuEnUnaColumna(espacios: readonly EspacioVisible[]): boolean {
  return espacios.length === 1
}

// ── Cambio de ámbito ────────────────────────────────────────────────────────

/** A dónde lleva «Plataforma» en el conmutador de ámbito. */
export const ATERRIZAJE_PLATAFORMA = '/superadmin/dashboard'
/** A dónde lleva «Empresa» en el conmutador de ámbito. */
export const ATERRIZAJE_EMPRESA = '/admin/dashboard'

/**
 * ¿Muestra la entrada explícita al panel de empresa? Solo cuando un
 * superadministrador está en la plataforma. Es el sentido de ida del
 * conmutador de ámbito; sin él, los 37 módulos de empresa no tenían ningún
 * enlace en el menú del superadministrador —solo se llegaba escribiendo la
 * URL—, que fue exactamente lo que se notó como «módulos que no aparecen».
 */
export function ofreceEntradaAEmpresa(ctx: ContextoNav): boolean {
  return ctx.scope === 'PLATFORM' && ctx.role === 'SUPERADMIN'
}

// ── Resolución por ruta ─────────────────────────────────────────────────────

/** ¿La ruta cae dentro de este prefijo? Exacto o como carpeta, nunca a medias. */
function casaPrefijo(pathname: string, prefijo: string): boolean {
  return pathname === prefijo || pathname.startsWith(prefijo + '/')
}

/** Todos los prefijos que pertenecen a un módulo: su ruta y sus históricos. */
function prefijosDe(item: NavLink): string[] {
  return [item.href, ...(item.prefijos ?? [])]
}

interface Coincidencia {
  workspace: EspacioVisible
  group: NavGroup
  item: NavLink
  /** Longitud del prefijo que casó: lo que decide quién gana. */
  largo: number
}

/**
 * EL MÓDULO AL QUE PERTENECE UNA RUTA, POR EL PREFIJO MÁS LARGO.
 *
 * Gana el prefijo más largo y no el primero que casa. Sin esa regla,
 * `/admin/audiencia/segmentos` resolvería a «Audiencia» —que también casa— y
 * el menú marcaría activo el módulo equivocado. Es también lo que hace que un
 * enlace profundo compartido por WhatsApp conserve su sitio en el menú en vez
 * de aterrizar sin contexto.
 */
function mejorCoincidencia(pathname: string, ctx: ContextoNav): Coincidencia | null {
  let mejor: Coincidencia | null = null
  for (const workspace of visibleWorkspaces(ctx)) {
    for (const group of workspace.groups) {
      for (const item of group.items) {
        for (const prefijo of prefijosDe(item)) {
          if (!casaPrefijo(pathname, prefijo)) continue
          if (mejor && prefijo.length <= mejor.largo) continue
          mejor = { workspace, group, item, largo: prefijo.length }
        }
      }
    }
  }
  return mejor
}

/** Dónde cae una ruta: su espacio, su grupo y el módulo exacto. */
export interface RutaResuelta {
  workspaceId: string
  groupId: string
  /** `href` del módulo, que es lo que el menú marca como activo. */
  href: string
}

/**
 * El módulo al que pertenece una ruta.
 *
 * Es la respuesta que necesitan a la vez el riel (qué espacio resaltar), el
 * panel (qué módulo marcar con `aria-current`) y las migas. Se calcula UNA vez
 * y por la misma regla, así que las tres superficies no pueden discrepar.
 */
export function resolverRuta(pathname: string, ctx: ContextoNav): RutaResuelta | null {
  const m = mejorCoincidencia(pathname, ctx)
  if (!m) return null
  return { workspaceId: m.workspace.id, groupId: m.group.id, href: m.item.href }
}

/** El espacio al que pertenece una ruta, o null si no es de ningún menú. */
export function workspaceOf(pathname: string, ctx: ContextoNav): string | null {
  return resolverRuta(pathname, ctx)?.workspaceId ?? null
}

/**
 * A dónde lleva pulsar el icono de un espacio en el riel.
 *
 * El módulo marcado `principal`, y si no hubiera ninguno visible, el primero
 * que quede. Nunca devuelve una ruta que esta persona no pueda abrir: se elige
 * sobre los grupos YA filtrados.
 */
export function workspaceLanding(
  workspace: Workspace,
  ctx: ContextoNav
): string | null {
  const groups = visibleGroups(workspace, ctx)
  for (const g of groups) {
    const principal = g.items.find((i) => i.principal)
    if (principal) return principal.href
  }
  return groups[0]?.items[0]?.href ?? null
}

// ── Migas ───────────────────────────────────────────────────────────────────

/** Etiquetas de los sub-segmentos comunes para el último nivel de la miga. */
const ETIQUETAS_SEGMENTO: Record<string, string> = {
  nuevo: 'Nuevo',
  nueva: 'Nueva',
  nuevos: 'Nuevos',
  editar: 'Editar',
  plantillas: 'Plantillas',
  segmentos: 'Segmentos',
  campanas: 'Campañas',
  conectar: 'Conectar',
  desarrolladores: 'Desarrolladores',
  claves: 'Claves de API',
  webhooks: 'Webhooks',
  registros: 'Registros',
}

export interface Miga {
  label: string
  /** Sin `href`, es la página actual y se pinta como texto. */
  href?: string
}

/**
 * DÓNDE ESTÁS: espacio → dominio → módulo → subpágina.
 *
 * La cabecera decía «MembeGo / Campañas», que responde «¿qué página es esta?»
 * pero no «¿dónde estoy?». Con espacios, la primera miga es la parcela de
 * trabajo y además es un enlace: volver al aterrizaje del espacio deja de
 * exigir un viaje por el menú.
 *
 * El dominio se omite cuando no aporta —un grupo de un solo módulo, o uno que
 * se llama igual que su módulo— porque «Inicio / Inicio» es ruido.
 */
export function breadcrumbs(pathname: string, ctx: ContextoNav): Miga[] {
  const m = mejorCoincidencia(pathname, ctx)
  if (!m) return []

  const migas: Miga[] = []
  const aterrizaje = workspaceLanding(m.workspace, ctx)
  // El espacio no se repite cuando su aterrizaje ES la página actual.
  if (aterrizaje && aterrizaje !== m.item.href) {
    migas.push({ label: m.workspace.label, href: aterrizaje })
  } else if (!aterrizaje) {
    migas.push({ label: m.workspace.label })
  }

  if (m.group.items.length > 1 && m.group.label !== m.item.label) {
    migas.push({ label: m.group.label })
  }

  // Lo que queda de la ruta después del prefijo que casó.
  const prefijo = prefijosDe(m.item).find(
    (p) => p.length === m.largo && casaPrefijo(pathname, p)
  )
  const resto = pathname.slice(prefijo?.length ?? 0).split('/').filter(Boolean)

  if (resto.length === 0) {
    migas.push({ label: m.item.label })
    return migas
  }

  migas.push({ label: m.item.label, href: m.item.href })
  const conNombre = [...resto].reverse().find((s) => ETIQUETAS_SEGMENTO[s])
  // Un id suelto no tiene nombre legible: «Detalle» es lo honesto.
  migas.push({ label: conNombre ? ETIQUETAS_SEGMENTO[conNombre] : 'Detalle' })
  return migas
}

// ── Buscador ────────────────────────────────────────────────────────────────

export interface ResultadoBusqueda {
  item: NavLink
  workspace: EspacioVisible
  group: NavGroup
}

/** Todos los módulos visibles, con su espacio y su grupo. Base del buscador. */
export function modulosVisibles(ctx: ContextoNav): ResultadoBusqueda[] {
  return visibleWorkspaces(ctx).flatMap((workspace) =>
    workspace.groups.flatMap((group) =>
      group.items.map((item) => ({ item, workspace, group }))
    )
  )
}

/** Quita tildes y baja a minúsculas: «Analítica» encuentra «analitica». */
function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

/**
 * Búsqueda de módulos por nombre, palabras clave, descripción y nombre del
 * espacio. Las palabras clave existen porque la gente escribe lo que quiere
 * hacer («canjear», «cobrar») y no cómo se llama el módulo en el menú.
 */
export function buscarModulos(
  consulta: string,
  ctx: ContextoNav,
  limite = 8
): ResultadoBusqueda[] {
  const q = normalizar(consulta.trim())
  if (!q) return []
  const puntua = (r: ResultadoBusqueda): number => {
    const label = normalizar(r.item.label)
    if (label === q) return 0
    if (label.startsWith(q)) return 1
    if (label.includes(q)) return 2
    if ((r.item.keywords ?? []).some((k) => normalizar(k).includes(q))) return 3
    if (normalizar(r.item.description ?? '').includes(q)) return 4
    if (normalizar(r.workspace.label).includes(q)) return 5
    return Infinity
  }
  return modulosVisibles(ctx)
    .map((r) => ({ r, p: puntua(r) }))
    .filter((x) => x.p !== Infinity)
    .sort((a, b) => a.p - b.p)
    .slice(0, limite)
    .map((x) => x.r)
}

// ── Compatibilidad: la lista plana ──────────────────────────────────────────

/**
 * La navegación de un rol como LISTA PLANA de grupos.
 *
 * Sigue existiendo porque hay pruebas y pantallas que razonan sobre dominios
 * («el panel de administrador son nueve dominios») y porque componer los
 * espacios en un solo orden es la forma de garantizar que reagrupar en
 * espacios NO cambió el inventario ni el orden de los dominios.
 *
 * NO aplica capacidades ni permisos: es el universo declarado del rol. Para
 * saber qué ve una persona concreta, `visibleWorkspaces`.
 */
export function navForRole(role: AppRole): NavGroup[] {
  const espacios = workspacesForRole(role)
  const ctx: ContextoNav = { role }
  const grupos = espacios.flatMap((w) => w.groups)
  // Los roles acotados (Marketing, Supervisión) siguen viendo solo sus
  // secciones también en la lista plana: es lo que consumían la paleta de
  // comandos y el buscador antes de esta fase.
  return grupos
    .map((g) => ({ ...g, items: g.items.filter((it) => seccionVisible(it.href, ctx)) }))
    .filter((g) => g.items.length > 0)
}

/** Lista plana de enlaces, para resolver títulos y buscar. */
export function allLinks(groups: NavGroup[]): NavLink[] {
  return groups.flatMap((g) => g.items)
}

/**
 * Oculta los enlaces cuya ruta esté en `hidden` y descarta los grupos vacíos.
 * Se conserva para las superficies que todavía razonan sobre grupos planos.
 */
export function filtrarNavOculto(groups: NavGroup[], hidden: string[]): NavGroup[] {
  if (hidden.length === 0) return groups
  const set = new Set(hidden)
  return groups
    .map((g) => ({ ...g, items: g.items.filter((it) => !set.has(it.href)) }))
    .filter((g) => g.items.length > 0)
}

/**
 * Módulo de PERMISOS: enlaces del panel cuya sección le fue NEGADA a este
 * empleado. El layout del admin los pasa como `ocultas` del contexto y con eso
 * desaparecen de TODAS las superficies de navegación sin tocar componente
 * alguno. La barrera real siguen siendo las server actions.
 */
export function hrefsNegadosPorPermisos(
  role: AppRole,
  permisos: PermisosUsuario | null
): string[] {
  if (!permisos) return []
  const negados: string[] = []
  for (const grupo of GRUPOS_ADMIN) {
    for (const item of grupo.items) {
      const seccion = adminSectionForPath(item.href)
      if (seccion && !seccionPermitida(role, seccion, permisos)) negados.push(item.href)
    }
  }
  return negados
}

export function roleLabel(role: AppRole): string {
  switch (role) {
    case 'CLIENTE':
      return 'Cliente'
    case 'SUPERADMIN':
      return 'Superadmin'
    case 'EMPLEADO':
      return 'Staff / Empleado'
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
    case 'VENDEDOR':
      return 'Vendedor'
    default:
      return 'Administrador'
  }
}
