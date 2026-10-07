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
/**
 * Zona horaria de la plataforma. Exportada porque los reportes que cruzan
 * TODAS las empresas no tienen una empresa de la que sacarla, y el corte del
 * periodo tiene que hacerse en alguna: sin una constante compartida cada
 * pantalla se inventaba la suya —o peor, usaba la del servidor, que en el
 * despliegue es UTC y mueve de mes los cobros de la noche del día 31—.
 */
export const TZ_PLATAFORMA = 'America/Santo_Domingo'
const DEFAULT_TZ = TZ_PLATAFORMA

/**
 * Normaliza el espacio «raro» que `Intl.DateTimeFormat` mete antes de
 * «a. m.»/«p. m.» en locales como `es-DO`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTO EXISTE: UN ERROR DE HIDRATACIÓN QUE SE VEÍA IGUAL EN LAS DOS FOTOS
 *
 * `HistorialMovimientos` (Inventario, F2.2) es un Client Component que
 * renderiza esta fecha, así que corre UNA VEZ en el servidor (para el HTML
 * inicial) y OTRA VEZ en el navegador al hidratar. React compara las dos
 * cadenas y, si no son BYTE A BYTE idénticas, descarta el árbol y lo vuelve a
 * montar —error #418—. El recorrido E2E `inventario-admin.spec.ts` lo
 * encontró así, mostrando un diff donde las dos líneas parecían idénticas a
 * simple vista.
 *
 * Lo eran, visualmente. La ICU de Node y la de Chromium no siempre coinciden
 * en qué carácter ponen ahí: una usa un espacio normal (U+0020) y la otra un
 * espacio ANGOSTO DE NO SEPARACIÓN (U+202F, a veces U+00A0) — indistinguibles
 * en pantalla, distintos en memoria. El servidor y el navegador formatean la
 * MISMA fecha con el MISMO locale y la MISMA zona horaria; lo único que
 * cambia es el motor de ICU que trae cada uno, y eso no se puede fijar desde
 * aquí.
 *
 * Lo que sí se puede fijar es el resultado: forzar siempre un espacio normal
 * hace que las dos pasadas —y cualquier otra— produzcan la MISMA cadena. No
 * es un parche sobre el síntoma del E2E: es la causa real (dos bytes que
 * dicen lo mismo y no son iguales) arreglada donde vive, para esta función y
 * para todo lo que la llama.
 */
function espacioEstandar(texto: string): string {
  return texto.replace(/[  ]/g, ' ')
}

/**
 * Formatea un monto con el símbolo de la moneda de la empresa.
 *
 * `decimales` es opcional y por defecto 0, que es como se muestran los precios
 * en toda la plataforma. Las pantallas de COBRO lo suben a 2: un saldo
 * pendiente de 0,40 mostrado como «RD$0» es un descuadre que nadie sabe
 * explicar después.
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
  try {
    return new Intl.NumberFormat(idioma, {
      style: 'currency',
      currency: moneda,
      minimumFractionDigits: decimales,
      maximumFractionDigits: decimales,
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
    return espacioEstandar(
      new Intl.DateTimeFormat(idioma, {
        timeZone: prefs?.zonaHoraria || DEFAULT_TZ,
        ...options,
      }).format(d)
    )
  } catch {
    // Locale o zona horaria inválidos: degradar al default de plataforma
    // SIN perder la zona horaria (el servidor corre en UTC).
    return espacioEstandar(
      new Intl.DateTimeFormat(DEFAULT_IDIOMA, {
        timeZone: DEFAULT_TZ,
        ...options,
      }).format(d)
    )
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
