import './support/sin-server-only'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Tabla } from '../packages/ui/src/ui/tabla'
import { TablaConciliaciones, TablaDepositos, TablaFacturas, TablaLiquidaciones, TablaObligaciones, TablaPagos } from '../src/components/supply-v2/finanzas/tablas'
import { TablaScorecard } from '../src/components/supply-v2/proveedores/tabla-scorecard'
import {
  TablaCatalogoProveedor,
  TablaLedgerLote,
  TablaLedgerOferta,
  TablaLineasCompra,
  TablaLineasConciliacion,
  TablaLineasFactura,
  TablaLineasLiquidacion,
  TablaLotesDelProducto,
  TablaMovimientosDeposito,
} from '../src/components/supply-v2/tablas-detalle'
import {
  TablaAsignaciones,
  TablaCupones,
  TablaHistorialCampana,
  TablaMovimientosBeneficio,
  TablaPrevistaLiquidacion,
  TablaUsosBeneficio,
} from '../src/components/supply-v2/tablas-beneficio-campana'

/**
 * LAS TABLAS DE SUPPLY (PLATAFORMA) EN LA `Tabla` DEL SISTEMA (auditoría admin · fase 7, tarea 7.1).
 *
 * Eran 22 `<table>` sueltas en las pantallas del superadmin: sin título para el lector de pantalla, sin `scope`, cada una con su
 * relleno. Las pruebas de extremo a extremo de Supply (`tests/e2e/supply-v2-*.spec.ts`) las encuentran por `data-testid`, así
 * que lo que importa aquí es que NINGUNO se pierda: se compara contra la lista de los que tenían antes de migrarlas.
 */

const RAIZ = 'src/app/(superadmin)/superadmin/supply/'
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
const html = (n: unknown) => renderToStaticMarkup(n as never)

// Los `data-testid` que había DENTRO de cada tabla antes de migrarla (sacados de la versión anterior de cada pantalla).
const TESTIDS_QUE_HABIA: Record<string, string[]> = {
  'beneficios/[id]/page.tsx': ['tabla-asignaciones', 'tabla-usos-beneficio', 'tabla-movimientos-beneficio'],
  'campanas/[id]/page.tsx': ['tabla-cupones', 'cupon-codigo', 'cupon-usos', 'historial-campana'],
  'compras/[id]/page.tsx': ['recibidas-linea', 'orden-total'],
  'finanzas/conciliaciones/[id]/page.tsx': ['conciliacion-lineas'],
  'finanzas/conciliaciones/page.tsx': ['tabla-conciliaciones', 'conciliacion'],
  'finanzas/depositos/[id]/page.tsx': ['deposito-movimientos', 'deposito-suma'],
  'finanzas/depositos/page.tsx': ['tabla-depositos', 'deposito', 'deposito-disponible'],
  'finanzas/facturas/page.tsx': ['tabla-facturas', 'factura', 'link-factura', 'factura-pendiente'],
  'finanzas/liquidaciones/[id]/page.tsx': ['liq-lineas', 'liq-linea'],
  'finanzas/liquidaciones/nueva/page.tsx': ['preview-liquidacion', 'preview-neto'],
  'finanzas/liquidaciones/page.tsx': ['tabla-liquidaciones', 'liquidacion', 'link-liquidacion', 'liquidacion-pendiente'],
  'finanzas/obligaciones/page.tsx': ['tabla-obligaciones', 'obligacion', 'obligacion-pendiente'],
  'finanzas/pagos/page.tsx': ['tabla-pagos', 'pago', 'link-pago'],
  'ofertas/[id]/page.tsx': ['oferta-ledger'],
  'proveedores/[id]/page.tsx': ['tabla-catalogo'],
  'proveedores/scorecard/page.tsx': ['scorecard', 'scorecard-fila'],
  'supply/[catalogItemId]/page.tsx': ['tabla-lotes'],
  'supply/lotes/[id]/page.tsx': ['tabla-ledger'],
}

