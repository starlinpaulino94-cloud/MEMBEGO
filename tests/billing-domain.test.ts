import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Prisma, type MembegoVerificationLevel, type MerchantFeeModel, type MerchantLedgerEntryType } from '@prisma/client'
import {
  CONFIG_POR_DEFECTO,
  DIAS_DE_GRACIA,
  TIPOS_QUE_RESTAN,
  TIPOS_QUE_SUMAN,
  calcularComision,
  envejecerDeuda,
  esPedidoDeSupply,
  evaluarEstadoDeCuenta,
  finDelPeriodo,
  inicioDelPeriodo,
  normalizarMotivo,
  pedidoGeneraComision,
  periodoDe,
  periodosCerrados,
  puedeCrearCampanas,
  resumirCorte,
  saldoDeAsientos,
  siguientePosicion,
  tipoDeComision,
  tramoDeAntiguedad,
  validarAsiento,
  validarTarifas,
} from '../src/modules/billing/domain'
import { etiquetaDePeriodo, formatoMonto } from '../src/modules/billing/formato'

/**
 * Merchant Billing · el dominio puro (Fase 4): qué pedido comisiona, CPA vs
 * porcentaje, el asiento válido, el límite de crédito y los periodos. Lo que
 * además vigila la base está contrastado en `tests/postgres/billing.db.test.ts`.
 */

const NIVELES: MembegoVerificationLevel[] = ['ATTRIBUTED', 'REDEEMED', 'CUSTOMER_VERIFIED', 'PAYMENT_VERIFIED', 'FISCALLY_RECONCILED']
const MODELOS: MerchantFeeModel[] = ['CPA_FIXED', 'PERCENTAGE', 'HYBRID']
const D = (n: string | number) => new Prisma.Decimal(n)
const cfg = (feeModel: MerchantFeeModel = 'HYBRID', cpaAmount = '100.00', percentageRate = '8.00') => ({ feeModel, cpaAmount, percentageRate })

test('CPA vs porcentaje: la tabla completa de modelo × nivel de verificación', () => {
  const esperado: Record<MerchantFeeModel, Record<MembegoVerificationLevel, 'CPA_FIXED' | 'PERCENTAGE'>> = {
    CPA_FIXED: { ATTRIBUTED: 'CPA_FIXED', REDEEMED: 'CPA_FIXED', CUSTOMER_VERIFIED: 'CPA_FIXED', PAYMENT_VERIFIED: 'CPA_FIXED', FISCALLY_RECONCILED: 'CPA_FIXED' },
    PERCENTAGE: { ATTRIBUTED: 'PERCENTAGE', REDEEMED: 'PERCENTAGE', CUSTOMER_VERIFIED: 'PERCENTAGE', PAYMENT_VERIFIED: 'PERCENTAGE', FISCALLY_RECONCILED: 'PERCENTAGE' },
    HYBRID: { ATTRIBUTED: 'CPA_FIXED', REDEEMED: 'CPA_FIXED', CUSTOMER_VERIFIED: 'CPA_FIXED', PAYMENT_VERIFIED: 'PERCENTAGE', FISCALLY_RECONCILED: 'PERCENTAGE' },
  }
  for (const m of MODELOS) for (const n of NIVELES) assert.equal(tipoDeComision(m, n), esperado[m][n], `${m} + ${n}`)
})

