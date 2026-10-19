import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  calcularComisionDeExtra,
  claveDeAjuste,
  claveDeCargo,
  claveDeReverso,
  correccionPorDisputa,
  dentroDeVentana,
  finDeVentana,
  resolverLineasDeExtra,
  resolverPoliticaDeExtras,
  seAsientaAlReportar,
  subeEvidencia,
  sumarVentas,
  totalCoincide,
} from '../src/modules/visitas-membego/domain'
import { REFERENCIAS_DEL_LIBRO, TIPOS_QUE_SUMAN, validarAsiento } from '../src/modules/billing/domain'

/**
 * SUPPLIER & FULFILLMENT COMMERCE · reglas puras de la visita atribuida (§24–§38, §55, §63, §72).
 * Ejecutar: npm test
 */

const catalogo = [
  { id: 'refresco', name: 'Refresco', publicPrice: '150.00', sellableAsExtra: true, status: 'ACTIVE' },
  { id: 'postre', name: 'Postre', publicPrice: '250.00', sellableAsExtra: true, status: 'ACTIVE' },
  { id: 'pizza', name: 'Pizza Pepperoni', publicPrice: '700.00', sellableAsExtra: false, status: 'ACTIVE' },
  { id: 'cafe', name: 'Café', publicPrice: '120.00', sellableAsExtra: true, status: 'INACTIVE' },
  { id: 'sinprecio', name: 'Sin precio', publicPrice: null, sellableAsExtra: true, status: 'ACTIVE' },
]

test('política: acuerdo > cuenta de la empresa > plataforma (8 %), ventana 120 min, sin confirmación', () => {
  const plataforma = resolverPoliticaDeExtras({})
  assert.deepEqual(plataforma, { ancillaryCommissionEnabled: true, ancillaryCommissionRate: '8.00', attributionWindowMinutes: 120, requiresCustomerConfirmation: false, receiptRequiredAbove: null })
  assert.equal(resolverPoliticaDeExtras({ cuenta: { percentageRate: '10' } }).ancillaryCommissionRate, '10.00')
  const contractual = resolverPoliticaDeExtras({ acuerdo: { ancillaryCommissionRate: '5.5', attributionWindowMinutes: 90, requiresCustomerConfirmation: true, receiptRequiredAbove: 1000 }, cuenta: { percentageRate: '10' } })
  assert.equal(contractual.ancillaryCommissionRate, '5.50', 'el acuerdo manda sobre la cuenta')
  assert.equal(contractual.attributionWindowMinutes, 90)
  assert.equal(contractual.requiresCustomerConfirmation, true)
  assert.equal(contractual.receiptRequiredAbove, '1000.00')
  assert.equal(resolverPoliticaDeExtras({ acuerdo: { ancillaryCommissionEnabled: false } }).ancillaryCommissionEnabled, false)
  assert.throws(() => resolverPoliticaDeExtras({ acuerdo: { ancillaryCommissionRate: 150 } }), /tasa/)
  assert.throws(() => resolverPoliticaDeExtras({ acuerdo: { attributionWindowMinutes: 0 } }), /ventana/)
})

test('ventana de atribución (§38): hasta openedAt + ventana; después, nada se atribuye', () => {
  const abierta = new Date('2026-10-14T19:00:00Z')
  const p = { attributionWindowMinutes: 50 }
  assert.equal(finDeVentana(abierta, p).toISOString(), '2026-10-14T19:50:00.000Z')
  assert.ok(dentroDeVentana(abierta, p, new Date('2026-10-14T19:49:00Z')))
  assert.ok(dentroDeVentana(abierta, p, new Date('2026-10-14T19:50:00Z')))
  assert.equal(dentroDeVentana(abierta, p, new Date('2026-10-14T19:51:00Z')), false)
})

