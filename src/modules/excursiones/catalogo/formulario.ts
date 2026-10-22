import { minutosDesdeMedianoche } from '../reservas/nucleo'

/**
 * LA PARTE PURA DEL FORMULARIO DE EXCURSIÓN (auditoría admin · fase 7, tarea 7.2).
 *
 * `ExcursionForm` eran 1 641 líneas: sus presets, sus cuentas de combos, su lectura de datos y todo su marcado en un archivo. Lo
 * que se decide sin navegador vive aquí, con sus pruebas: cómo se agregan y quitan horas y días, qué se deriva de las actividades
 * de un combo, cuánto ahorra el cliente con un combo, cómo se agrupan los bloques del itinerario y, sobre todo, la lectura del
 * formulario con el error de CADA campo (antes la acción devolvía un solo mensaje, y los campos de texto se borraban al fallar).
 */

// ── Datos de apoyo ──────────────────────────────────────────────────────────────────────────────────────────────────

export const CATEGORIAS_SUGERIDAS = [
  'Playa y Catamarán',
  'Aventura y Buggies',
  'Ecoturismo y Montaña',
  'Cultural e Histórica',
  'Paseo en Barco',
  'Snorkel y Buceo',
  'Gastronómica',
] as const

export const DURACION_PRESETS = [
  { label: '1 hora', horas: 1 },
  { label: '2 horas', horas: 2 },
  { label: '3 horas', horas: 3 },
  { label: '4 horas (medio día)', horas: 4 },
  { label: '6 horas', horas: 6 },
  { label: '8 horas (día completo)', horas: 8 },
  { label: '10 horas', horas: 10 },
] as const

export const HORAS_PRESETS = ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00'] as const

export const DIAS_NOMBRES: Record<number, string> = { 1: 'Lun', 2: 'Mar', 3: 'Mié', 4: 'Jue', 5: 'Vie', 6: 'Sáb', 7: 'Dom' }

export const TODOS_LOS_DIAS = [1, 2, 3, 4, 5, 6, 7]

export type TipoItem = 'ACTIVIDAD' | 'COMBO' | 'PASE_DIA'

/** Una actividad que puede formar parte de un combo, como la ofrece la consulta. */
export interface ActividadParaComboItem {
  id: string
  nombre: string
  tipoItem?: string
  categoria: string | null
  moneda?: string
  duracionMin?: number | null
  horaSalida?: string | null
  horaRegreso?: string | null
  capacidad?: number | null
  precioAdulto?: number | null
  precioNino?: number | null
  horarios?: { id: string; horaSalida: string; diasSemana: number[]; cupo?: number | null }[]
}

// ── Horas y días ────────────────────────────────────────────────────────────────────────────────────────────────────

const HORA_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

/** `14:30` → `2:30 PM`. Lo que no es una hora se deja como viene. */
export function formato12h(h24: string): string {
  if (!h24 || !h24.includes(':')) return h24
  const [hStr, mStr] = h24.split(':')
  const h = parseInt(hStr, 10)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 || 12
  return `${h12}:${mStr} ${ampm}`
}

/** Las horas de salida con una más: sin repetir, ordenadas, y una hora que no es hora no se agrega. */
export function agregarHoraSalida(horas: string[], hora: string): string[] {
  const limpia = hora.trim().slice(0, 5)
  if (!HORA_RE.test(limpia) || horas.includes(limpia)) return horas
  return [...horas, limpia].sort()
}

/** Quita una hora, pero siempre queda al menos una: sin ninguna, la excursión no sale nunca. */
export function quitarHoraSalida(horas: string[], hora: string): { horas: string[]; error?: string } {
  if (horas.length <= 1) return { horas, error: 'Debe haber al menos una hora de salida' }
  return { horas: horas.filter((h) => h !== hora) }
}

/** Marca o desmarca un día, pero siempre queda al menos uno. */
export function alternarDia(dias: number[], dia: number): { dias: number[]; error?: string } {
  if (dias.includes(dia)) {
    if (dias.length <= 1) return { dias, error: 'Debe seleccionar al menos un día de salida' }
    return { dias: dias.filter((d) => d !== dia) }
  }
  return { dias: [...dias, dia].sort() }
}

export function diasDePreset(tipo: 'todos' | 'laborables' | 'finde'): number[] {
  if (tipo === 'laborables') return [1, 2, 3, 4, 5]
  if (tipo === 'finde') return [6, 7]
  return [...TODOS_LOS_DIAS]
}

/** Lo que viaja en `horariosData`: cada hora de salida con los días en que opera. */
export function horariosDataJson(horas: string[], dias: number[]): string {
  return JSON.stringify(horas.map((h) => ({ horaSalida: h, diasSemana: dias, cupo: null })))
}