const COMPONENTES = [
  'src/components/supply-v2/finanzas/tablas.tsx',
  'src/components/supply-v2/tablas-detalle.tsx',
  'src/components/supply-v2/tablas-beneficio-campana.tsx',
  'src/components/supply-v2/proveedores/tabla-scorecard.tsx',
]

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? archivos(p) : p.endsWith('.tsx') ? [p] : []
  })
}

// ── Ningún testid se pierde ─────────────────────────────────────────────────────────────────────────────────────────

test('ninguna pantalla de Supply del superadmin pinta ya una <table> a mano', () => {
  const conTabla = archivos(RAIZ).filter((f) => /<table\b/.test(sinComentarios(readFileSync(f, 'utf8'))))
  assert.deepEqual(conTabla, [], `siguen con <table> a mano: ${conTabla.join(', ')}`)
})

test('CADA data-testid que había dentro de una tabla de Supply sigue existiendo (las pruebas de extremo a extremo los usan)', () => {
  const componentes = COMPONENTES.map((f) => readFileSync(f, 'utf8')).join('\n')
  const faltan: string[] = []
  for (const [pantalla, ids] of Object.entries(TESTIDS_QUE_HABIA)) {
    const fuente = readFileSync(RAIZ + pantalla, 'utf8') + '\n' + componentes
    for (const id of ids) {
      const presente = new RegExp(`(?:data-testid|testId|testIdFila)=(?:"|\\{')${id}(?:"|'\\})`).test(fuente)
      if (!presente) faltan.push(`${pantalla} → ${id}`)
    }
  }
  assert.deepEqual(faltan, [], `se perdieron data-testid: ${faltan.join('; ')}`)
})

test('cada pantalla migrada usa su tabla de componente (no una copia)', () => {
  const esperadas: Record<string, string> = {
    'finanzas/facturas/page.tsx': '<TablaFacturas',
    'finanzas/depositos/page.tsx': '<TablaDepositos',
    'finanzas/obligaciones/page.tsx': '<TablaObligaciones',
    'finanzas/pagos/page.tsx': '<TablaPagos',
    'finanzas/liquidaciones/page.tsx': '<TablaLiquidaciones',
    'finanzas/conciliaciones/page.tsx': '<TablaConciliaciones',
    'proveedores/scorecard/page.tsx': '<TablaScorecard',
    'beneficios/[id]/page.tsx': '<TablaAsignaciones',
    'campanas/[id]/page.tsx': '<TablaCupones',
    'finanzas/liquidaciones/nueva/page.tsx': '<TablaPrevistaLiquidacion',
    'compras/[id]/page.tsx': '<TablaLineasCompra',
  }
  for (const [pantalla, etiqueta] of Object.entries(esperadas)) {
    assert.ok(sinComentarios(readFileSync(RAIZ + pantalla, 'utf8')).includes(etiqueta), `${pantalla}: ${etiqueta}`)
  }
  // Las listas con paginación la conservan como pie de la tabla.
  for (const [pantalla, etiqueta] of [['finanzas/facturas/page.tsx', 'facturas'], ['finanzas/depositos/page.tsx', 'depósitos'], ['finanzas/pagos/page.tsx', 'pagos']]) {
    assert.match(readFileSync(RAIZ + pantalla, 'utf8'), new RegExp(`pie=\\{<TablaPaginacion paginacion=\\{paginacion\\} total=\\{total\\} params=\\{sp\\} etiqueta="${etiqueta}"`), pantalla)
  }
})

// ── La primitiva ────────────────────────────────────────────────────────────────────────────────────────────────────

