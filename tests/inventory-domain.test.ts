import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  BUCKETS,
  CANTIDAD_MAXIMA,
  EXISTENCIA_MAXIMA,
  MOVIMIENTOS_PERMITIDOS,
  TIPOS_CON_MOTIVO_OBLIGATORIO,
  TIPOS_DE_MOVIMIENTO,
  TTL_MAXIMO_MINUTOS,
  aplicarMovimiento,
  cubetasDeSaldo,
  cubetasVacias,
  cuadra,
  disponible,
  estadoDeStock,
  normalizarMotivo,
  reservaVencida,
  saldoDeCubetas,
  saldoDeMovimientos,
  sumaCubetas,
  validarCantidad,
  validarMovimiento,
  validarTtl,
  validarUmbral,
  vencimientoDeReserva,
  type Cubetas,
  type Movimiento,
} from '../src/modules/inventory/domain'

/**
 * COMMERCE CORE · inventario — el dominio puro (Fase 2).
 *
 * Sin base de datos. Lo que importa: `available` jamás negativo, las unidades
 * se conservan (un traslado no crea ni destruye), y los contadores del saldo
 * son SIEMPRE lo que dice el ledger. Contra PostgreSQL de verdad:
 * `tests/postgres/inventory.db.test.ts`.
 */

const cub = (AVAILABLE: number, RESERVED = 0, DAMAGED = 0): Cubetas => ({ AVAILABLE, RESERVED, DAMAGED })
const mov = (type: Movimiento['type'], sourceBucket: Movimiento['sourceBucket'], destinationBucket: Movimiento['destinationBucket'], quantity: number, reason?: string): Movimiento => ({
  type,
  sourceBucket,
  destinationBucket,
  quantity,
  reason,
})

test('los tres cubos y los nueve tipos de movimiento del Plan Maestro existen, y cada tipo puede hacer algo', () => {
  assert.deepEqual([...BUCKETS], ['AVAILABLE', 'RESERVED', 'DAMAGED'])
  assert.deepEqual([...TIPOS_DE_MOVIMIENTO].sort(), ['ADJUSTMENT', 'DAMAGE', 'PURCHASE', 'RESERVATION', 'RESERVATION_RELEASE', 'RETURN', 'SALE', 'TRANSFER_IN', 'TRANSFER_OUT'])
  for (const t of TIPOS_DE_MOVIMIENTO) assert.ok(MOVIMIENTOS_PERMITIDOS[t].length > 0, `${t} no puede hacer ningún traslado`)
})

test('un saldo se lee y se escribe como cubetas sin perder nada', () => {
  const s = { onHand: 10, reserved: 4, damaged: 2 }
  assert.deepEqual(cubetasDeSaldo(s), cub(6, 4, 2))
  assert.deepEqual(saldoDeCubetas(cubetasDeSaldo(s)), s)
  assert.equal(disponible(s), 6)
})

test('available = onHand − reserved, y lo dañado NO cuenta como existencia', () => {
  assert.equal(disponible({ onHand: 10, reserved: 10 }), 0)
  const dano = aplicarMovimiento(cub(10), mov('DAMAGE', 'AVAILABLE', 'DAMAGED', 3, 'se mojaron'))
  assert.deepEqual(saldoDeCubetas(dano), { onHand: 7, reserved: 0, damaged: 3 })
})

test('cada traslado permitido se aplica y conserva las unidades (salvo lo que entra o sale del inventario)', () => {
  for (const type of TIPOS_DE_MOVIMIENTO) {
    for (const t of MOVIMIENTOS_PERMITIDOS[type]) {
      const antes = cub(20, 20, 20)
      const m = mov(type, t.source, t.destination, 5, 'motivo')
      const despues = aplicarMovimiento(antes, m)
      const delta = (t.destination ? 5 : 0) - (t.source ? 5 : 0)
      assert.equal(sumaCubetas(despues) - sumaCubetas(antes), delta, `${type} ${t.source}→${t.destination}`)
      for (const b of BUCKETS) assert.ok(despues[b] >= 0)
    }
  }
})

