import type { AdminSection } from '@/lib/auth/permissions'

/**
 * Plataforma modular · E1 (docs/ESTRATEGIA-PLATAFORMA.md) — CATÁLOGO v1.
 *
 * Fuente de verdad de qué categorías de negocio y qué capacidades existen.
 * PURO (sin Prisma): lo consumen el resolutor, el panel de capacidades (E4)
 * y la navegación (E2). Agregar una categoría o capacidad nueva empieza y
 * termina aquí + su paquete base.
 */

// ── Categorías ───────────────────────────────────────────────────────────────

/** Solo CAR_WASH está operativa; las demás son valores reservados (E6+). */
export const CATEGORIAS = ['CAR_WASH', 'BARBERIA', 'RESTAURANTE', 'GYM'] as const
export type CategoriaNegocio = (typeof CATEGORIAS)[number]

export const CATEGORIA_LABELS: Record<CategoriaNegocio, string> = {
  CAR_WASH: 'Car Wash',
  BARBERIA: 'Barbería / Salón',
  RESTAURANTE: 'Restaurante',
  GYM: 'Gimnasio',
}

/**
 * Mapea el `Company.type` legacy ("carwash" | "restaurante" | …) a la
 * categoría del catálogo. Desconocido → CAR_WASH (la única operativa), que
 * junto al paquete base completo garantiza el fail-open.
 */
export function categoriaDeType(type: string | null | undefined): CategoriaNegocio {
  switch ((type ?? '').toLowerCase()) {
    case 'restaurante':
      return 'RESTAURANTE'
    case 'barberia':
    case 'salon':
      return 'BARBERIA'
    case 'gym':
    case 'gimnasio':
      return 'GYM'
    default:
      return 'CAR_WASH'
  }
}

// ── Capacidades ──────────────────────────────────────────────────────────────

export const CAPACIDADES = [
  /** Interruptor D7: launchpad + shell de la app (E2). Nace APAGADA. */
  'NAVEGACION_V2',
  'CITAS',
  'SEGUIMIENTO',
  /** Ruleta de premios (sección gamificación). */
  'RULETA',
  'GIFT_CARDS',
  /** Las recompensas gratis exigen cita para habilitar su QR. */
  'CITA_ANTES_DEL_QR',
  'POS_CAJA',
  // Futuras del Car Wash (P2 · E5). Nacen APAGADAS.
  'INVENTARIO',
  'COLA_VEHICULOS',
  'EVIDENCIA_FOTOS',
] as const
export type Capacidad = (typeof CAPACIDADES)[number]

export const CAPACIDAD_LABELS: Record<Capacidad, string> = {
  NAVEGACION_V2: 'Navegación de dos niveles (launchpad + app)',
  CITAS: 'Citas / agenda en línea',
  SEGUIMIENTO: 'Seguimiento de recompensas gratis',
  RULETA: 'Ruleta de premios',
  GIFT_CARDS: 'Gift cards de monto abierto',
  CITA_ANTES_DEL_QR: 'Cita obligatoria antes del QR del regalo',
  POS_CAJA: 'Caja / punto de venta',
  INVENTARIO: 'Inventario de productos',
  COLA_VEHICULOS: 'Cola de vehículos del día',
  EVIDENCIA_FOTOS: 'Fotos antes/después y control de daños',
}

/**
 * Secciones del panel /admin que cada capacidad controla. Una sección que NO
 * aparece aquí no depende de ninguna capacidad (siempre permitida) — así el
 * núcleo (clientes, membresías, pagos…) jamás puede apagarse por error.
 */
export const SECCIONES_POR_CAPACIDAD: Partial<Record<Capacidad, AdminSection[]>> = {
  CITAS: ['citas'],
  SEGUIMIENTO: ['seguimiento'],
  RULETA: ['gamificacion'],
}

/** Índice inverso sección → capacidad que la controla (o undefined). */
export const CAPACIDAD_DE_SECCION: Partial<Record<AdminSection, Capacidad>> = Object.fromEntries(
  Object.entries(SECCIONES_POR_CAPACIDAD).flatMap(([cap, secciones]) =>
    (secciones ?? []).map((s) => [s, cap as Capacidad])
  )
)

/**
 * Paquete BASE de capacidades por categoría: lo que una empresa de esa
 * categoría tiene encendido sin configurar nada. Para CAR_WASH incluye TODO
 * lo que hoy está activo en producción (fail-open del D4); lo nuevo
 * (NAVEGACION_V2, INVENTARIO, COLA, EVIDENCIA) nace apagado.
 */
export const CAPACIDADES_BASE: Record<CategoriaNegocio, Capacidad[]> = {
  CAR_WASH: ['CITAS', 'SEGUIMIENTO', 'RULETA', 'GIFT_CARDS', 'CITA_ANTES_DEL_QR', 'POS_CAJA'],
  BARBERIA: ['CITAS', 'SEGUIMIENTO', 'RULETA', 'GIFT_CARDS', 'POS_CAJA'],
  RESTAURANTE: ['CITAS', 'SEGUIMIENTO', 'RULETA', 'GIFT_CARDS', 'POS_CAJA'],
  GYM: ['CITAS', 'SEGUIMIENTO', 'RULETA', 'GIFT_CARDS', 'POS_CAJA'],
}

// ── Configuración guardada (companies.capacidades) ───────────────────────────

export interface CapacidadesConfig {
  /** Override de categoría; ausente = derivada de Company.type. */
  categoria?: CategoriaNegocio
  /** Encendidos/apagados puntuales sobre el paquete base. */
  overrides?: Partial<Record<Capacidad, boolean>>
}

/** Normaliza el JSON guardado (tolerante a null/basura/valores desconocidos). */
export function resolverConfig(raw: unknown): CapacidadesConfig {
  const cfg = (raw ?? {}) as { categoria?: unknown; overrides?: unknown }
  const categoria = (CATEGORIAS as readonly string[]).includes(String(cfg.categoria))
    ? (cfg.categoria as CategoriaNegocio)
    : undefined
  const overrides: Partial<Record<Capacidad, boolean>> = {}
  if (cfg.overrides && typeof cfg.overrides === 'object') {
    for (const [k, v] of Object.entries(cfg.overrides as Record<string, unknown>)) {
      if ((CAPACIDADES as readonly string[]).includes(k) && typeof v === 'boolean') {
        overrides[k as Capacidad] = v
      }
    }
  }
  return { categoria, overrides }
}

/** Capacidades efectivas: paquete base de la categoría + overrides. */
export function capacidadesEfectivas(
  type: string | null | undefined,
  raw: unknown
): { categoria: CategoriaNegocio; activas: Set<Capacidad> } {
  const config = resolverConfig(raw)
  const categoria = config.categoria ?? categoriaDeType(type)
  const activas = new Set<Capacidad>(CAPACIDADES_BASE[categoria])
  for (const [cap, on] of Object.entries(config.overrides ?? {})) {
    if (on) activas.add(cap as Capacidad)
    else activas.delete(cap as Capacidad)
  }
  return { categoria, activas }
}
