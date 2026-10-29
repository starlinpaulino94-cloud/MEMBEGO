import {
  Activity,
  BadgePercent,
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
  MapPinCheck,
  LayoutDashboard,
  LifeBuoy,
  Link2,
  Megaphone,
  MessageCircle,
  Newspaper,
  Package,
  PackageSearch,
  ShoppingBag,
  Warehouse,
  Palette,
  Plug,
  QrCode,
  Receipt,
  ReceiptText,
  Rocket,
  ScanLine,
  Scale,
  ListChecks,
  ShieldAlert,
  ShieldCheck,
  Share2,
  SlidersHorizontal,
  TextSearch,
  Store,
  Tag,
  Ticket,
  TicketPercent,
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
import { ADMIN_ROLES, FULL_ADMIN_ROLES, type AppRole } from '@/types'
import {
  adminSectionForPath,
  funcionPermitida,
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
export type CapacidadNav =
  | 'CITAS'
  | 'SEGUIMIENTO'
  | 'RULETA'
  | 'EXCURSIONES'
  | 'CRM'
  | 'PUBLICACIONES'
  | 'MENSAJERIA'
  | 'CATALOGO_UNIFICADO'
  | 'PEDIDOS_MEMBEGO'
  | 'DEALS_MARKETPLACE'
  | 'POS_CAJA'
  | 'MEMBEGO_SUPPLIER'

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
  // Los del hub (contrato Stitch): conteos baratos, cacheados 60 s. Los caros
  // —clientes en riesgo— siguen fuera a propósito: ver la nota de coste en
  // modules/navegacion/badges.ts.
  'planesActivos',
  'canjesHoy',
] as const
export type ClaveBadge = (typeof CLAVES_BADGE)[number]

/**
 * UNA PESTAÑA DE MÓDULO (auditoría admin · fase 6, 03 · C.2).
 *
 * El módulo es la entrada del menú; cada pestaña es una RUTA REAL con su propia sección de permisos. Fusionar «Pagos»,
 * «Registros», «Comprobantes» y «Conciliación» en una entrada no mueve ninguna ruta ni cambia ninguna sección: solo cambia
 * dónde se ofrece cada una. Por eso la pestaña declara lo mismo que declaraba su entrada de menú (capacidad, vertical,
 * palabras clave) y la sección sale de su ruta, como siempre (`adminSectionForPath`).
 */
export interface NavPestana {
  /** La ruta de la pestaña: la que se abre al pulsarla. La sección de permisos se deriva de ella. */
  href: string
  label: string
  description?: string
  /** Capacidad contratada que enciende ESTA pestaña. Ausente = siempre encendida. */
  capacidad?: CapacidadNav
  /** Verticales donde tiene sentido. Ausente = todas. */
  tiposEmpresa?: readonly TipoEmpresaNav[]
  /**
   * Función fina que la pantalla exige además de la sección (`reportes › ver_financieros`). La pestaña no se ofrece a quien no
   * la tiene: una pestaña que solo lleva a «no autorizado» no es un permiso, es un tropiezo.
   */
  funcion?: string
  /** Palabras clave del buscador: lo que la gente escribe para llegar a esta pestaña. */
  keywords?: readonly string[]
  /** Rutas que también pertenecen a esta pestaña (históricas o hijas que no cuelgan de `href`). */
  prefijos?: readonly string[]
}

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
  /** Tono del contador: ausente = informa (gris); peligro = avisa (rojo). */
  badgeTono?: 'peligro'
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
  /**
   * Las pestañas del módulo, en el orden en que se ofrecen; la primera es la entrada misma (su `href` es el de la primera).
   *
   * Una entrada con pestañas se muestra si le queda AL MENOS UNA visible y aterriza en la primera visible (03 · C.3): es la misma
   * regla que ya aplica `visibleGroups` a los grupos. Cada pestaña se filtra por su sección, su capacidad y su función.
   */
  pestanas?: readonly NavPestana[]
  /**
   * La pantalla ya pinta sus propias pestañas (Prospectos, Parques y Tours, el selector de tipo de Beneficios): no se dibuja la
   * barra del módulo encima. Las pestañas siguen sirviendo para decidir qué se ofrece y a dónde aterriza.
   */
  sinBarra?: boolean
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
  /**
   * Supplier Lite: la empresa es proveedora de Membego y NO tiene comercio
   * (ni catálogo, ni pedidos, ni ofertas). Su menú es el del proveedor y nada
   * más: no se le ofrece el Business OS que no contrató (§6).
   */
  soloProveedor?: boolean
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
      // Commerce Core · catálogo unificado (Fase 1). Detrás de su capacidad,
      // encendida de serie desde la experiencia comercial.
      href: '/admin/catalogo',
      label: 'Catálogo',
      icon: Package,
      description: 'Productos y servicios con sus variantes y precios.',
      keywords: ['catalogo', 'productos', 'servicios', 'variantes', 'precios', 'sku', 'inventario'],
      capacidad: 'CATALOGO_UNIFICADO',
    },
    {
      // Commerce Core · inventario (Fase 2). Misma capacidad que el catálogo.
      href: '/admin/inventario',
      label: 'Inventario',
      icon: Warehouse,
      description: 'Existencias por producto y sucursal, movimientos y stock bajo.',
      keywords: ['inventario', 'stock', 'existencias', 'almacen', 'bodega', 'sucursal', 'transferencia', 'ajuste', 'conteo'],
      capacidad: 'CATALOGO_UNIFICADO',
    },
    {
      // Growth Engine · ofertas sobre el catálogo (Fase 5). Detrás de su capacidad, encendida de serie.
      href: '/admin/deals',
      label: 'Ofertas y Promociones',
      icon: BadgePercent,
      description: 'Descuentos sobre tus productos y servicios que los clientes obtienen en el marketplace y canjean con QR, con tope de presupuesto.',
      keywords: ['ofertas', 'deals', 'descuento', 'presupuesto', 'cupon', 'canje', 'marketplace', 'cpa', 'promocion', 'promociones', 'rebaja', 'oferta'],
      capacidad: 'DEALS_MARKETPLACE',
    },
    {
      href: '/admin/planes',
      label: 'Planes',
      badge: 'planesActivos',
      icon: Package,
      description: 'Productos de membresía que vende la empresa.',
      principal: true,
      keywords: ['planes', 'precios', 'catalogo', 'productos'],
    },
    {
      href: '/admin/ofertas',
      label: 'Beneficios y regalos',
      icon: Tag,
      description: 'Promociones públicas, banners relámpago y regalos VIP (beneficios sin producto del catálogo).',
      keywords: ['ofertas', 'promociones', 'descuentos', 'banners', 'beneficios', 'regalos', 'vip'],
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
      capacidad: 'PUBLICACIONES',
    },
    {
      // Ruta real que no está en el diseño de espacios: se conserva tal cual.
      // Es contenido de captación, así que vive en Contenido sin ser principal.
      href: '/admin/crm',
      label: 'Prospectos',
      icon: Contact,
      description: 'Quién preguntó y todavía no compra.',
      keywords: ['crm', 'prospectos', 'leads', 'oportunidades'],
      capacidad: 'CRM',
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
      // Commerce Core · pedidos Membego (Fase 3). Detrás de su capacidad,
      // encendida de serie desde la experiencia comercial.
      href: '/admin/pedidos-membego',
      label: 'Pedidos Membego',
      icon: ShoppingBag,
      description: 'Pedidos del marketplace: acéptalos, ajusta el monto y ciérralos con el QR del cliente.',
      keywords: ['pedidos', 'ordenes', 'marketplace', 'membego', 'qr', 'reembolso', 'cancelar'],
      capacidad: 'PEDIDOS_MEMBEGO',
    },
    {
      href: '/admin/scanner',
      label: 'Escanear QR',
      badge: 'canjesHoy',
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
      // Commerce Core · Mi cuenta Membego (Fase 4): lo que la empresa le debe a la plataforma.
      href: '/admin/facturacion-membego',
      label: 'Mi cuenta Membego',
      icon: Landmark,
      description: 'Lo que debes a Membego por los pedidos del marketplace: saldo, comisiones y estados de cuenta.',
      keywords: ['cuenta', 'membego', 'comisiones', 'saldo', 'estado de cuenta', 'facturacion', 'cpa', 'limite', 'credito'],
      capacidad: 'PEDIDOS_MEMBEGO',
    },
    {
      // Analítica (Fase 6): lo que Membego le produjo a la empresa y lo que le costó. Misma capacidad que los pedidos.
      href: '/admin/resultados-membego',
      label: 'Resultados Membego',
      icon: TrendingUp,
      description: 'Cuántos clientes, pedidos y ventas te produjo Membego, qué te costó y cómo rinde cada oferta.',
      keywords: ['resultados', 'membego', 'roi', 'retorno', 'ventas', 'gmv', 'clientes nuevos', 'atribucion', 'comisiones', 'ofertas'],
      capacidad: 'PEDIDOS_MEMBEGO',
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
      href: '/admin/sinonimos',
      label: 'Sinónimos de búsqueda',
      icon: TextSearch,
      description: 'Cómo te encuentran tus clientes al buscar.',
      keywords: ['sinonimos', 'busqueda', 'buscador', 'equivalencias', 'terminos'],
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
      // Supply: el escáner y las entregas de los beneficios que los clientes
      // compraron a Membego. NO va junto a las promociones de la empresa: esto
      // no es lo que ella vende, es lo que Membego le compró y está obligada a
      // entregar.
      href: '/admin/supply',
      label: 'Entregas Membego',
      icon: ScanLine,
      description: 'Escanea el QR del cliente, confirma la entrega y revisa las entregas del día.',
      capacidad: 'MEMBEGO_SUPPLIER',
      keywords: ['supply', 'membego', 'entregas', 'escaner', 'qr', 'beneficios', 'redenciones'],
    },
    {
      href: '/admin/integraciones',
      label: 'Integraciones',
      icon: Plug,
      description: 'Aplicaciones, API, webhooks y conexiones de la empresa.',
      keywords: ['integraciones', 'conectar', 'api', 'webhooks', 'connect', 'apps'],
    },
  ],
}