test('líneas (§55): el precio del catálogo lo relee el servidor —lo que mandó el navegador se ignora—; la personalizada queda marcada', () => {
  const r = resolverLineasDeExtra(
    [
      { supplyCatalogItemId: 'refresco', quantity: 1, unitPrice: '1.00' },
      { supplyCatalogItemId: 'postre', quantity: 1, unitPrice: '9999' },
      { description: 'Servilletas bordadas', quantity: 2, unitPrice: '25.50' },
    ],
    catalogo
  )
  assert.ok(!('error' in r))
  assert.equal(r.subtotal.toFixed(2), '451.00', '150 + 250 + 2×25.50; nunca 1 ni 9999')
  assert.equal(r.lineas[0]!.unitPrice.toFixed(2), '150.00')
  assert.equal(r.lineas[0]!.priceSource, 'CATALOG')
  assert.equal(r.lineas[2]!.kind, 'CUSTOM_REPORTED_LINE')
  assert.equal(r.lineas[2]!.priceSource, 'OPERATOR')
  assert.equal(r.hasCustomLines, true)
})

test('líneas: lo que no se puede vender como extra no entra (la pizza de Membego, un extra inactivo, uno sin precio, otro proveedor)', () => {
  assert.match((resolverLineasDeExtra([{ supplyCatalogItemId: 'pizza', quantity: 1 }], catalogo) as { error: string }).error, /no está activo como extra/)
  assert.match((resolverLineasDeExtra([{ supplyCatalogItemId: 'cafe', quantity: 1 }], catalogo) as { error: string }).error, /no está activo/)
  assert.match((resolverLineasDeExtra([{ supplyCatalogItemId: 'sinprecio', quantity: 1 }], catalogo) as { error: string }).error, /sin precio|no tiene precio/i)
  assert.match((resolverLineasDeExtra([{ supplyCatalogItemId: 'ajeno', quantity: 1 }], catalogo) as { error: string }).error, /no es de tu catálogo/)
  assert.match((resolverLineasDeExtra([], catalogo) as { error: string }).error, /al menos una/)
  assert.match((resolverLineasDeExtra([{ supplyCatalogItemId: 'refresco', quantity: 0 }], catalogo) as { error: string }).error, /cantidad/)
  assert.match((resolverLineasDeExtra([{ description: 'x', quantity: 1 }], catalogo) as { error: string }).error, /precio/)
  assert.match((resolverLineasDeExtra([{ description: 'Cosa', quantity: 1, unitPrice: '-5' }], catalogo) as { error: string }).error, /no es válido/)
})

test('comisión (§28, §72): 8 % de RD$400 = RD$32; nunca sobre la pizza que Membego compró; base cero o política apagada = no aplica', () => {
  const politica = { ancillaryCommissionEnabled: true, ancillaryCommissionRate: '8.00' }
  const c = calcularComisionDeExtra('400.00', politica)
  assert.equal(c.base.toFixed(2), '400.00')
  assert.equal(c.amount.toFixed(2), '32.00')
  assert.equal(c.status, 'PENDING')
  // La «base» solo son los extras: si alguien intentara sumar la pizza (700) estaría mal por construcción; el dominio no la recibe.
  assert.equal(calcularComisionDeExtra('1100.00', politica).amount.toFixed(2), '88.00', 'solo pasaría si la base trajera la pizza; el servicio nunca la incluye')
  assert.equal(calcularComisionDeExtra('0', politica).status, 'NOT_APPLICABLE')
  assert.equal(calcularComisionDeExtra('400', { ...politica, ancillaryCommissionEnabled: false }).status, 'NOT_APPLICABLE')
  assert.equal(calcularComisionDeExtra('400', { ...politica, ancillaryCommissionRate: '0.00' }).status, 'NOT_APPLICABLE')
  assert.throws(() => calcularComisionDeExtra('-1', politica), /negativa/)
  assert.equal(seAsientaAlReportar({ requiresCustomerConfirmation: false }), true)
  assert.equal(seAsientaAlReportar({ requiresCustomerConfirmation: true }), false)
})