test('Tabla · testId y testIdFila se escriben solo si se piden (sin ellos el marcado es el de siempre)', () => {
  const base = { caption: 'Cosas', columnas: [{ clave: 'a', encabezado: 'A' }], filas: [{ a: 'x' }], claveDe: (f: { a: string }) => f.a }
  const Generica = Tabla as unknown as (p: typeof base & { testId?: string; testIdFila?: string }) => never
  const con = html(h(Generica, { ...base, testId: 'mi-tabla', testIdFila: 'mi-fila' }))
  assert.match(con, /<table[^>]*data-testid="mi-tabla"/)
  assert.match(con, /<tr[^>]*data-testid="mi-fila"/)
  assert.equal((con.match(/data-testid="mi-fila"/g) ?? []).length, 1, 'solo las filas de datos, no el encabezado')
  assert.doesNotMatch(html(h(Generica, base)), /data-testid/)
})

// ── Cada tabla, a HTML ──────────────────────────────────────────────────────────────────────────────────────────────

const PIE = h('p', { id: 'pie-de-prueba' }, 'Mostrando 1–1 de 1')
const reglas = (out: string, caption: RegExp, testId: string, testIdFila?: string) => {
  assert.match(out, caption, 'caption para el lector de pantalla')
  assert.match(out, /<th[^>]*scope="row"/, 'la primera columna es el identificador de la fila')
  assert.match(out, /scope="col"/)
  assert.match(out, new RegExp(`<table[^>]*data-testid="${testId}"`))
  if (testIdFila) assert.match(out, new RegExp(`<tr[^>]*data-testid="${testIdFila}"`))
}

test('facturas · identificador con su enlace, dinero a la derecha, el pendiente con su testid y el pie de paginación', () => {
  const f = { id: 'f1', number: 'FAC-0001', supplierInvoiceNumber: 'B0100000001', purchaseOrder: { number: 'OC-0007' }, proveedor: 'Pesca Azul', documentDate: '2026-10-01T00:00:00Z', dueDate: null, total: '1180', amountApplied: '0', amountPaid: '500', amountDue: '680', currency: 'DOP', status: 'APPROVED' }
  const out = html(h(TablaFacturas, { filas: [f] as never, pie: PIE }))
  reglas(out, /<caption[^>]*>Facturas de proveedores/, 'tabla-facturas', 'factura')
  assert.match(out, /data-testid="link-factura"[^>]*>FAC-0001/)
  assert.match(out, /B0100000001/)
  assert.match(out, /OC-0007/)
  assert.match(out, /<td[^>]*text-right[^>]*><span data-testid="factura-pendiente">RD\$680\.00/)
  assert.match(out, /data-testid="estado-factura"/, 'el chip de estado conserva el suyo')
  assert.match(out, /id="pie-de-prueba"/)
  assert.match(out, /—/, 'sin vencimiento se dice con un guion')
})

test('depósitos · disponible con su testid; «de PAGO» solo si viene de un pago', () => {
  const d = { id: 'd1', number: 'DEP-1', paymentNumber: 'PAG-9', proveedor: 'Pesca Azul', originalAmount: '1000', availableAmount: '400', appliedAmount: '600', currency: 'DOP', status: 'PARTIALLY_APPLIED', createdAt: '2026-10-02T00:00:00Z' }
  const out = html(h(TablaDepositos, { filas: [d, { ...d, id: 'd2', number: 'DEP-2', paymentNumber: null }] as never }))
  reglas(out, /<caption[^>]*>Depósitos a proveedores/, 'tabla-depositos', 'deposito')
  assert.equal((out.match(/data-testid="deposito"/g) ?? []).length, 2)
  assert.match(out, /<span data-testid="deposito-disponible">RD\$400\.00/)
  assert.equal((out.match(/de PAG-9/g) ?? []).length, 1)
})

