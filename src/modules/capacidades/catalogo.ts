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
 * Categoría RECONOCIDA en el `Company.type` legacy, o null si el texto no dice
 * nada que el catálogo entienda ("otro", vacío, un tipo inventado).
 *
 * Existe separada de `categoriaDeType` porque las dos preguntas que se le hacen
 * al tipo de negocio necesitan respuestas OPUESTAS ante la duda:
 *
 * - "¿qué módulos le enciendo?" → ante la duda, TODOS (fail-open: una empresa
 *   viva no puede perder funciones porque su `type` esté mal escrito).
 * - "¿le exijo un vehículo al cliente?" → ante la duda, NO. Un requisito es una
 *   PUERTA CERRADA: darlo por supuesto le pedía la placa del carro al cliente de
 *   un restaurante, que es como se descubrió que este default estaba mal.
 *
 * Por eso el desconocido cae en null aquí y en CAR_WASH allá.
 */
/**
 * Categoría desde el VERTICAL de la plataforma (`Company.tipoNegocioCodigo`,
 * el campo que asigna el superadmin desde la interfaz). Sus códigos son los
 * mismos de `CATEGORIAS` ('CAR_WASH', 'RESTAURANTE', …) por diseño.
 *
 * Existe porque conviven DOS sistemas de categoría: este (moderno, afirmado a
 * mano) y el `type` heredado (texto libre de la creación de la empresa). El
 * bug que lo destapó: el superadmin asignaba el vertical Restaurante, la
 * pantalla lo mostraba, y el registro seguía pidiendo vehículo porque leía el
 * `type` viejo que aún decía carwash. La pantalla y la decisión miraban campos
 * distintos.
 */
export function categoriaDeVertical(
  codigo: string | null | undefined
): CategoriaNegocio | null {
  const c = (codigo ?? '').trim().toUpperCase()
  return (CATEGORIAS as readonly string[]).includes(c) ? (c as CategoriaNegocio) : null
}

export function categoriaExplicitaDeType(
  type: string | null | undefined
): CategoriaNegocio | null {
  switch ((type ?? '').trim().toLowerCase()) {
    case 'carwash':
    case 'car wash':
    case 'car-wash':
    // El código CANÓNICO del vertical: el formulario de edición del superadmin
    // guarda en `type` el código del catálogo ('CAR_WASH'), y esta función lo
    // recibía en minúsculas ('car_wash') sin reconocerlo — un car wash real
    // editado desde ahí perdía el requisito de vehículo sin que nadie lo viera.
    case 'car_wash':
    case 'lavado':
    case 'lavadero':
    case 'autolavado':
      return 'CAR_WASH'
    case 'restaurante':
    case 'restaurant':
      return 'RESTAURANTE'
    case 'barberia':
    case 'barbería':
    case 'salon':
    case 'salón':
    case 'peluqueria':
    case 'peluquería':
      return 'BARBERIA'
    case 'gym':
    case 'gimnasio':
      return 'GYM'
    default:
      return null
  }
}

/**
 * Mapea el `Company.type` legacy ("carwash" | "restaurante" | …) a la
 * categoría del catálogo. Desconocido → CAR_WASH (la única operativa), que
 * junto al paquete base completo garantiza el fail-open.
 *
 * Para decidir REQUISITOS (¿pido vehículo?) usa `categoriaExplicitaDeType`:
 * este default no sirve para cerrar puertas, solo para no cerrar ninguna.
 */
export function categoriaDeType(type: string | null | undefined): CategoriaNegocio {
  return categoriaExplicitaDeType(type) ?? 'CAR_WASH'
}

/**
 * Categorías cuya operación gira alrededor de un vehículo: son las únicas que
 * pueden exigirle uno al cliente antes de venderle. Una categoría fuera de esta
 * lista —o desconocida— jamás pide placa.
 */
export const CATEGORIAS_CON_VEHICULO: readonly CategoriaNegocio[] = ['CAR_WASH']

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
  /// Pagos en línea: qué métodos se ofrecen al cliente para compras NUEVAS.
  /// Apagar TRANSFERENCIA no rompe las compras que ya están esperando su
  /// comprobante — solo deja de ofrecerla de aquí en adelante.
  'PAGO_TRANSFERENCIA',
  'PAGO_CARDNET',
  // Futuras del Car Wash (P2 · E5). Nacen APAGADAS.
  'INVENTARIO',
  'COLA_VEHICULOS',
  'EVIDENCIA_FOTOS',
  // Car Wash · Fase 2. Nacen APAGADAS. COMISIONES además no devenga nada
  // hasta que se llenen las tarifas por servicio: encenderla no mueve dinero
  // sola.
  'CUENTAS_CORPORATIVAS',
  'COMISIONES',
  'INCIDENCIAS',
  // Car Wash · Fase 3 (que la operación no se caiga). Nacen APAGADAS.
  'COMPRAS',
  'ACTIVOS',
  'TURNOS',
] as const
export type Capacidad = (typeof CAPACIDADES)[number]

