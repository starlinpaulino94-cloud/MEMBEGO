import {
  calcularPrecioEfectivo,
  calcularTotales,
  generarCombinacionesCombo,
  type CombinacionItinerarioCombo,
  type ReglaPrecioDinamico,
  type TotalesReserva,
} from './nucleo'

/**
 * LA PARTE PURA DEL FORMULARIO «NUEVA RESERVA» (auditoría admin · fase 7, tareas 7.2 y 7.4).
 *
 * El formulario eran 1 371 líneas de un solo componente con todo su estado, su lógica de combos, sus totales y su lectura de datos
 * mezclados con el marcado. Lo que se puede decidir sin navegador vive aquí, probado: las fechas, el itinerario del combo, el
 * resumen de importes, la lectura del formulario con el error de CADA campo, y cómo se busca un cliente.
 *
 * Y una regla que sale de un defecto real: **todo campo que la acción lee tiene que viajar en el formulario**. La fecha no viajaba
 * (el asistente de pasos de agosto dejó el campo sin `name`) y «Nueva reserva» no podía crear ninguna. Una prueba compara lo que
 * la acción lee con lo que el formulario manda.
 */

// ── Lo que el formulario recibe de la consulta ──────────────────────────────────────────────────────────────────────

export interface ExcursionOpcion {
  id: string
  nombre: string
  portadaUrl?: string | null
  duracionMin?: number | null
  categoria?: string | null
  tipoItem?: string
  ubicacion?: string | null
  moneda: string
  impuestoPct: number | null
  comboItems?: {
    id: string
    nombre: string
    tipoItem?: string
    duracionMin: number | null
    horaSalida?: string | null
    permitirSolapamiento?: boolean
    horarioFijo?: unknown
    horarios: { id: string; horaSalida: string; diasSemana: number[] }[]
  }[]
  variantes: {
    id: string
    nombre: string
    precioAdulto: number
    precioNino: number | null
    preciosDinamicos?: ReglaPrecioDinamico[]
  }[]
  horarios: { id: string; horaSalida: string; diasSemana: number[] }[]
}

export interface ClienteOpcion {
  id: string
  nombre: string
  email?: string | null
  telefono?: string | null
}

export interface VendedorOpcion {
  id: string
  nombre: string
  apellido?: string | null
  codigo: string
  tipo?: string | null
  estado?: string
}

type ComboItems = NonNullable<ExcursionOpcion['comboItems']>

// ── Fechas ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** `AAAA-MM-DD` con la fecha LOCAL del navegador (la que ve quien usa el formulario), no la de UTC. */
export function fechaLocalISO(d: Date): string {
  const anio = d.getFullYear()
  const mes = String(d.getMonth() + 1).padStart(2, '0')
  const dia = String(d.getDate()).padStart(2, '0')
  return `${anio}-${mes}-${dia}`
}

export function hoyISO(ahora: Date = new Date()): string {
  return fechaLocalISO(ahora)
}

export function diasDespuesISO(dias: number, ahora: Date = new Date()): string {
  const d = new Date(ahora)
  d.setDate(d.getDate() + dias)
  return fechaLocalISO(d)
}

/** Una fecha `AAAA-MM-DD` que existe en el calendario (`2026-02-31` no). */
export function esFechaReal(valor: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false
  const f = new Date(`${valor}T00:00:00.000Z`)
  return !Number.isNaN(f.getTime()) && f.toISOString().slice(0, 10) === valor
}

// ── Combos ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export type ModoComboFechas = 'MISMO_DIA' | 'DIAS_DIFERENTES'
export interface ItemItinerario {
  fecha: string
  hora: string
}
export type ItinerarioMulti = Record<string, ItemItinerario>

/** Los turnos coordinados del combo, sin solapamiento (los calcula el núcleo). */
export function combinacionesDeCombo(comboItems: ComboItems | undefined): CombinacionItinerarioCombo[] {
  if (!comboItems || comboItems.length === 0) return []
  return generarCombinacionesCombo(
    comboItems.map((ci) => ({
      id: ci.id,
      nombre: ci.nombre,
      tipoItem: ci.tipoItem,
      duracionMin: ci.duracionMin,
      horaSalida: ci.horaSalida,
      horarios: ci.horarios || [],
      permitirSolapamiento: ci.permitirSolapamiento,
      horarioFijo: Array.isArray(ci.horarioFijo) ? (ci.horarioFijo as string[]) : null,
    }))
  )
}

/**
 * Identidad del itinerario por días: los ids de las actividades más la fecha. Solo cambia cuando cambió algo de verdad, no cuando
 * el padre vuelve a renderizar con una referencia nueva (que antes borraba lo que se había elegido día por día).
 */
