import type { Capacidad, CategoriaNegocio } from '@/modules/capacidades/catalogo'

/**
 * Plataforma modular · E6 — CATÁLOGO DE APLICACIONES (docs/ESTRATEGIA-PLATAFORMA.md).
 *
 * La prueba de fuego de la arquitectura: montar una categoría nueva debe ser
 * AGREGAR UNA ENTRADA AQUÍ, sin escribir módulos ni tocar el núcleo. Antes de
 * E6 la app Car Wash estaba cableada a mano en tres sitios (launchpad, shell y
 * ocultamiento del menú); ahora los tres LEEN de este archivo.
 *
 * PURO (sin Prisma, sin React): lo consumen el launchpad (E2), el shell
 * genérico `/admin/app/[app]` y el layout de /admin.
 */

/** Iconos permitidos: nombres de lucide-react resueltos en la UI. */
export type IconoApp =
  | 'Car'
  | 'Scissors'
  | 'ScanLine'
  | 'CalendarDays'
  | 'QrCode'
  | 'Building2'
  | 'Banknote'
  | 'PackageSearch'
  | 'ListOrdered'
  | 'Camera'
  | 'Users'
  | 'Sparkles'
  | 'BarChart3'
  | 'Wallet'
  | 'ShieldAlert'
  | 'ShoppingCart'
  | 'Wrench'
  | 'Clock'

export interface ModuloApp {
  /** Etiqueta en el menú de la app. */
  label: string
  descripcion: string
  icon: IconoApp
  /** Pantalla a la que lleva (regla D5: NUNCA se mueven las URLs existentes). */
  href: string
  /**
   * Capacidad requerida. Si está apagada y `proximamente` es true, el módulo
   * se ve deshabilitado ("próximamente"); si es false, no se muestra.
   */
  capacidad?: Capacidad
  /** Mostrarlo deshabilitado en vez de ocultarlo cuando falta la capacidad. */
  proximamente?: boolean
}

export interface AplicacionNegocio {
  /** Segmento de URL: /admin/app/<slug>. */
  slug: string
  nombre: string
  descripcion: string
  icon: IconoApp
  /** Módulos del menú de la app, en orden. */
  modulos: ModuloApp[]
  /**
   * Entradas del menú lateral de MembeGo que se OCULTAN cuando esta app está
   * activa (NAVEGACION_V2 encendida): ya viven dentro de la app.
   */
  navOculta: string[]
}

// ── Módulos compartidos entre apps de servicios ──────────────────────────────
// Todas las categorías con agenda + servicios + membresías usan los mismos
// motores; solo cambia el vocabulario y los módulos propios de cada oficio.

const ESCANER: ModuloApp = {
  label: 'Escanear QR',
  descripcion: 'Canjes y visitas en el mostrador',
  icon: 'ScanLine',
  href: '/admin/scanner',
}

const CITAS: ModuloApp = {
  label: 'Citas',
  descripcion: 'Agenda y turnos del día',
  icon: 'CalendarDays',
  href: '/admin/citas',
  capacidad: 'CITAS',
}

const SEGUIMIENTO: ModuloApp = {
  label: 'Seguimiento',
  descripcion: 'Recompensas gratis: quién no ha venido',
  icon: 'QrCode',
  href: '/admin/seguimiento',
  capacidad: 'SEGUIMIENTO',
}

const SUCURSALES: ModuloApp = {
  label: 'Sucursales',
  descripcion: 'Puntos de servicio',
  icon: 'Building2',
  href: '/admin/sucursales',
}

const CAJA: ModuloApp = {
  label: 'Caja',
  descripcion: 'Cobros y órdenes del día',
  icon: 'Banknote',
  href: '/empleado/caja',
  capacidad: 'POS_CAJA',
}

const NAV_SERVICIOS = ['/admin/scanner', '/admin/citas', '/admin/seguimiento', '/admin/sucursales']

// ── Catálogo por categoría ───────────────────────────────────────────────────

