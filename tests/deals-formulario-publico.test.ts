import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Prisma } from '@prisma/client'
import { diaADate, leerCambiosDeOferta, leerOfertaNueva } from '../src/modules/deals/formulario'
import { aOfertaPublica, UMBRAL_QUEDAN, type FilaDeOfertaPublica } from '../src/modules/deals/publico-nucleo'

const D = (v: string | number) => new Prisma.Decimal(v)

const BASE = { title: 'Lavado básico', catalogVariantId: 'v1', discountType: 'PERCENT', discountValue: '20', maxClaims: '50', budgetTotal: '5000' }

test('formulario: una oferta nueva mínima se lee; sin fecha de inicio empieza ya y sin fin no termina', () => {
  const ahora = new Date('2026-10-07T12:00:00Z')
  const r = leerOfertaNueva(BASE, ahora)
  assert.ok(r.ok)
  if (!r.ok) return
  assert.equal(r.valor.discountValue, '20')
  assert.equal(r.valor.maxClaims, 50)
  assert.equal(r.valor.startsAt.getTime(), ahora.getTime())
  assert.equal(r.valor.endsAt, null)
  assert.equal(r.valor.voucherDays, undefined)
  assert.equal(r.valor.newCustomersOnly, false)
})

test('formulario: la Promotion opcional se lee como referencia y rechaza tipos manipulados', () => {
  const ligado = leerOfertaNueva({ ...BASE, promotionId: 'promo-123' })
  assert.ok(ligado.ok)
  if (ligado.ok) assert.equal(ligado.valor.promotionId, 'promo-123')

  const libre = leerOfertaNueva(BASE)
  assert.ok(libre.ok)
  if (libre.ok) assert.equal(libre.valor.promotionId, null)
  assert.equal(leerOfertaNueva({ ...BASE, promotionId: { id: 'otra-empresa' } }).ok, false)
})

test('formulario: los días son dominicanos (UTC−4): el inicio es la medianoche y el fin es el último instante de ese día', () => {
  assert.equal(diaADate('2026-10-08', false)?.toISOString(), '2026-10-08T04:00:00.000Z')
  assert.equal(diaADate('2026-10-08', true)?.toISOString(), '2026-10-09T03:59:59.999Z')
})

test('formulario: fechas imposibles y formatos raros se rechazan', () => {
  for (const malo of ['2026-02-31', '2026-13-01', '07/10/2026', '2026-1-1', '', 'mañana']) assert.equal(diaADate(malo, false), null, malo)
  const r = leerOfertaNueva({ ...BASE, endsAt: '2026-02-30' })
  assert.deepEqual(r, { ok: false, error: 'La fecha de fin no es válida.' })
})

test('formulario: números con comas, notación científica, negativos o con más de dos decimales no pasan', () => {
  for (const v of ['1,000', '1e3', '-5', '10.999', ' ', 'abc', '0x10']) {
    assert.equal(leerOfertaNueva({ ...BASE, budgetTotal: v }).ok, false, `presupuesto ${v}`)
    assert.equal(leerOfertaNueva({ ...BASE, discountValue: v }).ok, false, `descuento ${v}`)
  }
  for (const v of ['1.5', '0', '12']) assert.equal(leerOfertaNueva({ ...BASE, maxClaims: v }).ok, v !== '1.5')
  assert.equal(leerOfertaNueva({ ...BASE, maxClaims: 25 }).ok, true, 'un número también sirve')
})

test('formulario: tipo de descuento desconocido y datos que no son un objeto se rechazan', () => {
  assert.equal(leerOfertaNueva({ ...BASE, discountType: 'BOGO' }).ok, false)
  assert.equal(leerOfertaNueva(null as never).ok, false)
  assert.equal(leerCambiosDeOferta(undefined as never).ok, false)
})

test('formulario: «nuevos clientes» solo se enciende con true, "on" o "true"', () => {
  for (const [v, esperado] of [[true, true], ['on', true], ['true', true], [false, false], ['', false], ['no', false], [1, false]] as const) {
    const r = leerOfertaNueva({ ...BASE, newCustomersOnly: v })
    assert.ok(r.ok)
    if (r.ok) assert.equal(r.valor.newCustomersOnly, esperado, String(v))
  }
})

