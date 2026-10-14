import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../../src/lib/prisma'
import { sinEmpresa } from '../../src/lib/tenant'
import { designarCasaEnTx, sincronizarOfertaEnTx } from '../../src/modules/supply-bridge/service'
import { catalogoPublicoGlobal, itemCatalogoPublico } from '../../src/modules/catalog/publico'
import { ofertaPublicaPorSlug } from '../../src/modules/supply-v2/marketplace/read-model'
import { MARCA } from '../../src/modules/comercio/modo-comercial'
import { como, montarSupplierLite, type ArnesSupplierLite } from './supplier-lite-arnes'

/**
 * SUPPLIER & FULFILLMENT COMMERCE · Slice 4 contra PostgreSQL: lo que el
 * Marketplace dice de QUIÉN vende y DÓNDE se canjea (§12–§19, §64 C/E/F, §70).
 *
 *   Café Central es Supplier Lite (empresa sin vitrina). Membego publica su
 *   oferta y el puente la refleja en el catálogo: la ficha y la tarjeta dicen
 *   «Oferta Membego · Ofrecido por Membego · Canje en Café Central — Principal»
 *   y el punto de canje NO enlaza a ninguna vitrina.
 *   Cuando Café Central se convierte en Merchant (vitrina publicada), la oferta
 *   sigue siendo de Membego: lo único que cambia es que el punto de canje
 *   enlaza a /empresas/[slug].
 *
 * `npm run test:db`.
 */

let a: ArnesSupplierLite
let casaId = ''
let casaSlug = ''
let itemSlug = ''
let casaCreadaAqui = false

before(async () => {
  a = await montarSupplierLite({ prefijo: 'disp', unidadesCompradas: 50, unidadesCliente: 1 })
  // La empresa de la casa: dueña de los ítems puente. Una sola en toda la base: si otra
  // prueba ya la designó (y dejó ítems puente colgando de ella), se reutiliza; si no, se crea.
  // Sin casa designada pero con ítems puente de una corrida anterior, solo esa empresa puede volver a ser la casa.
  const existente =
    (await prisma.company.findFirst({ where: { esCasaMembego: true }, select: { id: true, slug: true } })) ??
    (await prisma.catalogItem.findFirst({ where: { source: 'SUPPLY' }, select: { company: { select: { id: true, slug: true } } } }))?.company ??
    null
  if (existente) {
    await sinEmpresa('prueba', (tx) => designarCasaEnTx(tx, existente.id, como(a.admin)))
    casaId = existente.id
    casaSlug = existente.slug
    await prisma.company.update({ where: { id: existente.id }, data: { isPublished: true, isActive: true, esDemo: false } })
  } else {
    const casa = await prisma.company.create({ data: { name: `Casa Membego ${a.sufijo}`, slug: `casa-${a.sufijo}`, type: 'otro', isPublished: true }, select: { id: true, slug: true } })
    casaId = casa.id
    casaSlug = casa.slug
    casaCreadaAqui = true
    await sinEmpresa('prueba', (tx) => designarCasaEnTx(tx, casa.id, como(a.admin)))
  }
  const r = await sinEmpresa('prueba', (tx) => sincronizarOfertaEnTx(tx, a.offerId))
  assert.equal(r.resultado, 'CREADO', JSON.stringify(r))
  const puente = await prisma.catalogItem.findUniqueOrThrow({ where: { supplyV2OfferId: a.offerId }, select: { slug: true, companyId: true } })
  assert.equal(puente.companyId, casaId)
  itemSlug = puente.slug
})

// Lo que esta prueba deja colgando de la casa estorba a `supply-bridge.db.test.ts` (que designa SU
// propia casa y exige que ningún ítem puente cuelgue de otra empresa): se recoge todo lo que
// nace de proveedores Supplier Lite (empresas `proveedor`, las del arnés) y la casa creada aquí.
after(async () => {
  await prisma.catalogItem.deleteMany({ where: { source: 'SUPPLY', supplyOffer: { supplier: { company: { type: 'proveedor' } } } } })
  if (casaCreadaAqui) await prisma.company.updateMany({ where: { id: casaId }, data: { esCasaMembego: false } })
})