test('obligaciones · el pendiente con su testid y el origen enlazado a su factura cuando la hay', () => {
  const o = { id: 'o1', number: 'OBL-1', proveedorId: 'p1', proveedor: 'Pesca Azul', origen: 'FAC-0001', invoice: { id: 'f1' }, recognitionBasis: 'INVOICE_APPROVAL', purchaseOrder: { number: 'OC-7' }, grossAmount: '1000', paidAmount: '200', outstandingAmount: '800', currency: 'DOP', dueAt: null, status: 'OPEN' }
  const out = html(h(TablaObligaciones, { filas: [o] as never }))
  reglas(out, /<caption[^>]*>Obligaciones con proveedores/, 'tabla-obligaciones', 'obligacion')
  assert.match(out, /data-testid="obligacion-pendiente">RD\$800\.00/)
  assert.match(out, /href="[^"]*\/facturas\/f1"[^>]*>FAC-0001/)
  assert.match(out, /href="\/superadmin\/supply\/proveedores\/p1"[^>]*>Pesca Azul/)
})

test('pagos · el enlace con su testid; «registró X» solo si está pendiente; el botón de confirmar solo con permiso', () => {
  const p = { id: 'g1', number: 'PAG-1', intendedInvoice: { number: 'FAC-1' }, intendedDeposit: null, proveedor: 'Pesca Azul', method: 'TRANSFER', amount: '500', appliedAmount: '0', currency: 'DOP', paidAt: '2026-10-03T00:00:00Z', reference: null, aplicaciones: 0, status: 'PENDING', creadoPor: 'Ana' }
  const sinPermiso = html(h(TablaPagos, { filas: [p] as never, puedoConfirmar: false }))
  reglas(sinPermiso, /<caption[^>]*>Pagos a proveedores/, 'tabla-pagos', 'pago')
  assert.match(sinPermiso, /data-testid="link-pago"[^>]*>PAG-1/)
  assert.match(sinPermiso, /para FAC-1/)
  assert.match(sinPermiso, /registró Ana/)
  assert.match(sinPermiso, /aplicado RD\$0\.00/)
  const confirmado = html(h(TablaPagos, { filas: [{ ...p, status: 'CONFIRMED' }] as never, puedoConfirmar: true }))
  assert.doesNotMatch(confirmado, /registró Ana/)
})

test('liquidaciones y conciliaciones · enlaces, cifras y los testid de lo que se lee', () => {
  const l = { id: 'l1', number: 'LIQ-1', lineas: 3, frequency: 'MONTHLY', proveedorId: 'p1', proveedor: 'Pesca Azul', periodStart: '2026-09-01T00:00:00Z', periodEnd: '2026-09-30T00:00:00Z', grossSales: '1000', commissionAmount: '100', supplierNet: '900', paidAmount: '300', pendiente: '600', currency: 'DOP', status: 'APPROVED' }
  const liq = html(h(TablaLiquidaciones, { filas: [l] as never }))
  reglas(liq, /<caption[^>]*>Liquidaciones a proveedores/, 'tabla-liquidaciones', 'liquidacion')
  assert.match(liq, /data-testid="link-liquidacion"[^>]*>LIQ-1/)
  assert.match(liq, /3 entrega\(s\)/)
  assert.match(liq, /data-testid="liquidacion-pendiente">RD\$600\.00/)

  const c = { id: 'c1', number: 'CON-1', kind: 'SUPPLY', lineas: 5, proveedor: 'Pesca Azul', periodStart: '2026-09-01T00:00:00Z', periodEnd: '2026-09-30T00:00:00Z', internalAmount: '1000', supplierAmount: null, differenceAmount: null, currency: 'DOP', status: 'DRAFT' }
  const con = html(h(TablaConciliaciones, { filas: [c] as never }))
  reglas(con, /<caption[^>]*>Conciliaciones con proveedores/, 'tabla-conciliaciones', 'conciliacion')
  assert.match(con, /5 líneas/)
  assert.match(con, /text-muted-foreground[^>]*>[^<]+<\/span>/, 'sin cifra del proveedor se dice, no se deja en blanco')
})

