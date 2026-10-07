import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CANALES,
  DATO_DEL_CANAL,
  DIAS_VIGENCIA_QR_PEDIDO,
  ESTADOS,
  ESTADOS_AJUSTABLES,
  ESTADOS_CANCELABLES,
  ESTADOS_CANCELABLES_POR_CLIENTE,
  ESTADOS_CERRADOS,
  ESTADOS_CONFIRMABLES,
  ESTADOS_CON_PAGO_REGISTRABLE,
  LINEAS_MAXIMAS,
  MOTIVO_MAXIMO,
  NIVELES,
  TRANSICIONES,
  calcularPedido,
  confirmacionVigente,
  esFinal,
  nivelDeVerificacion,
  normalizarMotivoPedido,
  normalizarNota,
  pagoVerificado,
  puedeTransicionar,
  qrDePedidoVencido,
  rangoDeNivel,
  validarAtribucion,
  validarLineaPedido,
  validarPago,
  vencimientoQrPedido,
  type EvidenciaDePedido,
} from '../src/modules/orders/domain'

/**
 * COMMERCE CORE · pedidos Membego — el dominio puro (Fase 3).
 *
 * Sin base de datos. Lo que importa: una transición que no está en la tabla no
 * ocurre, los totales cuadran con la aritmética que la base vigila con CHECK, y
 * el nivel de verificación es una cadena (cada nivel exige el anterior).
 * Contra PostgreSQL de verdad: `tests/postgres/orders.db.test.ts`.
 */

test('los siete estados del Plan Maestro existen y la tabla de transiciones los cubre todos', () => {
  assert.deepEqual([...ESTADOS], ['CREATED', 'AWAITING_MERCHANT', 'IN_PROGRESS', 'READY', 'COMPLETED', 'CANCELLED', 'REFUNDED'])
  assert.deepEqual(Object.keys(TRANSICIONES).sort(), [...ESTADOS].sort())
})

test('el camino feliz: CREATED → AWAITING_MERCHANT → IN_PROGRESS → READY → COMPLETED → REFUNDED', () => {
  const camino = ['CREATED', 'AWAITING_MERCHANT', 'IN_PROGRESS', 'READY', 'COMPLETED', 'REFUNDED'] as const
  for (let i = 0; i < camino.length - 1; i++) assert.ok(puedeTransicionar(camino[i], camino[i + 1]), `${camino[i]} → ${camino[i + 1]}`)
})

test('la empresa puede saltarse IN_PROGRESS cuando no hay nada que preparar', () => {
  assert.ok(puedeTransicionar('AWAITING_MERCHANT', 'READY'))
})

test('las 49 combinaciones: solo las declaradas ocurren, ninguna transición hacia atrás, y los finales no salen', () => {
  const permitidas = new Set([
    'CREATED>AWAITING_MERCHANT',
    'CREATED>CANCELLED',
    'AWAITING_MERCHANT>IN_PROGRESS',
    'AWAITING_MERCHANT>READY',
    'AWAITING_MERCHANT>CANCELLED',
    'IN_PROGRESS>READY',
    'IN_PROGRESS>CANCELLED',
    'READY>COMPLETED',
    'READY>CANCELLED',
    'COMPLETED>REFUNDED',
  ])
  let n = 0
  for (const d of ESTADOS) {
    for (const h of ESTADOS) {
      n++
      assert.equal(puedeTransicionar(d, h), permitidas.has(`${d}>${h}`), `${d} → ${h}`)
    }
  }
  assert.equal(n, 49)
  assert.equal(permitidas.size, 10)
  assert.ok(esFinal('CANCELLED') && esFinal('REFUNDED'))
  assert.ok(!esFinal('COMPLETED'), 'un pedido completado todavía puede reembolsarse')
})

test('un pedido cancelado no resucita ni se completa; uno completado no se cancela (se reembolsa)', () => {
  assert.equal(puedeTransicionar('CANCELLED', 'AWAITING_MERCHANT'), false)
  assert.equal(puedeTransicionar('CANCELLED', 'COMPLETED'), false)
  assert.equal(puedeTransicionar('COMPLETED', 'CANCELLED'), false)
  assert.equal(puedeTransicionar('READY', 'AWAITING_MERCHANT'), false)
})

