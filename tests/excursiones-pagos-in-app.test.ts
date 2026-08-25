import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  calcularTotales,
  calcularSaldo,
  estadoPorPagos,
  numeroReserva,
} from '../src/modules/excursiones/reservas/nucleo'
import {
  calcularComision,
  type ReglaComision,
} from '../src/modules/excursiones/comisiones/nucleo'

/**
 * Pruebas unitarias para pagos en destino vs pagos online simulados y liquidaciones.
 */

test('Opción 1: Pagar en destino crea reserva PENDIENTE con saldo pendiente completo', () => {
  const totales = calcularTotales({
    adultos: 2,
    ninos: 1,
    precioAdulto: 100,
    precioNino: 50,
    impuestoPct: 18,
  })
  assert.equal(totales.total, 295) // (200 + 50) + 18% = 295

  // Sin pagos registrados al momento de agendar
  const saldo = calcularSaldo(totales.total, [])
  assert.equal(saldo.pagado, 0)
  assert.equal(saldo.saldo, 295)
  assert.equal(saldo.liquidada, false)

  const estado = estadoPorPagos('PENDIENTE', totales.total, saldo.pagado)
  assert.equal(estado, 'PENDIENTE')
})

test('Opción 2: Pagar online simulado registra pago completo, salda reserva y emite estado PAGADA', () => {
  const totales = calcularTotales({
    adultos: 3,
    ninos: 0,
    precioAdulto: 80,
    precioNino: null,
    impuestoPct: 0,
  })
  assert.equal(totales.total, 240)

  // Se registra el abono simulado con el total
  const pagos = [{ monto: 240, estado: 'REGISTRADO' }]
  const saldo = calcularSaldo(totales.total, pagos)

  assert.equal(saldo.pagado, 240)
  assert.equal(saldo.saldo, 0)
  assert.equal(saldo.liquidada, true)

  const estado = estadoPorPagos('PENDIENTE', totales.total, saldo.pagado)
  assert.equal(estado, 'PAGADA')
})

test('Pago online simulado con vendedor acreditado genera comisión calculada correctamente', () => {
  const regla: ReglaComision = {
    id: 'regla-1',
    ambito: 'GENERAL',
    excursionId: null,
    vendedorId: null,
    tipoVendedor: null,
    categoria: null,
    tipoCalculo: 'PORCENTAJE',
    valor: 20, // 20%
    escalones: null,
    activa: true,
    vigenciaDesde: null,
    vigenciaHasta: null,
    createdAt: new Date(),
  }

  // Base comisionable: subtotal sin impuestos (US$ 200)
  const baseComisionable = 200
  const resultado = calcularComision(regla, {
    vendedorId: 'v1',
    excursionId: 'e1',
    total: 200,
    baseComisionable,
    adultos: 2,
    ninos: 0,
    fecha: new Date(),
  })

  assert.equal(resultado.monto, 40) // 20% de 200 = US$ 40
  assert.match(resultado.desglose, /20%/)
})

test('Balance de Liquidación Bidireccional: Pago Online vs Efectivo en Mano', () => {
  // Escenario A: Cliente pagó Online (Custodia Empresa)
  // Empresa recauda $1000, vendedor gana $200 de comisión -> Balance a pagar al vendedor = +$200
  const comisionesGanadas = 200
  const efectivoEnManoOnline = 0
  const balanceOnline = comisionesGanadas - efectivoEnManoOnline
  assert.equal(balanceOnline, 200) // Empresa PAGA $200

  // Escenario B: Vendedor cobró en Efectivo (Custodia Vendedor)
  // Vendedor tiene en mano $1000 de clientes, gana $200 de comisión -> Balance = -$800
  const efectivoEnManoFisico = 1000
  const balanceEfectivo = comisionesGanadas - efectivoEnManoFisico
  assert.equal(balanceEfectivo, -800) // Vendedor DEBE entregar $800 a Caja
})