test('un traslado fuera de la tabla se rechaza, y las combinaciones sin sentido también', () => {
  assert.match(validarMovimiento(mov('PURCHASE', 'AVAILABLE', null, 1)) ?? '', /PURCHASE/)
  assert.match(validarMovimiento(mov('SALE', null, 'AVAILABLE', 1)) ?? '', /SALE/)
  assert.match(validarMovimiento(mov('RESERVATION', 'AVAILABLE', 'DAMAGED', 1)) ?? '', /RESERVATION/)
  assert.match(validarMovimiento(mov('ADJUSTMENT', 'RESERVED', null, 1, 'x')) ?? '', /ADJUSTMENT/, 'un ajuste no toca lo apartado')
  assert.match(validarMovimiento(mov('PURCHASE', null, null, 1)) ?? '', /origen o de destino/)
})

test('available nunca queda negativo: sacar más de lo que hay lanza y no muta la entrada', () => {
  const antes = cub(3, 5, 1)
  assert.throws(() => aplicarMovimiento(antes, mov('SALE', 'AVAILABLE', null, 4)), /No hay 4 unidades en AVAILABLE: solo 3/)
  assert.throws(() => aplicarMovimiento(antes, mov('RESERVATION', 'AVAILABLE', 'RESERVED', 4)), /AVAILABLE/)
  assert.throws(() => aplicarMovimiento(antes, mov('SALE', 'RESERVED', null, 6)), /RESERVED/)
  assert.throws(() => aplicarMovimiento(antes, mov('DAMAGE', 'AVAILABLE', 'DAMAGED', 4, 'x')), /AVAILABLE/)
  assert.deepEqual(antes, cub(3, 5, 1))
})

test('un ajuste y un daño sin motivo se rechazan; los demás tipos no lo exigen', () => {
  assert.deepEqual([...TIPOS_CON_MOTIVO_OBLIGATORIO].sort(), ['ADJUSTMENT', 'DAMAGE'])
  assert.match(validarMovimiento(mov('ADJUSTMENT', null, 'AVAILABLE', 1)) ?? '', /motivo/)
  assert.match(validarMovimiento(mov('ADJUSTMENT', null, 'AVAILABLE', 1, '   ')) ?? '', /motivo/)
  assert.match(validarMovimiento(mov('DAMAGE', 'AVAILABLE', 'DAMAGED', 1)) ?? '', /motivo/)
  assert.equal(validarMovimiento(mov('PURCHASE', null, 'AVAILABLE', 1)), null)
})

test('la cantidad de un movimiento es entera, positiva y acotada', () => {
  for (const q of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) assert.notEqual(validarMovimiento(mov('PURCHASE', null, 'AVAILABLE', q)), null, String(q))
  assert.notEqual(validarMovimiento(mov('PURCHASE', null, 'AVAILABLE', CANTIDAD_MAXIMA + 1)), null)
  assert.equal(validarMovimiento(mov('PURCHASE', null, 'AVAILABLE', CANTIDAD_MAXIMA)), null)
  assert.throws(() => aplicarMovimiento(cub(EXISTENCIA_MAXIMA - 5), mov('PURCHASE', null, 'AVAILABLE', 10)), /máximo admitido/)
})

test('PROPIEDAD: 5.000 movimientos al azar nunca dejan una cubeta negativa y el saldo SIEMPRE cuadra con el ledger', () => {
  let semilla = 0xc0ffee
  const azar = () => {
    semilla = (Math.imul(semilla ^ (semilla >>> 15), 0x2c1b3c6d) + 0x297a2d39) >>> 0
    return semilla / 0x1_0000_0000
  }
  let actual = cubetasVacias()
  const ledger: Movimiento[] = []
  let aceptados = 0
  for (let i = 0; i < 5000; i++) {
    const type = TIPOS_DE_MOVIMIENTO[Math.floor(azar() * TIPOS_DE_MOVIMIENTO.length)]
    const permitidos = MOVIMIENTOS_PERMITIDOS[type]
    const t = permitidos[Math.floor(azar() * permitidos.length)]
    const m = mov(type, t.source, t.destination, 1 + Math.floor(azar() * 8), 'azar')
    try {
      actual = aplicarMovimiento(actual, m)
      ledger.push(m)
      aceptados++
    } catch {
      /* rechazado: el saldo no cambia */
    }
    for (const b of BUCKETS) assert.ok(actual[b] >= 0, `cubeta ${b} negativa en el paso ${i}`)
  }
  assert.ok(aceptados > 1000, `aceptó ${aceptados}`)
  assert.deepEqual(saldoDeMovimientos(ledger), actual)
  assert.ok(cuadra(saldoDeCubetas(actual), ledger))
})

