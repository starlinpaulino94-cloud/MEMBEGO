/**
 * Formateo regional para la app React Native (port de src/lib/format.ts).
 *
 * Hermes tiene soporte parcial de Intl: NumberFormat con style:'currency'
 * funciona, pero DateTimeFormat con dateStyle/timeStyle puede no estar
 * soportado. Este archivo intenta Intl primero y cae a un formateo
 * manual determinista cuando Intl falla o no produce el resultado esperado.
 *
 * Los defaults (DOP / es-DO / America/Santo_Domingo) replican el web.
 */

export interface RegionalPrefs {
  moneda?: string | null
  idioma?: string | null
  zonaHoraria?: string | null
}

const DEFAULT_IDIOMA = 'es-DO'
const DEFAULT_MONEDA = 'DOP'
export const TZ_PLATAFORMA = 'America/Santo_Domingo'
const DEFAULT_TZ = TZ_PLATAFORMA

// ── Currency symbols (fallback manual) ──────────────────────────────────────
const CURRENCY_SYMBOLS: Record<string, string> = {
  DOP: 'RD$',
  USD: 'US$',
  EUR: '€',
  MXN: 'MX$',
  COP: 'COL$',
}

/**
 * Formatea un monto con el símbolo de la moneda de la empresa.
 *
 * `decimales` es opcional y por defecto 0 (como se muestra en toda la
 * plataforma). Las pantallas de cobro lo suben a 2.
 */
export function formatMoney(
  amount: number | string,
  prefs?: RegionalPrefs | null,
  decimales = 0
): string {
  const n = typeof amount === 'string' ? Number(amount) : amount
  const value = Number.isFinite(n) ? n : 0
  const idioma = prefs?.idioma || DEFAULT_IDIOMA
  const moneda = prefs?.moneda || DEFAULT_MONEDA

  // Intento 1: Intl.NumberFormat (funciona en Hermes para style:'currency')
  try {
    const formatted = new Intl.NumberFormat(idioma, {
      style: 'currency',
      currency: moneda,
      minimumFractionDigits: decimales,
      maximumFractionDigits: decimales,
    }).format(value)
    // Verificación: si Intl devolvió algo con el símbolo, úsalo
    if (formatted && formatted !== String(value)) return formatted
  } catch {
    // Intl no soportado o locale/moneda inválidos
  }

  // Fallback manual: "RD$1,501"
  const symbol = CURRENCY_SYMBOLS[moneda] || `${moneda} `
  const formatted = value.toLocaleString(DEFAULT_IDIOMA, {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  })
  return `${symbol}${formatted}`
}

// ── Date formatting ─────────────────────────────────────────────────────────

const MONTHS_ES = [
  'ene', 'feb', 'mar', 'abr', 'may', 'jun',
  'jul', 'ago', 'sept', 'oct', 'nov', 'dic',
]

const MONTHS_ES_LONG = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

/**
 * Extrae componentes de fecha en una timezone usando Intl como helper
 * (formato ISO con timezone → parse). Más soportado que dateStyle/timeStyle.
 */