export function claveItinerario(esCombo: boolean, comboItems: ComboItems | undefined, fecha: string): string | null {
  return esCombo && comboItems ? `${fecha}|${comboItems.map((ci) => ci.id).join(',')}` : null
}

/** El itinerario de partida: cada actividad en la fecha elegida y en su hora (el pase de día no lleva hora). */
export function itinerarioInicial(comboItems: ComboItems, fecha: string): ItinerarioMulti {
  const inicial: ItinerarioMulti = {}
  for (const ci of comboItems) {
    inicial[ci.id] = { fecha, hora: ci.tipoItem === 'PASE_DIA' ? '' : ci.horaSalida || '09:00' }
  }
  return inicial
}

/**
 * Lo que viaja en `comboItinerarioJson`: por cada actividad, su fecha y su hora (el pase de día, sin hora). En «días separados»
 * sale de lo que se eligió día por día; en «mismo día», del turno coordinado elegido (o del primero).
 */
export function serializarItinerarioCombo(params: {
  comboItems: ComboItems | undefined
  esCombo: boolean
  modo: ModoComboFechas
  itinerario: ItinerarioMulti
  fecha: string
  combinaciones: CombinacionItinerarioCombo[]
  turnoId: string
}): string {
  const { comboItems, esCombo, modo, itinerario, fecha, combinaciones, turnoId } = params
  if (!esCombo || !comboItems) return ''
  if (modo === 'DIAS_DIFERENTES') {
    return JSON.stringify(
      comboItems.map((ci) => {
        const cfg = itinerario[ci.id] || { fecha, hora: ci.horaSalida }
        return { actividadId: ci.id, fecha: cfg.fecha, hora: ci.tipoItem === 'PASE_DIA' ? null : cfg.hora }
      })
    )
  }
  const turno = combinaciones.find((c) => c.id === turnoId) || combinaciones[0]
  return JSON.stringify(
    comboItems.map((ci) => ({
      actividadId: ci.id,
      fecha,
      hora: ci.tipoItem === 'PASE_DIA' ? null : turno?.horariosAsignados[ci.id] || ci.horaSalida || '09:00',
    }))
  )
}

// ── Resumen de importes ─────────────────────────────────────────────────────────────────────────────────────────────

export interface ResumenReserva extends TotalesReserva {
  precioAdulto: number
  precioNino: number | null
}

/** Los importes que ve quien reserva, con el precio efectivo de ese día y esa hora (reglas dinámicas incluidas). */
export function resumenDeReserva(params: {
  variante: ExcursionOpcion['variantes'][number] | undefined
  impuestoPct: number | null | undefined
  fecha: string
  hora: string
  adultos: number
  ninos: number
  descuento: string
}): ResumenReserva | null {
  const { variante, impuestoPct, fecha, hora, adultos, ninos, descuento } = params
  if (!variante) return null
  const fechaObj = fecha ? new Date(`${fecha}T12:00:00.000Z`) : new Date()
  const { precioAdulto, precioNino } = calcularPrecioEfectivo(
    fechaObj,
    hora,
    variante.precioAdulto,
    variante.precioNino,
    variante.preciosDinamicos ?? null
  )
  const totales = calcularTotales({
    precioAdulto,
    precioNino,
    impuestoPct: impuestoPct ?? 0,
    adultos: adultos || 0,
    ninos: ninos || 0,
    descuento: Number(descuento) || 0,
  })
  return { ...totales, precioAdulto, precioNino }
}

// ── Buscar un cliente ───────────────────────────────────────────────────────────────────────────────────────────────

/** Menos letras que esto y la búsqueda no distingue nada: no se manda. */
export const MIN_BUSQUEDA_CLIENTE = 2
/** Cuántos clientes se muestran. Si hay más, se DICE («hay más: escribe más para afinar»), no se corta en silencio. */
export const LIMITE_BUSQUEDA_CLIENTE = 10
const LARGO_MAXIMO_BUSQUEDA_CLIENTE = 80

/** Lo que se busca, recortado y acotado; vacío si es demasiado corto para buscar. */
export function leerBusquedaCliente(valor: unknown): string {
  const q = (typeof valor === 'string' ? valor : '').trim().slice(0, LARGO_MAXIMO_BUSQUEDA_CLIENTE)
  return q.length >= MIN_BUSQUEDA_CLIENTE ? q : ''
}

/** Un cliente de los resultados, como lo muestra la lista: nombre y, debajo, correo y teléfono. */
export function detalleDeCliente(c: ClienteOpcion): string {
  return [c.email, c.telefono].filter(Boolean).join(' · ')
}

