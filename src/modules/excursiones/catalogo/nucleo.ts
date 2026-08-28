/**
 * EXCURSIONES · Catálogo — NÚCLEO PURO (sin Prisma, sin red).
 *
 * Validación y vocabulario del catálogo: estados, monedas, días de la semana
 * y la normalización de lo que llega del navegador. La regla de la casa:
 * nada del navegador se guarda crudo.
 */

// ── Estados ──────────────────────────────────────────────────────────────────

export const ESTADOS_EXCURSION = ['ACTIVA', 'PAUSADA', 'AGOTADA', 'TEMPORAL', 'ARCHIVADA'] as const
export type EstadoExcursion = (typeof ESTADOS_EXCURSION)[number]

export const ESTADO_EXCURSION_LABEL: Record<EstadoExcursion, string> = {
  ACTIVA: 'Activa',
  PAUSADA: 'Pausada',
  AGOTADA: 'Agotada',
  TEMPORAL: 'Temporal',
  ARCHIVADA: 'Archivada',
}

/** Tono semántico para StatusChip (cambia con el tema). */
export const TONO_EXCURSION: Record<EstadoExcursion, 'success' | 'warning' | 'neutral' | 'info' | 'danger'> = {
  ACTIVA: 'success',
  PAUSADA: 'warning',
  AGOTADA: 'danger',
  TEMPORAL: 'info',
  ARCHIVADA: 'neutral',
}

export const MONEDAS = ['DOP', 'USD', 'EUR'] as const
export type Moneda = (typeof MONEDAS)[number]

/** Días ISO (1 = lunes … 7 = domingo), para los horarios de salida. */
export const DIAS_SEMANA = [
  { n: 1, label: 'Lun' },
  { n: 2, label: 'Mar' },
  { n: 3, label: 'Mié' },
  { n: 4, label: 'Jue' },
  { n: 5, label: 'Vie' },
  { n: 6, label: 'Sáb' },
  { n: 7, label: 'Dom' },
] as const

const HORA_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

// ── Normalización y validación ───────────────────────────────────────────────

