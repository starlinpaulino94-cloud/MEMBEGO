/**
 * EXCURSIONES · Métricas y metas — NÚCLEO PURO.
 *
 * Dos decisiones de fondo:
 *
 * 1. LOS KPI SON CONSULTAS, NO CONTADORES. No hay ninguna columna «totalVentas»
 *    que alguien tenga que acordarse de subir: cada cifra se calcula al mirarla,
 *    sobre las filas reales. Un contador desincronizado miente en silencio
 *    durante meses; una consulta lenta solo tarda.
 *
 * 2. EL CORTE DEL PERÍODO ES EN HORA LOCAL. El servidor corre en UTC y la
 *    empresa vive en República Dominicana (UTC−4, sin horario de verano). Sin
 *    ajustar, una venta de las 9 de la noche del 31 cae en el mes siguiente y
 *    el cierre de mes no cuadra con lo que el negocio vio ese día.
 */

/** República Dominicana: UTC−4 todo el año (no hay horario de verano). */
export const OFFSET_PLATAFORMA_MIN = -240

export const PERIODOS_META = ['DIARIA', 'SEMANAL', 'MENSUAL', 'RANGO'] as const
export type PeriodoMeta = (typeof PERIODOS_META)[number]

export const PERIODO_META_LABEL: Record<PeriodoMeta, string> = {
  DIARIA: 'Diaria',
  SEMANAL: 'Semanal',
  MENSUAL: 'Mensual',
  RANGO: 'Rango de fechas',
}

export interface Rango {
  desde: Date
  hasta: Date
}

/** Instante UTC que corresponde a una fecha/hora local de la plataforma. */
function utcDesdeLocal(anio: number, mes: number, dia: number, hora = 0, min = 0, seg = 0, ms = 0) {
  return new Date(Date.UTC(anio, mes, dia, hora, min, seg, ms) - OFFSET_PLATAFORMA_MIN * 60_000)
}

/** Partes de la fecha LOCAL correspondientes a un instante UTC. */
function partesLocales(fecha: Date) {
  const local = new Date(fecha.getTime() + OFFSET_PLATAFORMA_MIN * 60_000)
  return {
    anio: local.getUTCFullYear(),
    mes: local.getUTCMonth(),
    dia: local.getUTCDate(),
    diaSemana: local.getUTCDay(), // 0 = domingo
  }
}

/**
 * El rango de un período, en instantes UTC listos para consultar. La semana
 * empieza el LUNES, que es como cuenta la semana el negocio (no el domingo del
 * estándar de JavaScript).
 */
export function rangoDePeriodo(
  periodo: PeriodoMeta,
  ahora: Date,
  personalizado?: { desde?: Date | null; hasta?: Date | null }
): Rango {
  const { anio, mes, dia, diaSemana } = partesLocales(ahora)

  if (periodo === 'RANGO') {
    return {
      desde: personalizado?.desde ?? utcDesdeLocal(anio, mes, dia),
      hasta: personalizado?.hasta ?? utcDesdeLocal(anio, mes, dia, 23, 59, 59, 999),
    }
  }
  if (periodo === 'DIARIA') {
    return {
      desde: utcDesdeLocal(anio, mes, dia),
      hasta: utcDesdeLocal(anio, mes, dia, 23, 59, 59, 999),
    }
  }
  if (periodo === 'SEMANAL') {
    const desdeElLunes = (diaSemana + 6) % 7
    return {
      desde: utcDesdeLocal(anio, mes, dia - desdeElLunes),
      hasta: utcDesdeLocal(anio, mes, dia - desdeElLunes + 6, 23, 59, 59, 999),
    }
  }
  // MENSUAL: día 0 del mes siguiente es el último del actual.
  return {
    desde: utcDesdeLocal(anio, mes, 1),
    hasta: utcDesdeLocal(anio, mes + 1, 0, 23, 59, 59, 999),
  }
}

/** Los rangos que ofrece el selector del panel. */
export const RANGOS_PANEL = [
  { clave: 'HOY', label: 'Hoy', periodo: 'DIARIA' as PeriodoMeta },
  { clave: 'SEMANA', label: 'Esta semana', periodo: 'SEMANAL' as PeriodoMeta },
  { clave: 'MES', label: 'Este mes', periodo: 'MENSUAL' as PeriodoMeta },
] as const
export type ClaveRango = (typeof RANGOS_PANEL)[number]['clave']

export function rangoDelPanel(clave: string, ahora: Date): { label: string; rango: Rango } {
  const elegido = RANGOS_PANEL.find((r) => r.clave === clave) ?? RANGOS_PANEL[2]
  return { label: elegido.label, rango: rangoDePeriodo(elegido.periodo, ahora) }
}

// ── Dinero y promedios ───────────────────────────────────────────────────────

export function centavos(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100
}

/** Ticket promedio. Sin ventas es null, no cero: son cosas distintas. */
export function ticketPromedio(ingresos: number, ventas: number): number | null {
  if (!ventas) return null
  return centavos(ingresos / ventas)
}

/**
 * Conversión de un embudo, en porcentaje entero. Sin base no hay porcentaje:
 * «0% de conversión» cuando nadie visitó todavía es una acusación falsa.
 */
