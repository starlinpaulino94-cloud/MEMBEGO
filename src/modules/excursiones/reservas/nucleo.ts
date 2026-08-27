/**
 * EXCURSIONES · Reservas — NÚCLEO PURO (sin Prisma, sin red).
 *
 * Aquí vive la aritmética del dinero y la máquina de estados de la reserva.
 * Puro a propósito: el total de una reserva y el saldo pendiente son las dos
 * cifras que después mandan sobre las comisiones, y una cifra que no se puede
 * probar sin base de datos es una cifra en la que no se puede confiar.
 *
 * Dos reglas que no se negocian:
 * - Los PRECIOS nunca vienen del navegador. Estas funciones reciben los
 *   precios que el servidor leyó del catálogo (§57).
 * - Un pago no se borra: se ANULA con un movimiento nuevo. El saldo siempre
 *   sale de sumar los movimientos vivos, jamás de un contador guardado (§99).
 */

// ── Estados ──────────────────────────────────────────────────────────────────

export const ESTADOS_RESERVA = [
  'PENDIENTE',
  'CONFIRMADA',
  'PARCIALMENTE_PAGADA',
  'PAGADA',
  'COMPLETADA',
  'CANCELADA',
  'NO_SHOW',
] as const
export type EstadoReserva = (typeof ESTADOS_RESERVA)[number]

export const ESTADO_RESERVA_LABEL: Record<EstadoReserva, string> = {
  PENDIENTE: 'Pendiente',
  CONFIRMADA: 'Confirmada',
  PARCIALMENTE_PAGADA: 'Abonada',
  PAGADA: 'Pagada',
  COMPLETADA: 'Completada',
  CANCELADA: 'Cancelada',
  NO_SHOW: 'No se presentó',
}

export const TONO_RESERVA: Record<EstadoReserva, 'success' | 'warning' | 'neutral' | 'info' | 'danger'> = {
  PENDIENTE: 'warning',
  CONFIRMADA: 'info',
  PARCIALMENTE_PAGADA: 'warning',
  PAGADA: 'success',
  COMPLETADA: 'success',
  CANCELADA: 'neutral',
  NO_SHOW: 'danger',
}

/**
 * Estados CERRADOS: la reserva ya no se mueve sola. Un pago que llegue tarde
 * no puede resucitar una reserva cancelada ni «despagar» una completada.
 */
export const ESTADOS_CERRADOS: EstadoReserva[] = ['COMPLETADA', 'CANCELADA', 'NO_SHOW']

export const METODOS_PAGO = [
  'EFECTIVO',
  'TARJETA',
  'TRANSFERENCIA',
  'DEPOSITO',
  'LINK',
] as const
export type MetodoPago = (typeof METODOS_PAGO)[number]

export const METODO_PAGO_LABEL: Record<MetodoPago, string> = {
  EFECTIVO: 'Efectivo',
  TARJETA: 'Tarjeta',
  TRANSFERENCIA: 'Transferencia',
  DEPOSITO: 'Depósito',
  LINK: 'Enlace de pago',
}

// ── Numeración ───────────────────────────────────────────────────────────────

/** EXC-2026-000184: prefijo + año + correlativo de 6 dígitos (§17). */
export function numeroReserva(prefijo: string, anio: number, n: number): string {
  const p = (prefijo || 'EXC').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'EXC'
  return `${p}-${anio}-${String(Math.max(1, Math.trunc(n))).padStart(6, '0')}`
}

// ── Dinero ───────────────────────────────────────────────────────────────────

/** Redondeo a 2 decimales, siempre en el servidor. */
export function centavos(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100
}

export interface TotalesReserva {
  subtotal: number
  descuento: number
  impuestos: number
  total: number
}

/**
 * El total de la reserva a partir de los precios del CATÁLOGO. El descuento se
 * aplica antes del impuesto (se cobra impuesto sobre lo realmente cobrado) y
 * nunca deja el total en negativo: un descuento mayor que el subtotal deja la
 * reserva en cero, no en deuda de la empresa.
 */
export function calcularTotales(params: {
  adultos: number
  ninos: number
  precioAdulto: number
  precioNino: number | null
  descuento?: number
  impuestoPct?: number | null
}): TotalesReserva {
  const adultos = Math.max(0, Math.trunc(params.adultos || 0))
  const ninos = Math.max(0, Math.trunc(params.ninos || 0))
  // Sin precio de niño, el niño paga como adulto: es lo que hace el negocio
  // cuando la excursión no distingue, y cobrar 0 por descuido sería peor.
  const pNino = params.precioNino ?? params.precioAdulto

  const subtotal = centavos(adultos * params.precioAdulto + ninos * pNino)
  const descuento = Math.min(centavos(Math.max(0, params.descuento ?? 0)), subtotal)
  const base = centavos(subtotal - descuento)
  const pct = params.impuestoPct ?? 0
  const impuestos = pct > 0 ? centavos(base * (pct / 100)) : 0
  return { subtotal, descuento, impuestos, total: centavos(base + impuestos) }
}

export interface ReglaPrecioDinamico {
  diasSemana?: number[]
  horasSalida?: string[]
  precioAdulto: number
  precioNino: number | null
}

/**
 * Resuelve el precio efectivo de una variante evaluando reglas dinámicas (ej. por día u hora).
 * Retorna el precio base si ninguna regla coincide.
 */