export const CAPACIDAD_LABELS: Record<Capacidad, string> = {
  NAVEGACION_V2: 'Navegación de dos niveles (launchpad + app)',
  CITAS: 'Citas / agenda en línea',
  SEGUIMIENTO: 'Seguimiento de recompensas gratis',
  RULETA: 'Ruleta de premios',
  GIFT_CARDS: 'Gift cards de monto abierto',
  CITA_ANTES_DEL_QR: 'Invitar a agendar cita al adquirir un beneficio',
  POS_CAJA: 'Caja / punto de venta',
  PAGO_TRANSFERENCIA: 'Cobrar por transferencia bancaria',
  PAGO_CARDNET: 'Cobrar con tarjeta (pasarela CardNET)',
  INVENTARIO: 'Inventario de productos',
  COLA_VEHICULOS: 'Cola de vehículos del día',
  EVIDENCIA_FOTOS: 'Fotos antes/después y control de daños',
  CUENTAS_CORPORATIVAS: 'Cuentas corporativas y flotillas (cobro a crédito)',
  COMISIONES: 'Comisiones por lavador',
  INCIDENCIAS: 'Incidencias, daños y rewash',
  COMPRAS: 'Proveedores y órdenes de compra',
  ACTIVOS: 'Equipos y mantenimiento',
  TURNOS: 'Turnos y asistencia',
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
  CAR_WASH: ['PAGO_TRANSFERENCIA', 'CITAS', 'SEGUIMIENTO', 'RULETA', 'GIFT_CARDS', 'CITA_ANTES_DEL_QR', 'POS_CAJA'],
  BARBERIA: ['PAGO_TRANSFERENCIA', 'CITAS', 'SEGUIMIENTO', 'RULETA', 'GIFT_CARDS', 'POS_CAJA'],
  RESTAURANTE: ['PAGO_TRANSFERENCIA', 'CITAS', 'SEGUIMIENTO', 'RULETA', 'GIFT_CARDS', 'POS_CAJA'],
  GYM: ['PAGO_TRANSFERENCIA', 'CITAS', 'SEGUIMIENTO', 'RULETA', 'GIFT_CARDS', 'POS_CAJA'],
}

// ── Configuración guardada (companies.capacidades) ───────────────────────────

export interface CapacidadesConfig {
  /** Override de categoría; ausente = derivada de Company.type. */
  categoria?: CategoriaNegocio
  /** Encendidos/apagados puntuales sobre el paquete base. */
  overrides?: Partial<Record<Capacidad, boolean>>
  /** Forzados de visibilidad de los módulos del cliente (ausente = AUTO). */
  modulosCliente?: Partial<Record<ModuloCliente, VisibilidadModulo>>
}

/** Normaliza el JSON guardado (tolerante a null/basura/valores desconocidos). */
export function resolverConfig(raw: unknown): CapacidadesConfig {
  const cfg = (raw ?? {}) as {
    categoria?: unknown
    overrides?: unknown
    modulosCliente?: unknown
  }
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
  const modulosCliente: Partial<Record<ModuloCliente, VisibilidadModulo>> = {}
  if (cfg.modulosCliente && typeof cfg.modulosCliente === 'object') {
    for (const [k, v] of Object.entries(cfg.modulosCliente as Record<string, unknown>)) {
      if (
        (MODULOS_CLIENTE as readonly string[]).includes(k) &&
        (VISIBILIDADES as readonly string[]).includes(String(v))
      ) {
        modulosCliente[k as ModuloCliente] = v as VisibilidadModulo
      }
    }
  }
  return { categoria, overrides, modulosCliente }
}

/** Capacidades efectivas: paquete base de la categoría + overrides. */
export function capacidadesEfectivas(
  type: string | null | undefined,
  raw: unknown,
  /**
   * `Company.tipoNegocioCodigo` — el vertical moderno. Opcional: quien no lo
   * pase se comporta exactamente como antes. Quien lo pase hace que la
   * afirmación del superadmin GANE sobre el `type` heredado de la creación.
   */
  tipoNegocioCodigo?: string | null
): {
  categoria: CategoriaNegocio
  /** null = el tipo de negocio no dice nada reconocible (ver arriba el porqué). */
  categoriaExplicita: CategoriaNegocio | null
  activas: Set<Capacidad>
  modulosCliente: Partial<Record<ModuloCliente, VisibilidadModulo>>
} {
  const config = resolverConfig(raw)
  // Una categoría elegida a mano en el panel SÍ es explícita: alguien la
  // afirmó. Lo que no vale como afirmación es el default de un `type` ilegible.
  const categoriaExplicita =
    config.categoria ?? categoriaDeVertical(tipoNegocioCodigo) ?? categoriaExplicitaDeType(type)
  const categoria = categoriaExplicita ?? categoriaDeType(type)
  const activas = new Set<Capacidad>(CAPACIDADES_BASE[categoria])
  for (const [cap, on] of Object.entries(config.overrides ?? {})) {
    if (on) activas.add(cap as Capacidad)
    else activas.delete(cap as Capacidad)
  }
  return { categoria, categoriaExplicita, activas, modulosCliente: config.modulosCliente ?? {} }
}