test('los conjuntos de estados por operación son coherentes con la máquina', () => {
  // Todo lo cancelable puede pasar a CANCELLED, y nada fuera de eso.
  for (const e of ESTADOS) assert.equal(ESTADOS_CANCELABLES.includes(e), puedeTransicionar(e, 'CANCELLED'), `cancelable ${e}`)
  // El cliente cancela solo antes de que la empresa acepte.
  assert.deepEqual([...ESTADOS_CANCELABLES_POR_CLIENTE], ['CREATED', 'AWAITING_MERCHANT'])
  for (const e of ESTADOS_CANCELABLES_POR_CLIENTE) assert.ok(ESTADOS_CANCELABLES.includes(e))
  // El monto no se ajusta una vez cerrado el pedido, ni antes de que exista para la empresa.
  for (const e of ESTADOS_CERRADOS) assert.ok(!ESTADOS_AJUSTABLES.includes(e), `${e} ajustable`)
  assert.ok(!ESTADOS_AJUSTABLES.includes('CREATED'))
  // Confirmar y pagar: solo cuando el monto ya es firme.
  assert.ok(!ESTADOS_CONFIRMABLES.includes('AWAITING_MERCHANT'))
  assert.ok(ESTADOS_CONFIRMABLES.includes('COMPLETED'))
  assert.ok(!ESTADOS_CON_PAGO_REGISTRABLE.includes('CANCELLED'))
  assert.deepEqual([...ESTADOS_CERRADOS].sort(), ['CANCELLED', 'COMPLETED', 'REFUNDED'])
})

// ── Atribución ───────────────────────────────────────────────────────────────

test('los ocho canales del Plan Maestro existen y cada uno declara su dato', () => {
  assert.deepEqual([...CANALES].sort(), ['CAMPAIGN', 'DIRECT', 'MARKETPLACE_BROWSE', 'MARKETPLACE_SEARCH', 'PROMOTION_CLAIM', 'QR_SCAN', 'REFERRAL', 'SUPPLY_OFFER'])
  assert.deepEqual(Object.keys(DATO_DEL_CANAL).sort(), [...CANALES].sort())
})

test('los canales sin dato aceptan la atribución sola; los que lo piden la rechazan sin él', () => {
  for (const c of CANALES) {
    const dato = DATO_DEL_CANAL[c]
    if (!dato) {
      assert.equal(validarAtribucion({ channel: c }), null, c)
    } else {
      assert.match(validarAtribucion({ channel: c }) ?? '', /necesita/, `${c} sin dato`)
      assert.match(validarAtribucion({ channel: c, [dato]: '   ' }) ?? '', /necesita/, `${c} con dato en blanco`)
      assert.equal(validarAtribucion({ channel: c, [dato]: 'x' }), null, `${c} con dato`)
    }
  }
  assert.match(validarAtribucion({ channel: 'INVENTADO' as never }) ?? '', /no es válido/)
})

// ── Dinero ───────────────────────────────────────────────────────────────────

test('calcularPedido: subtotal, descuento, base comisionable y total', () => {
  const t = calcularPedido([
    { quantity: 2, unitPrice: '100.00', discount: '20.00' },
    { quantity: 1, unitPrice: '50.50' },
  ])
  assert.equal(t.subtotal.toFixed(2), '250.50')
  assert.equal(t.discount.toFixed(2), '20.00')
  assert.equal(t.adjustment.toFixed(2), '0.00')
  assert.equal(t.commissionableBase.toFixed(2), '230.50')
  assert.equal(t.tax.toFixed(2), '0.00')
  assert.equal(t.total.toFixed(2), '230.50')
  assert.equal(t.lineas[0].lineTotal.toFixed(2), '180.00')
  assert.equal(t.lineas[1].lineTotal.toFixed(2), '50.50')
})

test('calcularPedido: el ajuste y los impuestos entran en el total, pero solo el ajuste en la base comisionable', () => {
  const t = calcularPedido([{ quantity: 1, unitPrice: 1000 }], { adjustment: -150, tax: 153 })
  assert.equal(t.commissionableBase.toFixed(2), '850.00')
  assert.equal(t.total.toFixed(2), '1003.00')
  const recargo = calcularPedido([{ quantity: 1, unitPrice: 1000 }], { adjustment: '25.25' })
  assert.equal(recargo.commissionableBase.toFixed(2), '1025.25')
})

test('calcularPedido: no hay error de punto flotante (0.1 + 0.2)', () => {
  const t = calcularPedido([
    { quantity: 1, unitPrice: '0.10' },
    { quantity: 1, unitPrice: '0.20' },
  ])
  assert.equal(t.total.toFixed(2), '0.30')
})