test('calcular la comisión: CPA fijo, porcentaje exacto y redondeo al centavo (mitad hacia arriba)', () => {
  const cpa = calcularComision({ commissionableBase: '500.00', verificationLevel: 'REDEEMED' }, cfg())
  assert.deepEqual({ type: cpa?.type, amount: cpa?.amount.toFixed(2), rate: cpa?.rate }, { type: 'CPA_FIXED', amount: '100.00', rate: null })
  assert.equal(cpa?.baseAmount.toFixed(2), '500.00')

  const pct = calcularComision({ commissionableBase: '500.00', verificationLevel: 'PAYMENT_VERIFIED' }, cfg())
  assert.deepEqual({ type: pct?.type, amount: pct?.amount.toFixed(2), rate: pct?.rate?.toFixed(2) }, { type: 'PERCENTAGE', amount: '40.00', rate: '8.00' })

  // 249.99 × 8 % = 19.9992 → 20.00; 12.50 × 8 % = 1.00; 0.0625 → mitad hacia arriba.
  assert.equal(calcularComision({ commissionableBase: '249.99', verificationLevel: 'PAYMENT_VERIFIED' }, cfg())?.amount.toFixed(2), '20.00')
  assert.equal(calcularComision({ commissionableBase: '12.50', verificationLevel: 'PAYMENT_VERIFIED' }, cfg())?.amount.toFixed(2), '1.00')
  assert.equal(calcularComision({ commissionableBase: '6.25', verificationLevel: 'PAYMENT_VERIFIED' }, cfg('PERCENTAGE', '100', '8'))?.amount.toFixed(2), '0.50')
  assert.equal(calcularComision({ commissionableBase: '31.25', verificationLevel: 'REDEEMED' }, cfg('PERCENTAGE', '100', '0.01')), null, 'una comisión que redondea a cero no se cobra')
})

test('nada que cobrar → null: base en cero, CPA de cero o porcentaje que redondea a cero', () => {
  assert.equal(calcularComision({ commissionableBase: '0.00', verificationLevel: 'PAYMENT_VERIFIED' }, cfg()), null)
  assert.equal(calcularComision({ commissionableBase: '500', verificationLevel: 'REDEEMED' }, cfg('CPA_FIXED', '0')), null)
  assert.equal(calcularComision({ commissionableBase: '0.01', verificationLevel: 'PAYMENT_VERIFIED' }, cfg('PERCENTAGE', '100', '8')), null)
})

test('una tarifa rota lanza en vez de cobrar mal', () => {
  const p = { commissionableBase: '500', verificationLevel: 'PAYMENT_VERIFIED' as const }
  assert.throws(() => calcularComision(p, cfg('PERCENTAGE', '100', '101')))
  assert.throws(() => calcularComision(p, cfg('PERCENTAGE', '100', '-1')))
  assert.throws(() => calcularComision(p, cfg('CPA_FIXED', '-5')))
  assert.throws(() => calcularComision({ ...p, commissionableBase: '-1' }, cfg()))
})

test('qué pedidos comisionan: solo el marketplace; nunca el que envuelve Supply', () => {
  assert.equal(pedidoGeneraComision({ origin: 'MARKETPLACE', sourceType: null }), true)
  for (const origin of ['POS', 'EXCURSION', 'API']) assert.equal(pedidoGeneraComision({ origin, sourceType: null }), false, origin)
  assert.equal(pedidoGeneraComision({ origin: 'SUPPLY', sourceType: 'SUPPLY_V2_CUSTOMER_ORDER' }), false)
  // Aunque el origen mintiera, el documento de origen de Supply lo delata.
  assert.equal(pedidoGeneraComision({ origin: 'MARKETPLACE', sourceType: 'SUPPLY_V2_CUSTOMER_ORDER' }), false)
  assert.equal(esPedidoDeSupply({ origin: 'MARKETPLACE', sourceType: 'SUPPLY_V2_CUSTOMER_ORDER' }), true)
  assert.equal(esPedidoDeSupply({ origin: 'MARKETPLACE', sourceType: null }), false)
})

