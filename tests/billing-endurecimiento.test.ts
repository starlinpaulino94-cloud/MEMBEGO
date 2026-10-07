import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Prisma } from '@prisma/client'
import { cargosVigentes, envejecerDeuda, esClaveDeComision, instanteDelAsiento } from '../src/modules/billing/domain'

/**
 * Merchant Billing · endurecimiento tras la auditoría del 2026-10-07.
 *
 * Lo que se puede comprobar sin base de datos: las funciones puras nuevas y la forma
 * del código que las usa (el comportamiento contra PostgreSQL está en
 * `tests/postgres/billing.db.test.ts`, pruebas 35–40).
 */

const RAIZ = join(__dirname, '..')
const leer = (r: string) => readFileSync(join(RAIZ, r), 'utf8')
const D = (n: number | string) => new Prisma.Decimal(n)
const dia = (n: number) => new Date(Date.UTC(2030, 5, 1) + n * 86_400_000)

test('instanteDelAsiento: nunca antes del último asiento de la cuenta', () => {
  const ultimo = { createdAt: new Date('2030-03-10T12:00:00Z') }
  assert.equal(instanteDelAsiento(new Date('2030-03-10T11:00:00Z'), ultimo).toISOString(), '2030-03-10T12:00:00.000Z', 'un «ahora» viejo se sube al del último')
  assert.equal(instanteDelAsiento(new Date('2030-03-10T13:00:00Z'), ultimo).toISOString(), '2030-03-10T13:00:00.000Z', 'uno posterior se respeta')
  assert.equal(instanteDelAsiento(new Date('2030-03-10T12:00:00Z'), ultimo).toISOString(), '2030-03-10T12:00:00.000Z', 'el mismo instante vale')
  assert.equal(instanteDelAsiento(new Date('2001-01-01T00:00:00Z'), null).toISOString(), '2001-01-01T00:00:00.000Z', 'en una cuenta vacía no hay con qué comparar')
})

test('esClaveDeComision: reconoce el prefijo del sistema sin distinguir mayúsculas ni espacios', () => {
  assert.equal(esClaveDeComision('commission:abc'), true)
  assert.equal(esClaveDeComision('  Commission:abc:reversal '), true)
  assert.equal(esClaveDeComision('COMMISSION:x'), true)
  assert.equal(esClaveDeComision('7f9c0b1e-0000-4000-8000-000000000000'), false)
  assert.equal(esClaveDeComision('mi-commission:abc'), false)
})

test('cargosVigentes: una comisión revertida y su reverso no son un cargo vivo', () => {
  const asientos = [
    { type: 'REDEMPTION_FEE' as const, amount: D(100), createdAt: dia(0), referenceType: 'COMMISSION', referenceId: 'c1' },
    { type: 'ORDER_FEE' as const, amount: D(80), createdAt: dia(50), referenceType: 'COMMISSION', referenceId: 'c2' },
    { type: 'REFUND' as const, amount: D(-80), createdAt: dia(50), referenceType: 'COMMISSION', referenceId: 'c2' },
    { type: 'ADJUSTMENT' as const, amount: D(20), createdAt: dia(55), referenceType: 'MANUAL', referenceId: 'm1' },
    { type: 'ADJUSTMENT' as const, amount: D(-5), createdAt: dia(56), referenceType: 'MANUAL', referenceId: 'm2' },
    { type: 'PAYMENT' as const, amount: D(-10), createdAt: dia(57), referenceType: 'PAYMENT', referenceId: 'p1' },
  ]
  const vivos = cargosVigentes(asientos)
  assert.deepEqual(vivos.map((c) => c.amount.toString()), ['100', '20'], 'quedan la comisión sin revertir y el ajuste positivo')
})