/** Los minutos de recorrido que corresponden a unas horas de duración (mínimo 15). */
export function duracionEnMinutos(horas: number): number {
  return Math.max(15, Math.round(horas * 60))
}

// ── Combos ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * De qué se deriva la duración y la primera hora de un combo: del inicio más temprano de sus actividades al regreso más tardío
 * (la hora de regreso de cada una o, sin ella, su salida más su duración; 2 horas si no la declara).
 */
export function derivarDeCombo(
  actividades: ActividadParaComboItem[],
  horarioFijo: Record<string, string[]>
): { duracionHoras: number | null; primeraHora: string | null } {
  if (actividades.length === 0) return { duracionHoras: null, primeraHora: null }
  const horaBaseDe = (a: ActividadParaComboItem): string => {
    const fijos = horarioFijo[a.id]
    return fijos && fijos.length > 0 ? fijos[0] : a.horaSalida || (a.horarios && a.horarios.length > 0 ? a.horarios[0].horaSalida : '09:00')
  }
  let minInicio = Infinity
  let maxFin = 0
  for (const a of actividades) {
    const inicio = minutosDesdeMedianoche(horaBaseDe(a).trim().slice(0, 5))
    if (inicio < minInicio) minInicio = inicio
    const fin = a.horaRegreso
      ? minutosDesdeMedianoche(a.horaRegreso.trim().slice(0, 5))
      : inicio + (a.duracionMin && a.duracionMin > 0 ? a.duracionMin : 120)
    if (fin > maxFin) maxFin = fin
  }
  if (!(minInicio < Infinity && maxFin > 0)) return { duracionHoras: null, primeraHora: null }
  const total = maxFin - minInicio
  return {
    duracionHoras: total > 0 ? Number((total / 60).toFixed(1)) : null,
    primeraHora: horaBaseDe(actividades[0]).trim().slice(0, 5),
  }
}

/** Lo que costarían las actividades del combo por separado (el niño paga como adulto si no tiene precio propio). */
export function sumaDePrecios(actividades: ActividadParaComboItem[]): { adulto: number; nino: number } | null {
  if (actividades.length === 0) return null
  return {
    adulto: actividades.reduce((acc, a) => acc + (a.precioAdulto || 0), 0),
    nino: actividades.reduce((acc, a) => acc + (a.precioNino != null ? a.precioNino : a.precioAdulto || 0), 0),
  }
}

/** Cuánto ahorra el cliente con el precio del combo frente a la suma de sus actividades; nada si no hay precio o no es menor. */
export function ahorroDeCombo(
  suma: { adulto: number } | null,
  precioAdulto: string
): { ahorro: number; pct: number } | null {
  if (!suma || !precioAdulto) return null
  const precioCombo = parseFloat(precioAdulto) || 0
  if (precioCombo <= 0 || suma.adulto <= 0) return null
  const ahorro = suma.adulto - precioCombo
  return { ahorro, pct: Math.round((ahorro / suma.adulto) * 100) }
}

interface BloqueAnidable {
  id?: string
  inicio: string
  fin: string
  permitirSolapamiento?: boolean
}

/**
 * Los bloques del itinerario como los ve quien lo lee: cada actividad que se permite solapar CONTIENE a las que caen enteras
 * dentro de su horario (esas se muestran anidadas); las demás van sueltas, en su orden.
 */
export function agruparBloques<B extends BloqueAnidable>(bloques: B[]): { raiz: B[]; hijosDe: (bloque: B) => B[] } {
  const contenedorDe = new Map<string, B>()
  for (const b of bloques) {
    if (!b.permitirSolapamiento) continue
    const bInicio = minutosDesdeMedianoche(b.inicio)
    const bFin = minutosDesdeMedianoche(b.fin)
    for (const c of bloques) {
      if (c.id === b.id || c.permitirSolapamiento) continue
      if (minutosDesdeMedianoche(c.inicio) >= bInicio && minutosDesdeMedianoche(c.fin) <= bFin) contenedorDe.set(c.id!, b)
    }
  }
  return {
    raiz: bloques.filter((b) => !contenedorDe.has(b.id!)),
    hijosDe: (bloque) => bloques.filter((b) => contenedorDe.get(b.id!)?.id === bloque.id),
  }
}

/**
 * La identidad de lo que alimenta la derivación de un combo: sus actividades, los días comunes, los turnos y el itinerario. Se
 * compara por CONTENIDO: con referencias, cada render parecía un cambio y se pisaba lo que el administrador acababa de escribir.
 */