// ── Leer el formulario ──────────────────────────────────────────────────────────────────────────────────────────────

export type CampoReserva =
  | 'excursionId'
  | 'varianteId'
  | 'fecha'
  | 'pasajeros'
  | 'descuento'
  | 'clienteId'
  | 'clienteNombre'
  | 'clienteEmail'
export type ErroresReserva = Partial<Record<CampoReserva, string>>

export interface ReservaLeida {
  excursionId: string
  varianteId: string
  vendedorId: string
  clienteId: string
  clienteNombre: string
  clienteEmail: string
  clienteTelefono: string
}

const CORREO_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function texto(formData: FormData, nombre: string): string {
  const v = formData.get(nombre)
  return typeof v === 'string' ? v.trim() : ''
}

function enteroNoNegativo(formData: FormData, nombre: string): number {
  const n = Number(texto(formData, nombre))
  return Number.isInteger(n) && n >= 0 ? n : 0
}

/**
 * Lo que `crearReserva` necesita saber ANTES de tocar la base, con el error de cada campo (y no uno solo por intento). La
 * disponibilidad, los precios y el aprovisionamiento del cliente siguen siendo de la acción: eso solo se sabe con la base.
 *
 * `modoCliente` dice qué campos de cliente aplican: «EXISTENTE» (uno elegido de la búsqueda) o «NUEVO» (nombre y correo).
 */
export function leerReservaDeFormulario(
  formData: FormData
): { ok: true; datos: ReservaLeida } | { ok: false; error: string; campos: ErroresReserva } {
  const campos: ErroresReserva = {}

  const excursionId = texto(formData, 'excursionId')
  const varianteId = texto(formData, 'varianteId')
  if (!excursionId) campos.excursionId = 'Elige la excursión o el paquete.'
  else if (!varianteId) campos.varianteId = 'Elige una opción de tarifa.'

  if (!esFechaReal(texto(formData, 'fecha'))) campos.fecha = 'Elige la fecha de la excursión.'

  if (enteroNoNegativo(formData, 'adultos') + enteroNoNegativo(formData, 'ninos') === 0) {
    campos.pasajeros = 'Una reserva necesita al menos un pasajero.'
  }

  const descuento = texto(formData, 'descuento')
  if (descuento !== '' && !(Number.isFinite(Number(descuento)) && Number(descuento) >= 0)) {
    campos.descuento = 'El descuento tiene que ser un número, cero o más.'
  }

  const modo = texto(formData, 'modoCliente')
  const clienteId = modo === 'NUEVO' ? '' : texto(formData, 'clienteId')
  const clienteNombre = modo === 'EXISTENTE' ? '' : texto(formData, 'clienteNombre')
  const clienteEmail = modo === 'EXISTENTE' ? '' : texto(formData, 'clienteEmail').toLowerCase()
  const clienteTelefono = modo === 'EXISTENTE' ? '' : texto(formData, 'clienteTelefono')

  if (!clienteId) {
    if (modo === 'NUEVO' || clienteNombre || clienteEmail) {
      if (!clienteNombre) campos.clienteNombre = 'Escribe el nombre y apellido del cliente.'
      if (!clienteEmail) campos.clienteEmail = 'Escribe el correo del cliente.'
      else if (!CORREO_RE.test(clienteEmail)) campos.clienteEmail = 'Ese correo no parece válido.'
    } else {
      campos.clienteId = 'Elige un cliente de la búsqueda o crea uno nuevo.'
    }
  }

  const mensajes = Object.values(campos)
  if (mensajes.length > 0) {
    return {
      ok: false,
      error: mensajes.length === 1 ? mensajes[0]! : `Hay ${mensajes.length} campos por corregir.`,
      campos,
    }
  }

  return {
    ok: true,
    datos: {
      excursionId,
      varianteId,
      vendedorId: texto(formData, 'vendedorId'),
      clienteId,
      clienteNombre,
      clienteEmail,
      clienteTelefono,
    },
  }
}

// ── Teclado de la lista de resultados ───────────────────────────────────────────────────────────────────────────────

/**
 * La opción activa de una lista de resultados al pulsar flecha abajo (+1) o arriba (−1). Da la vuelta en los extremos; sin
 * resultados no hay opción activa (−1). Sin ninguna activa, abajo va a la primera y arriba a la última.
 */
export function moverActivo(actual: number, total: number, delta: 1 | -1): number {
  if (total <= 0) return -1
  if (actual < 0 || actual >= total) return delta === 1 ? 0 : total - 1
  return (actual + delta + total) % total
}
