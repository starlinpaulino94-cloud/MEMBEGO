import test from 'node:test'
import assert from 'node:assert/strict'
import { calcularPagoCambioPlan } from '../src/modules/membresia/prorrateo'

// Casos límite de la fórmula del cambio de plan (todo 28). La fórmula vive en
// `calcularPagoCambioPlan` y SOLO ahí; estos casos son el contrato que la
// pantalla y los cobros comparten.

test('a mitad de un período de 30 días, el importe es precioNuevo − precioVigente×(15/30)', () => {
  // Given una membresía de 30 días con 15 por delante y un plan más caro.
  const ahora = new Date('2026-09-18T12:00:00.000Z')
  const fechaVencimiento = new Date('2026-10-03T12:00:00.000Z') // +15 días

  // When se calcula el pago del cambio.
  const pago = calcularPagoCambioPlan({
    precioNuevo: 1499,
    precioVigente: 999,
    fechaVencimiento,
    vigenciaDias: 30,
    ahora,
  })

  // Then el crédito es la mitad del vigente y se paga la diferencia.
  assert.deepEqual(pago, { precioNuevo: 1499, credito: 499.5, aPagar: 999.5 })
})

test('sin fechaVencimiento el crédito es 0 y se paga el plan nuevo completo', () => {
  const pago = calcularPagoCambioPlan({
    precioNuevo: 1499,
    precioVigente: 999,
    fechaVencimiento: null,
    vigenciaDias: 30,
    ahora: new Date('2026-09-18T12:00:00.000Z'),
  })

  assert.equal(pago.credito, 0)
  assert.equal(pago.aPagar, 1499)
})

test('con días restantes <= 0 el crédito es 0', () => {
  const ahora = new Date('2026-09-18T12:00:00.000Z')

  const vencida = calcularPagoCambioPlan({
    precioNuevo: 1499,
    precioVigente: 999,
    fechaVencimiento: new Date('2026-09-10T12:00:00.000Z'),
    vigenciaDias: 30,
    ahora,
  })
  const venceHoy = calcularPagoCambioPlan({
    precioNuevo: 1499,
    precioVigente: 999,
    fechaVencimiento: new Date('2026-09-18T23:59:59.999Z'),
    vigenciaDias: 30,
    ahora,
  })

  assert.equal(vencida.credito, 0)
  assert.equal(vencida.aPagar, 1499)
  assert.equal(venceHoy.credito, 0)
  assert.equal(venceHoy.aPagar, 1499)
})

test('sin vigenciaDias (ausente, cero o no finita) el crédito es 0', () => {
  const base = {
    precioNuevo: 1499,
    precioVigente: 999,
    fechaVencimiento: new Date('2026-10-03T12:00:00.000Z'),
    ahora: new Date('2026-09-18T12:00:00.000Z'),
  }

  for (const vigenciaDias of [undefined, null, 0, -5, Number.NaN]) {
    const pago = calcularPagoCambioPlan({ ...base, vigenciaDias })
    assert.equal(pago.credito, 0, `vigenciaDias=${String(vigenciaDias)} debe dar crédito 0`)
    assert.equal(pago.aPagar, 1499)
  }
})

test('si el crédito alcanza o supera el precio nuevo, aPagar es 0', () => {
  // Given un plan nuevo que cuesta menos que el crédito por tiempo restante.
  const pago = calcularPagoCambioPlan({
    precioNuevo: 300,
    precioVigente: 999,
    fechaVencimiento: new Date('2026-10-03T12:00:00.000Z'), // +15 días
    vigenciaDias: 30,
    ahora: new Date('2026-09-18T12:00:00.000Z'),
  })

  // Then el crédito se acota a [0, precioNuevo] y no hay nada que pagar.
  assert.equal(pago.credito, 300)
  assert.equal(pago.aPagar, 0)
})

test('un plan vigente ilimitado no cambia la regla: el crédito sigue siendo por tiempo', () => {
  // El cálculo no conoce "ilimitado": solo el precio y los días del período.
  const pago = calcularPagoCambioPlan({
    precioNuevo: 2499,
    precioVigente: 999,
    fechaVencimiento: new Date('2026-10-03T12:00:00.000Z'), // +15 días
    vigenciaDias: 30,
    ahora: new Date('2026-09-18T12:00:00.000Z'),
  })

  assert.equal(pago.credito, 499.5)
  assert.equal(pago.aPagar, 1999.5)
})

