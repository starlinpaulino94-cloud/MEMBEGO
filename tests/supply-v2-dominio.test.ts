import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  aplicarMovimiento,
  cubetasVacias,
  invarianteCumplido,
  saldoDeAsientos,
  validarMovimiento,
  type LedgerMove,
} from '../src/modules/supply-v2/core/ledger'
import {
  estadoTrasRecepcion,
  exigirTransicion,
  TRANSICIONES_ORDEN,
  validarCantidadRecibida,
} from '../src/modules/supply-v2/core/estados'
import { esAutoaprobacion, MOTIVO_AUTOAPROBACION } from '../src/modules/supply-v2/core/segregacion'
import { OFERTA_EDITABLE, TRANSICIONES_OFERTA } from '../src/modules/supply-v2/core/estados'
import { edicionCambiaElPrecio, validarEdicionOferta } from '../src/modules/supply-v2/offers/domain'
import { calcularTotales, decimal, mismoMonto, validarLinea, valorDeLotes } from '../src/modules/supply-v2/core/dinero'
import { montoCuadra, resolverPrecioDeDatos, resolverPrecioOferta, validarModoPrecio } from '../src/modules/supply-v2/core/precios'
import { calcularRepartoLinea } from '../src/modules/supply-v2/core/financiacion'
import { formatearNumero, secuenciaDeNumero } from '../src/modules/supply-v2/core/numeracion'
import { acuerdoCompatible, validarAcuerdo } from '../src/modules/supply-v2/agreements/domain'
import { normalizarProveedor, validarProveedorExterno } from '../src/modules/supply-v2/suppliers/domain'
import { normalizarItemCatalogo, slugDeNombre, validarItemCatalogo } from '../src/modules/supply-v2/catalog/domain'

/**
 * MEMBEGO SUPPLY 2.0 · pruebas de dominio PURAS (§48). Sin base de datos: lo
 * que aquí se prueba es lo que decide qué es válido y cuánto queda.
 */

const recibir = (q: number): LedgerMove => ({ type: 'RECEIPT', sourceBucket: null, destinationBucket: 'AVAILABLE', quantity: q })

// ── Ledger ──────────────────────────────────────────────────────────────────

test('ledger · una recepción entra en AVAILABLE y el invariante cuadra', () => {
  const despues = aplicarMovimiento(cubetasVacias(), recibir(500))
  assert.equal(despues.AVAILABLE, 500)
  assert.ok(invarianteCumplido(500, despues))
})

test('ledger · tres recepciones suman lo recibido (500 + 300 + 200 = 1.000)', () => {
  const saldo = saldoDeAsientos([recibir(500), recibir(300), recibir(200)])
  assert.equal(saldo.AVAILABLE, 1000)
  assert.ok(invarianteCumplido(1000, saldo))
})

test('ledger · los balances nunca quedan negativos', () => {
  const b = aplicarMovimiento(cubetasVacias(), recibir(10))
  assert.throws(
    () => aplicarMovimiento(b, { type: 'CANCELLATION', sourceBucket: 'AVAILABLE', destinationBucket: 'CLOSED', quantity: 11, reason: 'prueba' }),
    /No hay 11 unidades/
  )
})

test('ledger · rechaza cantidades no positivas, traslados no declarados y ajustes sin motivo', () => {
  assert.match(validarMovimiento({ ...recibir(0) })!, /entera positiva/)
  assert.match(validarMovimiento({ type: 'RECEIPT', sourceBucket: 'AVAILABLE', destinationBucket: 'CLOSED', quantity: 1 })!, /no puede ir/)
  assert.match(validarMovimiento({ type: 'ADJUSTMENT', sourceBucket: 'AVAILABLE', destinationBucket: 'CLOSED', quantity: 1 })!, /motivo/)
  assert.equal(validarMovimiento({ type: 'ADJUSTMENT', sourceBucket: 'AVAILABLE', destinationBucket: 'CLOSED', quantity: 1, reason: 'descuadre' }), null)
})

test('ledger · el invariante detecta un descuadre', () => {
  const b = { ...cubetasVacias(), AVAILABLE: 400, CLOSED: 50 }
  assert.equal(invarianteCumplido(500, b), false)
  assert.equal(invarianteCumplido(450, b), true)
})

