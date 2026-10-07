import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as dinero from '../src/lib/commerce-primitives/dinero'
import * as fefo from '../src/lib/commerce-primitives/fefo'
import * as comision from '../src/lib/commerce-primitives/comision'
import {
  formatearNumero,
  secuenciaDeNumero,
  siguienteNumero,
} from '../src/lib/commerce-primitives/numeracion'
import {
  exigirTransicion,
  puedeTransicionar,
  type Transiciones,
} from '../src/lib/commerce-primitives/estados'
import {
  aplicarMovimientoGenerico,
  cubetasVaciasGenerico,
  invarianteCumplidoGenerico,
  saldoDeAsientosGenerico,
  sumaCubetasGenerico,
  validarMovimientoGenerico,
  type TraspasoPermitido,
} from '../src/lib/commerce-primitives/ledger'
import * as supplyDinero from '../src/modules/supply-v2/core/dinero'
import * as supplyFefo from '../src/modules/supply-v2/core/fefo'
import * as supplyComision from '../src/modules/supply-v2/core/comision'
import { siguienteNumero as siguienteNumeroSupply } from '../src/modules/supply-v2/core/numeracion'

/**
 * COMMERCE PRIMITIVES (Fase 0) — pruebas DIRECTAS de la capa compartida.
 *
 * Las pruebas de Supply V2 ya cubren estas funciones, pero solo con las
 * cubetas, estados y prefijos de Supply. Aquí se instancian los genéricos con
 * conjuntos que NO son de Supply (inventario, pedido, facturación de comercio):
 * es exactamente lo que Commerce Core y Merchant Billing van a hacer, y si el
 * genérico solo funcionara para Supply, esta es la prueba que lo dice.
 */

// ── Ledger genérico con cubetas de INVENTARIO ───────────────────────────────

type CubetaInv = 'ON_HAND' | 'RESERVED' | 'DAMAGED'
type MovInv = 'PURCHASE' | 'RESERVE' | 'RELEASE' | 'DAMAGE' | 'ADJUSTMENT'

const CUBETAS_INV: readonly CubetaInv[] = ['ON_HAND', 'RESERVED', 'DAMAGED']

const PERMITIDOS_INV: Record<MovInv, readonly TraspasoPermitido<CubetaInv>[]> = {
  PURCHASE: [{ source: null, destination: 'ON_HAND' }],
  RESERVE: [{ source: 'ON_HAND', destination: 'RESERVED' }],
  RELEASE: [{ source: 'RESERVED', destination: 'ON_HAND' }],
  DAMAGE: [{ source: 'ON_HAND', destination: 'DAMAGED' }],
  ADJUSTMENT: [],
}
const CON_MOTIVO_INV: readonly MovInv[] = ['ADJUSTMENT', 'DAMAGE']

const mover = (
  antes: Record<CubetaInv, number>,
  type: MovInv,
  sourceBucket: CubetaInv | null,
  destinationBucket: CubetaInv | null,
  quantity: number,
  reason?: string
) =>
  aplicarMovimientoGenerico(
    antes,
    { type, sourceBucket, destinationBucket, quantity, reason },
    PERMITIDOS_INV,
    CON_MOTIVO_INV,
    'ADJUSTMENT'
  )

test('ledger genérico · cubetas vacías salen del conjunto que se le pasa', () => {
  assert.deepEqual(cubetasVaciasGenerico(CUBETAS_INV), { ON_HAND: 0, RESERVED: 0, DAMAGED: 0 })
})

test('ledger genérico · un traslado resta de una cubeta lo que suma a otra y no muta la entrada', () => {
  const inicio = { ON_HAND: 10, RESERVED: 0, DAMAGED: 0 }
  const despues = mover(inicio, 'RESERVE', 'ON_HAND', 'RESERVED', 4)
  assert.deepEqual(despues, { ON_HAND: 6, RESERVED: 4, DAMAGED: 0 })
  assert.deepEqual(inicio, { ON_HAND: 10, RESERVED: 0, DAMAGED: 0 }, 'la entrada no se muta')
  assert.equal(sumaCubetasGenerico(CUBETAS_INV, despues), 10)
})

