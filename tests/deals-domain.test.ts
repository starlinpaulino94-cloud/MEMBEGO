import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Prisma } from '@prisma/client'
import {
  ESTADOS_DE_OFERTA,
  alertasDeOferta,
  claveDeAlertaDeOferta,
  textoDeAlertaDeOferta,
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
  rendimientoDeTotales,
  validarOferta,
  vencimientoDelReclamo,
  type EntradaDeOferta,
  type OfertaParaAlertas,
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
    assert.equal(r.datos.discountValue.toFixed(2), '20.00')
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

test('rendimientoDeTotales (agregado en la base) da lo mismo que contar reclamo por reclamo (auditoría F5–F9, M10)', () => {
  const filas = [
    { status: 'REDEEMED' as const, savings: '80', fee: '100' },
    { status: 'REDEEMED' as const, savings: '60', fee: '100' },
    { status: 'CLAIMED' as const, savings: '80', fee: '100' },
    { status: 'EXPIRED' as const, savings: '80', fee: '100' },
    { status: 'CANCELLED' as const, savings: '80', fee: '100' },
    { status: 'REFUNDED' as const, savings: '80', fee: '100' },
  ]
  const uno = rendimientoDeOferta(filas)
  const agrupado = rendimientoDeTotales([
    { status: 'REDEEMED', cantidad: 2, savings: '140', fee: '200' },
    { status: 'CLAIMED', cantidad: 1, savings: '80', fee: '100' },
    { status: 'EXPIRED', cantidad: 1, savings: '80', fee: '100' },
    { status: 'CANCELLED', cantidad: 1, savings: '80', fee: '100' },
    { status: 'REFUNDED', cantidad: 1, savings: '80', fee: '100' },
  ])
  assert.deepEqual({ ...agrupado, costoCobrado: agrupado.costoCobrado.toFixed(2), ahorroEntregado: agrupado.ahorroEntregado.toFixed(2) }, { ...uno, costoCobrado: uno.costoCobrado.toFixed(2), ahorroEntregado: uno.ahorroEntregado.toFixed(2) })
  assert.equal(agrupado.reclamos, 6)
  assert.equal(rendimientoDeTotales([]).conversion, 0)
})

test('etiquetas y vencimiento del reclamo', () => {
  assert.equal(etiquetaDeDescuento('PERCENT', 20), '20 % de descuento')
  assert.equal(etiquetaDeDescuento('AMOUNT_OFF', 100), 'RD$ 100.00 menos')
  assert.equal(etiquetaDeDescuento('FIXED_PRICE', 0), 'Gratis')
  assert.equal(etiquetaDeDescuento('FIXED_PRICE', 250, 'USD'), 'A USD 250.00')
  assert.equal(vencimientoDelReclamo(AHORA, 7).toISOString(), '2030-06-08T12:00:00.000Z')
  assert.ok(new Prisma.Decimal(1).equals(1))
})

// ── Avisos de presupuesto y vigencia (sprint de cierre) ──────────────────────

const para = (extra: Partial<OfertaParaAlertas> = {}): OfertaParaAlertas => ({
  status: 'ACTIVE',
  endsAt: null,
  feePerRedemption: 100,
  budgetTotal: 1000,
  budgetReserved: 0,
  budgetSpent: 0,
  ...extra,
})

test('alertas: debajo del 80 % no hay aviso; en el 80 % exacto, sí; el 100 % avisa también del 80 % y de que se agotó', () => {
  assert.deepEqual(alertasDeOferta(para({ budgetReserved: 700 }), AHORA), [])
  assert.deepEqual(alertasDeOferta(para({ budgetReserved: 799.99 }), AHORA), [])
  assert.deepEqual(alertasDeOferta(para({ budgetReserved: 500, budgetSpent: 300 }), AHORA), ['PRESUPUESTO_80'])
  // Lo comprometido es reservado + gastado, y 900 con cuota de 100 aún deja un canje (libre 100 ≥ 100): no está agotada.
  assert.deepEqual(alertasDeOferta(para({ budgetReserved: 200, budgetSpent: 700 }), AHORA), ['PRESUPUESTO_80'])
  assert.deepEqual(alertasDeOferta(para({ budgetReserved: 400, budgetSpent: 600 }), AHORA), ['PRESUPUESTO_80', 'PRESUPUESTO_100', 'AGOTADA'])
})

test('alertas: agotada es «no alcanza para otro canje», aunque quede un resto menor que la cuota', () => {
  assert.deepEqual(alertasDeOferta(para({ budgetSpent: 950 }), AHORA), ['PRESUPUESTO_80', 'AGOTADA'], '50 libres < cuota de 100: no se puede reclamar otra')
  assert.deepEqual(alertasDeOferta(para({ status: 'BUDGET_EXHAUSTED', budgetSpent: 950 }), AHORA), ['PRESUPUESTO_80', 'AGOTADA'])
})

test('alertas: «por vencer» solo en las últimas 72 horas y mientras no haya terminado', () => {
  const en = (horas: number) => new Date(AHORA.getTime() + horas * 3_600_000)
  assert.deepEqual(alertasDeOferta(para({ endsAt: en(73) }), AHORA), [])
  assert.deepEqual(alertasDeOferta(para({ endsAt: en(72) }), AHORA), ['POR_VENCER'])
  assert.deepEqual(alertasDeOferta(para({ endsAt: en(1) }), AHORA), ['POR_VENCER'])
  assert.deepEqual(alertasDeOferta(para({ endsAt: en(0) }), AHORA), [], 'ya terminó: no es «por vencer»')
  assert.deepEqual(alertasDeOferta(para({ endsAt: en(-5) }), AHORA), [])
})

test('alertas: borrador, terminada y archivada no avisan; pausada sí (sigue viva y sigue gastando cupones ya reclamados)', () => {
  for (const status of ['DRAFT', 'COMPLETED', 'ARCHIVED'] as const) {
    assert.deepEqual(alertasDeOferta(para({ status, budgetSpent: 1000, endsAt: new Date(AHORA.getTime() + 3_600_000) }), AHORA), [], status)
  }
  assert.deepEqual(alertasDeOferta(para({ status: 'PAUSED', budgetReserved: 800 }), AHORA), ['PRESUPUESTO_80'])
})

test('alertas: un presupuesto en cero no divide entre cero', () => {
  assert.doesNotThrow(() => alertasDeOferta(para({ budgetTotal: 0 }), AHORA))
})

test('alertas: la clave cambia con el presupuesto total y con la fecha de fin, y no con lo gastado', () => {
  const fin = new Date('2030-06-03T12:00:00Z')
  const base = claveDeAlertaDeOferta('d1', 'PRESUPUESTO_80', { budgetTotal: 1000, endsAt: fin })
  assert.equal(base, 'oferta-alerta:d1:PRESUPUESTO_80:1000.00')
  assert.notEqual(base, claveDeAlertaDeOferta('d1', 'PRESUPUESTO_80', { budgetTotal: 2000, endsAt: fin }), 'ampliar el presupuesto es otro hecho')
  assert.notEqual(claveDeAlertaDeOferta('d1', 'POR_VENCER', { budgetTotal: 1000, endsAt: fin }), claveDeAlertaDeOferta('d1', 'POR_VENCER', { budgetTotal: 1000, endsAt: new Date(fin.getTime() + 86_400_000) }), 'alargar la vigencia también')
  assert.equal(claveDeAlertaDeOferta('d1', 'POR_VENCER', { budgetTotal: 1000, endsAt: fin }), claveDeAlertaDeOferta('d1', 'POR_VENCER', { budgetTotal: 5000, endsAt: fin }), 'por vencer no depende del presupuesto')
})

test('alertas: los textos no llevan datos de clientes y dicen cuánto', () => {
  const t = textoDeAlertaDeOferta('PRESUPUESTO_80', 'Lavado 20 %', { budgetTotal: 1000, budgetReserved: 500, budgetSpent: 300, endsAt: null })
  assert.match(t.mensaje, /«Lavado 20 %»/)
  assert.match(t.mensaje, /RD\$ 800\.00 de RD\$ 1000\.00/)
  assert.equal(textoDeAlertaDeOferta('POR_VENCER', 'X', { budgetTotal: 1, budgetReserved: 0, budgetSpent: 0, endsAt: new Date('2030-06-03T12:00:00Z') }).mensaje.includes('2030-06-03'), true)
  assert.match(textoDeAlertaDeOferta('AGOTADA', 'X', { budgetTotal: 1, budgetReserved: 0, budgetSpent: 0, endsAt: null, currency: 'USD' }).titulo, /agotó/)
})

test('el barrido avisa DESPUÉS de terminar lo suyo y por la clave, nunca con un INSERT propio (la unicidad de la base es la que evita el doble aviso)', () => {
  const src = readFileSync('src/modules/deals/barrido.ts', 'utf8')
  assert.match(src, /notificarAdmins\(/)
  assert.match(src, /dedupeKey: clave/)
  assert.doesNotMatch(src, /notificacion\.(create|createMany|upsert)\(/, 'solo cuenta; escribe el helper de notificaciones')
})
