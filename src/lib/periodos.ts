import { TZ_PLATAFORMA } from '@/lib/format'

interface FechaLocal {
  year: number
  month: number
  day: number
}

interface FechaHoraLocal extends FechaLocal {
  hour: number
  minute: number
  second: number
  millisecond: number
}

const RANGOS_MESES: Array<{ min: number; max: number; meses: number }> = [
  { min: 28, max: 31, meses: 1 },
  { min: 89, max: 92, meses: 3 },
  { min: 180, max: 184, meses: 6 },
  { min: 364, max: 366, meses: 12 },
]

function zonaSegura(zonaHoraria: string | null | undefined): string {
  const zona = zonaHoraria || TZ_PLATAFORMA
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zona }).format(new Date(0))
    return zona
  } catch {
    return TZ_PLATAFORMA
  }
}

function mesesPorVigencia(dias: number): number | null {
  const d = Math.round(dias)
  if (!Number.isFinite(d) || d < 1) return 1
  return RANGOS_MESES.find((r) => d >= r.min && d <= r.max)?.meses ?? null
}

function partsEnZona(date: Date, zonaHoraria: string): FechaHoraLocal {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: zonaHoraria,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  })
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]))
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    millisecond: date.getUTCMilliseconds(),
  }
}

function ultimoDiaDelMes(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function sumarMesesLocal(fecha: FechaLocal, meses: number): FechaLocal {
  const indiceMes = fecha.month - 1 + meses
  const year = fecha.year + Math.floor(indiceMes / 12)
  const month = ((indiceMes % 12) + 12) % 12 + 1
  const day = Math.min(fecha.day, ultimoDiaDelMes(year, month))
  return { year, month, day }
}

function sumarDiasLocal(fecha: FechaLocal, dias: number): FechaLocal {
  const d = new Date(Date.UTC(fecha.year, fecha.month - 1, fecha.day + dias))
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  }
}

function fechaLocalAUtc(fecha: FechaHoraLocal, zonaHoraria: string): Date {
  const objetivo = Date.UTC(
    fecha.year,
    fecha.month - 1,
    fecha.day,
    fecha.hour,
    fecha.minute,
    fecha.second,
    fecha.millisecond
  )
  let utc = new Date(objetivo)

  for (let i = 0; i < 3; i++) {
    const vistoEnZona = partsEnZona(utc, zonaHoraria)
    const vistoComoUtc = Date.UTC(
      vistoEnZona.year,
      vistoEnZona.month - 1,
      vistoEnZona.day,
      vistoEnZona.hour,
      vistoEnZona.minute,
      vistoEnZona.second,
      fecha.millisecond
    )
    const diferencia = objetivo - vistoComoUtc
    if (diferencia === 0) break
    utc = new Date(utc.getTime() + diferencia)
  }

  return utc
}

function fechaLocalDesdeInput(valor: string): FechaLocal | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor)
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > ultimoDiaDelMes(year, month)) return null
  return { year, month, day }
}

/**
 * Fin de vigencia de una membresía.
 *
 * Los planes que el catálogo enseña como mes/trimestre/semestre/año se calculan
 * por calendario local, no por bloques fijos de 30 días. Un plan mensual
 * comprado el 30 de julio vence el 30 de agosto a las 11:59:59 PM del negocio.
 * Si el día no existe en el mes destino, cae al último día posible.
 */
export function periodEnd(from: Date, dias = 30, zonaHoraria = TZ_PLATAFORMA): Date {
  const zona = zonaSegura(zonaHoraria)
  const inicio = partsEnZona(from, zona)

  const meses = mesesPorVigencia(dias)
  const finLocal = meses
    ? sumarMesesLocal(inicio, meses)
    : sumarDiasLocal(inicio, Math.round(dias))

  return fechaLocalAUtc(
    { ...finLocal, hour: 23, minute: 59, second: 59, millisecond: 999 },
    zona
  )
}

/** Convierte `YYYY-MM-DD` al cierre de ese día en la zona horaria indicada. */
export function finDelDiaLocal(fecha: string, zonaHoraria = TZ_PLATAFORMA): Date | null {
  const local = fechaLocalDesdeInput(fecha)
  if (!local) return null
  const zona = zonaSegura(zonaHoraria)
  return fechaLocalAUtc(
    { ...local, hour: 23, minute: 59, second: 59, millisecond: 999 },
    zona
  )
}

/** Valor `YYYY-MM-DD` para inputs de fecha, respetando la zona del negocio. */
export function fechaInputLocal(date: Date | null, zonaHoraria = TZ_PLATAFORMA): string {
  if (!date) return ''
  const p = partsEnZona(date, zonaSegura(zonaHoraria))
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}