test('calcularPedido rechaza lo que la base también rechazaría', () => {
  assert.throws(() => calcularPedido([]), /sin líneas/)
  assert.throws(() => calcularPedido(Array.from({ length: LINEAS_MAXIMAS + 1 }, () => ({ quantity: 1, unitPrice: 1 }))), /máximo/)
  assert.throws(() => calcularPedido([{ quantity: 0, unitPrice: 1 }]), /entero positivo/)
  assert.throws(() => calcularPedido([{ quantity: 1.5, unitPrice: 1 }]), /entero positivo/)
  assert.throws(() => calcularPedido([{ quantity: 1, unitPrice: -1 }]), /negativo/)
  assert.throws(() => calcularPedido([{ quantity: 1, unitPrice: 10, discount: 11 }]), /descuento/)
  assert.throws(() => calcularPedido([{ quantity: 1, unitPrice: 10 }], { adjustment: -10.01 }), /negativo/)
  assert.throws(() => calcularPedido([{ quantity: 1, unitPrice: 10 }], { tax: -1 }), /impuesto/)
  assert.throws(() => calcularPedido([{ quantity: 1, unitPrice: 'abc' }]), /número/)
  assert.throws(() => calcularPedido([{ quantity: 1, unitPrice: 1 }], { adjustment: 'x' }), /ajuste/)
  assert.throws(() => calcularPedido([{ quantity: 10_000, unitPrice: 999_999_999 }]), /máximo/)
})

test('calcularPedido deja la base en cero cuando el ajuste cancela el pedido entero (no en negativo)', () => {
  const t = calcularPedido([{ quantity: 1, unitPrice: 10 }], { adjustment: -10 })
  assert.equal(t.commissionableBase.toFixed(2), '0.00')
  assert.equal(t.total.toFixed(2), '0.00')
})

test('validarLineaPedido', () => {
  assert.equal(validarLineaPedido({ quantity: 3, unitPrice: 10, discount: 30 }), null)
  assert.ok(validarLineaPedido({ quantity: 3, unitPrice: 10, discount: 30.01 }))
  assert.ok(validarLineaPedido({ quantity: 10_001, unitPrice: 1 }))
  assert.ok(validarLineaPedido({ quantity: 1, unitPrice: 1, discount: -1 }))
})

test('motivos y notas: obligatorio y acotado / opcional y acotada', () => {
  assert.deepEqual(normalizarMotivoPedido('  se acabó  '), { ok: true, valor: 'se acabó' })
  assert.equal(normalizarMotivoPedido('').ok, false)
  assert.equal(normalizarMotivoPedido('   ').ok, false)
  assert.equal(normalizarMotivoPedido(null).ok, false)
  assert.equal(normalizarMotivoPedido('x'.repeat(MOTIVO_MAXIMO + 1)).ok, false)
  assert.deepEqual(normalizarNota(undefined), { ok: true, valor: null })
  assert.deepEqual(normalizarNota('  '), { ok: true, valor: null })
  assert.deepEqual(normalizarNota(' sin cebolla '), { ok: true, valor: 'sin cebolla' })
  assert.equal(normalizarNota('x'.repeat(501)).ok, false)
  assert.equal(normalizarNota(12).ok, false)
})

// ── Verificación ─────────────────────────────────────────────────────────────

const ev = (parcial: Partial<EvidenciaDePedido> = {}): EvidenciaDePedido => ({ status: 'COMPLETED', total: '500.00', confirmacion: null, pago: null, ...parcial })

test('los cinco niveles de verificación existen, ordenados de menos a más evidencia', () => {
  assert.deepEqual([...NIVELES], ['ATTRIBUTED', 'REDEEMED', 'CUSTOMER_VERIFIED', 'PAYMENT_VERIFIED', 'FISCALLY_RECONCILED'])
  assert.ok(rangoDeNivel('REDEEMED') > rangoDeNivel('ATTRIBUTED'))
  assert.ok(rangoDeNivel('FISCALLY_RECONCILED') > rangoDeNivel('PAYMENT_VERIFIED'))
})

test('un pedido que no se completó no pasa de ATTRIBUTED, tenga la evidencia que tenga', () => {
  for (const status of ['CREATED', 'AWAITING_MERCHANT', 'IN_PROGRESS', 'READY', 'CANCELLED'] as const) {
    assert.equal(
      nivelDeVerificacion(ev({ status, confirmacion: { confirmedTotal: '500.00' }, pago: { method: 'TRANSFER', amount: '500.00', reference: 'T-1' } })),
      'ATTRIBUTED',
      status
    )
  }
})

