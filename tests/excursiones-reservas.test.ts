import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  calcularTotales,
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