test('la antigüedad con cargos vigentes no rejuvenece una deuda vieja', () => {
  const ahora = dia(51)
  const asientos = [
    { type: 'REDEMPTION_FEE' as const, amount: D(100), createdAt: dia(0), referenceType: 'COMMISSION', referenceId: 'c1' },
    { type: 'ORDER_FEE' as const, amount: D(100), createdAt: dia(50), referenceType: 'COMMISSION', referenceId: 'c2' },
    { type: 'REFUND' as const, amount: D(-100), createdAt: dia(50), referenceType: 'COMMISSION', referenceId: 'c2' },
  ]
  // El saldo es 100 (el cargo del día 50 y su reverso se anulan): es la comisión del día 0, de 51 días.
  const bien = envejecerDeuda(D(100), cargosVigentes(asientos), ahora)
  assert.equal(bien['31-60'].toString(), '100')
  assert.equal(bien['0-30'].toString(), '0')
  // Sin descontar el reverso, el saldo se atribuiría al cargo de ayer (el defecto que se corrigió).
  const mal = envejecerDeuda(D(100), asientos.filter((a) => a.type !== 'REFUND').map((a) => ({ amount: a.amount, createdAt: a.createdAt })), ahora)
  assert.equal(mal['0-30'].toString(), '100')
})

test('el servicio: el candado de la cuenta va ANTES de calcular los periodos pendientes', () => {
  const t = leer('src/modules/billing/service.ts')
  const i = t.indexOf('export async function generarCortesPendientesEnTx')
  assert.ok(i > 0)
  const cuerpo = t.slice(i, t.indexOf('\n}\n', i))
  assert.ok(cuerpo.indexOf('cuentaBloqueada(') > 0, 'toma el candado')
  assert.ok(cuerpo.indexOf('cuentaBloqueada(') < cuerpo.indexOf('periodosPendientesEnTx('), 'antes de leer el ciclo y calcular los periodos')
})

test('el servicio: el asiento usa el instante monótono, la moneda se comprueba y las claves manuales no pueden ser del sistema', () => {
  const t = leer('src/modules/billing/service.ts')
  assert.match(t, /createdAt: instanteDelAsiento\(e\.ahora, ultimo\)/, 'la fecha del asiento no retrocede')
  assert.match(t, /pedido\.currency !== config\.currency/, 'la comisión solo se asienta en la moneda de la cuenta')
  assert.match(t, /esClaveDeComision\(clave\)/, 'una clave manual no puede llevar el prefijo de las comisiones')
  assert.match(t, /PAGO_DUPLICADO/, 'un depósito no se acredita dos veces')
})

test('el barrido no reprocesa cada día los pedidos con base en cero', () => {
  const t = leer('src/modules/billing/barrido.ts')
  assert.match(t, /commissionableBase: \{ gt: 0 \}/)
})

test('la consulta de antigüedad lee también los reversos y usa los cargos vigentes', () => {
  const t = leer('src/modules/billing/queries.ts')
  assert.match(t, /cargosVigentes\(/)
  assert.match(t, /type: 'REFUND', referenceType: 'COMMISSION'/)
})

test('el escáner dice qué pasó cuando la moneda del pedido no es la de la cuenta', () => {
  const t = leer('src/modules/orders/service.ts')
  assert.match(t, /e instanceof FacturacionError && e\.codigo === 'MONEDA_DISTINTA'/)
})

test('la migración de endurecimiento: moneda, orden del tiempo, claves del sistema y pago único', () => {
  const m = leer('prisma/migrations/20261046_merchant_billing_endurecimiento/migration.sql')
  assert.match(m, /merchant_ledger_moneda/)
  assert.match(m, /merchant_ledger_orden/)
  assert.match(m, /merchant_ledger_entries_clave_comision/)
  assert.match(m, /merchant_ledger_entries_pago_referencia/)
  assert.doesNotMatch(m, /CREATE POLICY|DROP TABLE|DELETE FROM|TRUNCATE/i, 'aditiva y sin políticas a mano')
  assert.match(m, /IF NOT EXISTS/)
})