test('ledger genérico · una cubeta nunca queda en negativo', () => {
  assert.throws(
    () => mover({ ON_HAND: 2, RESERVED: 0, DAMAGED: 0 }, 'RESERVE', 'ON_HAND', 'RESERVED', 3),
    /No hay 3 unidades en ON_HAND: solo 2\./
  )
})

test('ledger genérico · un traslado fuera de la tabla se rechaza con el origen y destino en el mensaje', () => {
  const error = validarMovimientoGenerico(
    { type: 'RELEASE', sourceBucket: 'ON_HAND', destinationBucket: 'RESERVED', quantity: 1 },
    PERMITIDOS_INV,
    CON_MOTIVO_INV,
    'ADJUSTMENT'
  )
  assert.equal(error, 'Un asiento RELEASE no puede ir de ON_HAND a RESERVED.')
})

test('ledger genérico · el origen nulo se muestra como «fuera»', () => {
  const error = validarMovimientoGenerico(
    { type: 'DAMAGE', sourceBucket: null, destinationBucket: 'DAMAGED', quantity: 1, reason: 'se cayó' },
    PERMITIDOS_INV,
    CON_MOTIVO_INV,
    'ADJUSTMENT'
  )
  assert.equal(error, 'Un asiento DAMAGE no puede ir de fuera a DAMAGED.')
})

test('ledger genérico · cantidad no entera o no positiva, y sin cubetas, se rechazan', () => {
  const base = { type: 'PURCHASE' as const, sourceBucket: null, destinationBucket: 'ON_HAND' as const }
  for (const quantity of [0, -1, 1.5, Number.NaN]) {
    assert.match(
      validarMovimientoGenerico({ ...base, quantity }, PERMITIDOS_INV, CON_MOTIVO_INV, 'ADJUSTMENT') ?? '',
      /cantidad entera positiva/
    )
  }
  assert.match(
    validarMovimientoGenerico(
      { type: 'PURCHASE', sourceBucket: null, destinationBucket: null, quantity: 1 },
      PERMITIDOS_INV,
      CON_MOTIVO_INV,
      'ADJUSTMENT'
    ) ?? '',
    /al menos una cubeta/
  )
})

test('ledger genérico · los tipos con motivo obligatorio lo exigen, también el comodín', () => {
  const sinMotivo = validarMovimientoGenerico(
    { type: 'ADJUSTMENT', sourceBucket: 'ON_HAND', destinationBucket: 'DAMAGED', quantity: 1, reason: '  ' },
    PERMITIDOS_INV,
    CON_MOTIVO_INV,
    'ADJUSTMENT'
  )
  assert.equal(sinMotivo, 'Un asiento ADJUSTMENT exige un motivo por escrito.')
  const conMotivo = validarMovimientoGenerico(
    { type: 'ADJUSTMENT', sourceBucket: 'ON_HAND', destinationBucket: 'DAMAGED', quantity: 1, reason: 'conteo físico' },
    PERMITIDOS_INV,
    CON_MOTIVO_INV,
    'ADJUSTMENT'
  )
  assert.equal(conMotivo, null, 'el comodín acepta cualquier traslado si trae motivo')
})

test('ledger genérico · SIN comodín declarado, un tipo con tabla vacía no mueve nada', () => {
  const error = validarMovimientoGenerico(
    { type: 'ADJUSTMENT', sourceBucket: 'ON_HAND', destinationBucket: 'DAMAGED', quantity: 1, reason: 'x' },
    PERMITIDOS_INV,
    CON_MOTIVO_INV
  )
  assert.match(error ?? '', /no puede ir de ON_HAND a DAMAGED/)
})

