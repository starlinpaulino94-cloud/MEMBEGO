import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validarVendedor } from '../src/modules/excursiones/vendedores/nucleo'
import { validarReserva } from '../src/modules/excursiones/reservas/nucleo'

/**
 * Pruebas unitarias para el soporte de Turoperadores, Agencias B2B y logística hotelera.
 */

test('Validación de vendedor corporativo tipo Touroperador con crédito B2B', () => {
  const v = validarVendedor({
    nombre: 'Nexus Tours Dominicana',
    telefono: '809-555-9988',
    tipo: 'Touroperador',
    razonSocial: 'Nexus Tours Dominicana SRL',
    rnc: '1-30-99881-2',
    diasCredito: '30',
    limiteCredito: '10000',
    emailFacturacion: 'cuentas@nexustours.com',
    prefijoVoucher: 'nx-',
    modeloComercial: 'TARIFA_NETA',
  })

  assert.equal(v.ok, true)
  if (v.ok) {
    assert.equal(v.datos.tipo, 'Touroperador')
    assert.equal(v.datos.razonSocial, 'Nexus Tours Dominicana SRL')
    assert.equal(v.datos.rnc, '1-30-99881-2')
    assert.equal(v.datos.diasCredito, 30)
    assert.equal(v.datos.limiteCredito, 10000)
    assert.equal(v.datos.emailFacturacion, 'cuentas@nexustours.com')
    assert.equal(v.datos.prefijoVoucher, 'NX-') // Normalizado a mayúsculas
    assert.equal(v.datos.modeloComercial, 'TARIFA_NETA')
  }
})

test('Validación de Rep Hotel asignado a supervisor matriz', () => {
  const v = validarVendedor({
    nombre: 'Carlos',
    apellido: 'Martínez',
    telefono: '829-111-2233',
    tipo: 'Rep Hotel',
    supervisorId: 'touroperador-nexus-id',
  })

  assert.equal(v.ok, true)
  if (v.ok) {
    assert.equal(v.datos.tipo, 'Rep Hotel')
    assert.equal(v.datos.supervisorId, 'touroperador-nexus-id')
    assert.equal(v.datos.diasCredito, 0)
    assert.equal(v.datos.modeloComercial, 'COMISION')
  }
})

test('Validación de reserva con Voucher de Agencia y logística de recogida en Hotel', () => {
  const r = validarReserva({
    fecha: '2026-09-15',
    hora: '08:30',
    adultos: '4',
    ninos: '2',
    voucherAgencia: 'nx-889921',
    hotelRecogida: 'Hard Rock Hotel Punta Cana',
    lobbyRecogida: 'Lobby Principal',
    horaRecogida: '07:15',
    habitacion: '4201',
  })

  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal(r.datos.adultos, 4)
    assert.equal(r.datos.ninos, 2)
    assert.equal(r.datos.voucherAgencia, 'NX-889921')
    assert.equal(r.datos.hotelRecogida, 'Hard Rock Hotel Punta Cana')
    assert.equal(r.datos.lobbyRecogida, 'Lobby Principal')
    assert.equal(r.datos.horaRecogida, '07:15')
    assert.equal(r.datos.habitacion, '4201')
  }
})

test('Validación de reserva tradicional sin voucher ni datos de hotel (retrocompatibilidad)', () => {
  const r = validarReserva({
    fecha: '2026-09-20',
    hora: '09:00',
    adultos: '2',
    ninos: '0',
  })

  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal(r.datos.voucherAgencia, null)
    assert.equal(r.datos.hotelRecogida, null)
    assert.equal(r.datos.lobbyRecogida, null)
    assert.equal(r.datos.horaRecogida, null)
    assert.equal(r.datos.habitacion, null)
  }
})