export function calcularPrecioEfectivo(
  fecha: Date,
  hora: string | null,
  baseAdulto: number,
  baseNino: number | null,
  reglas: ReglaPrecioDinamico[] | null
): { precioAdulto: number; precioNino: number | null } {
  if (!reglas || reglas.length === 0) {
    return { precioAdulto: baseAdulto, precioNino: baseNino }
  }

  // Mapeo ISO día semana (1=Lun...7=Dom) a JS Date (0=Dom...6=Sáb)
  const DIA_ISO_A_JS: Record<number, number> = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 0 }
  const diaSemanaJS = fecha.getUTCDay()
  const diaISO = Object.entries(DIA_ISO_A_JS).find(([, v]) => v === diaSemanaJS)?.[0]
  const diaISONum = diaISO ? Number(diaISO) : null
  const horaNormalizada = hora ? hora.trim().slice(0, 5) : null

  for (const regla of reglas) {
    const cumpleDia = !regla.diasSemana || regla.diasSemana.length === 0 || (diaISONum !== null && regla.diasSemana.includes(diaISONum))
    const cumpleHora = !regla.horasSalida || regla.horasSalida.length === 0 || (horaNormalizada && regla.horasSalida.includes(horaNormalizada))

    if (cumpleDia && cumpleHora) {
      return {
        precioAdulto: regla.precioAdulto,
        precioNino: regla.precioNino
      }
    }
  }

  return { precioAdulto: baseAdulto, precioNino: baseNino }
}

export interface PagoVivo {
  monto: number
  estado: string
}

export interface SaldoReserva {
  pagado: number
  saldo: number
  /** true cuando ya no debe nada (incluye el total en cero). */
  liquidada: boolean
}

/** Suma SOLO los pagos vivos: un pago anulado deja de contar, no se borra. */
export function calcularSaldo(total: number, pagos: PagoVivo[]): SaldoReserva {
  const pagado = centavos(
    pagos.filter((p) => p.estado === 'REGISTRADO').reduce((suma, p) => suma + (p.monto || 0), 0)
  )
  const saldo = centavos(Math.max(0, total - pagado))
  return { pagado, saldo, liquidada: saldo <= 0 }
}

/**
 * El estado que le toca a la reserva según lo que lleva pagado. No decide
 * sobre reservas cerradas (canceladas, completadas, no-show): esas solo se
 * mueven a mano, y un pago tardío no puede resucitarlas.
 */
export function estadoPorPagos(
  estadoActual: EstadoReserva,
  total: number,
  pagado: number
): EstadoReserva {
  if (ESTADOS_CERRADOS.includes(estadoActual)) return estadoActual
  if (pagado <= 0) return estadoActual === 'CONFIRMADA' ? 'CONFIRMADA' : 'PENDIENTE'
  if (centavos(pagado) >= centavos(total)) return 'PAGADA'
  return 'PARCIALMENTE_PAGADA'
}

// ── Validación ───────────────────────────────────────────────────────────────

function texto(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

function entero(v: unknown, max: number): number {
  const s = typeof v === 'string' ? v.trim() : String(v ?? '')
  const n = Number(s)
  return Number.isInteger(n) && n >= 0 && n <= max ? n : 0
}

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/
export function normalizarHora(v: unknown): string | null {
  const s = texto(v, 8)
  const m = s.match(/^([01]?\d|2[0-3]):([0-5]\d)$/)
  if (!m) return null
  const hh = m[1].padStart(2, '0')
  const mm = m[2]
  return `${hh}:${mm}`
}

export interface ReservaDatos {
  fecha: Date
  hora: string | null
  adultos: number
  ninos: number
  descuento: number
  notas: string | null
  canal: string | null
  voucherAgencia: string | null
  hotelRecogida: string | null
  lobbyRecogida: string | null
  horaRecogida: string | null
  habitacion: string | null
}

/**
 * Lo que el navegador puede decidir de una reserva: cuándo, cuántos y las
 * notas. Los precios NO: esos los pone el servidor desde el catálogo.
 */
export function validarReserva(
  form: Record<string, unknown>
): { ok: true; datos: ReservaDatos } | { ok: false; error: string } {
  const fechaS = texto(form.fecha, 10)
  if (!FECHA_RE.test(fechaS)) return { ok: false, error: 'Elige la fecha de la excursión.' }
  const fecha = new Date(`${fechaS}T12:00:00.000Z`)
  if (Number.isNaN(fecha.getTime())) return { ok: false, error: 'La fecha no es válida.' }

  const adultos = entero(form.adultos, 500)
  const ninos = entero(form.ninos, 500)
  if (adultos + ninos === 0) {
    return { ok: false, error: 'Una reserva necesita al menos un pasajero.' }
  }

  const descuento = Number(texto(form.descuento, 12) || '0')

  return {
    ok: true,
    datos: {
      fecha,
      hora: normalizarHora(form.hora),
      adultos,
      ninos,
      descuento: Number.isFinite(descuento) && descuento > 0 ? centavos(descuento) : 0,
      notas: texto(form.notas, 1000) || null,
      canal: texto(form.canal, 40) || null,
      voucherAgencia: texto(form.voucherAgencia, 60).toUpperCase() || null,
      hotelRecogida: texto(form.hotelRecogida, 120) || null,
      lobbyRecogida: texto(form.lobbyRecogida, 80) || null,
      horaRecogida: normalizarHora(form.horaRecogida),
      habitacion: texto(form.habitacion, 30) || null,
    },
  }
}

export interface PagoDatos {
  monto: number
  metodo: string
  referencia: string | null
  notas: string | null
}

/**
 * Un pago se valida contra el SALDO REAL, no contra lo que diga la pantalla.
 * Cobrar de más no es un abono: es un descuadre que después nadie sabe
 * explicar, así que se rechaza con el saldo exacto en el mensaje.
 */
export function validarPago(
  form: Record<string, unknown>,
  saldo: number
): { ok: true; datos: PagoDatos } | { ok: false; error: string } {
  const monto = centavos(Number(texto(form.monto, 12)))
  if (!Number.isFinite(monto) || monto <= 0) {
    return { ok: false, error: 'El monto del pago debe ser mayor que cero.' }
  }
  if (saldo <= 0) return { ok: false, error: 'Esta reserva ya está saldada.' }
  if (monto > centavos(saldo)) {
    return { ok: false, error: `El pago excede el saldo pendiente (${centavos(saldo)}).` }
  }
  const metodo = texto(form.metodo, 40).toUpperCase() || 'EFECTIVO'
  if (!(METODOS_PAGO as readonly string[]).includes(metodo)) {
    return { ok: false, error: `Método de pago no válido: ${metodo}. Use: ${METODOS_PAGO.join(', ')}.` }
  }
  return {
    ok: true,
    datos: {
      monto,
      metodo,
      referencia: texto(form.referencia, 120) || null,
      notas: texto(form.notas, 500) || null,
    },
  }
}

/** Mapeo ISO día semana (1=Lun...7=Dom) a JS Date (0=Dom...6=Sáb). */
const DIA_ISO_A_JS: Record<number, number> = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 0 }

