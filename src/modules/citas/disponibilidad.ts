/**
 * Módulo de Citas · lógica PURA de disponibilidad (sin base de datos).
 *
 * Los horarios semanales se definen en la zona horaria de la empresa y los
 * turnos ("slots") se materializan como instantes UTC. República Dominicana
 * no tiene horario de verano, pero el cálculo usa Intl y funciona para
 * cualquier zona IANA configurada en la empresa.
 */

export interface RangoHorario {
  /** "HH:MM" en la zona horaria de la empresa. */
  desde: string
  hasta: string
}

/** Clave = día de semana ("0"=domingo … "6"=sábado). Ausente = cerrado. */
export type HorarioSemanal = Partial<Record<string, RangoHorario[]>>

const HM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

/** Valida y normaliza el JSON de horarios que llega del formulario/BD. */
export function normalizarHorarios(raw: unknown): HorarioSemanal {
  const out: HorarioSemanal = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [dia, rangos] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[0-6]$/.test(dia) || !Array.isArray(rangos)) continue
    const validos = rangos
      .filter(
        (r): r is RangoHorario =>
          !!r &&
          typeof r === 'object' &&
          HM_RE.test(String((r as RangoHorario).desde)) &&
          HM_RE.test(String((r as RangoHorario).hasta)) &&
          String((r as RangoHorario).desde) < String((r as RangoHorario).hasta)
      )
      .map((r) => ({ desde: r.desde, hasta: r.hasta }))
    if (validos.length > 0) out[dia] = validos
  }
  return out
}

/** Offset (minutos) de una zona IANA en un instante dado. */
function tzOffsetMin(instante: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const p = Object.fromEntries(dtf.formatToParts(instante).map((x) => [x.type, x.value]))
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second)
  return (asUTC - instante.getTime()) / 60000
}

/** Instante UTC de "ymd hm" interpretado en la zona horaria dada. */
export function utcDesdeLocal(ymd: string, hm: string, timeZone: string): Date {
  const base = new Date(`${ymd}T${hm}:00Z`)
  return new Date(base.getTime() - tzOffsetMin(base, timeZone) * 60000)
}

/** "YYYY-MM-DD" de un instante visto en la zona horaria dada. */
export function ymdEnTz(instante: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instante)
}

/** "HH:MM" de un instante visto en la zona horaria dada. */
export function hmEnTz(instante: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  }).format(instante)
}

/** Día de semana (0=domingo…6=sábado) de un "YYYY-MM-DD" en la zona dada. */
export function diaSemanaDeYmd(ymd: string, timeZone: string): number {
  // Mediodía local evita ambigüedades de borde de día.
  const instante = utcDesdeLocal(ymd, '12:00', timeZone)
  const dia = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(instante)
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(dia)
}

export interface SlotDia {
  /** Instante UTC de inicio del turno. */
  inicio: Date
  /** "HH:MM" local para mostrar. */
  hm: string
}

/**
 * Turnos de un día concreto según el horario semanal: cada franja se divide
 * en bloques de `duracionMin`; el último turno debe caber completo.
 */
export function slotsDelDia(
  horarios: HorarioSemanal,
  ymd: string,
  duracionMin: number,
  timeZone: string
): SlotDia[] {
  const rangos = horarios[String(diaSemanaDeYmd(ymd, timeZone))] ?? []
  const out: SlotDia[] = []
  for (const r of rangos) {
    const [dh, dm] = r.desde.split(':').map(Number)
    const [hh, hm] = r.hasta.split(':').map(Number)
    for (let t = dh * 60 + dm; t + duracionMin <= hh * 60 + hm; t += duracionMin) {
      const label = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
      out.push({ inicio: utcDesdeLocal(ymd, label, timeZone), hm: label })
    }
  }
  return out.sort((a, b) => a.inicio.getTime() - b.inicio.getTime())
}

/** Suma `dias` a un "YYYY-MM-DD" (aritmética de calendario, sin TZ). */
export function sumarDias(ymd: string, dias: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const f = new Date(Date.UTC(y, m - 1, d + dias))
  return f.toISOString().slice(0, 10)
}

/** Etiqueta corta de un ymd para chips de día ("lun 20 jul"). */
/**
 * Etiqueta corta de un día ("mié, 18 sept") en una zona horaria e idioma.
 *
 * NUNCA lanza: es un helper de PRESENTACIÓN, y se usa dentro del render de la
 * agenda (admin y cliente). Una zona horaria inválida —un dato corrupto, o dos
 * argumentos intercambiados— hacía que `Intl.DateTimeFormat({ timeZone })`
 * lanzara `RangeError` y tumbara la sección ENTERA con «No se pudo cargar»,
 * justo al abrir la agenda que tenía una cita que pintar. Ante una zona inválida
 * degrada a la del negocio por defecto; si ni así (un `ymd` roto), devuelve el
 * crudo. Pintar una fecha regular es infinitamente mejor que una pantalla en
 * blanco.
 */
export function etiquetaDia(ymd: string, timeZone: string, idioma = 'es-DO'): string {
  try {
    const instante = utcDesdeLocal(ymd, '12:00', timeZone)
    return new Intl.DateTimeFormat(idioma, {
      timeZone,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }).format(instante)
  } catch {
    try {
      const instante = utcDesdeLocal(ymd, '12:00', 'America/Santo_Domingo')
      return new Intl.DateTimeFormat('es-DO', {
        timeZone: 'America/Santo_Domingo',
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      }).format(instante)
    } catch {
      return ymd
    }
  }
}
