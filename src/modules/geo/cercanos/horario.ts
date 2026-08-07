/**
 * Horarios de apertura para el mapa "Cerca de mí".
 *
 * El shape canónico vive en `Sucursal.horarioDetallado` (JSON):
 *
 *   {
 *     "LUNES":   [["08:00", "18:00"]],
 *     "MARTES":  [["08:00", "12:00"], ["14:00", "18:00"]],
 *     "DOMINGO": []
 *   }
 *
 * Claves: LUNES..DOMINGO (nombre completo, sin tildes). Cada día es un array de
 * rangos [horaDesde, horaHasta] en formato "HH:mm" (24 h). Un día con array
 * vacío significa cerrado. Ausencia de la clave = horario desconocido.
 *
 * Membego opera en República Dominicana; la zona por defecto es
 * America/Santo_Domingo. `estaAbierto` resuelve el día local de la sucursal.
 */

export const DIAS_HORARIO = [
  'LUNES',
  'MARTES',
  'MIERCOLES',
  'JUEVES',
  'VIERNES',
  'SABADO',
  'DOMINGO',
] as const

export type DiaHorario = (typeof DIAS_HORARIO)[number]

export type RangoHorario = [desde: string, hasta: string]

export type HorarioDetallado = Partial<Record<DiaHorario, RangoHorario[]>>

export const TZ_MEMBEGO = 'America/Santo_Domingo'

const REGEX_HORA = /^([01]?\d|2[0-3]):([0-5]\d)$/

function esDiaHorario(k: string): k is DiaHorario {
  return (DIAS_HORARIO as readonly string[]).includes(k)
}

function minutosDeHora(hora: string): number | null {
  const m = REGEX_HORA.exec(hora)
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

/** Resuelve el día (ISO, LUNES=1) correspondiente a `now` en la zona `tz`. */
export function diaLocal(now: Date, tz: string = TZ_MEMBEGO): number {
  // Intl devuelve el nombre completo del día en el locale 'es'; convertimos a
  // LUNES..DOMINGO comparando el nombre normalizado (mayúsculas, sin tildes).
  const nombre = new Intl.DateTimeFormat('es-DO', {
    timeZone: tz,
    weekday: 'long',
  }).format(now)
  const normalizado = nombre
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
  const idx = DIAS_HORARIO.indexOf(normalizado as DiaHorario)
  return idx + 1 // ISO: 1 = lunes
}

function horaLocalCompleta(now: Date, tz: string): number {
  const partes = new Intl.DateTimeFormat('es-DO', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const h = partes.find((p) => p.type === 'hour')?.value ?? '0'
  const m = partes.find((p) => p.type === 'minute')?.value ?? '0'
  return Number(h) * 60 + Number(m)
}

/**
 * ¿Está abierta la sucursal a la hora `now` (por defecto, ahora mismo)?
 *
 * - `null` horario: devuelve `null` (desconocido — el filtro "abierto ahora" NO
 *   lo considera abierto, pero la tarjeta no muestra "cerrado").
 * - horario conocido sin clave para el día: devuelve `false` (cerrado).
 * - rango inválido (hora mal formada, desde >= hasta): se ignora ese rango.
 */
export function estaAbierto(
  horario: HorarioDetallado | null | undefined,
  now: Date = new Date(),
  tz: string = TZ_MEMBEGO
): boolean | null {
  if (!horario || typeof horario !== 'object') return null
  const dia = diaLocal(now, tz)
  const clave = DIAS_HORARIO[dia - 1]
  const rangos = Object.entries(horario).find(([k]) => esDiaHorario(k) && k === clave)?.[1]
  if (rangos === undefined) return null
  if (!Array.isArray(rangos) || rangos.length === 0) return false
  const ahora = horaLocalCompleta(now, tz)
  for (const rango of rangos) {
    if (!Array.isArray(rango) || rango.length !== 2) continue
    const desde = minutosDeHora(String(rango[0]))
    const hasta = minutosDeHora(String(rango[1]))
    if (desde === null || hasta === null || desde >= hasta) continue
    if (ahora >= desde && ahora <= hasta) return true
  }
  return false
}

/**
 * Texto legible del horario de hoy ("8:00–18:00", "Cerrado hoy", "Sin horario").
 * `null` si el horario es desconocido.
 */
export function textoHorarioHoy(
  horario: HorarioDetallado | null | undefined,
  now: Date = new Date(),
  tz: string = TZ_MEMBEGO
): string | null {
  if (!horario || typeof horario !== 'object') return null
  const clave = DIAS_HORARIO[diaLocal(now, tz) - 1]
  const rangos = Object.entries(horario).find(([k]) => esDiaHorario(k) && k === clave)?.[1]
  if (rangos === undefined) return null
  if (!Array.isArray(rangos) || rangos.length === 0) return 'Cerrado hoy'
  const textos = rangos
    .filter((r) => Array.isArray(r) && r.length === 2)
    .map((r) => `${String(r[0])}–${String(r[1])}`)
  return textos.length ? textos.join(', ') : 'Cerrado hoy'
}
