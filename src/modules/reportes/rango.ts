/**
 * Reportes · RANGO DE FECHAS — núcleo puro.
 *
 * Por qué importa tanto la zona horaria: el negocio abre y cierra en Santo
 * Domingo, no en UTC. Un lavado de las 9 de la noche del día 31 se guarda como
 * la 1 de la madrugada del día 1 en UTC; si el corte se hace en UTC, ese
 * ingreso aparece en el mes siguiente y los números del mes no cuadran con la
 * caja. Todos los límites de aquí son medianoche LOCAL de la empresa.
 *
 * Sin Prisma ni React: se puede probar con un reloj fijo.
 */

export const PRESETS = [
  { clave: 'hoy', label: 'Hoy' },
  { clave: '7d', label: 'Últimos 7 días' },
  { clave: '30d', label: 'Últimos 30 días' },
  { clave: 'mes', label: 'Este mes' },
  { clave: 'mes-pasado', label: 'Mes pasado' },
] as const

export type PresetRango = (typeof PRESETS)[number]['clave']
export const PRESET_POR_DEFECTO: PresetRango = '30d'

/** Tope de puntos de la serie diaria: un año de barras no se lee. */
export const MAX_DIAS_SERIE = 370

export interface Rango {
  /** Preset elegido, o 'personalizado' si vinieron fechas a mano. */
  preset: PresetRango | 'personalizado'
  /** Primer día incluido, `YYYY-MM-DD` en hora local de la empresa. */
  desdeDia: string
  /** Último día incluido (inclusive). */
  hastaDia: string
  /** Instante UTC del inicio del primer día local. */
  desde: Date
  /** Instante UTC del fin del último día local (exclusivo: usar `lt`). */
  hasta: Date
  /** Días que abarca (inclusive en ambos extremos). */
  dias: number
  etiqueta: string
  /** Mismo número de días justo antes, para comparar. */
  anterior: { desde: Date; hasta: Date; desdeDia: string; hastaDia: string }
}

const ES_DIA = /^\d{4}-\d{2}-\d{2}$/

/** Minutos que la zona horaria va por delante de UTC en un instante dado. */
function offsetMin(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const map: Record<string, number> = {}
  for (const p of dtf.formatToParts(date)) {
    if (p.type !== 'literal') map[p.type] = Number(p.value)
  }
  const asUTC = Date.UTC(map.year, map.month - 1, map.day, map.hour, map.minute, map.second)
  return (asUTC - date.getTime()) / 60000
}

/** El día local (`YYYY-MM-DD`) al que pertenece un instante. */
export function diaLocal(fecha: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(fecha)
}

/** Instante UTC de la medianoche local de un día (inicio, o fin si `fin`). */
export function limiteDiaLocal(dia: string, timeZone: string, fin = false): Date {
  const baseUtc = Date.parse(`${dia}T00:00:00Z`)
  const off = offsetMin(new Date(`${dia}T12:00:00Z`), timeZone)
  const inicio = baseUtc - off * 60000
  return new Date(fin ? inicio + 86_400_000 : inicio)
}

/** Suma días a un `YYYY-MM-DD` sin salirse del calendario. */
export function sumarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Días entre dos fechas locales, contando ambos extremos. */
function diasEntre(desde: string, hasta: string): number {
  const a = Date.parse(`${desde}T12:00:00Z`)
  const b = Date.parse(`${hasta}T12:00:00Z`)
  return Math.round((b - a) / 86_400_000) + 1
}

function primerDiaDelMes(dia: string): string {
  return `${dia.slice(0, 7)}-01`
}

function ultimoDiaDelMes(dia: string): string {
  const [a, m] = dia.split('-').map(Number)
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10)
}

/**
 * Lee el rango de la URL. Tolerante a basura: un preset inventado o una fecha
 * mal escrita cae en el rango por defecto en vez de romper el reporte.
 *
 * Las fechas a mano ganan al preset; si vienen al revés (desde > hasta) se
 * ordenan solas, porque es lo que la persona quiso decir.
 */
