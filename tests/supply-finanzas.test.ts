import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  aplicarDeposito,
  depositoAplicableAlCorte,
  economiaComision,
  estadoDeDeposito,
  netearLiquidacion,
  repartirVenta,
  saldarCuenta,
  signoDeAsiento,
} from '../src/modules/supply/dinero'
import { compararCifras } from '../src/modules/supply/conciliacion-cifras'
import { validarAcuerdo, type DatosAcuerdo } from '../src/modules/supply/contrato'
import { parsearUmbrales, UMBRALES_VENCIMIENTO, nivelRiesgoVencimiento } from '../src/modules/supply/catalogo'
import {
  DISCREPANCIA_VIVA,
  TRANSICIONES_CUENTA,
  TRANSICIONES_DEPOSITO,
  TRANSICIONES_DISCREPANCIA,
  TRANSICIONES_LIQUIDACION,
  TRANSICIONES_ACUERDO,
  exigirTransicion,
} from '../src/modules/supply/estados'
import { nuevoCodigoEntrega, codigoDeposito, codigoLiquidacion } from '../src/modules/supply/codigos'

/**
 * MEMBEGO SUPPLY · capa financiera, la parte PURA (auditoría 2026-09).
 *
 * Lo que aquí se prueba no toca la base: es la aritmética que la base luego
 * persiste. Los flujos completos (con PostgreSQL) viven en tests/postgres/.
 */

// ── Signo de los asientos (hallazgo H1) ─────────────────────────────────────

test('H1 · un REEMBOLSO del proveedor es a favor de Membego: signo positivo', () => {
  // Saldo = Σ asientos, positivo = a favor del proveedor. Un reembolso reduce
  // lo que Membego tiene depositado, así que SUMA (antes restaba: H1).
  assert.equal(signoDeAsiento('REEMBOLSO'), 1)
  assert.equal(signoDeAsiento('CREDITO'), 1)
  assert.equal(signoDeAsiento('CUENTA_POR_PAGAR'), 1)
  assert.equal(signoDeAsiento('DEPOSITO'), -1)
  assert.equal(signoDeAsiento('PAGO'), -1)
  assert.equal(signoDeAsiento('CUENTA_POR_COBRAR'), -1)
})

// ── Depósitos (Modelo B) ────────────────────────────────────────────────────

test('depósito de 100.000: aplicar 20.000 deja 80.000 y el estado pasa a parcialmente aplicado', () => {
  const d = { montoOriginal: 100_000, montoAplicado: 0, montoDevuelto: 0 }
  const r = aplicarDeposito(d, 20_000, 20_000)
  assert.ok(r.ok)
  assert.equal(r.saldoAntes, 100_000)
  assert.equal(r.saldoDespues, 80_000)
  assert.equal(estadoDeDeposito({ ...d, montoAplicado: 20_000 }), 'PARCIALMENTE_APLICADO')
  assert.equal(estadoDeDeposito(d), 'ABIERTO')
  assert.equal(estadoDeDeposito({ ...d, montoAplicado: 60_000, montoDevuelto: 40_000 }), 'AGOTADO')
})

test('no se aplica más de lo disponible ni más de lo que la cuenta debe', () => {
  const d = { montoOriginal: 1_000, montoAplicado: 900, montoDevuelto: 0 }
  assert.equal(aplicarDeposito(d, 200, 500).ok, false)
  assert.equal(aplicarDeposito(d, 100, 50).ok, false)
  assert.equal(aplicarDeposito(d, 0, 50).ok, false)
  assert.ok(aplicarDeposito(d, 100, 100).ok)
})

test('lo aplicable al corte cubre el neto positivo y nunca supera lo disponible', () => {
  assert.equal(depositoAplicableAlCorte(1_800, 80_000), 1_800)
  assert.equal(depositoAplicableAlCorte(90_000, 80_000), 80_000)
  assert.equal(depositoAplicableAlCorte(-500, 80_000), 0)
  assert.equal(depositoAplicableAlCorte(500, 0), 0)
})

// ── Cuentas ─────────────────────────────────────────────────────────────────

test('saldar una cuenta: parcial, total y de más', () => {
  const c = { montoNeto: 1_000, montoSaldado: 0 }
  const parcial = saldarCuenta(c, 400)
  assert.ok(parcial.ok && parcial.estado === 'PARCIALMENTE_SALDADA' && parcial.montoSaldado === 400)
  const total = saldarCuenta({ montoNeto: 1_000, montoSaldado: 400 }, 600)
  assert.ok(total.ok && total.estado === 'SALDADA' && total.montoSaldado === 1_000)
  assert.equal(saldarCuenta({ montoNeto: 1_000, montoSaldado: 400 }, 600.5).ok, false)
})

// ── Venta sin precompra (§14) ───────────────────────────────────────────────

