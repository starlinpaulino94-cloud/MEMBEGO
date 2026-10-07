import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Prisma } from '@prisma/client'
import {
  ESTADOS_DE_OFERTA,
  TRANSICIONES_DE_OFERTA,
  TRANSICIONES_DE_RECLAMO,
  estadoPorPresupuesto,
  etiquetaDeDescuento,
  motivoNoReclamable,
  precioDeLaOferta,
  presupuestoLibre,
  puedePasarOferta,
  reclamosPosibles,
  rendimientoDeOferta,
  validarOferta,
  vencimientoDelReclamo,
  type EntradaDeOferta,
  type OfertaParaReclamar,
} from '../src/modules/deals/domain'

const AHORA = new Date('2030-06-01T12:00:00Z')
const base = (extra: Partial<EntradaDeOferta> = {}): EntradaDeOferta => ({
  title: '20 % en el lavado',
  catalogVariantId: 'v1',
  discountType: 'PERCENT',
  discountValue: 20,
  startsAt: AHORA,
  maxClaims: 50,
  budgetTotal: 5000,
  ...extra,
})

test('validarOferta: acepta una oferta normal y normaliza el texto', () => {
  const r = validarOferta(base({ title: '  20 %   en   el lavado ' }), 100)
  assert.ok(r.ok)
  if (r.ok) {
    assert.equal(r.datos.title, '20 % en el lavado')
    assert.equal(r.datos.voucherDays, 7)
    assert.equal(r.datos.newCustomersOnly, false)
    assert.equal(r.datos.budgetTotal.toFixed(2), '5000.00')
  }
})

test('validarOferta: rechaza lo imposible, con un mensaje que se puede enseñar', () => {
  const malas: [string, Partial<EntradaDeOferta>, number | string][] = [
    ['título corto', { title: 'ab' }, 100],
    ['porcentaje 0', { discountValue: 0 }, 100],
    ['porcentaje 101', { discountValue: 101 }, 100],
    ['rebaja negativa', { discountType: 'AMOUNT_OFF', discountValue: -5 }, 100],
    ['precio fijo negativo', { discountType: 'FIXED_PRICE', discountValue: -1 }, 100],
    ['tres decimales', { discountValue: 10.123 }, 100],
    ['fin antes del inicio', { endsAt: new Date(AHORA.getTime() - 1000) }, 100],
    ['más de un año', { endsAt: new Date(AHORA.getTime() + 400 * 86_400_000) }, 100],
    ['vigencia del cupón 0', { voucherDays: 0 }, 100],
    ['vigencia del cupón 61', { voucherDays: 61 }, 100],
    ['sin clientes', { maxClaims: 0 }, 100],
    ['clientes fraccionarios', { maxClaims: 2.5 }, 100],
    ['presupuesto menor que una cuota', { budgetTotal: 99 }, 100],
    ['presupuesto no numérico', { budgetTotal: 'abc' }, 100],
    ['sin producto', { catalogVariantId: '' }, 100],
    ['sin tarifa en la cuenta', {}, 0],
  ]
  for (const [nombre, extra, cuota] of malas) {
    const r = validarOferta(base(extra), cuota)
    assert.equal(r.ok, false, nombre)
    if (!r.ok) assert.ok(r.error.length > 10, nombre)
  }
  assert.ok(validarOferta(base({ discountType: 'FIXED_PRICE', discountValue: 0 }), 100).ok, 'gratis es válido')
})

