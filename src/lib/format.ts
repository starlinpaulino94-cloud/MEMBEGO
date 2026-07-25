/**
 * Formateo regional por empresa (Onboarding Fase 3A · O-7).
 *
 * Aplica la preferencia de moneda/idioma/zona horaria de cada empresa al
 * FORMATEAR precios y fechas. No traduce la interfaz ni convierte divisas
 * (Decisión 4 del plan): un precio guardado en 500 se muestra como "US$500"
 * o "RD$500" según la moneda configurada, sin cambiar el número.
 *
 * Los defaults (DOP / es-DO / America/Santo_Domingo) reproducen el formateo
 * hardcodeado previo, así que los sitios que aún no pasan preferencias siguen
 * viéndose igual.
 */

export interface RegionalPrefs {
  moneda?: string | null
  idioma?: string | null
  zonaHoraria?: string | null
}

const DEFAULT_IDIOMA = 'es-DO'
const DEFAULT_MONEDA = 'DOP'
const DEFAULT_TZ = 'America/Santo_Domingo'

/** Formatea un monto con el símbolo de la moneda de la empresa. */
export function formatMoney(
  amount: number | string,
  prefs?: RegionalPrefs | null
): string {
  const n = typeof amount === 'string' ? Number(amount) : amount
  const value = Number.isFinite(n) ? n : 0
  const idioma = prefs?.idioma || DEFAULT_IDIOMA
  const moneda = prefs?.moneda || DEFAULT_MONEDA
  try {
    return new Intl.NumberFormat(idioma, {
      style: 'currency',
      currency: moneda,
      maximumFractionDigits: 0,
    }).format(value)
  } catch {
    // Locale/moneda inválidos: degradar a número + código.
    return `${moneda} ${new Intl.NumberFormat(DEFAULT_IDIOMA).format(value)}`
  }
}

/** Formatea una fecha con el idioma y la zona horaria de la empresa. */
export function formatDate(
  date: Date | string,
  prefs?: RegionalPrefs | null,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }
): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const idioma = prefs?.idioma || DEFAULT_IDIOMA
  try {
    return new Intl.DateTimeFormat(idioma, {
      timeZone: prefs?.zonaHoraria || DEFAULT_TZ,
      ...options,
    }).format(d)
  } catch {
    // Locale o zona horaria inválidos: degradar al default de plataforma
    // SIN perder la zona horaria (el servidor corre en UTC).
    return new Intl.DateTimeFormat(DEFAULT_IDIOMA, {
      timeZone: DEFAULT_TZ,
      ...options,
    }).format(d)
  }
}

/**
 * Formatea FECHA Y HORA. Úsalo siempre que se muestre CUÁNDO OCURRIÓ ALGO
 * (una acción, un cobro, un canje, una nota, un movimiento): la trazabilidad
 * exige la hora, no solo el día. `formatDate` queda para conceptos que son
 * de día completo (vencimiento, cumpleaños, vigencia de una promoción).
 */
export function formatDateTime(
  date: Date | string,
  prefs?: RegionalPrefs | null
): string {
  return formatDate(date, prefs, { dateStyle: 'medium', timeStyle: 'short' })
}

/**
 * Fecha y hora CON SEGUNDOS, para bitácoras de auditoría donde el orden
 * exacto de dos acciones seguidas importa.
 */
export function formatDateTimeExacto(
  date: Date | string,
  prefs?: RegionalPrefs | null
): string {
  return formatDate(date, prefs, { dateStyle: 'medium', timeStyle: 'medium' })
}

/**
 * Monto en pesos dominicanos SIN redondear a entero (a diferencia de
 * `formatMoney`, conserva decimales si el número los trae). Usado por los
 * paneles de superadmin que agregan montos de varias empresas.
 */
export function formatMoneyRD(n: number): string {
  return `RD$${n.toLocaleString('es-DO', { minimumFractionDigits: 0 })}`
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