test('validar tarifas: rangos, decimales y números', () => {
  assert.equal(validarTarifas({ cpaAmount: '100', percentageRate: '8', creditLimit: '5000' }), null)
  assert.equal(validarTarifas({}), null)
  assert.match(validarTarifas({ cpaAmount: '-1' }) ?? '', /negativo/)
  assert.match(validarTarifas({ cpaAmount: '1.001' }) ?? '', /decimales/)
  assert.match(validarTarifas({ cpaAmount: 'abc' }) ?? '', /número/)
  assert.match(validarTarifas({ cpaAmount: '2000000' }) ?? '', /alto/)
  assert.ok(validarTarifas({ percentageRate: '100.01' }))
  assert.ok(validarTarifas({ percentageRate: '-0.01' }))
  assert.ok(validarTarifas({ percentageRate: '8.123' }))
  assert.equal(validarTarifas({ percentageRate: '0' }), null)
  assert.equal(validarTarifas({ percentageRate: '100' }), null)
  assert.match(validarTarifas({ creditLimit: '-1' }) ?? '', /negativo/)
  assert.match(validarTarifas({ creditLimit: 'x' }) ?? '', /número/)
  assert.equal(validarTarifas({ creditLimit: '0' }), null)
})

test('los valores de la plataforma son válidos', () => {
  assert.equal(validarTarifas({ cpaAmount: CONFIG_POR_DEFECTO.cpaAmount, percentageRate: CONFIG_POR_DEFECTO.percentageRate, creditLimit: CONFIG_POR_DEFECTO.creditLimit }), null)
  assert.equal(CONFIG_POR_DEFECTO.feeModel, 'HYBRID')
  assert.equal(CONFIG_POR_DEFECTO.percentageRate, '8.00')
})

// ── Asientos ─────────────────────────────────────────────────────────────────

test('el signo del asiento lo decide el tipo; el motivo es obligatorio donde corresponde', () => {
  const TIPOS: MerchantLedgerEntryType[] = ['REDEMPTION_FEE', 'ORDER_FEE', 'REFUND', 'ADJUSTMENT', 'PAYMENT', 'CREDIT', 'PROMOTIONAL_CREDIT']
  assert.equal(TIPOS.length, TIPOS_QUE_SUMAN.length + TIPOS_QUE_RESTAN.length + 1, 'cada tipo suma, resta o es el ajuste')
  for (const t of TIPOS_QUE_SUMAN) {
    assert.equal(validarAsiento({ type: t, amount: '10' }), null)
    assert.ok(validarAsiento({ type: t, amount: '-10' }))
  }
  for (const t of TIPOS_QUE_RESTAN) {
    assert.equal(validarAsiento({ type: t, amount: '-10', reason: 'x' }), null)
    assert.ok(validarAsiento({ type: t, amount: '10', reason: 'x' }))
  }
  assert.equal(validarAsiento({ type: 'ADJUSTMENT', amount: '5', reason: 'x' }), null)
  assert.equal(validarAsiento({ type: 'ADJUSTMENT', amount: '-5', reason: 'x' }), null)
  assert.match(validarAsiento({ type: 'ADJUSTMENT', amount: '5', reason: '  ' }) ?? '', /motivo/)
  assert.match(validarAsiento({ type: 'CREDIT', amount: '-5' }) ?? '', /motivo/)
  assert.match(validarAsiento({ type: 'PROMOTIONAL_CREDIT', amount: '-5', reason: null }) ?? '', /motivo/)
  assert.equal(validarAsiento({ type: 'PAYMENT', amount: '-5' }), null, 'un pago no exige motivo (lleva referencia)')
  assert.match(validarAsiento({ type: 'ADJUSTMENT', amount: '0', reason: 'x' }) ?? '', /cero/)
  assert.match(validarAsiento({ type: 'ADJUSTMENT', amount: '1.005', reason: 'x' }) ?? '', /decimales/)
  assert.match(validarAsiento({ type: 'ADJUSTMENT', amount: 'abc', reason: 'x' }) ?? '', /número/)
  assert.match(validarAsiento({ type: 'ADJUSTMENT', amount: '100000001', reason: 'x' }) ?? '', /alto/)
})