test('disputa (§34–§35): reconocer 150 de 400 → ajuste de −20 (8 % de 250); reconocer 0 → reverso total; igual → nada; sin comisión asentada → nada', () => {
  const venta = { commissionBase: '400.00', commissionRate: '8.00', commissionAmount: '32.00', commissionStatus: 'POSTED' as const }
  const parcial = correccionPorDisputa(venta, '150')
  assert.equal(parcial.tipo, 'AJUSTE')
  assert.equal(parcial.comisionReconocida.toFixed(2), '12.00')
  assert.equal(parcial.delta.toFixed(2), '-20.00')
  const total = correccionPorDisputa(venta, 0)
  assert.equal(total.tipo, 'REVERSO')
  assert.equal(total.delta.toFixed(2), '-32.00')
  assert.equal(correccionPorDisputa(venta, '400').tipo, 'NADA')
  assert.equal(correccionPorDisputa(venta, '900').tipo, 'NADA', 'reconocer más de lo reportado se acota a lo reportado')
  assert.equal(correccionPorDisputa({ ...venta, commissionStatus: 'PENDING' }, '150').tipo, 'NADA', 'sin asiento no hay qué corregir')
})

test('evidencia (§32–§33): el cliente sube de reportado a confirmado, nunca a pago verificado', () => {
  assert.ok(subeEvidencia('MERCHANT_REPORTED', 'CUSTOMER_CONFIRMED'))
  assert.equal(subeEvidencia('PAYMENT_VERIFIED', 'CUSTOMER_CONFIRMED'), false)
  assert.ok(subeEvidencia('CUSTOMER_CONFIRMED', 'PAYMENT_VERIFIED'))
})

test('totales y confirmación: las reversadas no suman; solo la comisión asentada cuenta; confirmar otro total no es confirmar', () => {
  const t = sumarVentas([
    { status: 'REPORTED', subtotal: '150', commissionAmount: '12', commissionStatus: 'POSTED' },
    { status: 'CONFIRMED', subtotal: '250', commissionAmount: '20', commissionStatus: 'PENDING' },
    { status: 'REVERSED', subtotal: '999', commissionAmount: '79.92', commissionStatus: 'REVERSED' },
  ])
  assert.equal(t.ancillaryTotal.toFixed(2), '400.00')
  assert.equal(t.commissionTotal.toFixed(2), '12.00')
  // Una venta ajustada por disputa cuenta con su ajuste (asiento aparte, negativo): 32 − 20 = 12.
  const ajustada = sumarVentas([{ status: 'ADJUSTED', subtotal: '400', commissionAmount: '32', commissionStatus: 'POSTED', commissionAdjustment: '-20' }])
  assert.equal(ajustada.commissionTotal.toFixed(2), '12.00')
  assert.equal(ajustada.ancillaryTotal.toFixed(2), '400.00')
  assert.ok(totalCoincide('400.00', 400))
  assert.equal(totalCoincide('400.00', '399.99'), false)
  assert.equal(totalCoincide('400', 'x'), false)
})

test('el libro de Merchant Billing admite la comisión de extras como suma, con su referencia y sus claves', () => {
  assert.ok((TIPOS_QUE_SUMAN as readonly string[]).includes('ANCILLARY_FEE'))
  assert.ok((REFERENCIAS_DEL_LIBRO as readonly string[]).includes('ANCILLARY_SALE'))
  assert.equal(validarAsiento({ type: 'ANCILLARY_FEE', amount: '32.00' }), null)
  assert.match(validarAsiento({ type: 'ANCILLARY_FEE', amount: '-32.00' }) ?? '', /suma/)
  assert.equal(claveDeCargo('s1'), 'ancillary:s1')
  assert.equal(claveDeReverso('s1'), 'ancillary:s1:reversal')
  assert.equal(claveDeAjuste('s1', 'd1'), 'ancillary:s1:dispute:d1')
})