export function conversion(parte: number, base: number): number | null {
  if (!base) return null
  return Math.round((parte / base) * 100)
}

// ── Metas ────────────────────────────────────────────────────────────────────

export interface MetaValores {
  metaVentas: number | null
  metaPasajeros: number | null
  metaIngresos: number | null
  metaRegistros: number | null
  metaReservas: number | null
}

export interface RealesMeta {
  ventas: number
  pasajeros: number
  ingresos: number
  registros: number
  reservas: number
}

export interface LineaProgreso {
  clave: keyof RealesMeta
  label: string
  meta: number
  real: number
  /** Porcentaje topado a 100: pasarse está bien, pero la barra no se sale. */
  pct: number
  cumplida: boolean
  esDinero: boolean
}

const LINEAS: { clave: keyof RealesMeta; metaClave: keyof MetaValores; label: string; esDinero: boolean }[] = [
  { clave: 'registros', metaClave: 'metaRegistros', label: 'Clientes captados', esDinero: false },
  { clave: 'reservas', metaClave: 'metaReservas', label: 'Reservas', esDinero: false },
  { clave: 'ventas', metaClave: 'metaVentas', label: 'Ventas', esDinero: false },
  { clave: 'pasajeros', metaClave: 'metaPasajeros', label: 'Pasajeros', esDinero: false },
  { clave: 'ingresos', metaClave: 'metaIngresos', label: 'Ingresos', esDinero: true },
]

/**
 * El progreso de una meta, línea por línea. Solo se muestran las métricas que
 * la meta define: una meta de pasajeros no debe pintar una barra de ingresos
 * en cero, porque esa barra no significa nada.
 */
export function progresoMeta(meta: MetaValores, reales: RealesMeta): LineaProgreso[] {
  return LINEAS.filter((l) => {
    const objetivo = meta[l.metaClave]
    return typeof objetivo === 'number' && objetivo > 0
  }).map((l) => {
    const objetivo = Number(meta[l.metaClave])
    const real = Number(reales[l.clave] ?? 0)
    return {
      clave: l.clave,
      label: l.label,
      meta: objetivo,
      real,
      pct: Math.min(100, Math.round((real / objetivo) * 100)),
      cumplida: real >= objetivo,
      esDinero: l.esDinero,
    }
  })
}

// ── Validación ───────────────────────────────────────────────────────────────

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/

function texto(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

function enteroOpcional(v: unknown): number | null {
  const s = texto(v, 12)
  if (!s) return null
  const n = Number(s)
  return Number.isInteger(n) && n > 0 ? n : null
}

export interface MetaDatos extends MetaValores {
  vendedorId: string
  periodo: PeriodoMeta
  desde: Date | null
  hasta: Date | null
}

export function validarMeta(
  form: Record<string, unknown>
): { ok: true; datos: MetaDatos } | { ok: false; error: string } {
  const vendedorId = texto(form.vendedorId, 40)
  if (!vendedorId) return { ok: false, error: 'Elige a qué vendedor le pones la meta.' }

  const periodoCrudo = texto(form.periodo, 20).toUpperCase()
  const periodo = (PERIODOS_META as readonly string[]).includes(periodoCrudo)
    ? (periodoCrudo as PeriodoMeta)
    : 'MENSUAL'

  const fecha = (v: unknown): Date | null => {
    const s = texto(v, 10)
    if (!FECHA_RE.test(s)) return null
    const d = new Date(`${s}T00:00:00.000Z`)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const desde = periodo === 'RANGO' ? fecha(form.desde) : null
  const hasta = periodo === 'RANGO' ? fecha(form.hasta) : null
  if (periodo === 'RANGO') {
    if (!desde || !hasta) return { ok: false, error: 'Un rango necesita fecha de inicio y de fin.' }
    if (hasta < desde) return { ok: false, error: 'El rango termina antes de empezar.' }
  }

  const ingresosCrudo = texto(form.metaIngresos, 12)
  const metaIngresos = ingresosCrudo ? centavos(Number(ingresosCrudo)) : null
  if (metaIngresos !== null && (!Number.isFinite(metaIngresos) || metaIngresos <= 0)) {
    return { ok: false, error: 'La meta de ingresos no es válida.' }
  }

  const datos: MetaDatos = {
    vendedorId,
    periodo,
    desde,
    hasta,
    metaVentas: enteroOpcional(form.metaVentas),
    metaPasajeros: enteroOpcional(form.metaPasajeros),
    metaIngresos,
    metaRegistros: enteroOpcional(form.metaRegistros),
    metaReservas: enteroOpcional(form.metaReservas),
  }

  // Una meta sin ninguna cifra no mide nada: sería una fila que ocupa sitio en
  // la pantalla del vendedor sin decirle qué se espera de él.
  const tieneAlgo =
    datos.metaVentas || datos.metaPasajeros || datos.metaIngresos || datos.metaRegistros || datos.metaReservas
  if (!tieneAlgo) {
    return { ok: false, error: 'Pon al menos una cifra: clientes, reservas, ventas, pasajeros o ingresos.' }
  }

  return { ok: true, datos }
}