test('scorecard · doce columnas, las tres primeras siempre visibles y el resto por prioridad; sin colores de «bueno» o «malo»', () => {
  const f = { supplierId: 's1', proveedor: 'Pesca Azul', accessStatus: 'ACTIVE', redenciones: 12, reversadas: 1, incidencias: 0, visitas: 8, visitasConExtras: 3, tasaDeExtras: 0.375, extrasTotal: 4500, comisionTotal: 450, confirmadasPorCliente: 2, ventasAdicionales: 3, tasaDeConfirmacion: 0.67, disputas: 1, disputasAFavorDelCliente: 1, minutosPromedioDeVisita: 42 }
  const out = html(h(TablaScorecard, { filas: [f] as never }))
  reglas(out, /<caption[^>]*>Scorecard de proveedores/, 'scorecard', 'scorecard-fila')
  assert.equal((out.match(/<th[^>]*scope="col"/g) ?? []).length, 12)
  const th = (t: string) => out.match(new RegExp(`<th[^>]*>${t}</th>`))?.[0] ?? ''
  for (const siempre of ['Proveedor', 'Acceso', 'Canjes']) assert.doesNotMatch(th(siempre), /hidden/, siempre)
  assert.match(th('Comisión'), /max-lg:hidden/)
  assert.match(th('Incidencias'), /max-md:hidden/)
  assert.match(out, /\(38 %\)/)
  assert.match(out, /a favor del cliente/)
  assert.match(out, /42/)
})

// ── Los detalles ────────────────────────────────────────────────────────────────────────────────────────────────────

test('conciliación y factura · las líneas completas, con su título y las cifras a la derecha', () => {
  const lineas = [{ id: 'a', occurredAt: '2026-09-05T00:00:00Z', type: 'INVOICE', description: 'Factura FAC-1', internalAmount: '100', supplierAmount: null }]
  const con = html(h(TablaLineasConciliacion, { lineas, moneda: 'DOP', tipos: { INVOICE: 'Factura' } }))
  assert.match(con, /<caption[^>]*>Líneas de la conciliación/)
  assert.match(con, /<table[^>]*data-testid="conciliacion-lineas"/)
  assert.match(con, />Factura</)
  const fac = html(h(TablaLineasFactura, { lineas: [{ id: 'x', descriptionSnapshot: 'Pescado', quantity: 1500, unitCost: '10', taxes: '0', total: '15000' }], moneda: 'DOP' }))
  assert.match(fac, /<caption[^>]*>Líneas de la factura/)
  assert.match(fac, /1\.500|1,500/)
  assert.doesNotMatch(fac, /data-testid/, 'esta tabla no tenía testid y no se inventa uno')
})

test('libro de movimientos de una oferta y de un lote · cantidades, saldos y el origen del movimiento', () => {
  const oferta = html(h(TablaLedgerOferta, { movimientos: [{ id: 'm', type: 'RESERVE', lot: { code: 'L-1' }, sourceBucket: 'AVAILABLE', destinationBucket: null, quantity: 5, actor: null, createdAt: '2026-10-01T10:00:00Z' }] }))
  assert.match(oferta, /<table[^>]*data-testid="oferta-ledger"/)
  assert.match(oferta, /AVAILABLE → fuera/)
  assert.match(oferta, />sistema</)
  const lote = html(h(TablaLedgerLote, { movimientos: [{ id: 'm', type: 'RECEIVE', sourceBucket: null, destinationBucket: 'AVAILABLE', reason: 'recepción', quantity: 100, balanceBefore: 0, balanceAfter: 100, actor: { name: 'Luis', email: 'l@x.com' }, createdAt: '2026-10-01T10:00:00Z' }] }))
  assert.match(lote, /<table[^>]*data-testid="tabla-ledger"/)
  assert.match(lote, /\+100/)
  assert.match(lote, /0 → 100/)
  assert.match(lote, /fuera → AVAILABLE · recepción/)
  assert.match(lote, />Luis</)
})