test('la posición y el saldo del asiento que sigue; el saldo se recompone sumando', () => {
  assert.deepEqual({ seq: siguientePosicion(null, '100.00').seq, balance: siguientePosicion(null, '100.00').balance.toFixed(2) }, { seq: 1, balance: '100.00' })
  const s2 = siguientePosicion({ seq: 1, balance: D('100.00') }, '-30.50')
  assert.equal(s2.seq, 2)
  assert.equal(s2.balance.toFixed(2), '69.50')
  assert.equal(saldoDeAsientos([{ amount: '100.00' }, { amount: '-30.50' }, { amount: '0.01' }]).toFixed(2), '69.51')
  assert.equal(saldoDeAsientos([]).toFixed(2), '0.00')
  // Sin errores de punto flotante: 0.1 + 0.2.
  assert.equal(saldoDeAsientos([{ amount: '0.10' }, { amount: '0.20' }]).toFixed(2), '0.30')
})

test('normalizar el motivo: recorta, junta espacios y limita el largo', () => {
  assert.deepEqual(normalizarMotivo('  Cobro   olvidado  '), { ok: true, valor: 'Cobro olvidado' })
  assert.deepEqual(normalizarMotivo('   '), { ok: true, valor: null })
  assert.deepEqual(normalizarMotivo(undefined), { ok: true, valor: null })
  assert.equal(normalizarMotivo('x'.repeat(301)).ok, false)
  assert.equal(normalizarMotivo(5).ok, false)
})

// ── Límite de crédito ────────────────────────────────────────────────────────

const AHORA = new Date('2030-03-01T12:00:00Z')
const cuenta = (status: 'ACTIVE' | 'GRACE_PERIOD' | 'SUSPENDED', graceUntil: Date | null = null, holdManual = false) => ({ status, graceUntil, holdManual })

test('límite de crédito: la máquina de estados completa', () => {
  // Dentro del límite (incluido el exacto) no pasa nada.
  assert.equal(evaluarEstadoDeCuenta(cuenta('ACTIVE'), '300.00', '300.00', AHORA).motivo, null)
  assert.equal(evaluarEstadoDeCuenta(cuenta('ACTIVE'), '-50', '0', AHORA).status, 'ACTIVE', 'saldo a favor')
  // Pasarse: gracia de DIAS_DE_GRACIA.
  const g = evaluarEstadoDeCuenta(cuenta('ACTIVE'), '300.01', '300.00', AHORA)
  assert.equal(g.status, 'GRACE_PERIOD')
  assert.equal(g.graceUntil?.getTime(), AHORA.getTime() + DIAS_DE_GRACIA * 86_400_000)
  assert.ok(g.motivo)
  // En gracia y pasada, sin vencer: no cambia nada ni mueve el plazo.
  const plazo = new Date(AHORA.getTime() + 86_400_000)
  const igual = evaluarEstadoDeCuenta(cuenta('GRACE_PERIOD', plazo), '999', '300', AHORA)
  assert.deepEqual({ s: igual.status, u: igual.graceUntil, m: igual.motivo }, { s: 'GRACE_PERIOD', u: plazo, m: null })
  // Vencida la gracia (el instante exacto cuenta): se suspende.
  assert.equal(evaluarEstadoDeCuenta(cuenta('GRACE_PERIOD', AHORA), '999', '300', AHORA).status, 'SUSPENDED')
  assert.equal(evaluarEstadoDeCuenta(cuenta('GRACE_PERIOD', new Date(AHORA.getTime() - 1)), '999', '300', AHORA).graceUntil, null)
  // Al ponerse al día vuelve a ACTIVE, desde la gracia o la suspensión, y la gracia se borra.
  for (const s of ['GRACE_PERIOD', 'SUSPENDED'] as const) {
    const r = evaluarEstadoDeCuenta(cuenta(s, s === 'GRACE_PERIOD' ? plazo : null), '300.00', '300.00', AHORA)
    assert.deepEqual({ s: r.status, u: r.graceUntil }, { s: 'ACTIVE', u: null }, s)
    assert.ok(r.motivo)
  }
  // Una suspendida sigue suspendida mientras deba más que el límite.
  assert.equal(evaluarEstadoDeCuenta(cuenta('SUSPENDED'), '301', '300', AHORA).motivo, null)
})