test('ledger genérico · el saldo de los asientos reconstruye las cubetas y cumple el invariante', () => {
  const asientos = [
    { sourceBucket: null, destinationBucket: 'ON_HAND' as const, quantity: 10 },
    { sourceBucket: 'ON_HAND' as const, destinationBucket: 'RESERVED' as const, quantity: 4 },
    { sourceBucket: 'ON_HAND' as const, destinationBucket: 'DAMAGED' as const, quantity: 1 },
  ]
  const saldo = saldoDeAsientosGenerico(CUBETAS_INV, asientos)
  assert.deepEqual(saldo, { ON_HAND: 5, RESERVED: 4, DAMAGED: 1 })
  assert.equal(invarianteCumplidoGenerico(CUBETAS_INV, 10, saldo), true)
  assert.equal(invarianteCumplidoGenerico(CUBETAS_INV, 11, saldo), false, 'la suma no cuadra con lo recibido')
  assert.equal(
    invarianteCumplidoGenerico(CUBETAS_INV, 5, { ON_HAND: -1, RESERVED: 6, DAMAGED: 0 }),
    false,
    'una cubeta negativa rompe el invariante aunque la suma cuadre'
  )
})

// ── Máquina de estados genérica con estados de PEDIDO ───────────────────────

type EstadoPedido = 'CREATED' | 'READY' | 'COMPLETED' | 'CANCELLED'
const TRANSICIONES_PEDIDO: Transiciones<EstadoPedido> = {
  CREATED: ['READY', 'CANCELLED'],
  READY: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
}

test('estados genérico · solo ocurre lo declarado en la tabla', () => {
  assert.equal(puedeTransicionar(TRANSICIONES_PEDIDO, 'CREATED', 'READY'), true)
  assert.equal(puedeTransicionar(TRANSICIONES_PEDIDO, 'CREATED', 'COMPLETED'), false)
  assert.equal(puedeTransicionar(TRANSICIONES_PEDIDO, 'COMPLETED', 'CANCELLED'), false, 'un terminal no sale')
})

test('estados genérico · exigirTransicion lanza con la entidad y los dos estados', () => {
  assert.doesNotThrow(() => exigirTransicion(TRANSICIONES_PEDIDO, 'READY', 'COMPLETED', 'Pedido'))
  assert.throws(
    () => exigirTransicion(TRANSICIONES_PEDIDO, 'CANCELLED', 'READY', 'Pedido'),
    /Pedido: no se puede pasar de CANCELLED a READY\./
  )
})

// ── Numeración con prefijos que NO son de Supply ────────────────────────────

test('numeración · formato y secuencia con un prefijo de pedido de comercio', () => {
  assert.equal(formatearNumero('MBG-ORD', 2026, 7), 'MBG-ORD-2026-000007')
  assert.equal(secuenciaDeNumero('MBG-ORD-2026-000007'), 7)
  assert.equal(secuenciaDeNumero('MBG-ORD-2026-1234567'), 1234567, 'pasa de seis dígitos sin truncar')
  assert.equal(secuenciaDeNumero('sin-numero'), 0)
})

/** Un `tx` falso que solo recuerda con qué clave se pidió el cerrojo. */
function txFalso() {
  const claves: string[] = []
  const tx = {
    $executeRaw: async (_strings: TemplateStringsArray, ...valores: unknown[]) => {
      claves.push(String(valores[0]))
      return 1
    },
  }
  return { tx: tx as never, claves }
}

test('numeración · el siguiente es el último + 1 y pide el cerrojo con namespace "commerce" por defecto', async () => {
  const { tx, claves } = txFalso()
  let prefijoPedido = ''
  const numero = await siguienteNumero(
    tx,
    'MBG-ORD',
    async (prefijo) => {
      prefijoPedido = prefijo
      return 'MBG-ORD-2026-000041'
    },
    new Date('2026-03-01T00:00:00Z')
  )
  assert.equal(numero, 'MBG-ORD-2026-000042')
  assert.equal(prefijoPedido, 'MBG-ORD-2026-')
  assert.deepEqual(claves, ['commerce:MBG-ORD:2026'])
})

test('numeración · sin ninguno previo arranca en 1', async () => {
  const { tx } = txFalso()
  assert.equal(
    await siguienteNumero(tx, 'MBG-ORD', async () => null, new Date('2026-03-01T00:00:00Z')),
    'MBG-ORD-2026-000001'
  )
})