test('venta a comisión: bruto 1.000 con 20% → 200 para Membego, 800 al proveedor', () => {
  const r = repartirVenta(500, 2, 20)
  assert.deepEqual(r, { montoBruto: 1_000, comisionPorcentaje: 20, comisionMonto: 200, montoProveedor: 800 })
  assert.throws(() => repartirVenta(500, 0, 20))
  assert.throws(() => repartirVenta(500, 1, 101))
})

test('unit economics a comisión: margen y ticket', () => {
  const e = economiaComision([
    { montoBruto: 1_000, comisionMonto: 200, montoProveedor: 800 },
    { montoBruto: 500, comisionMonto: 100, montoProveedor: 400 },
  ])
  assert.equal(e.ventas, 2)
  assert.equal(e.ingresoBruto, 1_500)
  assert.equal(e.retuvoMembego, 300)
  assert.equal(e.recibioProveedor, 1_200)
  assert.equal(e.margenPorcentaje, 20)
})

// ── Liquidación (§17) ───────────────────────────────────────────────────────

test('el neteo suma con signo: CxP + redenciones − CxC − depósito aplicado', () => {
  const s = netearLiquidacion([
    { tipo: 'CUENTA_POR_PAGAR', monto: 800, bruto: 1_000, comision: 200 },
    { tipo: 'REDENCION', monto: 300 },
    { tipo: 'CUENTA_POR_PAGAR', monto: 1_000 },
    { tipo: 'CUENTA_POR_COBRAR', monto: -300 },
    { tipo: 'DEPOSITO_APLICADO', monto: -500 },
  ])
  assert.equal(s.ventasBrutas, 1_000)
  assert.equal(s.comisionMembego, 200)
  assert.equal(s.montoProveedor, 1_800)
  assert.equal(s.redencionesMonto, 300)
  assert.equal(s.reembolsos, 300)
  assert.equal(s.depositoAplicado, 500)
  assert.equal(s.netoLiquidar, 1_300)
})

test('un neto negativo es legítimo: el proveedor le debe a Membego', () => {
  const s = netearLiquidacion([{ tipo: 'CUENTA_POR_COBRAR', monto: -250 }])
  assert.equal(s.netoLiquidar, -250)
})

// ── Máquinas de estado nuevas ───────────────────────────────────────────────

test('una liquidación PAGADA no se cancela ni se recalcula; una DISPUTADA vuelve a CALCULADA', () => {
  assert.throws(() => exigirTransicion(TRANSICIONES_LIQUIDACION, 'PAGADA', 'CANCELADA', 'Liquidación'))
  assert.throws(() => exigirTransicion(TRANSICIONES_LIQUIDACION, 'PAGADA', 'CALCULADA', 'Liquidación'))
  assert.doesNotThrow(() => exigirTransicion(TRANSICIONES_LIQUIDACION, 'PAGADA', 'CONCILIADA', 'Liquidación'))
  assert.doesNotThrow(() => exigirTransicion(TRANSICIONES_LIQUIDACION, 'DISPUTADA', 'CALCULADA', 'Liquidación'))
  assert.throws(() => exigirTransicion(TRANSICIONES_LIQUIDACION, 'CALCULADA', 'PAGADA', 'Liquidación'))
})

test('discrepancias: aprobar exige haberla resuelto o ajustado; las vivas bloquean el cierre', () => {
  assert.throws(() => exigirTransicion(TRANSICIONES_DISCREPANCIA, 'ABIERTA', 'APROBADA', 'Discrepancia'))
  assert.doesNotThrow(() => exigirTransicion(TRANSICIONES_DISCREPANCIA, 'RESUELTA', 'APROBADA', 'Discrepancia'))
  // Resuelta o ajustada sigue VIVA hasta que otra persona la apruebe: la
  // conciliación no se cierra con discrepancias sin firmar.
  assert.deepEqual([...DISCREPANCIA_VIVA].sort(), ['ABIERTA', 'AJUSTADA', 'EN_INVESTIGACION', 'RESUELTA'])
  assert.ok(!DISCREPANCIA_VIVA.includes('APROBADA') && !DISCREPANCIA_VIVA.includes('RECHAZADA'))
})

test('depósitos y cuentas: los estados terminales no se mueven', () => {
  assert.equal(TRANSICIONES_DEPOSITO.CERRADO.length, 0)
  assert.equal(TRANSICIONES_DEPOSITO.CANCELADO.length, 0)
  assert.equal(TRANSICIONES_CUENTA.SALDADA.length, 0)
  assert.equal(TRANSICIONES_CUENTA.CANCELADA.length, 0)
  assert.ok(TRANSICIONES_CUENTA.DISPUTADA.includes('ABIERTA'))
})

test('un acuerdo SUSPENDIDO es una pausa: vuelve a ACTIVO, no a BORRADOR', () => {
  assert.ok(TRANSICIONES_ACUERDO.ACTIVO.includes('SUSPENDIDO'))
  assert.ok(TRANSICIONES_ACUERDO.SUSPENDIDO.includes('ACTIVO'))
  assert.ok(!TRANSICIONES_ACUERDO.SUSPENDIDO.includes('BORRADOR'))
})