export interface ExcursionParaDisponibilidad {
  capacidad: number | null
  tipoItem?: string | null
  horaSalida?: string | null
  horarios?: { id: string; diasSemana: number[]; horaSalida: string; cupo: number | null }[]
}

/**
 * Cupo que se asume cuando la excursión no declara capacidad.
 * Ver la nota en `validarDisponibilidad`: es una decisión de negocio abierta.
 */
export const CAPACIDAD_SIN_DECLARAR = 50

/** Valida disponibilidad de cupo para una fecha/hora dada. */
export function validarDisponibilidad(
  fecha: Date,
  hora: string | null,
  pasajeros: number,
  excursion: ExcursionParaDisponibilidad
): { ok: true; cupoDisponible: number } | { ok: false; error: string } {
  // PENDIENTE DE CONFIRMAR (regla comercial): qué hacer cuando la excursión no
  // declara capacidad. Antes se rechazaba la reserva; esta rama asume este
  // cupo. Asumir de más puede sobrevender; rechazar bloquea excursiones que el
  // operador no terminó de configurar. Queda con nombre y a la vista, no
  // escondido como un número suelto dentro de una condición.
  const capacidad =
    excursion.capacidad && excursion.capacidad > 0 ? excursion.capacidad : CAPACIDAD_SIN_DECLARAR

  // 1. Fecha >= hoy
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  const fechaDate = new Date(fecha)
  fechaDate.setHours(0, 0, 0, 0)
  if (fechaDate < hoy) return { ok: false, error: 'La fecha no puede ser anterior a hoy.' }

  const esPaseDia = excursion.tipoItem === 'PASE_DIA'

  // Extraer día de la semana a partir de la fecha (usar getUTCDay() si fue parseada en UTC)
  const diaSemanaJS = fecha.getUTCDay() // 0=Dom...6=Sáb
  const diaISO = Object.entries(DIA_ISO_A_JS).find(([, v]) => v === diaSemanaJS)?.[0]
  const diaISONum = diaISO ? Number(diaISO) : null

  if (esPaseDia) {
    // Para PASE_DIA: No requiere hora fija de salida
    // Si tiene horarios configurados con días de operación, validar el día
    if (excursion.horarios && excursion.horarios.length > 0) {
      const operaEnDia = excursion.horarios.some((h) => {
        const dias = Array.isArray(h.diasSemana) ? h.diasSemana.map(Number) : []
        return dias.length === 0 || (diaISONum !== null && dias.includes(diaISONum))
      })
      if (!operaEnDia) {
        return { ok: false, error: 'El pase de día no opera en el día seleccionado.' }
      }
    }
    return { ok: true, cupoDisponible: capacidad }
  }

  // 2. Hora requerida
  if (!hora) return { ok: false, error: 'Debes seleccionar una hora de salida.' }

  const horaNormalizada = hora.trim().slice(0, 5)

  // Si no hay horarios definidos pero la excursión tiene horaSalida directa:
  const effectiveHorarios =
    excursion.horarios && excursion.horarios.length > 0
      ? excursion.horarios
      : excursion.horaSalida
        ? [
            {
              id: 'default',
              diasSemana: [1, 2, 3, 4, 5, 6, 7],
              horaSalida: excursion.horaSalida,
              cupo: null,
            },
          ]
        : []

  // 3. Buscar horario que coincida con día de la semana y hora
  const horario = effectiveHorarios.find((h) => {
    const horaH = (h.horaSalida || '').trim().slice(0, 5)
    if (horaH !== horaNormalizada) return false
    const dias = Array.isArray(h.diasSemana) ? h.diasSemana.map(Number) : []
    return dias.length === 0 || (diaISONum !== null && dias.includes(diaISONum))
  })

  if (!horario && effectiveHorarios.length > 0) {
    return { ok: false, error: 'La excursión no opera en el día seleccionado o para la hora indicada.' }
  }

  // 4. Validar que la hora seleccionada no haya pasado si la fecha es hoy
  const hoyStr = hoy.toISOString().split('T')[0]
  const fechaStr = fecha.toISOString().split('T')[0]
  if (fechaStr === hoyStr) {
    const [hStr, mStr] = horaNormalizada.split(':')
    const ahora = new Date()
    const horaNum = Number(hStr || 0)
    const minNum = Number(mStr || 0)
    const salidaHoy = new Date()
    salidaHoy.setHours(horaNum, minNum, 0, 0)
    if (salidaHoy.getTime() < ahora.getTime()) {
      return { ok: false, error: 'La hora seleccionada para el día de hoy ya ha pasado.' }
    }
  }

  // 5. Cupo. OJO: esta función es PURA y no consulta la base, así que aquí no
  //    se puede saber el cupo real. El cupo de verdad —capacidad menos
  //    reservas vivas, y el `cupo` propio del horario— lo valida la acción del
  //    servidor, que sí puede contar. Ese reparto no se toca aquí.

  return { ok: true, cupoDisponible: capacidad }
}

/** Convierte una hora en formato "HH:mm" a minutos desde las 00:00 */
export function minutosDesdeMedianoche(hora: string): number {
  if (!hora || !hora.includes(':')) return 0
  const [h, m] = hora.trim().slice(0, 5).split(':').map((x) => parseInt(x, 10) || 0)
  return h * 60 + m
}