/**
 * SUPPLIER & FULFILLMENT COMMERCE · el portal del proveedor (Supplier Lite).
 * Todo cuelga de la sección `supply` y de la capacidad MEMBEGO_SUPPLIER; las
 * funciones finas (escanear, ventas adicionales, liquidaciones, personal,
 * configuración, solicitud) las decide `requireSection` en cada action.
 * `/admin/supply` (la portada) ya está en Conexiones; aquí van sus pantallas.
 */
const ENLACES_PORTAL_PROVEEDOR: readonly NavLink[] = [
    {
      href: '/admin/supply/inventario',
      label: 'Productos de Membego',
      icon: Warehouse,
      description: 'Lo que Membego te compró: unidades, derechos, capacidad y vencimientos por contrato.',
      capacidad: 'MEMBEGO_SUPPLIER',
      keywords: ['inventario', 'productos', 'servicios', 'derechos', 'unidades', 'contrato', 'proveedor', 'supply'],
    },
    {
      href: '/admin/supply/escaner',
      label: 'Escanear QR',
      icon: ScanLine,
      description: 'Lee el QR del cliente, entrega el beneficio de Membego y registra las compras adicionales.',
      capacidad: 'MEMBEGO_SUPPLIER',
      keywords: ['escanear', 'qr', 'entregar', 'canje', 'proveedor', 'supply'],
    },
    {
      href: '/admin/supply/canjes',
      label: 'Canjes',
      icon: ListChecks,
      description: 'Las entregas hechas: quién, qué, dónde y cuándo.',
      capacidad: 'MEMBEGO_SUPPLIER',
      keywords: ['canjes', 'entregas', 'redenciones', 'proveedor', 'supply'],
    },
    {
      href: '/admin/supply/ventas-adicionales',
      label: 'Ventas adicionales',
      icon: Receipt,
      description: 'Lo que los clientes de Membego te compraron además de lo incluido, y la comisión solo sobre eso.',
      capacidad: 'MEMBEGO_SUPPLIER',
      keywords: ['ventas', 'adicionales', 'extras', 'visitas', 'comision', 'proveedor', 'supply'],
    },
    {
      href: '/admin/supply/incidencias',
      label: 'Incidencias',
      icon: TriangleAlert,
      description: 'Lo que salió mal al entregar: QR inválido, producto agotado, cliente equivocado.',
      capacidad: 'MEMBEGO_SUPPLIER',
      keywords: ['incidencias', 'problemas', 'proveedor', 'supply'],
    },
    {
      href: '/admin/supply/liquidaciones',
      label: 'Liquidaciones',
      icon: Landmark,
      description: 'Lo que Membego te debe y te pagó por lo entregado.',
      capacidad: 'MEMBEGO_SUPPLIER',
      keywords: ['liquidaciones', 'pagos', 'finanzas', 'proveedor', 'supply'],
    },
    {
      href: '/admin/supply/personal',
      label: 'Personal',
      icon: Users,
      description: 'Quién escanea, quién ve las cuentas y quién solo mira.',
      capacidad: 'MEMBEGO_SUPPLIER',
      keywords: ['personal', 'equipo', 'operador', 'invitar', 'proveedor', 'supply'],
    },
    {
      href: '/admin/supply/configuracion',
      label: 'Configuración',
      icon: SlidersHorizontal,
      description: 'Contrato, prueba del escáner y lista de preparación de tu portal.',
      capacidad: 'MEMBEGO_SUPPLIER',
      keywords: ['configuracion', 'contrato', 'prueba', 'activacion', 'proveedor', 'supply'],
    },
    {
      href: '/admin/supply/solicitud-merchant',
      label: 'Ser empresa Membego',
      icon: Store,
      description: 'Pide operar también como empresa Membego: catálogo, pedidos y ofertas en la misma organización.',
      capacidad: 'MEMBEGO_SUPPLIER',
      keywords: ['merchant', 'empresa', 'solicitud', 'convertirme', 'vitrina', 'proveedor', 'supply'],
    },
]