// ── Contrato a comisión ─────────────────────────────────────────────────────

function base(): DatosAcuerdo {
  return {
    proveedorId: 'p',
    tipo: 'ON_DEMAND',
    modeloComercial: 'COMISION',
    modalidadPago: 'PAGO_POR_REDENCION',
    politicaSobrante: 'EXPIRAR',
    itemNombre: 'Pizza',
    cantidad: 100,
    costoUnitario: 0,
    precioReferencia: 500,
    comisionPorcentaje: 20,
    inicioAt: new Date('2026-10-01'),
    finAt: new Date('2026-12-01'),
  }
}

test('COMISION exige comisión en (0,100], precio público, costo 0 y pago por redención', () => {
  assert.equal(validarAcuerdo(base()), null)
  assert.notEqual(validarAcuerdo({ ...base(), comisionPorcentaje: 0 }), null)
  assert.notEqual(validarAcuerdo({ ...base(), comisionPorcentaje: null }), null)
  assert.notEqual(validarAcuerdo({ ...base(), precioReferencia: 0 }), null)
  assert.notEqual(validarAcuerdo({ ...base(), costoUnitario: 300 }), null)
  assert.notEqual(validarAcuerdo({ ...base(), modalidadPago: 'PREPAGO_TOTAL' }), null)
})

test('los porcentajes del acuerdo van de 0 a 100 y el plazo no es negativo', () => {
  const compra: DatosAcuerdo = { ...base(), modeloComercial: 'COMPRA_UNIDAD_COMPLETA', modalidadPago: 'PREPAGO_TOTAL', costoUnitario: 300, comisionPorcentaje: null }
  assert.equal(validarAcuerdo(compra), null)
  assert.notEqual(validarAcuerdo({ ...compra, descuentoPorcentaje: 101 }), null)
  assert.notEqual(validarAcuerdo({ ...compra, impuestoPorcentaje: -1 }), null)
  assert.notEqual(validarAcuerdo({ ...compra, plazoPagoDias: -5 }), null)
})

// ── Conciliación (§18): los seis tipos ──────────────────────────────────────

test('compararCifras produce el tipo correcto para cada diferencia', () => {
  const igual = { membegoRedenciones: 10, membegoMonto: 3_000, membegoVentas: 2, membegoVentasMonto: 1_600, proveedorRedenciones: 10, proveedorMonto: 3_000, proveedorVentas: 2, proveedorVentasMonto: 1_600 }
  assert.deepEqual(compararCifras(igual), [])
  assert.equal(compararCifras({ ...igual, proveedorRedenciones: 8 })[0]?.tipo, 'MISSING_REDEMPTION')
  assert.equal(compararCifras({ ...igual, proveedorRedenciones: 12 })[0]?.tipo, 'DUPLICATE')
  assert.equal(compararCifras({ ...igual, proveedorMonto: 3_100 })[0]?.tipo, 'VALUE_DIFFERENCE')
  assert.equal(compararCifras({ ...igual, proveedorVentas: 3 })[0]?.tipo, 'PRODUCT_DIFFERENCE')
  assert.equal(compararCifras({ ...igual, proveedorVentasMonto: 1_500 })[0]?.tipo, 'PAYMENT_DIFFERENCE')
  // Conteo Y dinero distintos: una sola discrepancia con el monto anotado.
  const ambas = compararCifras({ ...igual, proveedorRedenciones: 9, proveedorMonto: 2_700 })
  assert.equal(ambas.length, 1)
  assert.equal(ambas[0]?.montoDiferencia, 300)
})

// ── Umbrales de vencimiento (§20) ───────────────────────────────────────────

test('los umbrales por defecto son 90/60/30/15/7/1 y se pueden configurar', () => {
  assert.deepEqual([...UMBRALES_VENCIMIENTO], [90, 60, 30, 15, 7, 1])
  assert.deepEqual([...parsearUmbrales('45, 10 3')], [45, 10, 3])
  assert.deepEqual([...parsearUmbrales('basura')], [90, 60, 30, 15, 7, 1])
  assert.equal(nivelRiesgoVencimiento(15), 'MEDIO')
  assert.equal(nivelRiesgoVencimiento(16), 'BAJO')
})

// ── Códigos ─────────────────────────────────────────────────────────────────

test('los códigos financieros tienen prefijo y seis dígitos; el de entrega es impredecible', () => {
  assert.equal(codigoDeposito(7), 'MBG-DEP-000007')
  assert.equal(codigoLiquidacion(12), 'MBG-LIQ-000012')
  const a = nuevoCodigoEntrega()
  const b = nuevoCodigoEntrega()
  assert.notEqual(a, b)
  assert.ok(a.length >= 30)
  assert.match(a, /^[A-Za-z0-9_-]+$/)
})