// ── Máquina de estados de la orden ───────────────────────────────────────────

test('orden · DRAFT → PENDING_APPROVAL → APPROVED; no se salta la aprobación', () => {
  exigirTransicion(TRANSICIONES_ORDEN, 'DRAFT', 'PENDING_APPROVAL', 'Orden')
  exigirTransicion(TRANSICIONES_ORDEN, 'PENDING_APPROVAL', 'APPROVED', 'Orden')
  assert.throws(() => exigirTransicion(TRANSICIONES_ORDEN, 'DRAFT', 'APPROVED', 'Orden'), /no se puede pasar/)
  assert.throws(() => exigirTransicion(TRANSICIONES_ORDEN, 'RECEIVED', 'DRAFT', 'Orden'), /no se puede pasar/)
})

test('autoaprobación · quien crea TAMBIÉN aprueba; lo que queda es el rastro', () => {
  // La segregación se retiró a propósito: con un solo administrador de
  // plataforma no hay a quién pasarle la aprobación. Ya no existe veto.
  assert.equal(esAutoaprobacion('u1', 'u1'), true, 'aprobar lo propio se marca')
  assert.equal(esAutoaprobacion('u1', 'u2'), false, 'aprobar lo ajeno no es autoaprobación')
  // Sin creador conocido no hay nada que marcar.
  assert.equal(esAutoaprobacion(null, 'u1'), false)
  assert.equal(esAutoaprobacion('', 'u1'), false)
  assert.match(MOTIVO_AUTOAPROBACION, /misma persona que la creó/)
})

test('recepción · 500 de 1.000 deja PARTIALLY_RECEIVED; completar deja RECEIVED', () => {
  assert.equal(estadoTrasRecepcion([{ quantity: 1000, receivedQuantity: 500 }]), 'PARTIALLY_RECEIVED')
  assert.equal(estadoTrasRecepcion([{ quantity: 1000, receivedQuantity: 800 }]), 'PARTIALLY_RECEIVED')
  assert.equal(estadoTrasRecepcion([{ quantity: 1000, receivedQuantity: 1000 }]), 'RECEIVED')
})

test('recepción · nunca por encima de lo comprado (1.001 falla, 0 falla)', () => {
  const linea = { quantity: 1000, receivedQuantity: 800 }
  assert.equal(validarCantidadRecibida(200, linea), null)
  assert.match(validarCantidadRecibida(201, linea)!, /Solo quedan 200/)
  assert.match(validarCantidadRecibida(0, linea)!, /entero positivo/)
  assert.match(validarCantidadRecibida(1, { quantity: 1000, receivedQuantity: 1000 })!, /ya se recibió/)
})

// ── Dinero ──────────────────────────────────────────────────────────────────

test('dinero · 1.000 × 300 = 300.000 sin impuestos; con 18 % son 354.000', () => {
  const t = calcularTotales([{ quantity: 1000, unitCost: 300 }])
  assert.equal(t.subtotal.toFixed(2), '300000.00')
  assert.equal(t.taxes.toFixed(2), '0.00')
  assert.equal(t.total.toFixed(2), '300000.00')
  const con = calcularTotales([{ quantity: 1000, unitCost: '300' }], 18)
  assert.equal(con.taxes.toFixed(2), '54000.00')
  assert.equal(con.total.toFixed(2), '354000.00')
})

test('dinero · usa Decimal, no floats: 3 × 0.10 = 0.30 exacto', () => {
  const t = calcularTotales([{ quantity: 3, unitCost: '0.10' }])
  assert.equal(t.subtotal.toString(), '0.3')
})

test('dinero · rechaza cantidad ≤ 0, costo negativo e impuestos fuera de rango', () => {
  assert.match(validarLinea({ quantity: 0, unitCost: 1 })!, /entero positivo/)
  assert.match(validarLinea({ quantity: 1, unitCost: -1 })!, /negativo/)
  assert.throws(() => calcularTotales([{ quantity: 1, unitCost: 1 }], -1), /entre 0 y 100/)
  assert.throws(() => calcularTotales([], 0), /sin líneas/)
})

test('dinero · valor adquirido = unidades × costo congelado de cada lote', () => {
  assert.equal(valorDeLotes([{ quantity: 500, unitCost: 300 }, { quantity: 300, unitCost: '280' }]).toFixed(2), '234000.00')
})