/** Convierte minutos desde las 00:00 a formato "HH:mm" */
export function formatoMinutosAHora(minutos: number): string {
  const norm = ((minutos % 1440) + 1440) % 1440
  const h = Math.floor(norm / 60)
  const m = norm % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/**
 * Calcula la intersección estricta de días de la semana (1..7) entre múltiples actividades.
 * Todas las actividades del combo deben operar en esos días.
 */
export function diasComunesCombo(
  actividades: {
    horarios?: { diasSemana: number[] }[]
    horaSalida?: string | null
  }[]
): number[] {
  if (!actividades || actividades.length === 0) return [1, 2, 3, 4, 5, 6, 7]

  const setsDeDias: Set<number>[] = actividades.map((act) => {
    const conjunto = new Set<number>()
    if (act.horarios && act.horarios.length > 0) {
      for (const h of act.horarios) {
        const dias = Array.isArray(h.diasSemana) ? h.diasSemana : []
        if (dias.length === 0) {
          ;[1, 2, 3, 4, 5, 6, 7].forEach((d) => conjunto.add(d))
        } else {
          dias.forEach((d) => conjunto.add(Number(d)))
        }
      }
    } else {
      // Si no tiene horarios pero existe la actividad, asumimos todos los días
      ;[1, 2, 3, 4, 5, 6, 7].forEach((d) => conjunto.add(d))
    }
    return conjunto
  })

  // Intersección de todos los conjuntos
  const primerSet = setsDeDias[0] || new Set([1, 2, 3, 4, 5, 6, 7])
  const comunes = Array.from(primerSet).filter((dia) =>
    setsDeDias.every((s) => s.has(dia))
  )

  return comunes.sort((a, b) => a - b)
}

export interface ActividadParaItinerario {
  id?: string
  nombre: string
  tipoItem?: string | null
  horaSalida?: string | null
  duracionMin?: number | null
  horaRegreso?: string | null
  horarios?: { id?: string; horaSalida: string; cupo?: number | null; diasSemana?: number[] }[]
  permitirSolapamiento?: boolean
}

export interface BloqueItinerario {
  id?: string
  nombre: string
  inicio: string
  fin: string
  duracionMin: number
  permitirSolapamiento?: boolean
}

/**
 * Valida que las actividades del combo no se solapen en sus horas dentro del mismo día.
 * Las actividades de tipo PASE_DIA (acceso libre) no generan conflicto de solapamiento.
 * Ordena cronológicamente las actividades y verifica que inicio(i+1) >= fin(i).
 */
export function validarItinerarioCombo(
  actividades: ActividadParaItinerario[]
): { ok: boolean; itinerario: BloqueItinerario[]; error?: string } {
  if (actividades.length === 0) {
    return { ok: true, itinerario: [] }
  }

  // Filtrar exclusivamente las actividades que tienen horario/turnos programados
  const actividadesConHorario = actividades.filter((a) => a.tipoItem !== 'PASE_DIA')

  // Si no hay actividades con horario, no hay solapamiento de horas
  if (actividadesConHorario.length === 0) {
    return { ok: true, itinerario: [] }
  }

  if (actividadesConHorario.length === 1) {
    const a = actividadesConHorario[0]
    const inicio = (a.horaSalida || '09:00').trim().slice(0, 5)
    const duracion = a.duracionMin && a.duracionMin > 0 ? a.duracionMin : 120
    const fin =
      a.horaRegreso?.trim().slice(0, 5) ||
      formatoMinutosAHora(minutosDesdeMedianoche(inicio) + duracion)
    return {
      ok: true,
      itinerario: [
        {
          id: a.id,
          nombre: a.nombre,
          inicio,
          fin,
          duracionMin: duracion,
        },
      ],
    }
  }

  // Mapear con horas y minutos normalizados (calculando el fin dinámicamente según inicio + duración)
  const bloques: BloqueItinerario[] = actividadesConHorario.map((a) => {
    const inicio = (a.horaSalida || '09:00').trim().slice(0, 5)
    const duracion = a.duracionMin && a.duracionMin > 0 ? a.duracionMin : 120
    const fin = formatoMinutosAHora(minutosDesdeMedianoche(inicio) + duracion)

    return {
      id: a.id,
      nombre: a.nombre,
      inicio,
      fin,
      duracionMin: duracion,
      permitirSolapamiento: a.permitirSolapamiento,
    }
  })

  // Ordenar cronológicamente por hora de inicio
  bloques.sort((a, b) => minutosDesdeMedianoche(a.inicio) - minutosDesdeMedianoche(b.inicio))

  // Verificar solapamientos entre actividades consecutivas
  for (let i = 0; i < bloques.length - 1; i++) {
    const actual = bloques[i]
    const siguiente = bloques[i + 1]

    const finActualMin = minutosDesdeMedianoche(actual.fin)
    const inicioSiguienteMin = minutosDesdeMedianoche(siguiente.inicio)

    if (inicioSiguienteMin < finActualMin) {
      // Si cualquiera de los dos permite solapamiento, no es error
      if (actual.permitirSolapamiento || siguiente.permitirSolapamiento) {
        continue
      }
      return {
        ok: false,
        error: `Conflicto de horario: "${actual.nombre}" termina a las ${actual.fin} y "${siguiente.nombre}" inicia a las ${siguiente.inicio}. Las actividades del mismo día no deben solaparse.`,
        itinerario: bloques,
      }
    }
  }

  return { ok: true, itinerario: bloques }
}

export interface AutoResolucionItinerarioResult {
  ok: boolean
  horariosAsignados: Record<string, string>
  itinerario: BloqueItinerario[]
  ajustes: string[]
  error?: string
}

/**
 * Auto-resuelve y sincroniza automáticamente los horarios de las actividades de un combo
 * para eliminar solapamientos, eligiendo el horario disponible más cercano compatible.
 */
export function autoResolverItinerarioCombo(
  actividades: ActividadParaItinerario[],
  actividadModificadaId?: string
): AutoResolucionItinerarioResult {
  if (actividades.length === 0) {
    return { ok: true, horariosAsignados: {}, itinerario: [], ajustes: [] }
  }

  const horariosAsignados: Record<string, string> = {}
  const ajustes: string[] = []

  // Inicializar con la horaSalida actual o el primer horario disponible de cada actividad
  for (const act of actividades) {
    const actId = act.id || act.nombre
    const horaActual =
      act.horaSalida ||
      (act.horarios && act.horarios.length > 0 ? act.horarios[0].horaSalida : '09:00')
    horariosAsignados[actId] = horaActual.trim().slice(0, 5)
  }

  // Si solo hay una actividad, no hay cruces
  if (actividades.length === 1) {
    const valid = validarItinerarioCombo(
      actividades.map((a) => ({
        ...a,
        horaSalida: horariosAsignados[a.id || a.nombre],
      }))
    )
    return {
      ok: valid.ok,
      horariosAsignados,
      itinerario: valid.itinerario,
      ajustes: [],
      error: valid.ok ? undefined : valid.error,
    }
  }

  // Intentar validar primero con la configuración actual
  const actualValidation = validarItinerarioCombo(
    actividades.map((a) => ({
      ...a,
      horaSalida: horariosAsignados[a.id || a.nombre],
    }))
  )

  if (actualValidation.ok) {
    return {
      ok: true,
      horariosAsignados,
      itinerario: actualValidation.itinerario,
      ajustes: [],
    }
  }

  // Si hay solapamiento, ordenar las actividades por la hora deseada actual
  const actsOrdenadas = [...actividades].sort((a, b) => {
    const hA = minutosDesdeMedianoche(horariosAsignados[a.id || a.nombre] || '09:00')
    const hB = minutosDesdeMedianoche(horariosAsignados[b.id || b.nombre] || '09:00')
    return hA - hB
  })

  // Recorrer secuencialmente y ajustar hacia adelante
  let prevFinMin = 0
  let prevNombre = ''

  for (let i = 0; i < actsOrdenadas.length; i++) {
    const act = actsOrdenadas[i]
    const actId = act.id || act.nombre

    if (act.tipoItem === 'PASE_DIA') {
      horariosAsignados[actId] = ''
      continue
    }

    // Actividades con solapamiento permitido no se reordenan — se mantienen en su posición
    if (act.permitirSolapamiento) {
      continue
    }

    const duracion = act.duracionMin && act.duracionMin > 0 ? act.duracionMin : 120
    const horaActual = horariosAsignados[actId] || '09:00'
    const inicioActualMin = minutosDesdeMedianoche(horaActual)

    const horariosDisponibles = (
      act.horarios && act.horarios.length > 0
        ? act.horarios.map((h) => h.horaSalida.trim().slice(0, 5))
        : [horaActual]
    ).sort((a, b) => minutosDesdeMedianoche(a) - minutosDesdeMedianoche(b))

    // Si es la primera actividad con horario, respetamos su horario o el más temprano
    if (prevFinMin === 0) {
      prevFinMin = inicioActualMin + duracion
      prevNombre = act.nombre
      continue
    }

    // Para actividades subsiguientes, verificar si la hora actual choca con la anterior
    if (inicioActualMin < prevFinMin) {
      // Buscar el horario disponible más cercano que sea >= prevFinMin
      const horarioCompatible = horariosDisponibles.find(
        (h) => minutosDesdeMedianoche(h) >= prevFinMin
      )

      if (horarioCompatible) {
        const horaAnteriorStr = horariosAsignados[actId]
        horariosAsignados[actId] = horarioCompatible
        ajustes.push(
          `"${act.nombre}" se ajustó automáticamente de ${horaAnteriorStr} a las ${horarioCompatible} para iniciar después de "${prevNombre}" (finaliza a las ${formatoMinutosAHora(
            prevFinMin
          )}).`
        )
        const nuevoInicioMin = minutosDesdeMedianoche(horarioCompatible)
        prevFinMin = nuevoInicioMin + duracion
      } else {
        // No hay horario posterior disponible en la secuencia actual.
        // Probar si esta actividad puede ir ANTES de la primera actividad
        const finActConHorario = inicioActualMin + duracion
        const primeraAct = actsOrdenadas[0]
        const primeraActId = primeraAct.id || primeraAct.nombre
        const inicioPrimeraMin = minutosDesdeMedianoche(horariosAsignados[primeraActId])

        if (finActConHorario <= inicioPrimeraMin) {
          // Cabe antes
          ajustes.push(
            `"${act.nombre}" se colocó antes de "${primeraAct.nombre}" (${horaActual} → ${primeraAct.horaSalida}).`
          )
        }
      }
    } else {
      prevFinMin = inicioActualMin + duracion
    }

    prevNombre = act.nombre
  }

  // Re-validar el itinerario con los horarios asignados
  const resFinal = validarItinerarioCombo(
    actividades.map((a) => ({
      ...a,
      horaSalida: horariosAsignados[a.id || a.nombre],
    }))
  )

  if (resFinal.ok) {
    return {
      ok: true,
      horariosAsignados,
      itinerario: resFinal.itinerario,
      ajustes,
    }
  }

  // Si aún no es válido, intentar optimización exhaustiva de combinaciones
  const opt = optimizarItinerarioCombo(actividades)
  if (opt.ok) {
    return {
      ok: true,
      horariosAsignados: opt.horariosAsignados,
      itinerario: opt.itinerario,
      ajustes: [
        'Se reordenaron y sincronizaron los turnos para encontrar la combinación óptima sin solapamiento.',
      ],
    }
  }

  return {
    ok: false,
    horariosAsignados,
    itinerario: resFinal.itinerario,
    ajustes,
    error: resFinal.error || 'No se encontró una combinación de horarios sin solapamiento para este combo.',
  }
}

/**
 * Encuentra la combinación óptima y más fluida de horarios para las actividades de un combo,
 * minimizando los tiempos de espera y garantizando cero solapamiento.
 */
export function optimizarItinerarioCombo(
  actividades: ActividadParaItinerario[]
): {
  ok: boolean
  horariosAsignados: Record<string, string>
  itinerario: BloqueItinerario[]
  error?: string
} {
  if (actividades.length === 0) {
    return { ok: true, horariosAsignados: {}, itinerario: [] }
  }

  if (actividades.length === 1) {
    const act = actividades[0]
    const h =
      act.horaSalida ||
      (act.horarios && act.horarios.length > 0 ? act.horarios[0].horaSalida : '09:00')
    const v = validarItinerarioCombo([{ ...act, horaSalida: h }])
    return {
      ok: v.ok,
      horariosAsignados: { [act.id || act.nombre]: h },
      itinerario: v.itinerario,
    }
  }

  // Generar listas de horarios disponibles por actividad
  // Las actividades con permitirSolapamiento se fijan en su slot actual y no participan del combinador
  const slotsPorActividad: { id: string; act: ActividadParaItinerario; slots: string[] }[] =
    actividades
      .filter((a) => !a.permitirSolapamiento)
      .map((act) => {
        const id = act.id || act.nombre
        const slots =
          act.horarios && act.horarios.length > 0
            ? Array.from(new Set(act.horarios.map((h) => h.horaSalida.trim().slice(0, 5)))).sort(
                (a, b) => minutosDesdeMedianoche(a) - minutosDesdeMedianoche(b)
              )
            : [act.horaSalida ? act.horaSalida.trim().slice(0, 5) : '09:00']
        return { id, act, slots }
      })

  const actividadesFijas = actividades.filter((a) => a.permitirSolapamiento)

  // Función recursiva para buscar combinaciones válidas
  let mejorCombinacion: Record<string, string> | null = null
  let menorSpan = Infinity
  let menorInicioMin = Infinity
  let mejorItinerario: BloqueItinerario[] = []

  function probarCombinacion(
    index: number,
    asignacionActual: Record<string, string>
  ) {
    if (index >= slotsPorActividad.length) {
      // Agregar actividades fijas (solapamiento permitido) a la asignación
      const asignacionCompleta = { ...asignacionActual }
      for (const fija of actividadesFijas) {
        const fid = fija.id || fija.nombre
        asignacionCompleta[fid] =
          fija.horaSalida ||
          (fija.horarios && fija.horarios.length > 0 ? fija.horarios[0].horaSalida : '09:00')
      }

      const actsConHorario = actividades.map((a) => ({
        ...a,
        horaSalida: asignacionCompleta[a.id || a.nombre],
      }))
      const v = validarItinerarioCombo(actsConHorario)
      if (v.ok && v.itinerario.length > 0) {
        const inicioMin = minutosDesdeMedianoche(v.itinerario[0].inicio)
        const finMin = minutosDesdeMedianoche(v.itinerario[v.itinerario.length - 1].fin)
        const span = finMin - inicioMin
        if (span < menorSpan || (span === menorSpan && inicioMin < menorInicioMin)) {
          menorSpan = span
          menorInicioMin = inicioMin
          mejorCombinacion = { ...asignacionCompleta }
          mejorItinerario = v.itinerario
        }
      }
      return
    }

    const { id, slots } = slotsPorActividad[index]
    for (const slot of slots) {
      probarCombinacion(index + 1, { ...asignacionActual, [id]: slot })
    }
  }

  probarCombinacion(0, {})

  if (mejorCombinacion && mejorItinerario.length > 0) {
    return {
      ok: true,
      horariosAsignados: mejorCombinacion,
      itinerario: mejorItinerario,
    }
  }

  return {
    ok: false,
    horariosAsignados: {},
    itinerario: [],
    error:
      'Las actividades seleccionadas no disponen de horarios compatibles que permitan realizar el combo el mismo día sin solaparse.',
  }
}

export interface CombinacionItinerarioCombo {
  id: string
  nombre: string
  horaInicio: string
  horaFin: string
  duracionTotalMin: number
  horariosAsignados: Record<string, string>
  itinerario: BloqueItinerario[]
  resumenTexto: string
}

function horaAmPm(h24: string): string {
  if (!h24 || !h24.includes(':')) return h24
  const [hStr, mStr] = h24.split(':')
  const h = parseInt(hStr, 10)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 || 12
  return `${h12}:${mStr} ${ampm}`
}

/**
 * Genera exhaustivamente TODAS las combinaciones válidas de horarios
 * sin solapamientos entre las actividades del combo.
 * Las actividades de tipo PASE_DIA (acceso libre) no restringen los turnos horarios.
 */
export function generarCombinacionesCombo(
  actividades: ActividadParaItinerario[]
): CombinacionItinerarioCombo[] {
  if (actividades.length === 0) return []

  const actividadesConHorario = actividades.filter(
    (a) => a.tipoItem !== 'PASE_DIA' && !a.permitirSolapamiento
  )
  const actividadesSolapadas = actividades.filter(
    (a) => a.tipoItem !== 'PASE_DIA' && a.permitirSolapamiento
  )
  const pasesDia = actividades.filter((a) => a.tipoItem === 'PASE_DIA')

  // Si todas las actividades son pases de día o solapadas, no existen turnos restringidos
  if (actividadesConHorario.length === 0) {
    const asignaciones: Record<string, string> = {}
    for (const sol of actividadesSolapadas) {
      asignaciones[sol.id || sol.nombre] =
        sol.horaSalida ||
        (sol.horarios && sol.horarios.length > 0 ? sol.horarios[0].horaSalida : '09:00')
    }
    return [
      {
        id: 'acceso-libre',
        nombre: 'Acceso Libre (Todo el día)',
        horaInicio: '',
        horaFin: '',
        duracionTotalMin: 0,
        horariosAsignados: asignaciones,
        itinerario: [],
        resumenTexto: 'Pase(s) con acceso libre para la fecha seleccionada',
      },
    ]
  }

  // Si solo hay una actividad con horario (+ posibles pases de día y solapadas asociados)
  if (actividadesConHorario.length === 1) {
    const act = actividadesConHorario[0]
    const slots =
      act.horarios && act.horarios.length > 0
        ? Array.from(new Set(act.horarios.map((h) => h.horaSalida.trim().slice(0, 5)))).sort(
            (a, b) => minutosDesdeMedianoche(a) - minutosDesdeMedianoche(b)
          )
        : [act.horaSalida ? act.horaSalida.trim().slice(0, 5) : '09:00']

    return slots.map((slot) => {
      // Agregar actividades solapadas a la asignación
      const asignaciones: Record<string, string> = { [act.id || act.nombre]: slot }
      for (const sol of actividadesSolapadas) {
        asignaciones[sol.id || sol.nombre] =
          sol.horaSalida ||
          (sol.horarios && sol.horarios.length > 0 ? sol.horarios[0].horaSalida : '09:00')
      }

      const v = validarItinerarioCombo([
        { ...act, horaSalida: slot },
        ...actividadesSolapadas.map((a) => ({
          ...a,
          horaSalida:
            a.horaSalida ||
            (a.horarios && a.horarios.length > 0 ? a.horarios[0].horaSalida : '09:00'),
        })),
      ])
      const horaInicio = v.itinerario[0]?.inicio || slot
      const horaFin = v.itinerario[v.itinerario.length - 1]?.fin || slot
      const dur = minutosDesdeMedianoche(horaFin) - minutosDesdeMedianoche(horaInicio)

      const resumen = v.itinerario.map((b) => `${horaAmPm(b.inicio)} ${b.nombre}`).join(' ➔ ')

      return {
        id: slot,
        nombre: `Turno ${horaAmPm(slot)}`,
        horaInicio,
        horaFin,
        duracionTotalMin: dur,
        horariosAsignados: asignaciones,
        itinerario: v.itinerario,
        resumenTexto: resumen,
      }
    })
  }

  const slotsPorActividad = actividadesConHorario.map((act) => {
    const id = act.id || act.nombre
    const slots =
      act.horarios && act.horarios.length > 0
        ? Array.from(new Set(act.horarios.map((h) => h.horaSalida.trim().slice(0, 5)))).sort(
            (a, b) => minutosDesdeMedianoche(a) - minutosDesdeMedianoche(b)
          )
        : [act.horaSalida ? act.horaSalida.trim().slice(0, 5) : '09:00']
    return { id, act, slots }
  })

  const combinacionesValidas: CombinacionItinerarioCombo[] = []
  const vistas = new Set<string>()

  function explorar(index: number, asignacionActual: Record<string, string>) {
    if (index >= slotsPorActividad.length) {
      // Agregar actividades solapadas (fijas) a la asignación
      const asignacionCompleta = { ...asignacionActual }
      for (const sol of actividadesSolapadas) {
        const sid = sol.id || sol.nombre
        asignacionCompleta[sid] =
          sol.horaSalida ||
          (sol.horarios && sol.horarios.length > 0 ? sol.horarios[0].horaSalida : '09:00')
      }

      const actsConHorario = actividadesConHorario.map((a) => ({
        ...a,
        horaSalida: asignacionCompleta[a.id || a.nombre],
      }))
      const actsSolapadas = actividadesSolapadas.map((a) => ({
        ...a,
        horaSalida: asignacionCompleta[a.id || a.nombre],
      }))
      const v = validarItinerarioCombo([...actsConHorario, ...actsSolapadas])
      if (v.ok && v.itinerario.length > 0) {
        // Encontrar bloques con horarios reales para calcular inicio y fin del tour
        const horaInicio = v.itinerario[0]?.inicio || '09:00'
        const horaFin = v.itinerario[v.itinerario.length - 1]?.fin || '18:00'
        const duracionTotalMin =
          minutosDesdeMedianoche(horaFin) - minutosDesdeMedianoche(horaInicio)

        const asignacionesCompletas: Record<string, string> = { ...asignacionCompleta }

        const key = Object.entries(asignacionesCompletas)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, val]) => `${k}:${val}`)
          .join('|')

        if (!vistas.has(key)) {
          vistas.add(key)
          const resumenTexto = v.itinerario
            .map((b) => `${horaAmPm(b.inicio)} ${b.nombre}`)
            .join(' ➔ ')

          combinacionesValidas.push({
            id: key,
            nombre: `Turno ${horaAmPm(horaInicio)}`,
            horaInicio,
            horaFin,
            duracionTotalMin,
            horariosAsignados: asignacionesCompletas,
            itinerario: v.itinerario,
            resumenTexto,
          })
        }
      }
      return
    }

    const { id, slots } = slotsPorActividad[index]
    for (const slot of slots) {
      explorar(index + 1, { ...asignacionActual, [id]: slot })
    }
  }

  explorar(0, {})

  // Ordenar cronológicamente por horaInicio y luego por menor duración total
  combinacionesValidas.sort((a, b) => {
    const diffInicio = minutosDesdeMedianoche(a.horaInicio) - minutosDesdeMedianoche(b.horaInicio)
    if (diffInicio !== 0) return diffInicio
    return a.duracionTotalMin - b.duracionTotalMin
  })

  return combinacionesValidas
}