function texto(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

/** Precio del formulario → número con 2 decimales, o null si no aplica. */
export function precio(v: unknown): number | null {
  const s = typeof v === 'string' ? v.trim() : ''
  if (!s) return null
  const n = Number(s)
  if (!Number.isFinite(n) || n < 0 || n > 9_999_999) return null
  return Math.round(n * 100) / 100
}

export type TipoItemExcursion = 'ACTIVIDAD' | 'COMBO' | 'PASE_DIA'

export interface ExcursionDatos {
  nombre: string
  tipoItem: TipoItemExcursion
  descripcion: string | null
  duracionMin: number | null
  ubicacion: string | null
  categoria: string | null
  moneda: Moneda
  impuestoPct: number | null
  capacidad: number | null
  puntoSalida: string | null
  horaSalida: string | null
  horaRegreso: string | null
  incluye: string | null
  noIncluye: string | null
  politicas: string | null
  portadaUrl: string | null
  galeria: string[] | null
}

/**
 * Normaliza y valida los campos generales de una excursión. Devuelve los
 * datos LIMPIOS o el primer error en lenguaje del negocio.
 */
export function validarExcursion(
  form: Record<string, unknown>
): { ok: true; datos: ExcursionDatos } | { ok: false; error: string } {
  const nombre = texto(form.nombre, 140)
  if (nombre.length < 3) return { ok: false, error: 'Escribe el nombre de la excursión.' }

  const monedaCruda = texto(form.moneda, 3).toUpperCase()
  const moneda = (MONEDAS as readonly string[]).includes(monedaCruda)
    ? (monedaCruda as Moneda)
    : 'DOP'

  const enteroOpcional = (v: unknown, max: number): number | null => {
    const s = typeof v === 'string' ? v.trim() : ''
    if (!s) return null
    const n = Number(s)
    return Number.isInteger(n) && n > 0 && n <= max ? n : null
  }
  const horaOpcional = (v: unknown): string | null => {
    const s = texto(v, 5)
    return HORA_RE.test(s) ? s : null
  }

  const impuesto = precio(form.impuestoPct)
  if (impuesto !== null && impuesto > 100) {
    return { ok: false, error: 'El impuesto es un porcentaje: entre 0 y 100.' }
  }

  let galeria: string[] | null = null
  if (typeof form.galeriaJson === 'string') {
    try {
      const parsed = JSON.parse(form.galeriaJson)
      if (Array.isArray(parsed)) {
        galeria = parsed.map(u => String(u).trim()).filter(Boolean)
      }
    } catch {
      // Ignorar json inválido
    }
  }

  const tipoRaw = String(form.tipoItem ?? 'ACTIVIDAD').toUpperCase()
  const tipoItem: TipoItemExcursion =
    tipoRaw === 'COMBO' ? 'COMBO' : tipoRaw === 'PASE_DIA' ? 'PASE_DIA' : 'ACTIVIDAD'

  return {
    ok: true,
    datos: {
      nombre,
      tipoItem,
      descripcion: texto(form.descripcion, 2000) || null,
      duracionMin: tipoItem === 'PASE_DIA' ? null : enteroOpcional(form.duracionMin, 10_000),
      ubicacion: texto(form.ubicacion, 200) || null,
      categoria: texto(form.categoria, 80) || null,
      moneda,
      impuestoPct: impuesto,
      capacidad: enteroOpcional(form.capacidad, 100_000),
      puntoSalida: texto(form.puntoSalida, 300) || null,
      horaSalida: tipoItem === 'PASE_DIA' ? null : horaOpcional(form.horaSalida),
      horaRegreso: tipoItem === 'PASE_DIA' ? null : horaOpcional(form.horaRegreso),
      incluye: texto(form.incluye, 2000) || null,
      noIncluye: texto(form.noIncluye, 2000) || null,
      politicas: texto(form.politicas, 2000) || null,
      portadaUrl: texto(form.portadaUrl, 1000) || null,
      galeria: galeria && galeria.length > 0 ? galeria : null,
    },
  }
}

export interface ReglaPrecioDinamico {
  diasSemana: number[] // 1..7 (vacío = todos los días)
  horasSalida: string[] // 'HH:MM' (vacío = cualquier hora)
  precioAdulto: number
  precioNino: number | null
  precioResidente: number | null
  precioNinoResidente: number | null
}

export interface VarianteDatos {
  nombre: string
  precioAdulto: number
  precioNino: number | null
  precioResidente: number | null
  precioNinoResidente: number | null
  precioTurista: number | null
  capacidad: number | null
  preciosDinamicos: ReglaPrecioDinamico[] | null
}

export function validarVariante(
  form: Record<string, unknown>
): { ok: true; datos: VarianteDatos } | { ok: false; error: string } {
  const nombre = texto(form.nombre, 80)
  if (!nombre) return { ok: false, error: 'Ponle nombre a la variante (p. ej. «Estándar» o «VIP»).' }
  const precioAdulto = precio(form.precioAdulto)
  if (precioAdulto === null || precioAdulto <= 0) {
    return { ok: false, error: 'El precio por adulto es obligatorio y mayor que cero.' }
  }
  const cap = typeof form.capacidad === 'string' && form.capacidad.trim() ? Number(form.capacidad) : null

  let preciosDinamicos: ReglaPrecioDinamico[] | null = null
  if (typeof form.preciosDinamicosJson === 'string' && form.preciosDinamicosJson.trim()) {
    try {
      const parsed = JSON.parse(form.preciosDinamicosJson)
      if (Array.isArray(parsed)) {
        preciosDinamicos = parsed.map((crudo: unknown) => {
          // Viene de `JSON.parse`: no hay ninguna garantía de forma. `unknown`
          // obliga a comprobar antes de leer, que es lo que este bloque ya
          // hacía campo por campo; el `any` solo lo ocultaba.
          const r = (crudo ?? {}) as Record<string, unknown>
          return {
            diasSemana: Array.isArray(r.diasSemana)
              ? r.diasSemana.map(Number).filter((n: number) => n >= 1 && n <= 7)
              : [],
            horasSalida: Array.isArray(r.horasSalida)
              ? r.horasSalida.map(String).filter((s: string) => HORA_RE.test(s))
              : [],
            precioAdulto: Number(r.precioAdulto) || precioAdulto, // Fallback al base
            precioNino: r.precioNino ? Number(r.precioNino) : null,
            precioResidente: r.precioResidente ? Number(r.precioResidente) : null,
            precioNinoResidente: r.precioNinoResidente ? Number(r.precioNinoResidente) : null,
          }
        })
      }
    } catch {
      // Ignorar json inválido
    }
  }

  return {
    ok: true,
    datos: {
      nombre,
      precioAdulto,
      precioNino: precio(form.precioNino),
      precioResidente: precio(form.precioResidente),
      precioNinoResidente: precio(form.precioNinoResidente),
      precioTurista: precio(form.precioTurista),
      capacidad: cap !== null && Number.isInteger(cap) && cap > 0 ? cap : null,
      preciosDinamicos,
    },
  }
}

/**
 * Días del formulario (checkboxes '1'…'7') → arreglo ISO limpio y ordenado.
 * Vacío no es válido: un horario sin días no sale nunca.
 */
export function normalizarDias(valores: unknown[]): number[] {
  const dias = [
    ...new Set(
      valores
        .map((v) => Number(v))
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7)
    ),
  ].sort((a, b) => a - b)
  return dias
}