test('una retención manual no se mueve sola, pase lo que pase con el saldo', () => {
  for (const s of ['ACTIVE', 'GRACE_PERIOD', 'SUSPENDED'] as const) {
    for (const saldo of ['0', '300', '99999']) {
      const r = evaluarEstadoDeCuenta(cuenta(s, s === 'GRACE_PERIOD' ? AHORA : null, true), saldo, '300', new Date(AHORA.getTime() + 999 * 86_400_000))
      assert.equal(r.status, s)
      assert.equal(r.motivo, null)
    }
  }
})

test('solo una cuenta suspendida no puede crear campañas', () => {
  assert.equal(puedeCrearCampanas('ACTIVE'), true)
  assert.equal(puedeCrearCampanas('GRACE_PERIOD'), true)
  assert.equal(puedeCrearCampanas('SUSPENDED'), false)
})

// ── Periodos ─────────────────────────────────────────────────────────────────

// Santo Domingo = UTC−4: la medianoche local es 04:00Z.
const rd = (iso: string) => new Date(`${iso}T04:00:00Z`)

test('periodo mensual: del 1 al 1, en fechas de Santo Domingo (no de UTC)', () => {
  // 2031-02-01T02:00Z es todavía el 31 de enero a las 22:00 en Santo Domingo.
  assert.equal(inicioDelPeriodo('MONTHLY', new Date('2031-02-01T02:00:00Z')).toISOString(), '2031-01-01T04:00:00.000Z')
  assert.equal(inicioDelPeriodo('MONTHLY', new Date('2031-02-01T04:00:00Z')).toISOString(), '2031-02-01T04:00:00.000Z')
  assert.equal(finDelPeriodo('MONTHLY', rd('2031-01-01')).toISOString(), '2031-02-01T04:00:00.000Z')
  assert.equal(finDelPeriodo('MONTHLY', rd('2031-12-01')).toISOString(), '2032-01-01T04:00:00.000Z', 'diciembre → enero del año siguiente')
  assert.equal(periodoDe(rd('2031-01-01'), rd('2031-02-01')).clave, '2031-01-01/2031-02-01')
})

test('periodo quincenal: 1→16 y 16→1; semanal: lunes→lunes', () => {
  assert.equal(finDelPeriodo('BIWEEKLY', rd('2031-05-01')).toISOString(), rd('2031-05-16').toISOString())
  assert.equal(finDelPeriodo('BIWEEKLY', rd('2031-05-16')).toISOString(), rd('2031-06-01').toISOString())
  assert.equal(finDelPeriodo('BIWEEKLY', rd('2031-12-16')).toISOString(), rd('2032-01-01').toISOString())
  assert.equal(inicioDelPeriodo('BIWEEKLY', new Date('2031-05-15T12:00:00Z')).toISOString(), rd('2031-05-01').toISOString())
  assert.equal(inicioDelPeriodo('BIWEEKLY', new Date('2031-05-16T12:00:00Z')).toISOString(), rd('2031-05-16').toISOString())
  // 2031-01-06 es lunes.
  assert.equal(finDelPeriodo('WEEKLY', rd('2031-01-06')).toISOString(), rd('2031-01-13').toISOString())
  assert.equal(finDelPeriodo('WEEKLY', rd('2031-01-08')).toISOString(), rd('2031-01-13').toISOString(), 'un jueves termina el lunes siguiente')
  assert.equal(finDelPeriodo('WEEKLY', rd('2031-01-12')).toISOString(), rd('2031-01-13').toISOString(), 'un domingo, al día siguiente')
  assert.equal(inicioDelPeriodo('WEEKLY', new Date('2031-01-12T12:00:00Z')).toISOString(), rd('2031-01-06').toISOString())
  assert.equal(inicioDelPeriodo('WEEKLY', new Date('2031-01-06T12:00:00Z')).toISOString(), rd('2031-01-06').toISOString())
  assert.equal(finDelPeriodo('WEEKLY', rd('2031-12-29')).toISOString(), rd('2032-01-05').toISOString(), 'cruza el año')
})