/** Valida disponibilidad para un paquete o combo validando tanto el combo como sus actividades hijas. */
export function validarDisponibilidadCombo(
  fecha: Date,
  hora: string | null,
  pasajeros: number,
  combo: ExcursionParaDisponibilidad & {
    nombre?: string
    actividades: (ExcursionParaDisponibilidad & {
      id?: string
      nombre: string
      duracionMin?: number | null
      horaRegreso?: string | null
    })[]
  }
): { ok: true; cupoDisponible: number; itinerario: BloqueItinerario[] } | { ok: false; error: string } {
  // 1. Validar que no haya solapamiento de horas entre las actividades hijas del combo
  const itinerarioRes = validarItinerarioCombo(combo.actividades)
  if (!itinerarioRes.ok) {
    return { ok: false, error: itinerarioRes.error || 'Conflicto de horario en actividades del combo.' }
  }

  // 2. Validar que el día de la semana sea un día común operativo para todas las actividades
  const diaSemanaJS = fecha.getUTCDay()
  const diaISO = Object.entries(DIA_ISO_A_JS).find(([, v]) => v === diaSemanaJS)?.[0]
  const diaISONum = diaISO ? Number(diaISO) : 1

  const diasOperativos = diasComunesCombo([combo, ...combo.actividades])
  if (!diasOperativos.includes(diaISONum)) {
    return {
      ok: false,
      error: `El combo "${combo.nombre ?? 'Combo'}" no opera en el día seleccionado (alguna de las actividades hijas no tiene salida este día).`,
    }
  }

  const dispCombo = validarDisponibilidad(fecha, hora, pasajeros, combo)
  if (!dispCombo.ok) return dispCombo

  if (combo.capacidad && combo.capacidad > 0 && pasajeros > combo.capacidad) {
    return {
      ok: false,
      error: `El combo "${combo.nombre ?? 'Combo'}" excede la capacidad máxima disponible (${combo.capacidad} cupos).`,
    }
  }

  let menorCupo = combo.capacidad && combo.capacidad > 0 ? combo.capacidad : CAPACIDAD_SIN_DECLARAR

  for (const act of combo.actividades) {
    // Usar la hora de la actividad si tiene una definida distinta a la del combo
    const horaAValidar =
      act.horaSalida || (act.horarios && act.horarios.length > 0 ? act.horarios[0].horaSalida : hora)

    const horarioAct = act.horarios?.find(
      (h) => (h.horaSalida || '').trim().slice(0, 5) === (horaAValidar || '').trim().slice(0, 5)
    )

    // Si la actividad o el horario tienen cupo/capacidad definidos, verificar que no se exceda
    const capActGeneral = act.capacidad && act.capacidad > 0 ? act.capacidad : CAPACIDAD_SIN_DECLARAR
    const capHorario = horarioAct?.cupo && horarioAct.cupo > 0 ? horarioAct.cupo : capActGeneral
    const capEfectiva = Math.min(capActGeneral, capHorario)
    menorCupo = Math.min(menorCupo, capEfectiva)

    if (pasajeros > capEfectiva) {
      return {
        ok: false,
        error: `La actividad "${act.nombre}" del combo excede el cupo disponible (${capEfectiva} cupos).`,
      }
    }

    const dispAct = validarDisponibilidad(fecha, horaAValidar, pasajeros, act)
    if (!dispAct.ok) {
      return {
        ok: false,
        error: `La actividad "${act.nombre}" del combo no tiene disponibilidad para esta fecha: ${dispAct.error}`,
      }
    }
  }

  return { ok: true, cupoDisponible: menorCupo, itinerario: itinerarioRes.itinerario }
}