// ── Módulos del CLIENTE ──────────────────────────────────────────────────────

/**
 * Lo que el cliente ve en el menú de SU empresa.
 *
 * Es un eje distinto al de las capacidades: aquéllas dicen qué puede HACER el
 * negocio por dentro; éstos, de qué se le HABLA al cliente. Un negocio que
 * todavía no publicó un solo plan no debería tener una sección "Planes" que
 * abre en vacío, ni una que le pida datos para comprar algo que no existe:
 * un módulo vacío no es una promesa, es una puerta que no lleva a ningún sitio.
 *
 * La regla por defecto es AUTOMÁTICA (hay contenido → se ve). El forzado existe
 * para los dos casos que el dato no puede adivinar: enseñar algo el día antes de
 * lanzarlo, y esconder algo que existe pero no se quiere ofrecer todavía.
 */
export const MODULOS_CLIENTE = [
  'MEMBRESIAS',
  'OFERTAS',
  'BENEFICIOS',
  'REGALOS',
  'INVITA_Y_GANA',
  'RULETA',
  'CITAS',
  'VEHICULOS',
] as const
export type ModuloCliente = (typeof MODULOS_CLIENTE)[number]

export const MODULO_CLIENTE_LABELS: Record<ModuloCliente, string> = {
  MEMBRESIAS: 'Planes y mis membresías',
  OFERTAS: 'Ofertas del negocio',
  BENEFICIOS: 'Mis beneficios comprados',
  REGALOS: 'Regalos y gift cards',
  INVITA_Y_GANA: 'Invita y Gana',
  RULETA: 'Ruleta de premios',
  CITAS: 'Mis citas',
  VEHICULOS: 'Mis vehículos',
}

/** Qué se le enseña al negocio como criterio automático de cada módulo. */
export const MODULO_CLIENTE_AUTO: Record<ModuloCliente, string> = {
  MEMBRESIAS: 'Se ve si la empresa tiene planes activos o el cliente ya tiene una membresía.',
  OFERTAS: 'Se ve si la empresa tiene promociones vigentes.',
  BENEFICIOS: 'Se ve si el cliente compró beneficios o recibió regalos VIP.',
  REGALOS: 'Se ve si el negocio permite regalar o el cliente ya envió/recibió alguno.',
  INVITA_Y_GANA: 'Se ve si hay una campaña de invitación activa y el programa premia algo.',
  RULETA: 'Se ve si hay premios activos configurados.',
  CITAS: 'Se ve si la agenda está encendida o el cliente ya tiene citas.',
  VEHICULOS: 'Se ve si el negocio trabaja con vehículos o el cliente ya registró uno.',
}

/** Rutas del menú del cliente que cada módulo controla. */
export const RUTAS_POR_MODULO_CLIENTE: Record<ModuloCliente, string[]> = {
  MEMBRESIAS: ['/cliente/planes', '/mis-membresias'],
  OFERTAS: ['/cliente/promociones'],
  BENEFICIOS: ['/cliente/mis-promociones'],
  REGALOS: ['/cliente/regalos'],
  INVITA_Y_GANA: ['/cliente/invita-y-gana'],
  RULETA: ['/cliente/ruleta'],
  CITAS: ['/cliente/citas'],
  VEHICULOS: ['/cliente/vehiculos'],
}

export const VISIBILIDADES = ['AUTO', 'MOSTRAR', 'OCULTAR'] as const
export type VisibilidadModulo = (typeof VISIBILIDADES)[number]

export const VISIBILIDAD_LABELS: Record<VisibilidadModulo, string> = {
  AUTO: 'Automático (según lo que haya)',
  MOSTRAR: 'Mostrar siempre',
  OCULTAR: 'Ocultar siempre',
}

/**
 * Rutas del menú del cliente que hay que ESCONDER (decisión pura).
 *
 * `disponible[m] === false` significa "no hay nada dentro"; `undefined` es "no
 * se pudo averiguar" y se trata como disponible — un fallo de consulta puede
 * dejar un módulo de más en el menú, nunca dejar al cliente sin los suyos.
 */
export function rutasOcultasCliente(
  disponible: Partial<Record<ModuloCliente, boolean>>,
  forzados: Partial<Record<ModuloCliente, VisibilidadModulo>> = {}
): string[] {
  const ocultas: string[] = []
  for (const modulo of MODULOS_CLIENTE) {
    const forzado = forzados[modulo] ?? 'AUTO'
    if (forzado === 'MOSTRAR') continue
    const vacio = disponible[modulo] === false
    if (forzado === 'OCULTAR' || vacio) ocultas.push(...RUTAS_POR_MODULO_CLIENTE[modulo])
  }
  return ocultas
}
