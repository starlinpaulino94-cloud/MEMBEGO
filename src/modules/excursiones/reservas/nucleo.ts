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
const HORA_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

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

  const horaS = texto(form.hora, 5)
  const horaRecogidaS = texto(form.horaRecogida, 5)
  const descuento = Number(texto(form.descuento, 12) || '0')

  return {
    ok: true,
    datos: {
      fecha,
      hora: HORA_RE.test(horaS) ? horaS : null,
      adultos,
      ninos,
      descuento: Number.isFinite(descuento) && descuento > 0 ? centavos(descuento) : 0,
      notas: texto(form.notas, 1000) || null,
      canal: texto(form.canal, 40) || null,
      voucherAgencia: texto(form.voucherAgencia, 60).toUpperCase() || null,
      hotelRecogida: texto(form.hotelRecogida, 120) || null,
      lobbyRecogida: texto(form.lobbyRecogida, 80) || null,
      horaRecogida: HORA_RE.test(horaRecogidaS) ? horaRecogidaS : null,
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
  // Extraer día de la semana a partir de la fecha (usar getUTCDay() si fue parseada en UTC)
  const diaSemanaJS = fecha.getUTCDay() // 0=Dom...6=Sáb
  const diaISO = Object.entries(DIA_ISO_A_JS).find(([, v]) => v === diaSemanaJS)?.[0]
  const diaISONum = diaISO ? Number(diaISO) : null

  const horario = effectiveHorarios.find((h) => {
    const horaH = (h.horaSalida || '').trim().slice(0, 5)
    if (horaH !== horaNormalizada) return false
    const dias = Array.isArray(h.diasSemana) ? h.diasSemana.map(Number) : []
    return dias.length === 0 || (diaISONum !== null && dias.includes(diaISONum))
  })

  if (!horario && effectiveHorarios.length > 0) {
    // Si la hora coincide con alguna de las salidas configuradas
    const coincideHora = effectiveHorarios.some(
      (h) => (h.horaSalida || '').trim().slice(0, 5) === horaNormalizada
    )
    if (!coincideHora) {
      return { ok: false, error: 'Esa hora no está disponible para la fecha seleccionada.' }
    }
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