test('C · Supplier Lite: la oferta de Membego se enseña como de Membego, con canje en Café Central y SIN enlace a vitrina', async () => {
  const oferta = await ofertaPublicaPorSlug((await prisma.supplyV2Offer.findUniqueOrThrow({ where: { id: a.offerId }, select: { slug: true } })).slug)
  assert.ok(oferta)
  assert.equal(oferta.comercial.modo, 'MEMBEGO_RESALE')
  assert.equal(oferta.comercial.vendedor.nombre, MARCA)
  assert.equal(oferta.comercial.etiqueta, `Oferta ${MARCA}`)
  assert.equal(oferta.comercial.lineaVendedor, `Ofrecido por ${MARCA}`)
  assert.equal(oferta.comercial.canje.nombre, `Café Central ${a.sufijo}`)
  assert.equal(oferta.comercial.canje.slug, null, 'Supplier Lite: sin vitrina, sin enlace')
  assert.deepEqual(oferta.comercial.canje.sucursales.map((s) => s.nombre), ['Principal'])
  assert.equal(oferta.comercial.lineaCanje, `Canje en Café Central ${a.sufijo} — Principal`)
  assert.ok(!JSON.stringify(oferta).includes('unitCost'), 'nunca costos')

  // El mismo bloque llega por el catálogo unificado (tarjeta y ficha), sin nombrar a la casa como vendedora.
  const { items } = await catalogoPublicoGlobal({ q: a.sufijo, origen: 'SUPPLY' })
  const item = items.find((i) => i.slug === itemSlug)
  assert.ok(item, 'el ítem puente sale en el descubrimiento')
  assert.equal(item.origen, 'SUPPLY')
  assert.equal(item.comercial.modo, 'MEMBEGO_RESALE')
  assert.equal(item.comercial.vendedor.tipo, 'MEMBEGO')
  assert.equal(item.comercial.canje.nombre, `Café Central ${a.sufijo}`)
  assert.equal(item.comercial.canje.slug, null)
  const ficha = await itemCatalogoPublico(casaSlug, itemSlug)
  assert.ok(ficha)
  assert.equal(ficha.comercial.lineaCanje, `Canje en Café Central ${a.sufijo} — Principal`)
})

test('F · el proveedor convertido en Merchant: la oferta sigue siendo de Membego; el punto de canje gana enlace a su vitrina', async () => {
  await prisma.company.update({ where: { id: a.companyId }, data: { isPublished: true, capacidades: { overrides: { MEMBEGO_SUPPLIER: true, CATALOGO_UNIFICADO: true, PEDIDOS_MEMBEGO: true } } } })
  const slugProveedor = (await prisma.company.findUniqueOrThrow({ where: { id: a.companyId }, select: { slug: true } })).slug

  const oferta = await ofertaPublicaPorSlug((await prisma.supplyV2Offer.findUniqueOrThrow({ where: { id: a.offerId }, select: { slug: true } })).slug)
  assert.equal(oferta!.comercial.modo, 'MEMBEGO_RESALE', 'la propiedad comercial histórica no cambia (§48)')
  assert.equal(oferta!.comercial.vendedor.tipo, 'MEMBEGO')
  assert.equal(oferta!.comercial.canje.slug, slugProveedor, 'ahora el punto de canje enlaza a /empresas/[slug] (§49)')

  const { items } = await catalogoPublicoGlobal({ q: a.sufijo, origen: 'SUPPLY' })
  const item = items.find((i) => i.slug === itemSlug)!
  assert.equal(item.comercial.canje.slug, slugProveedor)
  assert.equal(item.comercial.vendedor.nombre, MARCA)
  assert.equal(item.company.slug, casaSlug, 'el dueño del ítem puente sigue siendo la casa; no se enseña como vendedor')
})

test('D · regalo: una oferta GRATIS de Membego es «Regalo de Membego», no una venta', async () => {
  const { crearOfertaEnTx, publicarOfertaEnTx } = await import('../../src/modules/supply-v2/offers/service')
  const slug = await sinEmpresa('prueba', async (tx) => {
    const o = await crearOfertaEnTx(tx, { catalogItemId: a.itemId, title: `Regalo cappuccino · ${a.sufijo}`, publicPrice: 250, salePrice: 0, priceMode: 'FREE', quantity: 5, perCustomerLimit: 1, startsAt: new Date(Date.now() - 60_000), endsAt: new Date(Date.now() + 7 * 86_400_000) }, como(a.admin))
    await publicarOfertaEnTx(tx, o.id, como(a.admin))
    return (await tx.supplyV2Offer.findUniqueOrThrow({ where: { id: o.id }, select: { slug: true } })).slug
  })
  const oferta = await ofertaPublicaPorSlug(slug)
  assert.ok(oferta)
  assert.equal(oferta.comercial.modo, 'MEMBEGO_GIFT')
  assert.equal(oferta.comercial.etiqueta, `Regalo de ${MARCA}`)
  assert.ok(!/vendido/i.test(oferta.comercial.lineaVendedor))
  assert.equal(oferta.salePrice, '0.00')
})