test('periodos cerrados: continuos, solo los que ya terminaron y con tope', () => {
  const ps = periodosCerrados('MONTHLY', rd('2031-01-01'), new Date('2031-04-10T12:00:00Z'))
  assert.deepEqual(ps.map((p) => p.clave), ['2031-01-01/2031-02-01', '2031-02-01/2031-03-01', '2031-03-01/2031-04-01'])
  ps.forEach((p, i) => {
    if (i > 0) assert.equal(p.inicio.getTime(), ps[i - 1].fin.getTime())
  })
  assert.deepEqual(periodosCerrados('MONTHLY', rd('2031-04-01'), new Date('2031-04-10T12:00:00Z')), [], 'el mes en curso no se corta')
  assert.equal(periodosCerrados('WEEKLY', rd('2030-01-07'), new Date('2035-01-01T00:00:00Z'), 5).length, 5, 'tope por llamada')
  // Cambiar de ciclo a mitad: sigue desde donde quedó, sin huecos.
  const m = periodosCerrados('BIWEEKLY', rd('2031-05-01'), new Date('2031-07-20T12:00:00Z'))
  assert.equal(m[0].inicio.toISOString(), rd('2031-05-01').toISOString())
  assert.equal(m.at(-1)?.clave, '2031-07-01/2031-07-16')
  const raro = periodosCerrados('MONTHLY', rd('2031-05-16'), new Date('2031-08-10T12:00:00Z'))
  assert.deepEqual(raro.map((p) => p.clave), ['2031-05-16/2031-06-01', '2031-06-01/2031-07-01', '2031-07-01/2031-08-01'], 'desde una mitad de mes, el primero es corto')
})

test('un periodo no se corta recién terminado: el instante exacto cuenta', () => {
  const fin = rd('2031-02-01')
  assert.equal(periodosCerrados('MONTHLY', rd('2031-01-01'), new Date(fin.getTime() - 1)).length, 0)
  assert.equal(periodosCerrados('MONTHLY', rd('2031-01-01'), fin).length, 1)
})

// ── Cortes ───────────────────────────────────────────────────────────────────

test('el corte resume por tipo, cuadra con el saldo corrido y cuenta pedidos y base', () => {
  const asientos = [
    { type: 'ORDER_FEE' as const, amount: '40.00', balance: '140.00' },
    { type: 'REDEMPTION_FEE' as const, amount: '100.00', balance: '240.00' },
    { type: 'REFUND' as const, amount: '-100.00', balance: '140.00' },
    { type: 'ADJUSTMENT' as const, amount: '-5.00', balance: '135.00' },
    { type: 'CREDIT' as const, amount: '-10.00', balance: '125.00' },
    { type: 'PROMOTIONAL_CREDIT' as const, amount: '-5.00', balance: '120.00' },
    { type: 'PAYMENT' as const, amount: '-20.00', balance: '100.00' },
  ]
  const r = resumirCorte('100.00', asientos.map((a, i) => ({ ...a, balance: D(100).plus(asientos.slice(0, i + 1).reduce((t, x) => t.plus(x.amount), D(0))).toFixed(2) })), ['500.00', '250.00'])
  assert.equal(r.openingBalance.toFixed(2), '100.00')
  assert.equal(r.totalCommissions.toFixed(2), '140.00')
  assert.equal(r.reversals.toFixed(2), '-100.00')
  assert.equal(r.adjustments.toFixed(2), '-5.00')
  assert.equal(r.credits.toFixed(2), '-15.00')
  assert.equal(r.payments.toFixed(2), '-20.00')
  assert.equal(r.closingBalance.toFixed(2), '100.00')
  assert.equal(r.amountDue.toFixed(2), '100.00')
  assert.equal(r.totalOrders, 2)
  assert.equal(r.totalGmv.toFixed(2), '750.00')
  assert.equal(r.entryCount, 7)
})