export interface ComboItemItinerarioDetalle {
  actividadId: string
  nombre: string
  fecha: Date
  hora: string | null
  tipoItem?: string | null
}

/**
 * Valida disponibilidad y consistencia para un combo reservado en múltiples fechas y/o turnos independientes.
 */
export function validarDisponibilidadComboMultiFecha(
  pasajeros: number,
  combo: ExcursionParaDisponibilidad & {
    nombre?: string
    actividades: (ExcursionParaDisponibilidad & {
      id: string
      nombre: string
      duracionMin?: number | null
      horaRegreso?: string | null
    })[]
  },
  itemsItinerario: { actividadId: string; fecha: Date; hora: string | null }[]
): { ok: true; cupoDisponible: number; itemsValidados: ComboItemItinerarioDetalle[] } | { ok: false; error: string } {
  if (!itemsItinerario || itemsItinerario.length === 0) {
    return { ok: false, error: 'Debes configurar las fechas y turnos de las actividades del combo.' }
  }

  // Agrupar actividades por fecha para validar solapamientos en un mismo día
  const porFecha = new Map<string, ActividadParaItinerario[]>()
  const itemsValidados: ComboItemItinerarioDetalle[] = []
  let menorCupo = combo.capacidad && combo.capacidad > 0 ? combo.capacidad : CAPACIDAD_SIN_DECLARAR

  for (const item of itemsItinerario) {
    const act = combo.actividades.find((a) => a.id === item.actividadId)
    if (!act) {
      return { ok: false, error: `Actividad con ID ${item.actividadId} no pertenece al combo.` }
    }

    // Validar disponibilidad individual
    const disp = validarDisponibilidad(item.fecha, item.hora, pasajeros, act)
    if (!disp.ok) {
      const fechaStr = item.fecha.toISOString().split('T')[0]
      return {
        ok: false,
        error: `La actividad "${act.nombre}" no tiene disponibilidad para el ${fechaStr}: ${disp.error}`,
      }
    }

    const horarioItem = act.horarios?.find(
      (h) => (h.horaSalida || '').trim().slice(0, 5) === (item.hora || '').trim().slice(0, 5)
    )
    const capActGeneral = act.capacidad && act.capacidad > 0 ? act.capacidad : CAPACIDAD_SIN_DECLARAR
    const capHorario = horarioItem?.cupo && horarioItem.cupo > 0 ? horarioItem.cupo : capActGeneral
    const capEfectiva = Math.min(capActGeneral, capHorario)
    menorCupo = Math.min(menorCupo, capEfectiva)

    if (pasajeros > capEfectiva) {
      return {
        ok: false,
        error: `La actividad "${act.nombre}" excede el cupo disponible (${capEfectiva} cupos).`,
      }
    }

    const fechaKey = item.fecha.toISOString().split('T')[0]
    const lista = porFecha.get(fechaKey) || []
    lista.push({
      id: act.id,
      nombre: act.nombre,
      tipoItem: act.tipoItem,
      duracionMin: act.duracionMin,
      horaSalida: item.hora,
      horaRegreso: act.horaRegreso,
      horarios: act.horarios,
    })
    porFecha.set(fechaKey, lista)

    itemsValidados.push({
      actividadId: act.id,
      nombre: act.nombre,
      fecha: item.fecha,
      hora: item.hora,
      tipoItem: act.tipoItem,
    })
  }

  // Validar solapamiento para actividades programadas en la misma fecha
  for (const [, actsDelDia] of porFecha.entries()) {
    if (actsDelDia.length > 1) {
      const val = validarItinerarioCombo(actsDelDia)
      if (!val.ok) {
        return { ok: false, error: val.error || 'Conflicto de horario en actividades programadas para el mismo día.' }
      }
    }
  }

  return { ok: true, cupoDisponible: menorCupo, itemsValidados }
}