test('cuadra() detecta un saldo que alguien tocó por fuera del ledger', () => {
  const ledger = [mov('PURCHASE', null, 'AVAILABLE', 10), mov('RESERVATION', 'AVAILABLE', 'RESERVED', 3, 'x'), mov('DAMAGE', 'AVAILABLE', 'DAMAGED', 2, 'x')]
  const bueno = { onHand: 8, reserved: 3, damaged: 2 }
  assert.ok(cuadra(bueno, ledger))
  assert.ok(!cuadra({ ...bueno, onHand: 9 }, ledger))
  assert.ok(!cuadra({ ...bueno, reserved: 2 }, ledger))
  assert.ok(!cuadra({ ...bueno, damaged: 3 }, ledger))
})

test('estado de stock: agotado, bajo (solo con umbral) u ok', () => {
  assert.equal(estadoDeStock({ onHand: 0, reserved: 0, lowStockThreshold: 0 }), 'AGOTADO')
  assert.equal(estadoDeStock({ onHand: 5, reserved: 5, lowStockThreshold: 3 }), 'AGOTADO', 'todo apartado = nada vendible')
  assert.equal(estadoDeStock({ onHand: 5, reserved: 2, lowStockThreshold: 3 }), 'BAJO', 'disponible 3 = umbral')
  assert.equal(estadoDeStock({ onHand: 5, reserved: 1, lowStockThreshold: 3 }), 'OK')
  assert.equal(estadoDeStock({ onHand: 1, reserved: 0, lowStockThreshold: 0 }), 'OK', 'umbral 0 = sin alerta')
})

test('validaciones de entrada: cantidad, umbral, motivo y vigencia', () => {
  assert.deepEqual(validarCantidad(3), { ok: true, valor: 3 })
  for (const mala of [0, -2, 2.5, '3', null, undefined, Number.NaN, CANTIDAD_MAXIMA + 1]) assert.equal(validarCantidad(mala).ok, false, String(mala))
  assert.deepEqual(validarUmbral(0), { ok: true, valor: 0 })
  for (const mala of [-1, 1.2, '2', Number.NaN]) assert.equal(validarUmbral(mala).ok, false, String(mala))

  assert.deepEqual(normalizarMotivo('  se   cayó  '), { ok: true, valor: 'se cayó' })
  assert.deepEqual(normalizarMotivo('   '), { ok: true, valor: null })
  assert.deepEqual(normalizarMotivo(undefined), { ok: true, valor: null })
  assert.equal(normalizarMotivo('x'.repeat(301)).ok, false)
  assert.equal(normalizarMotivo(5).ok, false)

  assert.equal(validarTtl(30).ok, true)
  assert.equal(validarTtl(1).ok, true)
  assert.equal(validarTtl(TTL_MAXIMO_MINUTOS).ok, true)
  for (const mala of [0, -1, 1.5, TTL_MAXIMO_MINUTOS + 1, '30']) assert.equal(validarTtl(mala).ok, false, String(mala))
})

test('una reserva vence EXACTAMENTE a su hora: antes aparta, a la hora y después ya no', () => {
  const t0 = new Date('2030-01-01T10:00:00.000Z')
  const vence = vencimientoDeReserva(t0, 10)
  assert.equal(vence.toISOString(), '2030-01-01T10:10:00.000Z')
  assert.equal(reservaVencida(vence, new Date(vence.getTime() - 1)), false)
  assert.equal(reservaVencida(vence, vence), true)
  assert.equal(reservaVencida(vence, new Date(vence.getTime() + 1)), true)
})