export function leerRango(
  params: Record<string, string | string[] | undefined>,
  timeZone: string,
  ahora: Date = new Date()
): Rango {
  const leer = (k: string) => {
    const v = Array.isArray(params[k]) ? params[k][0] : params[k]
    return typeof v === 'string' ? v.trim() : ''
  }

  const hoy = diaLocal(ahora, timeZone)
  let desdeDia: string
  let hastaDia: string
  let preset: Rango['preset']
  let etiqueta: string

  const dManual = leer('desde')
  const hManual = leer('hasta')

  if (ES_DIA.test(dManual) && ES_DIA.test(hManual)) {
    preset = 'personalizado'
    ;[desdeDia, hastaDia] = dManual <= hManual ? [dManual, hManual] : [hManual, dManual]
    etiqueta = `${desdeDia} → ${hastaDia}`
  } else {
    const pedido = leer('rango')
    const valido = PRESETS.find((p) => p.clave === pedido)
    preset = valido?.clave ?? PRESET_POR_DEFECTO
    etiqueta = (valido ?? PRESETS.find((p) => p.clave === PRESET_POR_DEFECTO)!).label

    switch (preset) {
      case 'hoy':
        desdeDia = hoy
        hastaDia = hoy
        break
      case '7d':
        desdeDia = sumarDias(hoy, -6)
        hastaDia = hoy
        break
      case 'mes':
        desdeDia = primerDiaDelMes(hoy)
        hastaDia = hoy
        break
      case 'mes-pasado': {
        const finMesPasado = sumarDias(primerDiaDelMes(hoy), -1)
        desdeDia = primerDiaDelMes(finMesPasado)
        hastaDia = ultimoDiaDelMes(finMesPasado)
        break
      }
      default:
        desdeDia = sumarDias(hoy, -29)
        hastaDia = hoy
    }
  }

  const dias = Math.max(1, diasEntre(desdeDia, hastaDia))
  // El periodo anterior tiene EXACTAMENTE los mismos días: comparar 30 días
  // contra un mes de 31 daría una caída que no existió.
  const antHastaDia = sumarDias(desdeDia, -1)
  const antDesdeDia = sumarDias(antHastaDia, -(dias - 1))

  return {
    preset,
    desdeDia,
    hastaDia,
    desde: limiteDiaLocal(desdeDia, timeZone),
    hasta: limiteDiaLocal(hastaDia, timeZone, true),
    dias,
    etiqueta,
    anterior: {
      desdeDia: antDesdeDia,
      hastaDia: antHastaDia,
      desde: limiteDiaLocal(antDesdeDia, timeZone),
      hasta: limiteDiaLocal(antHastaDia, timeZone, true),
    },
  }
}

/** Todos los días del rango, para que la gráfica no se salte los días sin datos. */
export function diasDelRango(rango: Pick<Rango, 'desdeDia' | 'dias'>): string[] {
  const total = Math.min(rango.dias, MAX_DIAS_SERIE)
  return Array.from({ length: total }, (_, i) => sumarDias(rango.desdeDia, i))
}

/**
 * Variación porcentual contra el periodo anterior.
 *
 * `null` cuando antes no hubo nada: pasar de 0 a 5 no es «+∞ %» ni «+100 %»,
 * es simplemente el primer periodo con datos y decirlo así engaña menos.
 */
export function variacion(actual: number, anterior: number): number | null {
  if (anterior === 0) return null
  return Math.round(((actual - anterior) / anterior) * 100)
}

/** Query string del rango, para enlaces y para el botón de exportar. */
export function paramsDeRango(rango: Rango): string {
  const sp = new URLSearchParams()
  if (rango.preset === 'personalizado') {
    sp.set('desde', rango.desdeDia)
    sp.set('hasta', rango.hastaDia)
  } else if (rango.preset !== PRESET_POR_DEFECTO) {
    sp.set('rango', rango.preset)
  }
  const q = sp.toString()
  return q ? `?${q}` : ''
}