export function claveDeCombo(params: {
  tipoItem: TipoItem
  actividadIds: string[]
  diasComunes: number[]
  combinaciones: { horaInicio: string; duracionTotalMin: number }[]
  bloques: { inicio: string; fin: string }[]
}): string | null {
  if (params.tipoItem !== 'COMBO' || params.actividadIds.length === 0) return null
  return [
    params.actividadIds.join(','),
    params.diasComunes.join(','),
    params.combinaciones.map((c) => `${c.horaInicio}:${c.duracionTotalMin}`).join(','),
    params.bloques.map((i) => `${i.inicio}-${i.fin}`).join(','),
  ].join('|')
}

// ── Leer el formulario ──────────────────────────────────────────────────────────────────────────────────────────────

export type CampoExcursion =
  | 'nombre'
  | 'capacidad'
  | 'impuestoPct'
  | 'precioAdulto'
  | 'precioNino'
  | 'precioResidente'
  | 'precioNinoResidente'
  | 'horasSalida'
  | 'actividadesComboIds'
export type ErroresExcursion = Partial<Record<CampoExcursion, string>>

function texto(formData: FormData, nombre: string): string {
  const v = formData.get(nombre)
  return typeof v === 'string' ? v.trim() : ''
}

const esNumero = (s: string) => s !== '' && Number.isFinite(Number(s))

/**
 * Lo que `crearExcursion` y `actualizarExcursion` pueden saber ANTES de tocar la base, con el error de cada campo (y no uno solo
 * por intento). Lo que depende de la base (qué actividades existen, si un horario se cruza) sigue siendo de la acción.
 *
 * Dos cosas que el servidor hacía en silencio ahora se dicen: una capacidad que no es un entero positivo se guardaba como «sin
 * capacidad» y un precio opcional ilegible se guardaba como vacío.
 *
 * `modo` decide si se pide el precio base: al CREAR nace la variante «Estándar»; al editar, los precios viven en el editor de
 * variantes y este formulario no los manda.
 */
export function leerExcursionDeFormulario(
  formData: FormData,
  modo: 'crear' | 'editar'
): { ok: true } | { ok: false; error: string; campos: ErroresExcursion } {
  const campos: ErroresExcursion = {}
  const tipoItem = (texto(formData, 'tipoItem').toUpperCase() || 'ACTIVIDAD') as TipoItem

  if (texto(formData, 'nombre').length < 3) campos.nombre = 'Escribe el nombre de la excursión (al menos 3 letras).'

  const capacidad = texto(formData, 'capacidad')
  if (capacidad !== '' && !(Number.isInteger(Number(capacidad)) && Number(capacidad) >= 1 && Number(capacidad) <= 100_000)) {
    campos.capacidad = 'La capacidad es un número entero, de 1 en adelante.'
  }

  const impuesto = texto(formData, 'impuestoPct')
  if (impuesto !== '' && !(esNumero(impuesto) && Number(impuesto) >= 0 && Number(impuesto) <= 100)) {
    campos.impuestoPct = 'El impuesto es un porcentaje: entre 0 y 100.'
  }

  if (modo === 'crear') {
    const adulto = texto(formData, 'precioAdulto')
    if (!esNumero(adulto) || Number(adulto) <= 0) campos.precioAdulto = 'El precio por adulto es obligatorio y mayor que cero.'
    for (const campo of ['precioNino', 'precioResidente', 'precioNinoResidente'] as const) {
      const v = texto(formData, campo)
      if (v !== '' && !(esNumero(v) && Number(v) >= 0)) campos[campo] = 'Escribe un precio válido: cero o más.'
    }
  }

  if (tipoItem !== 'PASE_DIA') {
    let hayHora = false
    try {
      const parsed: unknown = JSON.parse(texto(formData, 'horariosData') || '[]')
      hayHora = Array.isArray(parsed) && parsed.some((h) => HORA_RE.test(String((h as { horaSalida?: unknown })?.horaSalida ?? '').trim().slice(0, 5)))
    } catch {
      hayHora = false
    }
    if (!hayHora) campos.horasSalida = 'Agrega al menos una hora de salida.'
  }

  if (tipoItem === 'COMBO') {
    const actividades = new Set(formData.getAll('actividadesComboIds').map((id) => String(id).trim()).filter(Boolean))
    if (actividades.size < 2) campos.actividadesComboIds = 'Un combo debe incluir al menos 2 actividades del catálogo.'
  }

  const mensajes = Object.values(campos)
  if (mensajes.length === 0) return { ok: true }
  return {
    ok: false,
    error: mensajes.length === 1 ? mensajes[0]! : `Hay ${mensajes.length} campos por corregir.`,
    campos,
  }
}