export function validarHorario(
  form: Record<string, unknown>,
  dias: unknown[]
): { ok: true; datos: { diasSemana: number[]; horaSalida: string; cupo: number | null } } | { ok: false; error: string } {
  const diasSemana = normalizarDias(dias)
  if (diasSemana.length === 0) return { ok: false, error: 'Elige al menos un día de salida.' }
  const horaSalida = texto(form.horaSalida, 5)
  if (!HORA_RE.test(horaSalida)) return { ok: false, error: 'La hora de salida no es válida (HH:MM).' }
  const cupoS = typeof form.cupo === 'string' ? form.cupo.trim() : ''
  const cupoN = cupoS ? Number(cupoS) : null
  const cupo = cupoN !== null && Number.isInteger(cupoN) && cupoN > 0 ? cupoN : null
  return { ok: true, datos: { diasSemana, horaSalida, cupo } }
}

/** Slug base desde el nombre (la unicidad por empresa la asegura la acción). */
export function slugExcursion(nombre: string): string {
  return (
    nombre
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'excursion'
  )
}

/** Convierte HH:MM a minutos desde medianoche. */
export function horaAMinutos(hora: string): number | null {
  const m = hora.match(/^(\d{2}):(\d{2})$/)
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

/** Convierte minutos a HH:MM. */
export function minutosAHora(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Calcula duración en minutos entre horaSalida y horaRegreso. */
export function calcularDuracion(horaSalida: string, horaRegreso: string): number | null {
  const ini = horaAMinutos(horaSalida)
  const fin = horaAMinutos(horaRegreso)
  if (ini === null || fin === null) return null
  let diff = fin - ini
  if (diff < 0) diff += 24 * 60 // cruza medianoche
  return diff
}

/** Calcula horaRegreso = horaSalida + duracionMin. */
export function calcularHoraRegreso(horaSalida: string, duracionMin: number): string | null {
  const ini = horaAMinutos(horaSalida)
  if (ini === null) return null
  return minutosAHora(ini + duracionMin)
}

/** Convierte minutos a string legible "Xh Ym" o "Xh". */
export function formatearDuracion(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}