test('formulario: al editar solo viajan los campos presentes; un fin vacío quita la fecha y uno mal escrito es un error', () => {
  const r = leerCambiosDeOferta({ title: '  Nuevo  ', endsAt: '' })
  assert.ok(r.ok)
  if (r.ok) assert.deepEqual(r.valor, { title: 'Nuevo', endsAt: null })
  assert.equal(leerCambiosDeOferta({ maxClaims: 'muchos' }).ok, false)
  assert.equal(leerCambiosDeOferta({ endsAt: '2026-99-99' }).ok, false)
  const vacio = leerCambiosDeOferta({})
  assert.ok(vacio.ok)
  if (vacio.ok) assert.deepEqual(vacio.valor, {})
})

// ── Modelo público ──────────────────────────────────────────────────────────

function fila(over: Partial<FilaDeOfertaPublica> = {}): FilaDeOfertaPublica {
  return {
    id: 'd1',
    title: '20 % en el lavado',
    description: null,
    discountType: 'PERCENT',
    discountValue: D(20),
    currency: 'DOP',
    endsAt: new Date('2026-12-31T03:59:59Z'),
    voucherDays: 7,
    newCustomersOnly: false,
    maxClaims: 100,
    claimsActive: 0,
    feePerRedemption: D(100),
    budgetTotal: D(5000),
    budgetReserved: D(0),
    budgetSpent: D(0),
    variant: { id: 'v1', name: 'Estándar', price: D(500), item: { name: 'Lavado', slug: 'lavado', type: 'SERVICE', images: [], company: { slug: 'car-town', name: 'Car Town', sucursales: [{ id: 's1', nombre: 'Principal' }] } } },
    ...over,
  }
}

test('público: precios, ahorro y etiqueta salen del precio de la variante', () => {
  const o = aOfertaPublica(fila())
  assert.ok(o)
  assert.equal(o.precioAntes, '500.00')
  assert.equal(o.precioAhora, '400.00')
  assert.equal(o.ahorro, '100.00')
  assert.equal(o.etiqueta, '20 % de descuento')
  assert.equal(o.endsAt, '2026-12-31T03:59:59.000Z')
})

test('público: LISTA BLANCA — ni el presupuesto, ni la cuota, ni lo reservado o gastado, ni la empresa interna salen', () => {
  const o = aOfertaPublica(fila({ budgetReserved: D(300), budgetSpent: D(700) }))
  assert.ok(o)
  const json = JSON.stringify(o)
  for (const prohibido of ['budget', 'fee', 'Reserved', 'Spent', 'claimsActive', 'maxClaims', 'companyId', 'createdBy', '5000']) {
    assert.ok(!json.includes(prohibido), `la proyección pública enseña «${prohibido}»`)
  }
  assert.deepEqual(Object.keys(o).sort(), [
    'ahorro', 'currency', 'description', 'empresa', 'endsAt', 'etiqueta', 'id', 'imageUrl', 'itemName', 'itemSlug', 'precioAhora', 'precioAntes', 'quedan', 'soloClientesNuevos', 'sucursales', 'title', 'variantName', 'voucherDays',
  ])
})

test('público: una oferta que no baja el precio, sin sucursal donde canjearla o a la que no le queda nada no se enseña', () => {
  assert.equal(aOfertaPublica(fila({ discountType: 'FIXED_PRICE', discountValue: D(900) })), null, 'precio fijo mayor al de lista')
  assert.equal(aOfertaPublica(fila({ claimsActive: 100 })), null, 'sin cupos')
  const sinSucursal = fila()
  sinSucursal.variant.item.company.sucursales = []
  assert.equal(aOfertaPublica(sinSucursal), null, 'sin sucursal activa')
  assert.equal(aOfertaPublica(fila({ budgetSpent: D(4950) })), null, 'el presupuesto no alcanza para otro canje')
})

test('público: «quedan» solo aparece cuando son pocos, y es el menor entre cupos y lo que el presupuesto paga', () => {
  assert.equal(aOfertaPublica(fila())?.quedan, null)
  assert.equal(aOfertaPublica(fila({ claimsActive: 100 - UMBRAL_QUEDAN }))?.quedan, UMBRAL_QUEDAN)
  assert.equal(aOfertaPublica(fila({ budgetReserved: D(4700) }))?.quedan, 3, 'el presupuesto alcanza para 3 canjes')
})

test('el presupuesto y el descuento caben en la columna (DECIMAL(12,2): hasta 10 enteros) y lo que no cabe se rechaza con un mensaje, no con un error de la base (auditoría F5–F9)', () => {
  assert.equal(leerOfertaNueva({ ...BASE, budgetTotal: '9999999999.99' }).ok, true)
  assert.equal(leerOfertaNueva({ ...BASE, budgetTotal: '10000000000' }).ok, false)
  assert.equal(leerOfertaNueva({ ...BASE, budgetTotal: '99999999999999' }).ok, false)
})