// ── Numeración ──────────────────────────────────────────────────────────────

test('numeración · formato MBG-PO-2026-000001 y lectura de la secuencia', () => {
  assert.equal(formatearNumero('MBG-PO', 2026, 1), 'MBG-PO-2026-000001')
  assert.equal(secuenciaDeNumero('MBG-PO-2026-000127'), 127)
  assert.equal(secuenciaDeNumero('LOT-2026-000009'), 9)
  assert.equal(formatearNumero('LOT', 2026, secuenciaDeNumero('LOT-2026-000009') + 1), 'LOT-2026-000010')
})

// ── Acuerdos ────────────────────────────────────────────────────────────────

const hoy = new Date('2026-06-01T12:00:00Z')
const baseAcuerdo = {
  status: 'ACTIVE',
  type: 'PREPAID_PURCHASE' as const,
  scope: 'ITEM' as const,
  catalogItemId: 'item-1',
  category: null,
  startsAt: new Date('2026-01-01'),
  endsAt: new Date('2026-12-31'),
}

test('acuerdo · compatible solo si vigente, del tipo del Slice 1 y cubre el ítem', () => {
  const item = { id: 'item-1', category: 'Pizzas' }
  assert.equal(acuerdoCompatible(baseAcuerdo, item, hoy), true)
  assert.equal(acuerdoCompatible({ ...baseAcuerdo, catalogItemId: 'otro' }, item, hoy), false)
  assert.equal(acuerdoCompatible({ ...baseAcuerdo, status: 'DRAFT' }, item, hoy), false)
  assert.equal(acuerdoCompatible({ ...baseAcuerdo, endsAt: new Date('2026-05-01') }, item, hoy), false)
  assert.equal(acuerdoCompatible({ ...baseAcuerdo, type: 'COMMISSION' }, item, hoy), false)
  assert.equal(acuerdoCompatible({ ...baseAcuerdo, scope: 'CATEGORY', catalogItemId: null, category: 'pizzas' }, item, hoy), true)
  assert.equal(acuerdoCompatible({ ...baseAcuerdo, scope: 'CATALOG', catalogItemId: null }, { id: 'x', category: null }, hoy), true)
})

test('acuerdo · valida fechas, costo y tipos del Slice 1', () => {
  const ok = { supplierId: 's', type: 'PREPAID_PURCHASE' as const, catalogItemId: 'i', negotiatedUnitCost: 300, startsAt: new Date('2026-01-01'), endsAt: new Date('2026-12-31') }
  assert.equal(validarAcuerdo(ok), null)
  assert.match(validarAcuerdo({ ...ok, endsAt: new Date('2025-12-31') })!, /posterior/)
  assert.match(validarAcuerdo({ ...ok, negotiatedUnitCost: -1 })!, /negativo/)
  // Slice 5 abrió COMMISSION (con sus propias reglas); HYBRID y OPEN_DEPOSIT siguen fuera.
  assert.match(validarAcuerdo({ ...ok, type: 'HYBRID' })!, /solo se pueden crear/)
  assert.match(validarAcuerdo({ ...ok, type: 'COMMISSION', negotiatedUnitCost: null })!, /porcentaje/)
  assert.match(validarAcuerdo({ ...ok, catalogItemId: null })!, /necesita el producto/)
})

// ── Proveedor y catálogo ────────────────────────────────────────────────────

test('proveedor · exige nombre, valida correo y normaliza moneda y país', () => {
  assert.match(validarProveedorExterno({ commercialName: '  ' })!, /nombre comercial/)
  assert.match(validarProveedorExterno({ commercialName: 'Little Pizza', email: 'no-es-correo' })!, /correo/)
  const n = normalizarProveedor({ commercialName: ' Little Pizza ', email: 'Hola@LittlePizza.do', currency: 'dop', countryCode: 'do' })
  assert.equal(n.commercialName, 'Little Pizza')
  assert.equal(n.email, 'hola@littlepizza.do')
  assert.equal(n.currency, 'DOP')
  assert.equal(n.countryCode, 'DO')
})

