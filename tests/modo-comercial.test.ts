import { test } from 'node:test'
import assert from 'node:assert/strict'
import { COPY_COMERCIAL, MARCA, esRegalo, modoComercial, presentacionComercial, vendeMembego } from '../src/modules/comercio/modo-comercial'
import { aResumenPublico, comercialDeFila } from '../src/modules/catalog/publico-nucleo'
import { aOfertaPublica } from '../src/modules/deals/publico-nucleo'
import { Prisma } from '@prisma/client'

/**
 * SUPPLIER & FULFILLMENT COMMERCE · Slice 4 · seller ≠ supplier ≠ fulfillment (§12–§19, §64).
 * Los seis casos del documento, resueltos por la regla pura y por las proyecciones públicas.
 * Ejecutar: npm test
 */

const sucursal = { id: 's1', nombre: 'Bávaro' }

test('A · Merchant normal: Tech Store vende lo suyo → «Vendido por Tech Store», sin etiqueta ni canje aparte', () => {
  const p = presentacionComercial({ origen: 'EMPRESA', empresa: { nombre: 'Tech Store', slug: 'tech-store' }, sucursales: [sucursal] })
  assert.equal(p.modo, 'MERCHANT_SALE')
  assert.deepEqual(p.vendedor, { tipo: 'EMPRESA', nombre: 'Tech Store', slug: 'tech-store' })
  assert.equal(p.canje.nombre, 'Tech Store')
  assert.equal(p.canje.slug, 'tech-store')
  assert.equal(p.etiqueta, null)
  assert.equal(p.lineaVendedor, 'Vendido por Tech Store')
  assert.equal(p.lineaCanje, null)
  assert.equal(p.lineaFinanciacion, null)
  assert.equal(p.financiadoPor, null)
  assert.equal(vendeMembego(p), false)
})

test('B · Membego compra a un Merchant: la unidad es de Membego aunque Litre Pizza sea Merchant → «Oferta · Ofrecido por Membego · Canje en Litre Pizza — Bávaro» con enlace', () => {
  const p = presentacionComercial({
    origen: 'SUPPLY',
    empresa: { nombre: 'Casa Membego', slug: 'casa' },
    supply: { priceMode: 'FIXED', sourceType: 'PREPURCHASED_SUPPLY', salePrice: '350.00', proveedor: { nombre: 'Litre Pizza', slug: 'litre-pizza', sucursales: [sucursal] } },
  })
  assert.equal(p.modo, 'MEMBEGO_RESALE')
  assert.equal(p.vendedor.tipo, 'MEMBEGO')
  assert.equal(p.vendedor.nombre, MARCA)
  assert.equal(p.etiqueta, `Oferta ${MARCA}`)
  assert.equal(p.lineaVendedor, `Ofrecido por ${MARCA}`)
  assert.equal(p.lineaCanje, 'Canje en Litre Pizza — Bávaro')
  assert.equal(p.canje.slug, 'litre-pizza', 'el Merchant tiene vitrina: el punto de canje enlaza')
  assert.equal(vendeMembego(p), true)
  // Nunca se enseña la empresa de la casa como vendedora.
  assert.notEqual(p.vendedor.nombre, 'Casa Membego')
})

test('C · Supplier Lite: Café Central NO es Merchant → «Ofrecido por Membego · Canje en Café Central» SIN enlace a vitrina', () => {
  const p = presentacionComercial({
    origen: 'SUPPLY',
    empresa: { nombre: 'Casa Membego', slug: 'casa' },
    supply: { priceMode: 'PERCENTAGE', sourceType: 'PREPURCHASED_SUPPLY', salePrice: '150.00', proveedor: { nombre: 'Café Central', slug: null, sucursales: [{ id: 'h', nombre: 'Higüey' }] } },
  })
  assert.equal(p.modo, 'MEMBEGO_RESALE')
  assert.equal(p.canje.slug, null)
  assert.equal(p.lineaCanje, 'Canje en Café Central — Higüey')
  assert.equal(p.vendedor.nombre, MARCA)
})