test('catálogo del proveedor y lotes de un producto · cada pantalla escribe el dinero a su manera, y se respeta', () => {
  const productos = [{ id: 'i1', name: 'Langosta', category: 'Mariscos', type: 'PRODUCT', sku: null, publicPrice: '1500', currency: 'DOP', status: 'ACTIVE' }, { id: 'i2', name: 'Sin precio', category: null, type: 'PRODUCT', sku: 'S-2', publicPrice: null, currency: 'DOP', status: 'INACTIVE' }]
  const cat = html(h(TablaCatalogoProveedor, { productos, tipos: { PRODUCT: 'Producto' }, formato: (n, m) => `<<${m}:${String(n)}>>` }))
  assert.match(cat, /<table[^>]*data-testid="tabla-catalogo"/)
  assert.match(cat, /&lt;&lt;DOP:1500&gt;&gt;/, 'usa el formateador de la pantalla')
  assert.match(cat, />Activo</)
  assert.match(cat, />Inactivo</)
  assert.equal((cat.match(/—/g) ?? []).length >= 2, true, 'sin precio y sin SKU se dice')
  const lote = { id: 'l1', code: 'LOT-1', quantityReceived: 10, quantityAvailable: 6, quantityAllocated: 1, quantityReserved: 1, quantityIssued: 1, quantityRedeemed: 1, unitCost: '50', currency: 'DOP', expiresAt: null, purchaseOrder: { id: 'oc1', number: 'OC-1' }, receipt: { number: 'REC-1' }, status: h('span', null, 'ESTADO-DEL-LOTE') }
  const lotes = html(h(TablaLotesDelProducto, { lotes: [lote] }))
  assert.match(lotes, /<table[^>]*data-testid="tabla-lotes"/)
  assert.match(lotes, /1 · 1 · 1 · 1/)
  assert.match(lotes, /ESTADO-DEL-LOTE/)
  assert.match(lotes, /REC-1/)
})

test('liquidación (entregas) · once columnas, el neto es lo que no se oculta, y cada fila con su testid', () => {
  const x = { id: 'e1', redemptionId: 'r1', descripcion: 'Saona · Ana', obligationNumber: 'OBL-3', grossAmount: '100', contractualAmount: '90', membegoSubsidyAmount: '5', customerPaidAmount: '85', commissionAmount: '10', alreadyPaidAmount: '0', supplierNet: '80', paidAmount: '0', obligationStatus: 'OPEN' }
  const out = html(h(TablaLineasLiquidacion, { lineas: [x as never], moneda: 'DOP' }))
  assert.match(out, /<table[^>]*data-testid="liq-lineas"/)
  assert.match(out, /<tr[^>]*data-testid="liq-linea"/)
  assert.equal((out.match(/<th[^>]*scope="col"/g) ?? []).length, 11)
  assert.match(out, /href="\/superadmin\/supply\/redenciones\/r1"[^>]*>Saona · Ana/)
  assert.doesNotMatch(out.match(/<th[^>]*>Neto<\/th>/)?.[0] ?? '', /hidden/)
})

test('depósito y compra · los totales del <tfoot> pasan al pie de la tabla con sus testid', () => {
  const movimientos = [{ id: 'mv', createdAt: '2026-10-01T10:00:00Z', type: 'APPLIED', reason: null, actor: null, amount: { isNegative: () => true, abs: () => '100' }, balanceAfter: '900', application: null }]
  const dep = html(h(TablaMovimientosDeposito, { movimientos, moneda: 'DOP', etiquetas: { APPLIED: 'Aplicado' }, suma: '900', rutaFacturas: '/superadmin/supply/finanzas/facturas' }))
  assert.match(dep, /<table[^>]*data-testid="deposito-movimientos"/)
  assert.match(dep, /text-destructive[^>]*>−RD\$100\.00/)
  assert.match(dep, /Suma de movimientos[\s\S]*data-testid="deposito-suma">RD\$900\.00/)

  const compra = html(
    h(TablaLineasCompra, {
      lineas: [{ id: 'l', descriptionSnapshot: 'Langosta', quantity: 10, receivedQuantity: 4, unitCost: '50', subtotal: '500' }],
      moneda: 'DOP',
      subtotal: '500',
      impuestos: '90',
      porcentajeImpuesto: '18',
      total: '590',
    })
  )
  assert.match(compra, /<caption[^>]*>Líneas de la orden de compra/)
  assert.match(compra, /data-testid="recibidas-linea">4 \/ 10/)
  assert.match(compra, /Impuestos \(18 %\)/)
  assert.match(compra, /data-testid="orden-total">RD\$590\.00/)
})