function getDateParts(
  date: Date,
  timeZone: string
): { year: number; month: number; day: number; hour: number; minute: number } {
  try {
    // Formatear como ISO con la timezone deseada
    const iso = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date)
    // Resultado: "2026-09-23, 20:00" o "2026-09-23, 00:00"
    const [datePart, timePart] = iso.split(', ')
    const [year, month, day] = datePart.split('-').map(Number)
    const [hour, minute] = (timePart || '00:00').split(':').map(Number)
    return { year, month, day, hour, minute }
  } catch {
    // timeZone no soportada: usar UTC
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: date.getUTCHours(),
      minute: date.getUTCMinutes(),
    }
  }
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** Formatea hora en 12h con AM/PM (estilo es-DO: "12:00 p. m.") */
function formatTime12(h: number, m: number): string {
  const period = h >= 12 ? 'p. m.' : 'a. m.'
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${h12}:${pad2(m)} ${period}`
}

/**
 * Formatea una fecha con el idioma y la zona horaria de la empresa.
 * Replica el output de Intl.DateTimeFormat con dateStyle:'medium' para es-DO:
 * "23 sept 2026"
 */
export function formatDate(
  date: Date | string,
  prefs?: RegionalPrefs | null,
  options?: Intl.DateTimeFormatOptions
): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const idioma = prefs?.idioma || DEFAULT_IDIOMA
  const timeZone = prefs?.zonaHoraria || DEFAULT_TZ

  // Si se pasaron opciones custom (timeStyle, etc.), intentar Intl directo
  if (options && (options.timeStyle || options.dateStyle)) {
    try {
      const result = new Intl.DateTimeFormat(idioma, {
        timeZone,
        ...options,
      }).format(d)
      if (result) return result
    } catch {
      // Caer al formateo manual
    }
  }

  // Intento 1: Intl.DateTimeFormat con dateStyle:'medium'
  try {
    const result = new Intl.DateTimeFormat(idioma, {
      timeZone,
      dateStyle: 'medium',
    }).format(d)
    // Verificación: el resultado debe contener el mes abreviado
    if (result && /\w+ \d{4}/.test(result)) return result
  } catch {
    // dateStyle no soportado en Hermes
  }

  // Fallback manual: "dd mmm yyyy" para es-DO
  const parts = getDateParts(d, timeZone)
  const monthName = MONTHS_ES[parts.month - 1] || '???'
  return `${parts.day} ${monthName} ${parts.year}`
}

/**
 * Formatea FECHA Y HORA. Usar siempre que se muestre CUÁNDO OCURRIÓ
 * algo (acción, cobro, canje, nota, movimiento).
 */
export function formatDateTime(
  date: Date | string,
  prefs?: RegionalPrefs | null
): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const idioma = prefs?.idioma || DEFAULT_IDIOMA
  const timeZone = prefs?.zonaHoraria || DEFAULT_TZ

  // Intento 1: Intl con dateStyle + timeStyle
  try {
    const result = new Intl.DateTimeFormat(idioma, {
      timeZone,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(d)
    if (result) return result
  } catch {
    // Caer al fallback
  }

  // Fallback manual: "24 sept 2026, 12:00 p. m."
  const parts = getDateParts(d, timeZone)
  const monthName = MONTHS_ES[parts.month - 1] || '???'
  const time = formatTime12(parts.hour, parts.minute)
  return `${parts.day} ${monthName} ${parts.year}, ${time}`
}

/**
 * Fecha y hora CON SEGUNDOS, para bitácoras de auditoría.
 */
export function formatDateTimeExacto(
  date: Date | string,
  prefs?: RegionalPrefs | null
): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const idioma = prefs?.idioma || DEFAULT_IDIOMA
  const timeZone = prefs?.zonaHoraria || DEFAULT_TZ

  try {
    const result = new Intl.DateTimeFormat(idioma, {
      timeZone,
      dateStyle: 'medium',
      timeStyle: 'medium',
    }).format(d)
    if (result) return result
  } catch {
    // Caer al fallback
  }

  const parts = getDateParts(d, timeZone)
  const monthName = MONTHS_ES[parts.month - 1] || '???'
  const time = formatTime12(parts.hour, parts.minute)
  return `${parts.day} ${monthName} ${parts.year}, ${time}`
}

/**
 * Monto en pesos dominicanos SIN redondear a entero.
 */
export function formatMoneyRD(n: number): string {
  try {
    return new Intl.NumberFormat(DEFAULT_IDIOMA, {
      style: 'currency',
      currency: DEFAULT_MONEDA,
      minimumFractionDigits: 0,
    }).format(n)
  } catch {
    const formatted = n.toLocaleString(DEFAULT_IDIOMA, { minimumFractionDigits: 0 })
    return `RD$${formatted}`
  }
}

/** Monedas ofrecidas en el selector de configuración. */
export const MONEDAS = [
  { code: 'DOP', label: 'Peso dominicano (RD$)' },
  { code: 'USD', label: 'Dólar estadounidense (US$)' },
  { code: 'EUR', label: 'Euro (€)' },
  { code: 'MXN', label: 'Peso mexicano (MX$)' },
  { code: 'COP', label: 'Peso colombiano (COL$)' },
] as const

/** Idiomas/locales ofrecidos en el selector. */
export const IDIOMAS = [
  { code: 'es-DO', label: 'Español (República Dominicana)' },
  { code: 'es-MX', label: 'Español (México)' },
  { code: 'es-ES', label: 'Español (España)' },
  { code: 'en-US', label: 'Inglés (EE. UU.)' },
] as const
