import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  calcularTotales,
  calcularPrecioEfectivo,
  calcularSaldo,
  estadoPorPagos,
  numeroReserva,
  validarReserva,
  validarPago,
  validarDisponibilidad,
  validarItinerarioCombo,
} from '../src/modules/excursiones/reservas/nucleo'

/**
 * Excursiones · Fase 5 — el total de una reserva y su saldo son las cifras que
 * después mandan sobre las comisiones. Se prueban puras, sin base de datos.
 */

test('el total cuenta adultos y niños, y el descuento va antes del impuesto', () => {
  const t = calcularTotales({
    adultos: 2,
    ninos: 1,
    precioAdulto: 100,
    precioNino: 50,
    descuento: 50,
    impuestoPct: 18,
  })
  assert.equal(t.subtotal, 250) // 2×100 + 1×50
  assert.equal(t.descuento, 50)
  assert.equal(t.impuestos, 36) // 18% de 200, no de 250
  assert.equal(t.total, 236)
})

test('sin precio de niño, el niño paga como adulto (no gratis por descuido)', () => {
  const t = calcularTotales({ adultos: 1, ninos: 2, precioAdulto: 80, precioNino: null })
  assert.equal(t.subtotal, 240)
  assert.equal(t.total, 240)
})

test('un descuento mayor que el subtotal deja el total en cero, nunca negativo', () => {
  const t = calcularTotales({ adultos: 1, ninos: 0, precioAdulto: 100, precioNino: null, descuento: 500 })
  assert.equal(t.descuento, 100)
  assert.equal(t.total, 0)
})

test('los centavos se redondean en el servidor', () => {
  const t = calcularTotales({ adultos: 3, ninos: 0, precioAdulto: 33.333, precioNino: null, impuestoPct: 18 })
  assert.equal(t.subtotal, 100)
  assert.equal(t.total, 118)
})

test('el saldo solo suma pagos vivos: el anulado deja de contar', () => {
  const s = calcularSaldo(1000, [
    { monto: 300, estado: 'REGISTRADO' },
    { monto: 200, estado: 'ANULADO' },
    { monto: 100, estado: 'REGISTRADO' },
  ])
  assert.equal(s.pagado, 400)
  assert.equal(s.saldo, 600)
  assert.equal(s.liquidada, false)
  assert.equal(calcularSaldo(500, [{ monto: 500, estado: 'REGISTRADO' }]).liquidada, true)
})

test('el estado sigue a los pagos, pero no resucita una reserva cerrada', () => {
  assert.equal(estadoPorPagos('PENDIENTE', 1000, 0), 'PENDIENTE')
  assert.equal(estadoPorPagos('PENDIENTE', 1000, 400), 'PARCIALMENTE_PAGADA')
  assert.equal(estadoPorPagos('PARCIALMENTE_PAGADA', 1000, 1000), 'PAGADA')
  assert.equal(estadoPorPagos('CONFIRMADA', 1000, 0), 'CONFIRMADA')
  // Un pago tardío no reabre lo que ya se cerró.
  assert.equal(estadoPorPagos('CANCELADA', 1000, 1000), 'CANCELADA')
  assert.equal(estadoPorPagos('COMPLETADA', 1000, 500), 'COMPLETADA')
})

test('el número de reserva es legible y estable', () => {
  assert.equal(numeroReserva('EXC', 2026, 184), 'EXC-2026-000184')
  assert.equal(numeroReserva('', 2026, 1), 'EXC-2026-000001')
  assert.equal(numeroReserva('ex c!', 2026, 7), 'EXC-2026-000007')
})

test('una reserva necesita fecha y al menos un pasajero', () => {
  assert.equal(validarReserva({ fecha: '', adultos: '2' }).ok, false)
  assert.equal(validarReserva({ fecha: 'mañana', adultos: '2' }).ok, false)
  assert.equal(validarReserva({ fecha: '2026-09-01', adultos: '0', ninos: '0' }).ok, false)
  const r = validarReserva({ fecha: '2026-09-01', hora: '08:30', adultos: '2', ninos: '1', descuento: '50' })
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal(r.datos.adultos, 2)
    assert.equal(r.datos.hora, '08:30')
    assert.equal(r.datos.descuento, 50)
  }
})

test('un pago no puede exceder el saldo ni caer sobre una reserva saldada', () => {
  assert.equal(validarPago({ monto: '0' }, 500).ok, false)
  assert.equal(validarPago({ monto: '600' }, 500).ok, false) // descuadre, no abono
  assert.equal(validarPago({ monto: '100' }, 0).ok, false)
  const p = validarPago({ monto: '500', metodo: 'tarjeta', referencia: 'AUT-9911' }, 500)
  assert.equal(p.ok, true)
  if (p.ok) {
  }
})

test('validarReserva devuelve un objeto Date válido para el año de la reserva', () => {
  const r = validarReserva({ fecha: '2026-08-21', hora: '10:00', adultos: '1' })
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal(r.datos.fecha instanceof Date, true)
    assert.equal(isNaN(r.datos.fecha.getTime()), false)
    assert.equal(r.datos.fecha.getUTCFullYear(), 2026)
    const num = numeroReserva('CAT', r.datos.fecha.getUTCFullYear(), 1)
    assert.equal(num, 'CAT-2026-000001')
  }
})

test('validarDisponibilidad para PASE_DIA no exige hora de salida fija', () => {
  const manana = new Date()
  manana.setDate(manana.getDate() + 1)

  const disp = validarDisponibilidad(manana, null, 4, {
    capacidad: 50,
    tipoItem: 'PASE_DIA',
    horarios: [{ id: 'h1', diasSemana: [1, 2, 3, 4, 5, 6, 7], horaSalida: '00:00', cupo: 50 }],
  })
  assert.equal(disp.ok, true)
  if (disp.ok) {
    assert.equal(disp.cupoDisponible, 50)
  }
})