test('catálogo · el nombre no es el identificador: el slug se deriva y el SKU se normaliza', () => {
  assert.equal(slugDeNombre('Pizza Grande Pepperoni'), 'pizza-grande-pepperoni')
  assert.equal(slugDeNombre('Ñoquis à la crème!'), 'noquis-a-la-creme')
  assert.match(validarItemCatalogo({ supplierId: 's', type: 'PRODUCT', name: '' })!, /nombre/)
  assert.match(validarItemCatalogo({ supplierId: 's', type: 'PRODUCT', name: 'x', publicPrice: -5 })!, /negativo/)
  const n = normalizarItemCatalogo({ supplierId: 's', type: 'PRODUCT', name: ' Pizza ', sku: ' piz-pep-g ', publicPrice: '600' })
  assert.equal(n.sku, 'PIZ-PEP-G')
  assert.equal(n.publicPrice, '600')
  assert.equal(n.unit, 'UNIT')
})

// ── Editar una oferta (§7–§15) ───────────────────────────────────────────────

const ofertaActual = { publicPrice: '1000.00', salePrice: '700.00', quantityLimit: 100, startsAt: new Date('2026-01-01') }
const MANANA = new Date(Date.now() + 86_400_000)
const AYER = new Date(Date.now() - 86_400_000)

test('oferta editable · los estados terminales quedan fuera, y TODOS están clasificados', () => {
  assert.deepEqual([...OFERTA_EDITABLE], ['DRAFT', 'SCHEDULED', 'ACTIVE', 'PAUSED'])
  for (const terminal of ['SOLD_OUT', 'ENDED', 'CANCELLED'] as const) {
    assert.ok(!OFERTA_EDITABLE.includes(terminal), `${terminal} no se edita: se publica otra`)
  }
  // Un estado nuevo en la máquina no puede colarse como editable por descuido.
  for (const estado of Object.keys(TRANSICIONES_OFERTA)) {
    const clasificado = OFERTA_EDITABLE.includes(estado as never) || ['SOLD_OUT', 'ENDED', 'CANCELLED'].includes(estado)
    assert.ok(clasificado, `el estado ${estado} no está clasificado como editable o no editable`)
  }
})

test('editar una oferta · el título y los precios se validan como par', () => {
  assert.equal(validarEdicionOferta({ title: 'Lavado premium' }, ofertaActual), null)
  assert.match(validarEdicionOferta({ title: '   ' }, ofertaActual)!, /necesita un título/)
  assert.match(validarEdicionOferta({ title: 'x'.repeat(161) }, ofertaActual)!, /demasiado largo/)

  // Solo baja el público: el Membego que NO cambia se toma del actual, así que
  // la invariante se sigue comprobando entre los dos.
  assert.match(validarEdicionOferta({ publicPrice: 500 }, ofertaActual)!, /no puede ser mayor que el precio público/)
  assert.equal(validarEdicionOferta({ publicPrice: 1200 }, ofertaActual), null)
  assert.equal(validarEdicionOferta({ salePrice: 0 }, ofertaActual), null, 'regalarla es legal')
})

test('editar una oferta · límite por persona y vigencia', () => {
  assert.match(validarEdicionOferta({ perCustomerLimit: 0 }, ofertaActual)!, /entero positivo/)
  assert.match(validarEdicionOferta({ perCustomerLimit: 101 }, ofertaActual)!, /no puede superar las unidades/)
  assert.equal(validarEdicionOferta({ perCustomerLimit: 100 }, ofertaActual), null)

  assert.equal(validarEdicionOferta({ endsAt: MANANA }, ofertaActual), null)
  assert.equal(validarEdicionOferta({ endsAt: null }, ofertaActual), null, 'quitar el fin es legal')
  // Acortar al pasado es terminar la oferta, y eso libera unidades.
  assert.match(validarEdicionOferta({ endsAt: AYER }, ofertaActual)!, /usa «Finalizar»/)
})