test('beneficio, campaña y prevista de liquidación · testid conservados y los botones solo con permiso', () => {
  const asig = html(h(TablaAsignaciones, { asignaciones: [{ id: 'g1', cliente: 'Ana', email: 'a@x.com', status: 'AVAILABLE', usesConsumed: 1, usesAllowed: 3, expiresAt: null, note: null, grantedAt: '2026-10-01T00:00:00Z', otorgadoPor: 'Luis' }], benefitId: 'b1', puedeCancelar: false }))
  assert.match(asig, /<table[^>]*data-testid="tabla-asignaciones"/)
  assert.match(asig, /1 \/ 3/)
  assert.doesNotMatch(asig, /Cancelar/, 'sin permiso no se ofrece cancelar')

  const usos = html(h(TablaUsosBeneficio, { usos: [{ id: 'u1', orderId: 'o1', orderNumber: 'PED-1', cliente: 'Ana', status: 'REVERSED', quantity: 2, supplierAmount: '30', membegoAmount: '10', createdAt: '2026-10-01T00:00:00Z', appliedAt: null, reversedReason: 'error de precio' }], benefitId: 'b1', moneda: 'DOP', puedeCancelar: false }))
  assert.match(usos, /<table[^>]*data-testid="tabla-usos-beneficio"/)
  assert.match(usos, /Reversado: error de precio/)

  const mov = html(h(TablaMovimientosBeneficio, { movimientos: [{ id: 'm1', createdAt: '2026-10-01T00:00:00Z', type: 'RESERVE', reservedDelta: '10', consumedDelta: '0', reservedAfter: '10', consumedAfter: '0', reason: null, actor: null }], moneda: 'DOP' }))
  assert.match(mov, /<table[^>]*data-testid="tabla-movimientos-beneficio"/)
  assert.match(mov, />Sistema</)

  const cup = html(h(TablaCupones, { cupones: [{ id: 'k1', code: 'VERANO10', kind: 'PUBLIC', cliente: null, promocion: '10 % de verano', timesRedeemed: 2, maxRedemptions: null, maxPerCustomer: 1, minPurchase: '500', expiresAt: null, status: 'ACTIVE' }], campaignId: 'c1', moneda: 'DOP', puedeCupones: false }))
  assert.match(cup, /<table[^>]*data-testid="tabla-cupones"/)
  assert.match(cup, /<th[^>]*scope="row"[^>]*><span[^>]*data-testid="cupon-codigo">VERANO10/)
  assert.match(cup, /data-testid="cupon-usos">2 \/ ∞/)
  assert.match(cup, /1 por cliente/)

  const hist = html(h(TablaHistorialCampana, { eventos: [{ id: 'e', createdAt: '2026-10-01T00:00:00Z', type: 'CREATED', detail: null, actor: null }] }))
  assert.match(hist, /<table[^>]*data-testid="historial-campana"/)

  const prev = html(h(TablaPrevistaLiquidacion, { entregas: [{ id: 'e1', redemptionNumber: null, number: 'ENT-1', producto: 'Saona', cliente: 'Ana', redeemedAt: '2026-10-01T00:00:00Z', gross: '100', commission: '10', net: '90' }], moneda: 'DOP', bruto: '100', comision: '10', neto: '90' }))
  assert.match(prev, /<table[^>]*data-testid="preview-liquidacion"/)
  assert.match(prev, /1 entrega\(s\)/)
  assert.match(prev, /data-testid="preview-neto">RD\$90\.00/)
})