test('validarItinerarioCombo procesa actividades con horario excluyendo Daypasses del cálculo de horas', () => {
  const itinerario = validarItinerarioCombo([
    { id: '1', nombre: 'Pase de Día Club de Playa', tipoItem: 'PASE_DIA' },
    { id: '2', nombre: 'Tour en Catamarán', horaSalida: '14:00', duracionMin: 180 },
  ])
  assert.equal(itinerario.ok, true)
  if (itinerario.ok) {
    // Solo la actividad con horario forma parte del itinerario de horas
    assert.equal(itinerario.itinerario.length, 1)
    assert.equal(itinerario.itinerario[0].nombre, 'Tour en Catamarán')
    assert.equal(itinerario.itinerario[0].inicio, '14:00')
    assert.equal(itinerario.itinerario[0].fin, '17:00')
  }
})

test('calcularPrecioEfectivo aplica niños gratis (0) los martes y cae a base los miércoles', () => {
  const reglas = [
    {
      diasSemana: [2], // 2 = Martes en ISO
      horasSalida: [],
      precioAdulto: 100,
      precioNino: 0, // Niños gratis
      precioResidente: null,
      precioNinoResidente: null,
    },
  ]

  // 2026-09-01 es un Martes (UTCDay = 2)
  const fechaMartes = new Date('2026-09-01T12:00:00.000Z')
  assert.equal(fechaMartes.getUTCDay(), 2)

  const precioMartes = calcularPrecioEfectivo(fechaMartes, '09:00', 100, 50, reglas)
  assert.equal(precioMartes.precioAdulto, 100)
  assert.equal(precioMartes.precioNino, 0) // ¡Niños gratis!

  const totalesMartes = calcularTotales({
    adultos: 2,
    ninos: 2,
    precioAdulto: precioMartes.precioAdulto,
    precioNino: precioMartes.precioNino,
  })
  assert.equal(totalesMartes.subtotal, 200) // 2x100 + 2x0 = 200
  assert.equal(totalesMartes.total, 200)

  // 2026-09-02 es un Miércoles (UTCDay = 3)
  const fechaMiercoles = new Date('2026-09-02T12:00:00.000Z')
  assert.equal(fechaMiercoles.getUTCDay(), 3)

  const precioMiercoles = calcularPrecioEfectivo(fechaMiercoles, '09:00', 100, 50, reglas)
  assert.equal(precioMiercoles.precioAdulto, 100)
  assert.equal(precioMiercoles.precioNino, 50) // Tarifa base regular

  const totalesMiercoles = calcularTotales({
    adultos: 2,
    ninos: 2,
    precioAdulto: precioMiercoles.precioAdulto,
    precioNino: precioMiercoles.precioNino,
  })
  assert.equal(totalesMiercoles.subtotal, 300) // 2x100 + 2x50 = 300
  assert.equal(totalesMiercoles.total, 300)
})

test('calcularPrecioEfectivo respeta tarifa de residente niño gratis (0)', () => {
  const reglas = [
    {
      diasSemana: [4], // Jueves
      horasSalida: [],
      precioAdulto: 120,
      precioNino: 60,
      precioResidente: 80,
      precioNinoResidente: 0, // Niños residentes gratis
    },
  ]

  // 2026-09-03 es un Jueves (UTCDay = 4)
  const fechaJueves = new Date('2026-09-03T12:00:00.000Z')
  assert.equal(fechaJueves.getUTCDay(), 4)

  const precioResidente = calcularPrecioEfectivo(
    fechaJueves,
    '10:00',
    120,
    60,
    reglas,
    true, // esResidente
    90,
    45
  )
  assert.equal(precioResidente.precioAdulto, 80)
  assert.equal(precioResidente.precioNino, 0) // Gratis para residentes

  const precioTurista = calcularPrecioEfectivo(
    fechaJueves,
    '10:00',
    120,
    60,
    reglas,
    false, // Turista normal
    90,
    45
  )
  assert.equal(precioTurista.precioAdulto, 120)
  assert.equal(precioTurista.precioNino, 60)
})

test('validarReserva procesa y preserva notas de la reserva correctamente', () => {
  // Nota estándar
  const r1 = validarReserva({
    fecha: '2026-09-01',
    adultos: '2',
    notas: '  Cliente alérgico al marisco, necesita asiento adelante  ',
  })
  assert.equal(r1.ok, true)
  if (r1.ok) {
    assert.equal(r1.datos.notas, 'Cliente alérgico al marisco, necesita asiento adelante')
  }

  // Nota vacía o solo espacios normaliza a null
  const r2 = validarReserva({
    fecha: '2026-09-01',
    adultos: '1',
    notas: '   ',
  })
  assert.equal(r2.ok, true)
  if (r2.ok) {
    assert.equal(r2.datos.notas, null)
  }

  // Nota no provista normaliza a null
  const r3 = validarReserva({
    fecha: '2026-09-01',
    adultos: '1',
  })
  assert.equal(r3.ok, true)
  if (r3.ok) {
    assert.equal(r3.datos.notas, null)
  }

  // Límite de caracteres
  const notaLarga = 'X'.repeat(1200)
  const r4 = validarReserva({
    fecha: '2026-09-01',
    adultos: '1',
    notas: notaLarga,
  })
  assert.equal(r4.ok, true)
  if (r4.ok) {
    assert.equal(r4.datos.notas?.length, 1000)
  }
})