export const APPS_POR_CATEGORIA: Partial<Record<CategoriaNegocio, AplicacionNegocio>> = {
  CAR_WASH: {
    slug: 'carwash',
    nombre: 'Car Wash',
    descripcion:
      'La operación de la pista: escáner, citas, seguimiento de lavados, vehículos, sucursales y caja.',
    icon: 'Car',
    modulos: [
      {
        label: 'Catálogo de la pista',
        descripcion: 'Servicios, precios por vehículo y bahías',
        icon: 'Sparkles',
        href: '/admin/app/carwash/catalogo',
      },
      ESCANER,
      CITAS,
      SEGUIMIENTO,
      {
        label: 'Clientes de la pista',
        descripcion: 'Con cuenta o de mostrador, buscables por placa',
        icon: 'Users',
        href: '/admin/app/carwash/clientes',
      },
      {
        label: 'Vehículos',
        descripcion: 'Busca por placa, marca o dueño',
        icon: 'Car',
        href: '/admin/app/carwash/vehiculos',
      },
      SUCURSALES,
      CAJA,
      {
        label: 'Reportes operativos',
        descripcion: 'Cómo nos fue: vehículos, tiempos y consumo',
        icon: 'BarChart3',
        href: '/admin/app/carwash/reportes',
      },
      {
        label: 'Cola de vehículos',
        descripcion: 'Estado de cada vehículo en pista',
        icon: 'ListOrdered',
        href: '/admin/app/carwash/cola',
        capacidad: 'COLA_VEHICULOS',
        proximamente: true,
      },
      {
        label: 'Inventario',
        descripcion: 'Productos, químicos y existencias',
        icon: 'PackageSearch',
        href: '/admin/app/carwash/inventario',
        capacidad: 'INVENTARIO',
        proximamente: true,
      },
      {
        label: 'Fotos antes/después',
        descripcion: 'Evidencia y control de daños',
        icon: 'Camera',
        href: '/admin/app/carwash/evidencias',
        capacidad: 'EVIDENCIA_FOTOS',
        proximamente: true,
      },
      // ── Fase 2 · lo que da dinero ───────────────────────────────────────
      {
        label: 'Cuentas corporativas',
        descripcion: 'Flotillas que pagan a crédito',
        icon: 'Building2',
        href: '/admin/app/carwash/cuentas',
        capacidad: 'CUENTAS_CORPORATIVAS',
        proximamente: true,
      },
      {
        label: 'Comisiones',
        descripcion: 'Lo que se le debe a cada lavador',
        icon: 'Wallet',
        href: '/admin/app/carwash/comisiones',
        capacidad: 'COMISIONES',
        proximamente: true,
      },
      {
        label: 'Incidencias y rewash',
        descripcion: 'Daños, quejas y trabajos repetidos',
        icon: 'ShieldAlert',
        href: '/admin/app/carwash/incidencias',
        capacidad: 'INCIDENCIAS',
        proximamente: true,
      },
      // ── Fase 3 · que la operación no se caiga ───────────────────────────
      {
        label: 'Compras',
        descripcion: 'Proveedores y órdenes de compra',
        icon: 'ShoppingCart',
        href: '/admin/app/carwash/compras',
        capacidad: 'COMPRAS',
        proximamente: true,
      },
      {
        label: 'Equipos',
        descripcion: 'Mantenimiento y tiempo parado',
        icon: 'Wrench',
        href: '/admin/app/carwash/activos',
        capacidad: 'ACTIVOS',
        proximamente: true,
      },
      {
        label: 'Turnos',
        descripcion: 'Asistencia y costo por lavado',
        icon: 'Clock',
        href: '/admin/app/carwash/turnos',
        capacidad: 'TURNOS',
        proximamente: true,
      },
    ],
    navOculta: NAV_SERVICIOS,
  },

  /**
   * E6 · Segunda categoría. Se monta SOLO con esta entrada: mismos motores
   * (agenda, recompensas, caja, clientes) con el vocabulario del oficio. No
   * hay módulos nuevos ni columnas nuevas — si hiciera falta escribir código
   * para lograrlo, la arquitectura tendría una fuga.
   */
  BARBERIA: {
    slug: 'barberia',
    nombre: 'Barbería',
    descripcion:
      'La operación del salón: escáner, citas, seguimiento de servicios gratis, clientes y caja.',
    icon: 'Scissors',
    modulos: [
      ESCANER,
      CITAS,
      SEGUIMIENTO,
      {
        label: 'Clientes',
        descripcion: 'Fichas, historial y notas',
        icon: 'Users',
        href: '/admin/clientes',
      },
      SUCURSALES,
      CAJA,
    ],
    navOculta: NAV_SERVICIOS,
  },
}

/** App de una categoría (undefined si la categoría aún no tiene app). */
export function appDeCategoria(categoria: CategoriaNegocio): AplicacionNegocio | undefined {
  return APPS_POR_CATEGORIA[categoria]
}

/** App por su slug de URL (para el shell genérico /admin/app/[app]). */
export function appPorSlug(slug: string): AplicacionNegocio | undefined {
  return Object.values(APPS_POR_CATEGORIA).find((a) => a.slug === slug)
}

/** Slugs válidos: alimenta `generateStaticParams` y la validación de rutas. */
export function slugsDeApps(): string[] {
  return Object.values(APPS_POR_CATEGORIA).map((a) => a.slug)
}