test('numeración · dos dominios con el mismo prefijo NO comparten cerrojo si usan otro namespace', async () => {
  const a = txFalso()
  const b = txFalso()
  const fecha = new Date('2026-03-01T00:00:00Z')
  await siguienteNumero(a.tx, 'MBG-XX', async () => null, fecha)
  await siguienteNumero(b.tx, 'MBG-XX', async () => null, fecha, 'billing')
  assert.notEqual(a.claves[0], b.claves[0])
})

test('numeración · Supply V2 conserva EXACTAMENTE su clave de cerrojo histórica (supply_v2:<prefijo>:<año>)', async () => {
  // Si esta clave cambia, durante un despliegue gradual la instancia vieja y la
  // nueva toman cerrojos distintos para el mismo prefijo y una choca con el
  // índice único. Regresión de la Fase 0.
  const { tx, claves } = txFalso()
  const numero = await siguienteNumeroSupply(
    tx,
    'MBG-PO',
    async () => 'MBG-PO-2026-000009',
    new Date('2026-03-01T00:00:00Z')
  )
  assert.equal(numero, 'MBG-PO-2026-000010')
  assert.deepEqual(claves, ['supply_v2:MBG-PO:2026'])
})

// ── Dinero, FEFO y comisión: Supply V2 re-exporta la MISMA implementación ───

test('Supply V2 reexporta las mismas funciones (una sola implementación, no una copia)', () => {
  assert.equal(supplyDinero.calcularTotales, dinero.calcularTotales)
  assert.equal(supplyDinero.mismoMonto, dinero.mismoMonto)
  assert.equal(supplyFefo.repartirFefo, fefo.repartirFefo)
  assert.equal(supplyComision.repartirComision, comision.repartirComision)
  assert.equal(supplyComision.SupplyV2PricingEngine, comision.SupplyV2PricingEngine)
})

test('comisión · el 8 % de una venta verificada reparte exacto y suma el GMV (caso de Merchant Billing)', () => {
  const r = comision.repartirComision('1000', 8)
  assert.equal(r.commissionAmount.toFixed(2), '80.00')
  assert.equal(r.netSupplierAmount.toFixed(2), '920.00')
  assert.equal(r.commissionAmount.plus(r.netSupplierAmount).toFixed(2), r.gmv.toFixed(2))
})

test('comisión · repartir en unidades suma exactamente el total (sin centavo perdido)', () => {
  const partes = comision.repartirEnUnidades(dinero.decimal('100.00'), 3)
  assert.equal(partes.length, 3)
  assert.equal(partes.reduce((t, p) => t.plus(p), dinero.decimal(0)).toFixed(2), '100.00')
})

test('comisión · porcentajes inválidos se rechazan', () => {
  for (const pct of [-1, 101, 'abc', '8.123', null, undefined]) {
    assert.notEqual(comision.validarPorcentajeComision(pct as never), null, `pct=${String(pct)}`)
  }
  assert.equal(comision.validarPorcentajeComision(8), null)
})

test('dinero · el mismo monto escrito distinto sigue siendo el mismo monto', () => {
  assert.equal(dinero.mismoMonto('600', '600.00'), true)
  assert.equal(dinero.mismoMonto('600', '600.01'), false)
  assert.equal(dinero.mismoMonto('abc', 1), false)
})

test('FEFO · reparte por vencimiento y lanza si no alcanza (inventario de comercio)', () => {
  const dia = 86_400_000
  const t0 = new Date('2026-06-01T00:00:00Z').getTime()
  const lotes = [
    { id: 'tarde', disponible: 5, expiresAt: new Date(t0 + 30 * dia), receivedAt: new Date(t0) },
    { id: 'pronto', disponible: 3, expiresAt: new Date(t0 + 5 * dia), receivedAt: new Date(t0) },
  ]
  assert.deepEqual(fefo.repartirFefo(lotes, 4), [
    { id: 'pronto', cantidad: 3 },
    { id: 'tarde', cantidad: 1 },
  ])
  assert.throws(() => fefo.repartirFefo(lotes, 9), /Solo hay/)
})