test('D · Regalo: RD$0 → «Regalo de Membego», sin lenguaje de venta', () => {
  const p = presentacionComercial({
    origen: 'SUPPLY',
    empresa: { nombre: 'Casa', slug: 'casa' },
    supply: { priceMode: 'FREE', sourceType: 'PREPURCHASED_SUPPLY', salePrice: '0.00', proveedor: { nombre: 'Litre Pizza', slug: 'litre-pizza' } },
  })
  assert.equal(p.modo, 'MEMBEGO_GIFT')
  assert.equal(esRegalo(p), true)
  assert.equal(p.etiqueta, `Regalo de ${MARCA}`)
  assert.equal(p.lineaVendedor, `Regalo de ${MARCA}`)
  assert.ok(!/vendido/i.test(p.lineaVendedor))
  assert.equal(p.lineaCanje, 'Canje en Litre Pizza')
  // Un precio 0 con priceMode FIXED también es regalo: manda lo que paga el cliente.
  assert.equal(modoComercial({ origen: 'SUPPLY', empresa: { nombre: 'c', slug: 'c' }, supply: { priceMode: 'FIXED', sourceType: 'PREPURCHASED_SUPPLY', salePrice: '0.00', proveedor: { nombre: 'x', slug: null } } }), 'MEMBEGO_GIFT')
})

test('E · Subsidio: el Merchant sigue vendiendo y Membego financia parte → «Vendido por Litre Pizza · Promoción financiada por Membego»', () => {
  const p = presentacionComercial({ origen: 'EMPRESA', empresa: { nombre: 'Litre Pizza', slug: 'litre-pizza' }, deal: { sponsor: 'MEMBEGO' }, sucursales: [sucursal] })
  assert.equal(p.modo, 'MERCHANT_SUBSIDIZED')
  assert.equal(p.vendedor.tipo, 'EMPRESA')
  assert.equal(p.lineaVendedor, 'Vendido por Litre Pizza')
  assert.equal(p.lineaFinanciacion, `Promoción financiada por ${MARCA}`)
  assert.equal(p.financiadoPor, 'MEMBEGO')
  assert.equal(presentacionComercial({ origen: 'EMPRESA', empresa: { nombre: 'L', slug: 'l' }, deal: { sponsor: 'SHARED' } }).financiadoPor, 'COMPARTIDO')
  assert.equal(modoComercial({ origen: 'EMPRESA', empresa: { nombre: 'L', slug: 'l' }, deal: { sponsor: 'MERCHANT' } }), 'MERCHANT_SALE')
})

test('F · Membego patrocina un descuento sobre su propia oferta → MEMBEGO_SPONSORED, sigue siendo oferta de Membego', () => {
  const p = presentacionComercial({
    origen: 'SUPPLY',
    empresa: { nombre: 'Casa', slug: 'casa' },
    supply: { priceMode: 'FIXED', sourceType: 'COMMISSION', salePrice: '300.00', subsidioMembego: true, proveedor: { nombre: 'Litre Pizza', slug: 'litre-pizza' } },
  })
  assert.equal(p.modo, 'MEMBEGO_SPONSORED')
  assert.equal(p.vendedor.tipo, 'MEMBEGO')
  assert.equal(p.etiqueta, `Oferta ${MARCA}`)
  assert.equal(p.lineaFinanciacion, COPY_COMERCIAL.financiacion.MEMBEGO_SPONSORED)
})

test('G · el proveedor convertido en Merchant: la oferta sigue siendo de Membego; solo gana enlace el punto de canje (§48–§49)', () => {
  const antes = presentacionComercial({ origen: 'SUPPLY', empresa: { nombre: 'Casa', slug: 'casa' }, supply: { priceMode: 'FIXED', sourceType: 'PREPURCHASED_SUPPLY', salePrice: '150.00', proveedor: { nombre: 'Café Central', slug: null } } })
  const despues = presentacionComercial({ origen: 'SUPPLY', empresa: { nombre: 'Casa', slug: 'casa' }, supply: { priceMode: 'FIXED', sourceType: 'PREPURCHASED_SUPPLY', salePrice: '150.00', proveedor: { nombre: 'Café Central', slug: 'cafe-central' } } })
  assert.equal(antes.vendedor.tipo, 'MEMBEGO')
  assert.equal(despues.vendedor.tipo, 'MEMBEGO')
  assert.equal(antes.modo, despues.modo)
  assert.equal(antes.canje.slug, null)
  assert.equal(despues.canje.slug, 'cafe-central')
})

// ── Las proyecciones públicas llevan el bloque resuelto ─────────────────────