test('el corte con saldo a favor debe cero, y un libro roto no emite corte', () => {
  const a = resumirCorte('0', [{ type: 'PAYMENT', amount: '-30.00', balance: '-30.00' }], [])
  assert.equal(a.closingBalance.toFixed(2), '-30.00')
  assert.equal(a.amountDue.toFixed(2), '0.00')
  const vacio = resumirCorte('55.00', [], [])
  assert.equal(vacio.closingBalance.toFixed(2), '55.00')
  assert.equal(vacio.entryCount, 0)
  assert.throws(() => resumirCorte('0', [{ type: 'PAYMENT', amount: '-30.00', balance: '-29.99' }], []), /no coincide/)
})

test('formato de monto', () => {
  assert.equal(formatoMonto('1234.5'), 'RD$ 1,234.50')
  assert.equal(formatoMonto('-30'), '−RD$ 30.00')
  assert.equal(formatoMonto('0'), 'RD$ 0.00')
  assert.equal(formatoMonto('1000000', 'USD'), 'USD 1,000,000.00')
  assert.equal(formatoMonto('abc'), '—')
  // El fin del periodo está excluido: enero termina el 31.
  assert.match(etiquetaDePeriodo('2031-01-01T04:00:00Z', '2031-02-01T04:00:00Z'), /^01 ene.* 2031 – 31 ene.* 2031$/)
})

// ── Antigüedad de la deuda ───────────────────────────────────────────────────

test('tramos de antigüedad: los bordes', () => {
  assert.deepEqual([0, 30, 31, 60, 61, 90, 91, 400].map(tramoDeAntiguedad), ['0-30', '0-30', '31-60', '31-60', '61-90', '61-90', '90+', '90+'])
})

test('aging: lo que se debe son los cargos más recientes (un pago salda lo más viejo primero)', () => {
  const ahora = new Date('2030-06-30T12:00:00Z')
  const hace = (d: number) => new Date(ahora.getTime() - d * 86_400_000)
  const cargos = [
    { amount: '100.00', createdAt: hace(100) },
    { amount: '100.00', createdAt: hace(70) },
    { amount: '100.00', createdAt: hace(40) },
    { amount: '100.00', createdAt: hace(5) },
  ]
  const t = (saldo: string) => Object.fromEntries(Object.entries(envejecerDeuda(saldo, cargos, ahora)).map(([k, v]) => [k, v.toFixed(2)]))
  assert.deepEqual(t('400.00'), { '0-30': '100.00', '31-60': '100.00', '61-90': '100.00', '90+': '100.00' })
  assert.deepEqual(t('250.00'), { '0-30': '100.00', '31-60': '100.00', '61-90': '50.00', '90+': '0.00' }, 'un pago de 150 saldó lo más viejo')
  assert.deepEqual(t('30.00'), { '0-30': '30.00', '31-60': '0.00', '61-90': '0.00', '90+': '0.00' })
  assert.deepEqual(t('0'), { '0-30': '0.00', '31-60': '0.00', '61-90': '0.00', '90+': '0.00' })
  assert.deepEqual(t('-20'), { '0-30': '0.00', '31-60': '0.00', '61-90': '0.00', '90+': '0.00' }, 'a favor: no hay deuda que envejecer')
  // Un saldo que los cargos no explican (saldo inicial) cuenta como lo más viejo; los ajustes negativos no son cargos.
  assert.deepEqual(Object.fromEntries(Object.entries(envejecerDeuda('150', [{ amount: '100', createdAt: hace(1) }, { amount: '-30', createdAt: hace(2) }], ahora)).map(([k, v]) => [k, v.toFixed(2)])), { '0-30': '100.00', '31-60': '0.00', '61-90': '0.00', '90+': '50.00' })
  assert.deepEqual(Object.fromEntries(Object.entries(envejecerDeuda('10', [], ahora)).map(([k, v]) => [k, v.toFixed(2)])), { '0-30': '0.00', '31-60': '0.00', '61-90': '0.00', '90+': '10.00' })
})