test('editar una oferta · la guarda solo salta si de verdad cambia lo que se cobra', () => {
  const actual = { publicPrice: '1000.00', salePrice: '700.00' }
  const resolver = (d: Parameters<typeof resolverPrecioDeDatos>[0]) => resolverPrecioDeDatos(d)

  // Una edición que no toca el precio no resuelve nada, y entonces no hay guarda.
  assert.equal(edicionCambiaElPrecio(null, actual), false, 'cambiar el título no toca el dinero')
  assert.equal(edicionCambiaElPrecio(resolver({ publicPrice: '1000', salePrice: '700' }), actual), false, 'reenviar el mismo precio no es un cambio')
  assert.equal(edicionCambiaElPrecio(resolver({ publicPrice: '1000', salePrice: '650' }), actual), true)
  assert.equal(edicionCambiaElPrecio(resolver({ publicPrice: '1200', salePrice: '700' }), actual), true)

  // El mismo precio ESCRITO DE OTRA FORMA no es un cambio. Comparar dinero como
  // texto fallaba justo aquí: la base devuelve «700.00» y el formulario manda
  // «700», así que reenviar sin tocar nada se contaba como cambio de precio y,
  // con un checkout vivo, se rechazaba una edición que no cambiaba nada.
  for (const igual of ['700', 700, '700.0', '0700.00']) {
    assert.equal(
      edicionCambiaElPrecio(resolver({ publicPrice: '1000.00', salePrice: igual }), actual),
      false,
      `${JSON.stringify(igual)} es el mismo precio que 700.00`
    )
  }
  // Y un centavo SÍ es un cambio: aquí no hay tolerancia que valga.
  assert.equal(edicionCambiaElPrecio(resolver({ publicPrice: '1000.00', salePrice: '699.99' }), actual), true)

  // Cambiar SOLO el modo cambia lo que se cobra sin que el formulario traiga un
  // importe: por eso la pregunta se hace sobre el precio ya resuelto.
  assert.equal(edicionCambiaElPrecio(resolver({ publicPrice: '1000.00', priceMode: 'FREE' }), actual), true, 'pasar a gratis es un cambio de precio')
  // Y al revés: pasar de precio fijo a un 30 % que da EXACTAMENTE el mismo
  // importe (1000 − 300 = 700) no es un cambio de precio. El modo sí cambia y
  // se registra, pero nadie va a pagar algo distinto, así que no hay motivo
  // para rechazar la edición por los checkouts en curso. Esto es justo lo que
  // se perdería comparando los campos del formulario en vez del resultado.
  assert.equal(
    edicionCambiaElPrecio(resolver({ publicPrice: '1000.00', priceMode: 'PERCENTAGE', priceModePercentage: '30' }), actual),
    false,
    'el 30 % de 1000 deja el precio en 700, que es el que ya tenía'
  )
  assert.equal(
    edicionCambiaElPrecio(resolver({ publicPrice: '1000.00', priceMode: 'PERCENTAGE', priceModePercentage: '35' }), actual),
    true,
    'el 35 % deja el precio en 650: eso sí cambia lo que se cobra'
  )
})

test('mismoMonto · exacto, y distinto de la tolerancia de conciliación', () => {
  assert.equal(mismoMonto('600', '600.00'), true)
  assert.equal(mismoMonto(0, '0.00'), true)
  assert.equal(mismoMonto(decimal('1000'), 1000), true)
  // Un centavo: `montoCuadra` lo perdona porque un cobro bancario lo necesita;
  // `mismoMonto` no, porque un centavo de precio es un precio distinto.
  assert.equal(montoCuadra('600.00', '600.009'), true)
  assert.equal(mismoMonto('600.00', '600.01'), false)
  // Basura de entrada no se hace pasar por «igual».
  assert.equal(mismoMonto('abc', '600'), false)
})

// ── Modos de precio de una oferta: fijo, porcentaje y gratis ─────────────────

test('resolverPrecioOferta · los tres modos materializan siempre el precio Membego', () => {
  const fijo = resolverPrecioOferta({ mode: 'FIXED', publicPrice: '1000', salePrice: '650' })
  assert.equal(fijo.salePrice.toFixed(2), '650.00')
  assert.equal(fijo.mode, 'FIXED')
  assert.equal(fijo.percentage, null, 'el porcentaje solo se guarda en PERCENTAGE')

  const pct = resolverPrecioOferta({ mode: 'PERCENTAGE', publicPrice: '1000', percentage: '35' })
  assert.equal(pct.salePrice.toFixed(2), '650.00', '35 % de 1000 son 350: queda en 650')
  assert.equal(pct.percentage?.toString(), '35')
  assert.equal(pct.discountPercentage, 35, 'el porcentaje calculado coincide con el escrito')

  // Gratis es gratis: 0, no «casi 0». El checkout lo exige y el CHECK también.
  const gratis = resolverPrecioOferta({ mode: 'FREE', publicPrice: '1000' })
  assert.equal(gratis.salePrice.toFixed(2), '0.00')
  assert.equal(gratis.discount.toFixed(2), '1000.00')
  assert.equal(gratis.discountPercentage, 100)
  assert.equal(gratis.percentage, null)
})