test('redondeo a dos decimales (unidad de moneda)', () => {
  // Given 6 días de 30 sobre un vigente de 999: 999×(6/30) = 199.8.
  const pago = calcularPagoCambioPlan({
    precioNuevo: 1499,
    precioVigente: 999,
    fechaVencimiento: new Date('2026-09-24T18:51:54.627Z'),
    vigenciaDias: 30,
    ahora: new Date('2026-09-18T12:00:00.000Z'),
  })

  assert.equal(pago.credito, 199.8)
  assert.equal(pago.aPagar, 1299.2)
})

test('un período de 90 días prorratea sobre 90, no sobre 30', () => {
  const pago = calcularPagoCambioPlan({
    precioNuevo: 2000,
    precioVigente: 1200,
    fechaVencimiento: new Date('2026-11-02T12:00:00.000Z'), // +45 días
    vigenciaDias: 90,
    ahora: new Date('2026-09-18T12:00:00.000Z'),
  })

  assert.equal(pago.credito, 600)
  assert.equal(pago.aPagar, 1400)
})

test('el último día del período el crédito vale exactamente un día de vigencia', () => {
  // Given queda 1 día de los 30 del período del plan vigente.
  const pago = calcularPagoCambioPlan({
    precioNuevo: 1499,
    precioVigente: 999,
    fechaVencimiento: new Date('2026-09-18T12:00:00.000Z'), // +1 día
    vigenciaDias: 30,
    ahora: new Date('2026-09-17T12:00:00.000Z'),
  })

  // Then el crédito es 999×(1/30) = 33.3, no 0 (el día que queda sí se reconoce).
  assert.equal(pago.credito, 33.3)
  assert.equal(pago.aPagar, 1465.7)
})

test('una moneda sin decimales no cambia la regla: la función siempre redondea al céntimo', () => {
  // La firma no recibe moneda: el redondeo es SIEMPRE a dos decimales (la
  // unidad de moneda de la plataforma, DOP). Aunque el plan esté expresado en
  // enteros y la moneda no tenga decimales, el resultado puede llevar céntimos;
  // el redondeo a la unidad entera de una moneda así corresponde a quien
  // muestra o cobra, no a esta función.
  const pago = calcularPagoCambioPlan({
    precioNuevo: 1000,
    precioVigente: 1000,
    fechaVencimiento: new Date('2026-10-02T12:00:00.000Z'), // +14 días
    vigenciaDias: 30,
    ahora: new Date('2026-09-18T12:00:00.000Z'),
  })

  assert.equal(pago.credito, 466.67)
  assert.equal(pago.aPagar, 533.33)
})

test('el redondeo de moneda va al céntimo más cercano, nunca hacia abajo', () => {
  // Given 11 de 30 días sobre un vigente de 1234: 1234×(11/30) = 452.4666…
  // El crédito real redondeado al céntimo es 452.47 y el importe 1547.53.
  // Si el redondeo se hiciera hacia abajo, el crédito caería a 452.46 y el
  // cliente pagaría 1547.54: estas aserciones fallan (dientes).
  const pago = calcularPagoCambioPlan({
    precioNuevo: 2000,
    precioVigente: 1234,
    fechaVencimiento: new Date('2026-09-12T12:00:00.000Z'), // +11 días
    vigenciaDias: 30,
    ahora: new Date('2026-09-01T12:00:00.000Z'),
  })

  assert.equal(pago.credito, 452.47)
  assert.equal(pago.aPagar, 1547.53)
})

test('el crédito se descuenta una sola vez del precio nuevo', () => {
  // Given 20 de 30 días sobre un vigente de 1200 → crédito = 800.
  const pago = calcularPagoCambioPlan({
    precioNuevo: 2000,
    precioVigente: 1200,
    fechaVencimiento: new Date('2026-09-28T12:00:00.000Z'), // +20 días
    vigenciaDias: 30,
    ahora: new Date('2026-09-08T12:00:00.000Z'),
  })

  assert.equal(pago.credito, 800)
  // La identidad precioNuevo − crédito = aPagar se rompe si el crédito se
  // aplicara dos veces (aPagar caería a 400): estas dos aserciones fallan.
  assert.equal(pago.precioNuevo - pago.credito, pago.aPagar)
  assert.equal(pago.aPagar, 1200)
})