test('completado por QR sin más evidencia: REDEEMED', () => {
  assert.equal(nivelDeVerificacion(ev()), 'REDEEMED')
})

test('con la confirmación del cliente del monto vigente: CUSTOMER_VERIFIED', () => {
  assert.equal(nivelDeVerificacion(ev({ confirmacion: { confirmedTotal: '500' } })), 'CUSTOMER_VERIFIED')
})

test('una confirmación de OTRO monto (la empresa ajustó después) no cuenta', () => {
  assert.equal(confirmacionVigente('500.00', { confirmedTotal: '600.00' }), false)
  assert.equal(nivelDeVerificacion(ev({ confirmacion: { confirmedTotal: '600.00' } })), 'REDEEMED')
  assert.equal(confirmacionVigente('500.00', null), false)
})

test('pago verificado: método verificable + referencia + el monto del pedido; y exige la confirmación', () => {
  const pago = { method: 'TRANSFER' as const, amount: '500.00', reference: 'T-99' }
  assert.equal(nivelDeVerificacion(ev({ confirmacion: { confirmedTotal: '500.00' }, pago })), 'PAYMENT_VERIFIED')
  // Sin confirmación del cliente el pago solo no sube más allá de REDEEMED (es una cadena).
  assert.equal(nivelDeVerificacion(ev({ pago })), 'REDEEMED')
})

test('el pago NO verifica si es efectivo, no tiene referencia o no es por el monto', () => {
  const conf = { confirmedTotal: '500.00' }
  assert.equal(pagoVerificado('500.00', { method: 'CASH', amount: '500.00', reference: 'R' }), false)
  assert.equal(pagoVerificado('500.00', { method: 'OTHER', amount: '500.00', reference: 'R' }), false)
  assert.equal(pagoVerificado('500.00', { method: 'CARD', amount: '500.00', reference: null }), false)
  assert.equal(pagoVerificado('500.00', { method: 'CARD', amount: '500.00', reference: '  ' }), false)
  assert.equal(pagoVerificado('500.00', { method: 'CARD', amount: '499.99', reference: 'R' }), false)
  assert.equal(pagoVerificado('500.00', null), false)
  assert.equal(pagoVerificado('500.00', { method: 'MEMBEGO_CHECKOUT', amount: 500, reference: 'R' }), true)
  assert.equal(nivelDeVerificacion(ev({ confirmacion: conf, pago: { method: 'CASH', amount: '500.00', reference: 'R' } })), 'CUSTOMER_VERIFIED')
})

test('un pedido reembolsado conserva el nivel que tenía al completarse', () => {
  assert.equal(nivelDeVerificacion(ev({ status: 'REFUNDED', confirmacion: { confirmedTotal: '500.00' } })), 'CUSTOMER_VERIFIED')
})

test('FISCALLY_RECONCILED no se deriva en esta fase: ninguna evidencia lo produce', () => {
  const maxima = ev({ confirmacion: { confirmedTotal: '500.00' }, pago: { method: 'CARD', amount: '500.00', reference: 'R' } })
  assert.notEqual(nivelDeVerificacion(maxima), 'FISCALLY_RECONCILED')
})

test('validarPago', () => {
  assert.equal(validarPago({ method: 'CASH', amount: 10 }), null)
  assert.ok(validarPago({ method: 'CASH', amount: -1 }))
  assert.ok(validarPago({ method: 'CASH', amount: 'abc' }))
  assert.ok(validarPago({ method: 'CASH', amount: 1_000_000_000 }))
  assert.ok(validarPago({ method: 'TRANSFER', amount: 10, reference: 'x'.repeat(81) }))
})

// ── QR ───────────────────────────────────────────────────────────────────────

test('el QR del pedido vive siete días y vence exactamente en ese instante', () => {
  assert.equal(DIAS_VIGENCIA_QR_PEDIDO, 7)
  const t0 = new Date('2030-01-01T10:00:00.000Z')
  const vence = vencimientoQrPedido(t0)
  assert.equal(vence.toISOString(), '2030-01-08T10:00:00.000Z')
  assert.equal(qrDePedidoVencido(vence, new Date(vence.getTime() - 1)), false)
  assert.equal(qrDePedidoVencido(vence, vence), true)
  assert.equal(qrDePedidoVencido(null, t0), true, 'sin vencimiento no hay QR vigente')
  assert.equal(t0.toISOString(), '2030-01-01T10:00:00.000Z', 'no muta la fecha de entrada')
})