function delPortal(...hrefs: readonly string[]): NavLink[] {
  return hrefs.map((href) => {
    const enlace = ENLACES_PORTAL_PROVEEDOR.find((i) => i.href === href)
    if (!enlace) throw new Error(`Navegación: no existe la pantalla del portal ${href}.`)
    return enlace
  })
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
      capacidad: 'MENSAJERIA',
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

// ── El hub administrativo (contrato Stitch) ─────────────────────────────────
//
// Los diseños definen UNA columna con ocho grupos rotulados, no un riel de dos
// niveles. La agrupación no se inventó aquí: sale del `code.html` del resumen
// administrativo, y coincide casi literalmente con la que el encargo proponía.
//
// ────────────────────────────────────────────────────────────────────────────
// POR QUÉ LOS GRUPOS SON EL CONTRATO Y LA LISTA DE ENLACES NO
//
// La barra lateral del diseño enseña los módulos de LA EMPRESA que sirvió de
// ejemplo: unos veinte. MEMBEGO tiene treinta y siete. Adoptar esa lista al pie
// de la letra escondería diecisiete módulos que funcionan —prospectos,
// automatizaciones, conciliación, tickets…— y eso es perder funciones sin
// decirlo, que es justo lo que el encargo prohíbe.
//
// Así que se adopta la ESTRUCTURA —los ocho grupos, en su orden— y cada módulo
// existente entra en el grupo que le corresponde. Al revés también: lo que el
// diseño nombra y aquí no existe (Navegación, Cerca de ti, Mi QR de empresa,
// Servicios, Ingresos, Rendimiento) NO se pinta como enlace muerto; queda
// anotado en `docs/transformacion-membego/04-fidelidad-stitch.md`.
//
// `deAdmin` falla ruidosamente si una ruta desaparece del catálogo, y
// `tests/navegacion-espacios.test.ts` comprueba que ningún módulo se quede sin
// grupo. Un enlace que se pierde en una reagrupación no vuelve a aparecer solo.

const CATALOGO_ADMIN: readonly NavGroup[] = [
  G_INICIO, G_CLI_GESTION, G_CLI_RELACION, G_EXCURSIONES, G_OFERTA,
  G_FIDELIZACION, G_MKT_CONTENIDO, G_MKT_AUTO, G_ATENCION, G_ORGANIZACION,
  G_ANA_RESULTADOS, G_ANA_CONOCIMIENTO, G_ADM_EMPRESA, G_ADM_CONEXIONES,
  G_SOPORTE,
]

/** Todos los enlaces de administración, sin duplicados, en su orden de origen. */
export const ENLACES_ADMIN: readonly NavLink[] = CATALOGO_ADMIN.flatMap((g) => g.items)

/** Toma enlaces por ruta conservando sus permisos, capacidades y palabras clave. */
function deAdmin(...hrefs: readonly string[]): NavLink[] {
  return hrefs.map((href) => {
    const enlace = ENLACES_ADMIN.find((i) => i.href === href)
    if (!enlace) {
      throw new Error(`Navegación: no existe el módulo ${href}. Si se retiró, sácalo del hub.`)
    }
    return enlace
  })
}

// ── El hub administrativo: módulos con pestañas (auditoría admin · fase 6) ───
//
// DE CUARENTA Y CINCO DESTINOS A UN MENÚ QUE SE LEE (03 · C.2).
//
// El panel de empresa llegó a 45 destinos siempre visibles: la auditoría contó 37 y después nacieron el catálogo, el inventario,
// los pedidos, las ofertas con presupuesto, «Mi cuenta Membego», «Resultados» y las entregas del proveedor. Pintados a la vez
// son un inventario, no un menú: nada dice dónde mirar, y cuatro entradas seguidas (Pagos, Comprobantes, Registros,
// Conciliación) son UNA tarea.
//
// LO QUE CAMBIA Y LO QUE NO. Cambia dónde se OFRECE cada pantalla: pares como Pagos/Registros/Comprobantes/Conciliación pasan a
// ser pestañas de un solo módulo. NO cambia ninguna ruta, ninguna sección de permisos, ninguna capacidad ni ninguna pantalla:
// cada pestaña es la misma ruta de siempre, con la misma guardia. Solo se fusionan puertas de entrada, no modelos de datos.
//
// CÓMO SE DECLARA. El catálogo de destinos (`ENLACES_ADMIN`, arriba) sigue siendo la fuente de la etiqueta, la capacidad y las
// palabras clave de cada RUTA; aquí solo se dice qué rutas son pestañas de qué módulo. `modulo()` falla si una pestaña no existe
// en el catálogo ni trae etiqueta, y una prueba comprueba que ningún destino del catálogo se queda sin entrada ni pestaña.
//
// POR QUÉ NO SE SIGUE EL «21» AL PIE DE LA LETRA. El diseño aprobado (03 · C.2, prototipos de la fase 3) tenía 21 entradas
// para el menú de entonces. Las ofertas de Membego no existían: Catálogo (con Inventario) y Pedidos Membego (con Mi cuenta y
// Resultados) entran como dos módulos nuevos y las entregas del proveedor siguen siendo una entrada que solo ven las empresas
// proveedoras. Una empresa con todo encendido ve 24 entradas; la que no vende en Membego, 21–22.

type DeclaracionPestana =
  | string
  | {
      href: string
      label?: string
      description?: string
      capacidad?: CapacidadNav
      funcion?: string
      keywords?: readonly string[]
      prefijos?: readonly string[]
    }

/** La pestaña a partir del catálogo de destinos: lo que no se declara aquí se hereda de la entrada de menú que era. */
function comoPestana(decl: DeclaracionPestana, capacidadDelModulo?: CapacidadNav): NavPestana {
  const d = typeof decl === 'string' ? { href: decl } : decl
  const base = ENLACES_ADMIN.find((i) => i.href === d.href)
  const label = d.label ?? base?.label
  if (!label) {
    throw new Error(`Navegación: la pestaña ${d.href} no está en el catálogo y no declara etiqueta.`)
  }
  return {
    href: d.href,
    label,
    description: d.description ?? base?.description,
    capacidad: d.capacidad ?? base?.capacidad ?? capacidadDelModulo,
    tiposEmpresa: base?.tiposEmpresa,
    funcion: d.funcion,
    // Si la pestaña cambia el nombre que tenía como entrada de menú («Métodos de pago» → «Cobros»), el nombre de antes sigue
    // siendo una palabra clave: quien lo escribía para llegar sigue llegando.
    keywords: [
      ...(base?.keywords ?? []),
      ...(base && d.label && d.label !== base.label ? [base.label.toLowerCase()] : []),
      ...(d.keywords ?? []),
    ],
    prefijos: d.prefijos,
  }
}

/**
 * UNA ENTRADA DEL MENÚ CON PESTAÑAS. Su `href` es el de la primera pestaña (a donde aterriza quien lo ve todo). Quien escribía
 * «conciliación» para llegar a Conciliación sigue llegando, y ahora el buscador le ofrece «Pagos › Conciliación» directamente.
 */
function modulo(def: {
  label: string
  icon: LucideIcon
  description: string
  pestanas: readonly DeclaracionPestana[]
  /** Capacidad que enciende todas las pestañas que no declaren la suya. */
  capacidad?: CapacidadNav
  sinBarra?: boolean
  principal?: boolean
  badge?: ClaveBadge
  keywords?: readonly string[]
}): NavLink {
  const pestanas = def.pestanas.map((d) => comoPestana(d, def.capacidad))
  const primera = pestanas[0]
  if (!primera) throw new Error(`Navegación: el módulo ${def.label} no tiene pestañas.`)
  // Solo las de la PRIMERA pestaña, que es la entrada misma. Las demás se buscan por su propio destino (`destinosDe`: «Pagos ›
  // Conciliación»): si la entrada heredara sus palabras, empataría con ellas y el buscador llevaría a la entrada y no a la pantalla.
  const palabras = [...(def.keywords ?? []), primera.label.toLowerCase(), ...(primera.keywords ?? [])]
  return {
    href: primera.href,
    label: def.label,
    icon: def.icon,
    description: def.description,
    principal: def.principal,
    badge: def.badge,
    sinBarra: def.sinBarra,
    pestanas,
    keywords: [...new Set(palabras)],
  }
}

const HUB_PRINCIPAL: NavGroup = {
  id: 'principal',
  label: 'Principal',
  items: deAdmin('/admin/dashboard'),
}

const HUB_EXPERIENCIA: NavGroup = {
  id: 'experiencia-cliente',
  label: 'App del cliente',
  items: [
    modulo({
      label: 'Editor de inicio',
      icon: Palette,
      description: 'Cómo se ve tu empresa en la app de tus clientes y cómo te encuentran al buscar.',
      pestanas: [{ href: '/admin/personalizacion', label: 'Inicio' }, { href: '/admin/personalizacion/carrusel', label: 'Carrusel' }, '/admin/sinonimos'],
      keywords: ['editor', 'inicio', 'home', 'app'],
    }),
  ],
}

/**
 * COMERCIO (experiencia comercial, 2026-10-08). Lo que una empresa VENDE y OPERA en Membego, en el orden en que se usa: qué vendo
 * (Catálogo, con su inventario) → qué me piden (Pedidos, con lo que debo a Membego y lo que me produjo) → qué incentivo aplico
 * (Beneficios y regalos) → membresías → excursiones.
 */
const HUB_COMERCIO: NavGroup = {
  id: 'comercio',
  label: 'Comercio',
  items: [
    modulo({
      label: 'Catálogo',
      icon: Package,
      description: 'Productos y servicios con sus variantes, precios y existencias.',
      pestanas: [{ href: '/admin/catalogo', label: 'Productos y servicios' }, '/admin/inventario'],
    }),
    modulo({
      label: 'Pedidos Membego',
      icon: ShoppingBag,
      description: 'Pedidos del marketplace, lo que debes a Membego y lo que Membego te produjo.',
      pestanas: [
        { href: '/admin/pedidos-membego', label: 'Pedidos' },
        { href: '/admin/facturacion-membego', label: 'Mi cuenta' },
        { href: '/admin/resultados-membego', label: 'Resultados' },
      ],
    }),
    modulo({
      label: 'Beneficios y regalos',
      icon: Tag,
      description: 'Promociones públicas, ofertas relámpago, regalos VIP y ofertas sobre tu catálogo.',
      // La pantalla ya trae su selector de tipo (fase 5 · 5.4): la barra del módulo duplicaría las pestañas.
      sinBarra: true,
      pestanas: [
        '/admin/ofertas',
        { href: '/admin/promociones', label: 'Promociones públicas' },
        { href: '/admin/marketing', label: 'Ofertas relámpago' },
        { href: '/admin/deals', label: 'Ofertas sobre productos' },
      ],
    }),
    modulo({
      label: 'Planes',
      icon: Package,
      description: 'Productos de membresía que vende la empresa.',
      badge: 'planesActivos',
      pestanas: ['/admin/planes', { href: '/admin/planes/plantillas', label: 'Plantillas' }],
    }),
    ...deAdmin('/admin/excursiones'),
  ],
}

const HUB_OPERACIONES: NavGroup = {
  id: 'operaciones',
  label: 'Operaciones',
  items: [
    // Una sola pantalla, compartida con el mostrador: sin pestañas. «Escanear QR» sigue siendo una palabra clave.
    {
      ...deAdmin('/admin/scanner')[0]!,
      label: 'Canjes y QR',
      keywords: [...(deAdmin('/admin/scanner')[0]!.keywords ?? []), 'escanear qr'],
    },
    modulo({
      label: 'Citas',
      icon: CalendarDays,
      description: 'La agenda de la empresa y su configuración.',
      capacidad: 'CITAS',
      pestanas: [{ href: '/admin/citas', label: 'Agenda' }, { href: '/admin/citas/configuracion', label: 'Configuración' }],
    }),
    modulo({
      label: 'Pagos',
      icon: Wallet,
      description: 'Validar cobros, ver los movimientos y los comprobantes, y cuadrar la caja.',
      pestanas: [
        { href: '/admin/pagos', label: 'Por validar' },
        { href: '/admin/registros', label: 'Movimientos' },
        { href: '/admin/facturas', label: 'Comprobantes' },
        '/admin/conciliacion',
      ],
    }),
    {
      // Caja vive en el mostrador (`/empleado/caja`, solo roles de mostrador): D-09, adoptada. Se ofrece solo a quien puede
      // abrirla; a Marketing y Supervisión, que rebotarían, no se les enseña.
      href: '/empleado/caja',
      label: 'Caja',
      icon: Banknote,
      description: 'Cobrar en el mostrador. Se abre en la pantalla de mostrador.',
      capacidad: 'POS_CAJA',
      roles: ['SUPERADMIN', 'ADMINISTRADOR', 'ADMIN_EMPRESA', 'GERENTE', 'CAJERO'],
      keywords: ['caja', 'cobrar', 'pos', 'punto de venta', 'turno'],
    },
  ],
}

const HUB_CLIENTES: NavGroup = {
  id: 'clientes',
  label: 'Clientes',
  items: [
    modulo({
      label: 'Clientes',
      icon: Users,
      description: 'El directorio, sus membresías, quién está por irse y los grupos de clientes.',
      principal: true,
      pestanas: [
        { href: '/admin/clientes', label: 'Directorio' },
        '/admin/membresias',
        '/admin/riesgo',
        '/admin/audiencia/segmentos',
      ],
    }),
    // El CRM trae sus propias pestañas (`crm/layout.tsx`): no se les pone una barra encima.
    ...deAdmin('/admin/crm'),
    modulo({
      label: 'Soporte',
      icon: LifeBuoy,
      description: 'Casos de soporte y canales de contacto de la empresa.',
      badge: 'companyOpenTickets',
      pestanas: ['/admin/tickets', '/admin/comunicacion'],
    }),
  ],
}

const HUB_MARKETING: NavGroup = {
  id: 'marketing',
  label: 'Marketing',
  items: [
    modulo({
      label: 'Comunicaciones',
      icon: Megaphone,
      description: 'Avisos y campañas a tus clientes, y las reglas que los envían solos.',
      pestanas: [
        '/admin/notificaciones',
        '/admin/automatizaciones',
        {
          href: '/admin/audiencia/campanas',
          label: 'Campañas segmentadas',
          description: 'Campañas dirigidas a grupos de clientes.',
          keywords: ['campanas', 'dirigidas', 'segmentadas', 'audiencia'],
        },
        '/admin/campanas',
      ],
    }),
    ...deAdmin('/admin/publicaciones'),
    modulo({
      label: 'Fidelización',
      icon: HeartHandshake,
      description: 'Programas para que tus clientes vuelvan y traigan a otros.',
      pestanas: [
        { href: '/admin/invitaciones', label: 'Invita y Gana', prefijos: ['/admin/referidos'] },
        { href: '/admin/gamificacion', label: 'Ruleta' },
        { href: '/admin/regalos', label: 'Regalos' },
        { href: '/admin/crecimiento', label: 'Recompensas' },
        '/admin/seguimiento',
      ],
    }),
  ],
}

const HUB_ANALITICA: NavGroup = {
  id: 'analitica',
  label: 'Analítica',
  items: [
    modulo({
      label: 'Reportes',
      icon: BarChart3,
      description: 'Resultados, finanzas, membresías, operación, retención, audiencia y origen de los clientes.',
      principal: true,
      pestanas: [
        { href: '/admin/reportes', label: 'Resumen' },
        {
          href: '/admin/reportes/finanzas',
          label: 'Finanzas',
          description: 'Ingresos, cobros y comisiones.',
          // La pantalla entera exige `reportes › ver_financieros`: sin ella, la pestaña solo llevaría a «no autorizado».
          funcion: 'ver_financieros',
          keywords: ['finanzas', 'ingresos', 'dinero', 'ventas', 'cobros'],
        },
        { href: '/admin/reportes/membresias', label: 'Membresías', keywords: ['membresias', 'altas', 'bajas'] },
        { href: '/admin/reportes/operacion', label: 'Operación', keywords: ['operacion', 'visitas', 'canjes'] },
        '/admin/retencion',
        '/admin/audiencia',
        '/admin/adquisicion',
      ],
    }),
    ...deAdmin('/admin/actividad'),
  ],
}

const HUB_AJUSTES: NavGroup = {
  id: 'ajustes',
  label: 'Ajustes',
  // `/admin/supply` va aquí, junto a integraciones, y no en Comercio ni en Operaciones: no es lo que la empresa vende, es su
  // relación contractual con la plataforma. Detrás de la capacidad MEMBEGO_SUPPLIER, así que solo aparece en las empresas que de
  // verdad le venden supply a Membego.
  items: [
    modulo({
      label: 'Empresa',
      icon: Store,
      description: 'El perfil público del negocio y sus formas de cobro.',
      principal: true,
      pestanas: ['/admin/perfil', { href: '/admin/metodos-pago', label: 'Cobros' }],
    }),
    ...deAdmin('/admin/sucursales'),
    modulo({
      label: 'Equipo',
      icon: UserCog,
      description: 'Las personas de tu equipo, sus roles y lo que puede abrir cada una.',
      pestanas: [
        { href: '/admin/empleados', label: 'Personas' },
        {
          href: '/admin/empleados/accesos',
          label: 'Accesos',
          description: 'Qué puede abrir cada persona del equipo.',
          keywords: ['accesos', 'permisos', 'roles'],
        },
      ],
    }),
    ...deAdmin('/admin/integraciones', '/admin/supply'),
  ],
}

export const GRUPOS_HUB_ADMIN: readonly NavGroup[] = [
  HUB_PRINCIPAL, HUB_EXPERIENCIA, HUB_COMERCIO, HUB_OPERACIONES,
  HUB_CLIENTES, HUB_MARKETING, HUB_ANALITICA, HUB_AJUSTES,
]

const ESPACIOS_ADMIN: Workspace[] = [
  {
    id: 'empresa',
    label: 'Empresa',
    short: 'Empresa',
    icon: Building2,
    description: 'Todo lo que esta empresa opera y publica.',
    scope: 'COMPANY',
    groups: [...GRUPOS_HUB_ADMIN],
  },
]

/**
 * EL ESPACIO DEL PROVEEDOR (Supplier Lite, §6). Para una empresa SOLO
 * proveedora es el único espacio; para una que además vende en Membego se
 * suma a «Empresa». Sus módulos son los del portal `/admin/supply/*` y nada
 * del Business OS comercial.
 */
const ESPACIO_PROVEEDOR: Workspace = {
  id: 'proveedor',
  label: 'Proveedor Membego',
  short: 'Proveedor',
  icon: Store,
  description: 'Lo que Membego te compró y tú entregas: canjes, extras, liquidaciones y tu equipo.',
  scope: 'COMPANY',
  capacidad: 'MEMBEGO_SUPPLIER',
  groups: [
    {
      id: 'proveedor-inicio',
      label: 'Inicio',
      items: [{ ...deAdmin('/admin/supply')[0]!, label: 'Inicio', principal: true }],
    },
    {
      id: 'proveedor-operacion',
      label: 'Operación',
      items: delPortal('/admin/supply/inventario', '/admin/supply/escaner', '/admin/supply/canjes', '/admin/supply/ventas-adicionales', '/admin/supply/incidencias'),
    },
    {
      id: 'proveedor-cuentas',
      label: 'Cuentas',
      items: delPortal('/admin/supply/liquidaciones'),
    },
    {
      id: 'proveedor-organizacion',
      label: 'Organización',
      items: delPortal('/admin/supply/personal', '/admin/supply/configuracion', '/admin/supply/solicitud-merchant'),
    },
  ],
}

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
      // Experiencia comercial (2026-10-08): la puerta al marketplace dentro de la
      // app — negocios, productos, servicios y ofertas con una sola taxonomía.
      href: '/cliente/explorar',
      label: 'Explorar',
      icon: PackageSearch,
      description: 'Negocios, productos, servicios y ofertas.',
      keywords: ['explorar', 'marketplace', 'productos', 'servicios', 'negocios', 'empresas', 'catalogo', 'buscar'],
    },
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
      // Commerce Core · pedidos Membego (Fase 3): lo que la persona pidió a una
      // empresa. Se oculta mientras ni la empresa recibe pedidos ni la persona
      // tiene alguno (`navDisponible`); la ruta sigue abierta por URL.
      href: '/cliente/pedidos',
      label: 'Mis pedidos',
      icon: ShoppingBag,
      description: 'Lo que pediste a las empresas, el monto acordado y el QR para recogerlo.',
      keywords: ['pedidos', 'ordenes', 'compras', 'qr', 'recoger', 'membego'],
    },
    {
      // Supply: compras hechas a MEMBEGO (no a una empresa) y los
      // beneficios que nacen de ellas. Va en Mi Membego porque ya es suyo.
      //
      // NO hay una entrada aparte «Beneficios Membego» → /cliente/beneficios:
      // esa ruta se retiró con Supply V1 y ahora redirige aquí mismo. Dos
      // entradas de menú al mismo destino es la misma confusión entre capas
      // que ese nombre separado existía para evitar, solo que al revés.
      href: '/cliente/compras',
      label: 'Compras Membego',
      icon: Tag,
      description: 'Ofertas Membego que compraste y tus beneficios.',
      keywords: ['compras', 'membego', 'ofertas', 'beneficios', 'supply'],
    },
    {
      // SUPPLIER & FULFILLMENT COMMERCE · cada vez que usó un beneficio en un
      // negocio: lo incluido, lo que compró además y su confirmación (§33).
      href: '/cliente/visitas',
      label: 'Mis visitas',
      icon: MapPinCheck,
      description: 'Dónde usaste un beneficio de Membego y qué compraste además.',
      keywords: ['visitas', 'membego', 'consumo', 'confirmar', 'compras adicionales'],
    },
    {
      // Supply · Slice 6: bonos y descuentos que Membego le asignó a esta
      // persona y que rebajan lo que paga al comprar una oferta. No son
      // unidades ya pagadas (eso es «Beneficios Membego») ni promociones que
      // ella compró (eso es «Mis beneficios»): es dinero a su favor.
      href: '/cliente/bonos',
      label: 'Bonos y descuentos',
      icon: BadgePercent,
      description: 'Bonos que Membego te asignó para pagar menos.',
      keywords: ['bonos', 'descuentos', 'beneficio', 'bono', 'subsidio', 'supply'],
    },
    {
      // Supply · Slice 7: los códigos de las campañas. Van aparte de los
      // bonos porque se usan distinto: un cupón se teclea en el checkout.
      href: '/cliente/cupones',
      label: 'Mis cupones',
      icon: TicketPercent,
      description: 'Códigos de las campañas de Membego.',
      keywords: ['cupones', 'cupon', 'codigo', 'promocion', 'campana', 'supply'],
    },
    {
      // Supply · Slice 8: membresía, puntos, recompensas e invitaciones en
      // una entrada. Se llama «fidelización» y no «membresías» porque V1 ya
      // tiene su propia entrada con ese nombre.
      href: '/cliente/fidelizacion',
      label: 'Mi fidelización',
      icon: Gift,
      description: 'Tu membresía, tus puntos y tus recompensas.',
      keywords: ['fidelizacion', 'membresia', 'puntos', 'recompensas', 'invitar', 'referidos', 'supply'],
    },
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
      href: '/superadmin/identidad',
      label: 'Identidad',
      icon: ShieldCheck,
      description: 'Verificación de identidad: casos, incidencias y estado.',
      keywords: ['identidad', 'verificacion', 'cedula', 'kyc', 'selfie', 'incidencias'],
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
      href: '/superadmin/busqueda',
      label: 'Búsqueda',
      icon: TextSearch,
      description: 'Sinónimos globales del buscador.',
      keywords: ['busqueda', 'sinonimos', 'buscador', 'equivalencias'],
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
      href: '/superadmin/supply',
      label: 'Supply',
      icon: PackageSearch,
      description: 'Procurement, pool, ofertas, beneficios, campañas, fidelización y finanzas de proveedores.',
      keywords: ['supply', 'procurement', 'proveedores', 'compras', 'recepciones', 'lotes', 'ofertas', 'beneficios'],
    },
    {
      href: '/superadmin/puente-supply',
      label: 'Puente Supply → Catálogo',
      icon: Link2,
      description: 'Las ofertas de Supply en el catálogo y el descubrimiento: empresa de la casa y sincronización.',
      keywords: ['puente', 'bridge', 'supply', 'catalogo', 'ofertas', 'marketplace', 'sincronizar', 'casa'],
    },
    {
      href: '/superadmin/facturacion',
      label: 'Cobros a empresas',
      icon: Landmark,
      description: 'Merchant Billing: lo que cada empresa debe a Membego — cuentas, comisiones, pagos, ajustes, límites y antigüedad.',
      keywords: ['facturacion', 'cobros', 'comisiones', 'cpa', 'cuentas', 'pagos', 'ajustes', 'credito', 'mora', 'aging', 'estado de cuenta'],
    },
    {
      href: '/superadmin/analitica',
      label: 'Analítica de Membego',
      icon: TrendingUp,
      description: 'GMV, take rate, ventas por empresa y canal, ofertas y salud de los cobros. Supply Economics aparte.',
      keywords: ['analitica', 'gmv', 'take rate', 'toma', 'ventas', 'empresas', 'canales', 'atribucion', 'ofertas', 'ticket', 'salud'],
    },
    {
      href: '/superadmin/conciliacion',
      label: 'Conciliación',
      icon: ListChecks,
      description: 'Si los pedidos, pagos, comisiones, libros, ofertas e inventario cuadran entre sí. Solo lectura.',
      keywords: ['conciliacion', 'cuadre', 'auditoria', 'comisiones', 'libro', 'inventario', 'pagos', 'ofertas', 'integridad', 'anomalias'],
    },
    {
      href: '/superadmin/riesgo',
      label: 'Señales de riesgo',
      icon: ShieldAlert,
      description: 'A qué empresas y clientes conviene llamar primero: cancelaciones, reembolsos, pedidos sin atender, crédito y cupones vencidos.',
      keywords: ['riesgo', 'fraude', 'senales', 'alertas', 'cancelaciones', 'reembolsos', 'credito', 'mora', 'cupones', 'abuso'],
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
  BODEGA: 45,
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
     * Hoy NINGUNA ruta del menú cae aquí, y una prueba lo mantiene así
     * («toda ruta /admin del menú resuelve a una sección conocida», en
     * tests/permisos-empleado.test.ts). Las tres que caían —`/admin/facturas`,
     * `/admin/sinonimos` y `/admin/crm`— ya son secciones o resuelven a una.
     *
     * La rama se queda igualmente: es el fail-closed para una ruta de /admin
     * que llegue por URL sin pasar por el menú. Si vuelve a aparecer una en el
     * menú, salta la prueba antes que esto.
     *
     * `/admin/facturas` estaba en este mismo caso y ya salió: hoy es la
     * sección `facturas`. Lo que sí hace falta decir es que un ajuste por
     * empleado NO puede regular lo que quede aquí: sin sección, no hay nada
     * que conceder ni negar.
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

/** ¿Se le ofrece esta pestaña a esta persona? Su sección, su capacidad, su vertical y, si la pantalla la pide, su función. */
function pestanaVisible(p: NavPestana, ctx: ContextoNav): boolean {
  if (ctx.ocultas?.includes(p.href)) return false
  if (!capacidadVisible(p.capacidad, ctx)) return false
  if (!tipoVisible(p.tiposEmpresa, ctx)) return false
  if (!seccionVisible(p.href, ctx)) return false
  if (p.funcion) {
    const seccion = adminSectionForPath(p.href)
    if (seccion && !funcionPermitida(ctx.role, seccion, p.funcion, ctx.permisos)) return false
  }
  return true
}

/**
 * LA ENTRADA TAL COMO LA VE ESTA PERSONA, o null si no ve ninguna parte de ella.
 *
 * Sin pestañas es lo de siempre (`canSeeItem`). Con pestañas, la entrada se queda con las que SÍ ve y aterriza en la primera
 * (03 · C.3): su `href` pasa a ser el de esa pestaña, y los de todas las demás se suman a sus prefijos para que migas y
 * resaltado sigan resolviendo la ruta. Es la misma regla con la que `visibleGroups` ya trataba a los grupos: lo que queda
 * vacío no se pinta. La visibilidad es cosmética; la barrera de cada ruta sigue siendo su guardia de servidor.
 */
function entradaVisible(item: NavLink, ctx: ContextoNav): NavLink | null {
  if (!item.pestanas) return canSeeItem(item, ctx) ? item : null
  if (item.roles && !item.roles.includes(ctx.role)) return null
  if (item.rangoMinimo !== undefined && rankOf(ctx.role) < item.rangoMinimo) return null
  if (!capacidadVisible(item.capacidad, ctx)) return null
  if (!tipoVisible(item.tiposEmpresa, ctx)) return null
  const visibles = item.pestanas.filter((p) => pestanaVisible(p, ctx))
  const primera = visibles[0]
  if (!primera) return null
  return {
    ...item,
    href: primera.href,
    pestanas: visibles,
    prefijos: [
      ...(item.prefijos ?? []),
      item.href,
      ...visibles.flatMap((p) => [p.href, ...(p.prefijos ?? [])]),
    ],
  }
}

/** ¿Se le ofrece este módulo a esta persona? Con pestañas, basta con que vea una. */
export function canSeeItem(item: NavLink, ctx: ContextoNav): boolean {
  if (item.pestanas) return entradaVisible(item, ctx) !== null
  if (item.roles && !item.roles.includes(ctx.role)) return false
  if (item.rangoMinimo !== undefined && rankOf(ctx.role) < item.rangoMinimo) return false
  if (ctx.ocultas?.includes(item.href)) return false
  if (!capacidadVisible(item.capacidad, ctx)) return false
  if (!tipoVisible(item.tiposEmpresa, ctx)) return false
  return seccionVisible(item.href, ctx)
}

/** Los grupos del espacio que quedan con al menos un módulo visible, con cada módulo ya resuelto para esta persona. */
export function visibleGroups(workspace: Workspace, ctx: ContextoNav): NavGroup[] {
  return workspace.groups
    .map((g) => ({ ...g, items: g.items.flatMap((it) => entradaVisible(it, ctx) ?? []) }))
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
  return espaciosDe(ctx)
    .filter((w) => canSeeWorkspace(w, ctx))
    .map((w) => ({ ...w, groups: visibleGroups(w, ctx) }))
}

/**
 * Los espacios de los que parte el menú de esta persona.
 *
 * `workspacesForRole` reparte por rol, y a un rol de mostrador le da el
 * mostrador: los espacios del panel NO ESTÁN EN SU ÁRBOL. Por eso conceder
 * Clientes a un empleado no le enseñaba nada — no es que el módulo se
 * filtrara, es que no había dónde filtrarlo.
 *
 * Con alguna sección concedida se le suman los espacios del panel, y de ahí
 * en adelante manda el filtro de siempre: `visibleGroups` deja solo los
 * módulos permitidos y un espacio sin ninguno no se pinta. Un empleado con
 * Clientes concedido ve Clientes, y nada más.
 *
 * NO HACE FALTA AFLOJAR NADA MÁS, y se comprobó: probé además a saltarme el
 * rol y el rango del item y del espacio para quien tuviera concesiones, y las
 * pruebas seguían pasando con y sin ello — porque hoy ningún módulo ni
 * espacio del menú declara `roles` ni `rangoMinimo`. Era código que no hacía
 * nada, con una prueba que no podía fallar. Fuera los dos.
 */
function espaciosDe(ctx: ContextoNav): Workspace[] {
  // Supplier Lite (§6): una empresa SOLO proveedora no ve el Business OS.
  // Vale para cualquier rol del panel y para el superadmin que la opera.
  if (ctx.soloProveedor && ctx.scope === 'COMPANY') return [ESPACIO_PROVEEDOR]
  const base = workspacesForRole(ctx.role)
  // El espacio del proveedor se SUMA solo cuando la capacidad se leyó y está
  // encendida: no es un módulo que una empresa pierda si falla una consulta
  // (el fail-open de las capacidades no aplica a lo que se añade).
  const esProveedora = ctx.capacidades?.includes('MEMBEGO_SUPPLIER') === true
  const conProveedor = (ws: Workspace[]) => (esProveedora && ctx.scope === 'COMPANY' && !ws.includes(ESPACIO_PROVEEDOR) ? [...ws, ESPACIO_PROVEEDOR] : ws)
  if (ADMIN_ROLES.includes(ctx.role) || !tieneAlgunaConcesion(ctx)) return conProveedor(base)
  const yaEstan = new Set(base.map((w) => w.id))
  return conProveedor([...base, ...ESPACIOS_ADMIN.filter((w) => !yaEstan.has(w.id))])
}

/** ¿Tiene concedida ALGUNA sección? Abre el árbol; el contenido se filtra aparte. */
function tieneAlgunaConcesion(ctx: ContextoNav): boolean {
  return Object.values(ctx.permisos?.secciones ?? {}).some((v) => v === true)
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

// ── Pestañas de módulo ──────────────────────────────────────────────────────

/** La pestaña de un módulo a la que pertenece una ruta: la de prefijo más largo. */
function pestanaDeRuta(item: NavLink, pathname: string): NavPestana | null {
  let mejor: NavPestana | null = null
  let largo = -1
  for (const p of item.pestanas ?? []) {
    for (const prefijo of [p.href, ...(p.prefijos ?? [])]) {
      if (casaPrefijo(pathname, prefijo) && prefijo.length > largo) {
        mejor = p
        largo = prefijo.length
      }
    }
  }
  return mejor
}

/** Una pestaña ya resuelta para pintar la barra del módulo. */
export interface PestanaPintable {
  label: string
  href: string
  activa: boolean
}

export interface BarraDeModulo {
  /** El módulo al que pertenece la ruta («Pagos»). */
  modulo: string
  pestanas: PestanaPintable[]
}

/**
 * LA BARRA DE PESTAÑAS QUE LE TOCA A UNA RUTA, o null si no le toca ninguna.
 *
 * No hay una barra por módulo escrita en cada layout: las pestañas de un módulo viven en carpetas distintas (`/admin/pagos`,
 * `/admin/registros`, `/admin/conciliacion`…), así que ningún layout las envolvería a todas. La carcasa pregunta aquí por la
 * ruta actual y pinta lo que le digan; quien añade una pestaña la declara en el módulo y aparece en todas sus pantallas.
 *
 * Solo se pinta con DOS o más pestañas visibles (una sola no es una barra), y no si la pantalla trae las suyas (`sinBarra`).
 * Las pestañas ya llegan filtradas por sección, capacidad y función: lo que no se puede abrir no se ofrece.
 */
export function pestanasDeModulo(pathname: string, ctx: ContextoNav): BarraDeModulo | null {
  const m = mejorCoincidencia(pathname, ctx)
  const item = m?.item
  if (!item || !item.pestanas || item.sinBarra || item.pestanas.length < 2) return null
  const actual = pestanaDeRuta(item, pathname)
  if (!actual) return null
  return {
    modulo: item.label,
    pestanas: item.pestanas.map((p) => ({ label: p.label, href: p.href, activa: p === actual })),
  }
}

/**
 * Los destinos que ofrece una entrada: ella misma y cada una de sus otras pestañas como un destino propio («Pagos › Conciliación»).
 * Es lo que permite que el buscador y la paleta lleven DIRECTO a una pantalla que ya no tiene entrada de menú.
 */
export function destinosDe(item: NavLink): NavLink[] {
  const otras = (item.pestanas ?? []).slice(1)
  return [
    item,
    ...otras.map<NavLink>((p) => ({
      href: p.href,
      label: `${item.label} › ${p.label}`,
      icon: item.icon,
      description: p.description ?? item.description,
      keywords: p.keywords,
    })),
  ]
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

  // La PESTAÑA no es una miga: la barra del módulo ya dice cuál es la activa, y una cuarta miga («Empresa › Operaciones › Pagos ›
  // Conciliación») no cabe junto al buscador. Las migas llegan hasta el módulo; la pestaña la marca la barra.

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
      group.items.flatMap(destinosDe).map((item) => ({ item, workspace, group }))
    )
  )
}

/**
 * TODAS las rutas que el menú le ofrece a esta persona: cada entrada y cada una de sus pestañas visibles. Es lo que hay que
 * preguntar para saber si una pantalla «está en el menú»: con módulos de pestañas, el `href` de una entrada solo dice a dónde
 * aterriza, no todo lo que contiene.
 */
export function rutasOfrecidas(ctx: ContextoNav): string[] {
  return modulosVisibles(ctx).map((r) => r.item.href)
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
    .map((g) => ({
      ...g,
      items: g.items.flatMap((it) =>
        it.pestanas
          ? (entradaVisible(it, ctx) ?? [])
          : (!it.roles || it.roles.includes(role)) && seccionVisible(it.href, ctx)
            ? [it]
            : []
      ),
    }))
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
    case 'BODEGA':
      return 'Bodega'
    case 'VENDEDOR':
      return 'Vendedor'
    default:
      return 'Administrador'
  }
}