test('resolverPrecioOferta · un porcentaje fuera de rango se rechaza, no se recorta', () => {
  for (const malo of ['0', '-5', '101', '120']) {
    assert.throws(
      () => resolverPrecioOferta({ mode: 'PERCENTAGE', publicPrice: '1000', percentage: malo }),
      /porcentaje/i,
      `${malo} % no es un descuento`
    )
  }
  // Recortar al 100 % en vez de rechazar convertiría un dedazo en una oferta gratis.
  assert.equal(resolverPrecioOferta({ mode: 'PERCENTAGE', publicPrice: '1000', percentage: '100' }).salePrice.toFixed(2), '0.00')
})

test('resolverPrecioOferta · redondea igual que el motor de beneficios', () => {
  // La razón de redondear el DESCUENTO y luego restar, en vez de redondear el
  // resultado: una oferta al 35 % y un beneficio del 35 % sobre la misma base
  // tienen que dar el mismo importe al céntimo. Si difirieran, ese céntimo
  // aparecería como un descuadre en la liquidación al proveedor.
  for (const base of ['333.33', '1000', '1250.55', '99.99', '7.77']) {
    for (const p of ['35', '12.5', '7', '33.33']) {
      const oferta = resolverPrecioOferta({ mode: 'PERCENTAGE', publicPrice: base, percentage: p })
      const beneficio = calcularRepartoLinea({
        saleUnitPrice: base,
        quantity: 1,
        sourceType: 'PREPURCHASED_SUPPLY',
        beneficio: { valueType: 'PERCENTAGE', funding: 'SUPPLIER', membegoValue: 0, supplierValue: p },
      })
      assert.equal(
        oferta.salePrice.toFixed(2),
        beneficio.customerPayable.toFixed(2),
        `${p} % sobre ${base}: la oferta y el beneficio tienen que coincidir`
      )
    }
  }
})

test('resolverPrecioDeDatos · sin modo es FIXED, que es lo que han hecho siempre las ofertas', () => {
  const sinModo = resolverPrecioDeDatos({ publicPrice: '1000', salePrice: '700' })
  assert.equal(sinModo.mode, 'FIXED')
  assert.equal(sinModo.salePrice.toFixed(2), '700.00')

  // Cada modo exige lo que necesita, y lo dice en vez de inventarlo.
  assert.throws(() => resolverPrecioDeDatos({ publicPrice: '1000', priceMode: 'PERCENTAGE' }), /necesita el porcentaje/)
  assert.throws(() => resolverPrecioDeDatos({ publicPrice: '1000', priceMode: 'FIXED' }), /necesita el precio Membego/)
  // FREE no necesita nada más: el precio es 0 por definición.
  assert.equal(resolverPrecioDeDatos({ publicPrice: '1000', priceMode: 'FREE' }).salePrice.toFixed(2), '0.00')
})

test('validarModoPrecio · el modo y el porcentaje van emparejados, como en el CHECK', () => {
  assert.equal(validarModoPrecio('FIXED', null), null)
  assert.equal(validarModoPrecio('FREE', null), null)
  assert.equal(validarModoPrecio('PERCENTAGE', '35'), null)
  assert.match(validarModoPrecio('PERCENTAGE', null)!, /necesita el porcentaje/)
  // Un porcentaje huérfano en una oferta de precio fijo es un número que
  // alguien acabaría mostrando como si fuera el descuento vigente.
  assert.match(validarModoPrecio('FIXED', '35')!, /solo se guarda/)
  assert.match(validarModoPrecio('FREE', '35')!, /solo se guarda/)
  assert.match(validarModoPrecio('PERCENTAGE', '101')!, /no puede superar 100/)
})