test('precioDeLaOferta: porcentaje, rebaja y precio fijo; nunca negativo ni mayor que el de lista', () => {
  const p = (lista: number, tipo: 'PERCENT' | 'AMOUNT_OFF' | 'FIXED_PRICE', v: number) => {
    const r = precioDeLaOferta(lista, tipo, v)
    return [r.precio.toFixed(2), r.ahorro.toFixed(2)]
  }
  assert.deepEqual(p(400, 'PERCENT', 20), ['320.00', '80.00'])
  assert.deepEqual(p(400, 'PERCENT', 100), ['0.00', '400.00'])
  assert.deepEqual(p(333.33, 'PERCENT', 15), ['283.33', '50.00'], 'redondea al centavo')
  assert.deepEqual(p(400, 'AMOUNT_OFF', 100), ['300.00', '100.00'])
  assert.deepEqual(p(400, 'AMOUNT_OFF', 900), ['0.00', '400.00'], 'una rebaja mayor que el precio deja cero')
  assert.deepEqual(p(400, 'FIXED_PRICE', 250), ['250.00', '150.00'])
  assert.deepEqual(p(400, 'FIXED_PRICE', 0), ['0.00', '400.00'])
  assert.deepEqual(p(400, 'FIXED_PRICE', 999), ['400.00', '0.00'], 'un precio fijo mayor no es una oferta')
})

test('presupuesto: libre, reclamos posibles y estado que le toca', () => {
  const n = { maxClaims: 10, claimsActive: 2, feePerRedemption: 100, budgetTotal: 500, budgetReserved: 100, budgetSpent: 100 }
  assert.equal(presupuestoLibre(n).toFixed(2), '300.00')
  assert.equal(reclamosPosibles(n), 3, 'lo que paga el presupuesto (3) gana a los cupos (8)')
  assert.equal(reclamosPosibles({ ...n, maxClaims: 3 }), 1, 'los cupos (1) ganan al presupuesto')
  assert.equal(reclamosPosibles({ ...n, budgetSpent: 400 }), 0)
  assert.equal(reclamosPosibles({ ...n, feePerRedemption: 0 }), 0, 'sin cuota no hay cuenta que hacer')
  assert.equal(estadoPorPresupuesto({ ...n, status: 'ACTIVE' }), 'ACTIVE')
  assert.equal(estadoPorPresupuesto({ ...n, status: 'ACTIVE', budgetSpent: 350 }), 'BUDGET_EXHAUSTED')
  assert.equal(estadoPorPresupuesto({ ...n, status: 'BUDGET_EXHAUSTED' }), 'ACTIVE', 'alcanza otra vez: vuelve')
  for (const s of ['DRAFT', 'PAUSED', 'COMPLETED', 'ARCHIVED'] as const) assert.equal(estadoPorPresupuesto({ ...n, status: s, budgetSpent: 400 }), s, `${s} no se mueve solo`)
})

test('motivoNoReclamable: dice por qué, en el mismo orden en que importa', () => {
  const o: OfertaParaReclamar = { status: 'ACTIVE', startsAt: new Date(AHORA.getTime() - 1000), endsAt: null, maxClaims: 5, claimsActive: 0, feePerRedemption: 100, budgetTotal: 500, budgetReserved: 0, budgetSpent: 0 }
  assert.equal(motivoNoReclamable(o, AHORA), null)
  assert.equal(motivoNoReclamable({ ...o, status: 'DRAFT' }, AHORA)?.codigo, 'OFERTA_NO_DISPONIBLE')
  assert.equal(motivoNoReclamable({ ...o, status: 'PAUSED' }, AHORA)?.codigo, 'OFERTA_PAUSADA')
  assert.equal(motivoNoReclamable({ ...o, status: 'BUDGET_EXHAUSTED' }, AHORA)?.codigo, 'OFERTA_AGOTADA')
  assert.equal(motivoNoReclamable({ ...o, status: 'COMPLETED' }, AHORA)?.codigo, 'OFERTA_TERMINADA')
  assert.equal(motivoNoReclamable({ ...o, startsAt: new Date(AHORA.getTime() + 1000) }, AHORA)?.codigo, 'OFERTA_NO_EMPEZO')
  assert.equal(motivoNoReclamable({ ...o, endsAt: AHORA }, AHORA)?.codigo, 'OFERTA_TERMINADA', 'el fin es exclusivo')
  assert.equal(motivoNoReclamable({ ...o, claimsActive: 5 }, AHORA)?.codigo, 'OFERTA_AGOTADA')
  assert.equal(motivoNoReclamable({ ...o, budgetReserved: 450 }, AHORA)?.codigo, 'OFERTA_AGOTADA')
  assert.equal(motivoNoReclamable(o, AHORA, true)?.codigo, 'CUENTA_SUSPENDIDA')
})