const variante = { id: 'v1', name: 'Única', price: new Prisma.Decimal('350.00'), compareAtPrice: null, attributes: {}, status: 'ACTIVE' as const }

test('la proyección del catálogo resuelve el bloque desde la oferta en vivo: proveedor sin vitrina → sin slug; con vitrina → con slug', () => {
  const base = { id: 'i', slug: 'pizza', name: 'Pizza Pepperoni', description: null, type: 'VOUCHER' as const, currency: 'DOP', company: { slug: 'casa', name: 'Casa Membego' }, variants: [variante], images: [], source: 'SUPPLY' as const }
  const lite = aResumenPublico({ ...base, supplyOffer: { slug: 'of', status: 'ACTIVE', priceMode: 'FIXED', sourceType: 'PREPURCHASED_SUPPLY', salePrice: new Prisma.Decimal('350.00'), benefits: [], supplier: { commercialName: 'Café Central', company: { slug: 'cafe', name: 'Café Central', isPublished: false, isActive: true, esDemo: false, sucursales: [{ id: 'h', nombre: 'Higüey' }] } } } })!
  assert.equal(lite.comercial.modo, 'MEMBEGO_RESALE')
  assert.equal(lite.comercial.canje.slug, null, 'sin vitrina (isPublished=false) no hay enlace')
  assert.equal(lite.comercial.lineaCanje, 'Canje en Café Central — Higüey')
  assert.equal(lite.comercial.vendedor.nombre, MARCA)
  const merchant = aResumenPublico({ ...base, supplyOffer: { slug: 'of', status: 'ACTIVE', priceMode: 'FREE', sourceType: 'PREPURCHASED_SUPPLY', salePrice: new Prisma.Decimal('0.00'), benefits: [], supplier: { commercialName: 'Litre Pizza', company: { slug: 'litre', name: 'Litre Pizza', isPublished: true, isActive: true, esDemo: false, sucursales: [] } } } })!
  assert.equal(merchant.comercial.modo, 'MEMBEGO_GIFT')
  assert.equal(merchant.comercial.canje.slug, 'litre')
  const externo = comercialDeFila({ ...base, supplyOffer: { slug: 'of', status: 'ACTIVE', supplier: { commercialName: 'Proveedor Externo', company: null } } })
  assert.equal(externo.canje.nombre, 'Proveedor Externo')
  assert.equal(externo.canje.slug, null)
  const propio = aResumenPublico({ ...base, source: 'MERCHANT', company: { slug: 'tech', name: 'Tech Store' } })!
  assert.equal(propio.comercial.modo, 'MERCHANT_SALE')
  assert.equal(propio.comercial.lineaVendedor, 'Vendido por Tech Store')
})

test('la proyección de una oferta de empresa lleva quién la financia', () => {
  const fila = {
    id: 'd', sponsor: 'MEMBEGO' as const, title: '10% OFF', description: null, discountType: 'PERCENT' as const, discountValue: new Prisma.Decimal('10'), currency: 'DOP', endsAt: null, voucherDays: 7, newCustomersOnly: false,
    maxClaims: 100, claimsActive: 0, feePerRedemption: new Prisma.Decimal('100'), budgetTotal: new Prisma.Decimal('10000'), budgetReserved: new Prisma.Decimal('0'), budgetSpent: new Prisma.Decimal('0'),
    variant: { id: 'v', name: 'Única', isDefault: true, price: new Prisma.Decimal('700'), item: { name: 'Pizza Pepperoni', slug: 'pizza', type: 'PHYSICAL_PRODUCT' as const, capabilities: null, images: [], company: { slug: 'litre', name: 'Litre Pizza', sucursales: [sucursal] } } },
  }
  const o = aOfertaPublica(fila)!
  assert.equal(o.comercial.modo, 'MERCHANT_SUBSIDIZED')
  assert.equal(o.comercial.lineaVendedor, 'Vendido por Litre Pizza')
  assert.equal(o.comercial.lineaFinanciacion, `Promoción financiada por ${MARCA}`)
  assert.equal(aOfertaPublica({ ...fila, sponsor: 'MERCHANT' })!.comercial.modo, 'MERCHANT_SALE')
  assert.equal(aOfertaPublica({ ...fila, sponsor: undefined })!.comercial.modo, 'MERCHANT_SALE', 'sin dato = la empresa financia (verdad histórica)')
})