test('las transiciones del dominio son las del disparador de la base (gemelas)', () => {
  const sql = readFileSync('prisma/migrations/20261047_deals/migration.sql', 'utf8')
  const bloque = sql.slice(sql.indexOf('permitida := CASE OLD."status"'), sql.indexOf('END;', sql.indexOf('permitida := CASE OLD."status"')))
  const deSql: Record<string, string[]> = {}
  for (const m of bloque.matchAll(/WHEN '(\w+)'\s+THEN NEW\."status" IN \(([^)]*)\)/g)) {
    deSql[m[1]] = [...m[2].matchAll(/'(\w+)'/g)].map((x) => x[1]).sort()
  }
  deSql.ARCHIVED = []
  for (const s of ESTADOS_DE_OFERTA) assert.deepEqual([...TRANSICIONES_DE_OFERTA[s]].sort(), deSql[s], `transiciones desde ${s}`)
  // Cualquier par que el dominio no permita, tampoco.
  for (const a of ESTADOS_DE_OFERTA) for (const b of ESTADOS_DE_OFERTA) assert.equal(puedePasarOferta(a, b), (deSql[a] ?? []).includes(b), `${a} → ${b}`)
  // Y las del reclamo.
  assert.deepEqual([...TRANSICIONES_DE_RECLAMO.CLAIMED].sort(), ['CANCELLED', 'EXPIRED', 'REDEEMED'])
  assert.deepEqual([...TRANSICIONES_DE_RECLAMO.REDEEMED], ['REFUNDED'])
  for (const s of ['EXPIRED', 'CANCELLED', 'REFUNDED'] as const) assert.deepEqual([...TRANSICIONES_DE_RECLAMO[s]], [])
  assert.match(sql, /OLD\."status" = 'CLAIMED'\s+AND NEW\."status" IN \('REDEEMED', 'EXPIRED', 'CANCELLED'\)/)
  assert.match(sql, /OLD\."status" = 'REDEEMED' AND NEW\."status" = 'REFUNDED'/)
})

test('rendimientoDeOferta: reclamos, canjes, conversión y lo cobrado', () => {
  const r = rendimientoDeOferta([
    { status: 'REDEEMED', savings: '80', fee: '100' },
    { status: 'REDEEMED', savings: '80', fee: '100' },
    { status: 'CLAIMED', savings: '80', fee: '100' },
    { status: 'EXPIRED', savings: '80', fee: '100' },
    { status: 'CANCELLED', savings: '80', fee: '100' },
    { status: 'REFUNDED', savings: '80', fee: '100' },
  ])
  assert.equal(r.reclamos, 6)
  assert.equal(r.canjeados, 2)
  assert.equal(r.porCanjear, 1)
  assert.equal(r.conversion, 33.3)
  assert.equal(r.costoCobrado.toFixed(2), '200.00')
  assert.equal(r.ahorroEntregado.toFixed(2), '160.00')
  assert.equal(rendimientoDeOferta([]).conversion, 0)
})

test('etiquetas y vencimiento del reclamo', () => {
  assert.equal(etiquetaDeDescuento('PERCENT', 20), '20 % de descuento')
  assert.equal(etiquetaDeDescuento('AMOUNT_OFF', 100), 'RD$ 100.00 menos')
  assert.equal(etiquetaDeDescuento('FIXED_PRICE', 0), 'Gratis')
  assert.equal(etiquetaDeDescuento('FIXED_PRICE', 250, 'USD'), 'A USD 250.00')
  assert.equal(vencimientoDelReclamo(AHORA, 7).toISOString(), '2030-06-08T12:00:00.000Z')
  assert.ok(new Prisma.Decimal(1).equals(1))
})
