import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Prisma } from '@prisma/client'
import {
  cabeEnElPresupuesto,
  campanaAtribuida,
  codigoAleatorio,
  codigoValido,
  estadoAlPublicar,
  estadoCuponSegunUsos,
  fueraDePublico,
  fueraDeVigencia,
  MENSAJE_CUPON_OPACO,
  metricasDeCampana,
  minutosDesdeTexto,
  minutosLocales,
  motivoCuponNoAplicable,
  normalizarCodigoCupon,
  presupuestoDeCampana,
  textoDesdeMinutos,
  TRANSICIONES_CAMPANA,
  validarCampana,
  type CampanaParaElegibilidad,
  type CuponParaElegibilidad,
  type DatosCampana,
  type HistorialDelCliente,
  type UsosDelCupon,
  type VentaDeCampana,
} from '../src/modules/supply-v2/campaigns/domain'
import { calcularRepartoLinea } from '../src/modules/supply-v2/core/financiacion'
import { motivoNoElegible, type BeneficioParaElegibilidad, type OfertaParaElegibilidad } from '../src/modules/supply-v2/benefits/domain'
import { esAutoaprobacion } from '../src/modules/supply-v2/core/segregacion'
import { puedeTransicionar } from '../src/modules/supply-v2/core/estados'
import { SUPPLY_V2_PERMISSIONS } from '../src/modules/supply-v2/contracts/gateways'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 7 · pruebas de DOMINIO (§30). Sin base de datos.
 *
 * El caso que manda, el del enunciado: precio 1 000, descuento del proveedor
 * 100, bono de Membego 300 → el cliente paga 600, el valor contractual es 900,
 * la comisión del 8 % son 72 y el neto del proveedor 828. La comisión NO se
 * calcula sobre los 600.
 *
 * Lo que garantiza la base (candados, CHECK, unicidad de códigos) se prueba en
 * `tests/postgres/supply-v2-slice7.db.test.ts`.
 */

const D = (n: string | number) => new Prisma.Decimal(n)
const AHORA = new Date('2026-06-15T18:00:00.000Z') // 14:00 en Santo Domingo (UTC−4)

const campanaBase = (p: Partial<CampanaParaElegibilidad> = {}): CampanaParaElegibilidad => ({
  id: 'c1',
  status: 'ACTIVE',
  currency: 'DOP',
  startsAt: new Date('2026-06-01T00:00:00.000Z'),
  endsAt: new Date('2026-07-01T00:00:00.000Z'),
  activeFromMinute: null,
  activeToMinute: null,
  maxRedemptions: null,
  maxPerCustomer: 1,
  audience: 'ALL',
  ...p,
})

const cuponBase = (p: Partial<CuponParaElegibilidad> = {}): CuponParaElegibilidad => ({
  id: 'k1',
  code: 'COMIDA15',
  kind: 'PUBLIC',
  customerId: null,
  status: 'ACTIVE',
  maxRedemptions: null,
  maxPerCustomer: 1,
  minPurchase: null,
  timesRedeemed: 0,
  expiresAt: null,
  ...p,
})

const sinUsos: UsosDelCupon = { totales: 0, delCliente: 0, deLaCampanaPorCliente: 0, deLaCampana: 0 }
const historialBase = (p: Partial<HistorialDelCliente> = {}): HistorialDelCliente => ({ comprasPagadas: 0, beneficiosDeCampanaUsados: 0, asignadoAEstaCampana: false, ...p })

function aplicable(c: Partial<CuponParaElegibilidad> = {}, campana: Partial<CampanaParaElegibilidad> = {}, d: Partial<{ customerId: string; ofertaEnCampana: boolean; importeDeLinea: Prisma.Decimal; usos: UsosDelCupon; historial: HistorialDelCliente }> = {}, ahora = AHORA) {
  return motivoCuponNoAplicable(
    cuponBase(c),
    campanaBase(campana),
    {
      customerId: d.customerId ?? 'cli1',
      ofertaEnCampana: d.ofertaEnCampana ?? true,
      importeDeLinea: d.importeDeLinea ?? D(1000),
      usos: d.usos ?? sinUsos,
      historial: d.historial ?? historialBase(),
    },
    ahora
  )
}

const datosCampana = (p: Partial<DatosCampana> = {}): DatosCampana => ({
  name: 'Semana Gastronómica',
  organizer: 'MEMBEGO',
  funding: 'MEMBEGO',
  audience: 'ALL',
  budgetTotal: 50_000,
  startsAt: new Date('2026-06-01T00:00:00.000Z'),
  ...p,
})

// ── 1–2 · Campaña programada y campaña vencida (§7) ─────────────────────────

test('1 · campaña programada: no vale antes de su fecha y al publicarla queda PROGRAMADA, no activa', () => {
  const futura = campanaBase({ startsAt: new Date('2026-07-01T00:00:00.000Z'), endsAt: null })
  assert.equal(fueraDeVigencia(futura, AHORA), 'NO_EMPEZO')
  assert.equal(aplicable({}, { startsAt: new Date('2026-07-01T00:00:00.000Z') }), 'CAMPANA_NO_EMPEZO')
  // Publicar no adelanta la vigencia.
  assert.equal(estadoAlPublicar(new Date('2026-07-01T00:00:00.000Z'), AHORA), 'SCHEDULED')
  assert.equal(estadoAlPublicar(new Date('2026-06-01T00:00:00.000Z'), AHORA), 'ACTIVE')
})

test('2 · campaña vencida: deja de valer el mismo instante en que termina', () => {
  assert.equal(fueraDeVigencia(campanaBase({ endsAt: new Date('2026-06-01T00:00:00.000Z') }), AHORA), 'TERMINO')
  assert.equal(aplicable({}, { endsAt: new Date('2026-06-14T00:00:00.000Z') }), 'CAMPANA_TERMINO')
  // Un instante antes del fin sí vale.
  assert.equal(fueraDeVigencia(campanaBase({ endsAt: new Date(AHORA.getTime() + 1) }), AHORA), null)
  assert.equal(fueraDeVigencia(campanaBase({ endsAt: AHORA }), AHORA), 'TERMINO')
})

test('3 · promoción por horario: vale dentro de su ventana y no fuera, en la zona de la plataforma', () => {
  // 18:00 UTC son las 14:00 en Santo Domingo: 840 minutos.
  assert.equal(minutosLocales(AHORA, 'America/Santo_Domingo'), 840)
  const almuerzo = campanaBase({ activeFromMinute: 12 * 60, activeToMinute: 15 * 60 })
  assert.equal(fueraDeVigencia(almuerzo, AHORA), null)
  const cena = campanaBase({ activeFromMinute: 18 * 60, activeToMinute: 23 * 60 })
  assert.equal(fueraDeVigencia(cena, AHORA), 'FUERA_DE_HORARIO')
  assert.equal(aplicable({}, { activeFromMinute: 18 * 60, activeToMinute: 23 * 60 }), 'FUERA_DE_HORARIO')
  // El horario se lee y se escribe como lo teclea una persona.
  assert.equal(minutosDesdeTexto('18:30'), 1110)
  assert.equal(textoDesdeMinutos(1110), '18:30')
  assert.equal(minutosDesdeTexto('24:00'), null)
  assert.equal(minutosDesdeTexto('mañana'), null)
})

// ── 4–8 · Cupones (§9–§11) ──────────────────────────────────────────────────

test('4 · cupón público: lo usa cualquier cliente elegible', () => {
  assert.equal(aplicable({ kind: 'PUBLIC', customerId: null }, {}, { customerId: 'cualquiera' }), null)
})

test('5 · cupón privado: el de otra persona se rechaza aunque se sepa el código', () => {
  assert.equal(aplicable({ kind: 'PRIVATE', customerId: 'cli1' }, {}, { customerId: 'cli1' }), null)
  assert.equal(aplicable({ kind: 'PRIVATE', customerId: 'cli1' }, {}, { customerId: 'cli2' }), 'CUPON_AJENO')
  // Y el mensaje que ve quien lo prueba no distingue «no existe» de «no es tuyo».
  assert.match(MENSAJE_CUPON_OPACO, /no existe o no se puede usar/)
})

test('6 · código inválido: formato, normalización y unicidad sin distinguir mayúsculas', () => {
  assert.equal(normalizarCodigoCupon('  saona-300 '), 'SAONA300')
  assert.ok(codigoValido('bienvenido200'))
  assert.ok(!codigoValido('ABC'))
  assert.ok(!codigoValido('CON ESPACIO Y SÍMBOLO!'))
  assert.ok(!codigoValido(''))
  assert.ok(!codigoValido('A'.repeat(33)))
})

test('7 · cupón vencido, agotado o cancelado: cada uno con su motivo', () => {
  assert.equal(aplicable({ expiresAt: new Date('2026-06-14T00:00:00.000Z') }), 'CUPON_VENCIDO')
  assert.equal(aplicable({ status: 'EXPIRED' }), 'CUPON_VENCIDO')
  assert.equal(aplicable({ status: 'EXHAUSTED' }), 'CUPON_AGOTADO')
  assert.equal(aplicable({ status: 'CANCELLED' }), 'CUPON_CANCELADO')
})

test('8 · límite por cliente del cupón: las aplicaciones vivas cuentan', () => {
  assert.equal(aplicable({ maxPerCustomer: 1 }, {}, { usos: { ...sinUsos, delCliente: 1 } }), 'LIMITE_DEL_CUPON_POR_CLIENTE')
  assert.equal(aplicable({ maxPerCustomer: 2 }, {}, { usos: { ...sinUsos, delCliente: 1 } }), null)
})

test('9 · límite global: del cupón y de la campaña, con mensajes distintos', () => {
  assert.equal(aplicable({ maxRedemptions: 10 }, {}, { usos: { ...sinUsos, totales: 10 } }), 'LIMITE_DEL_CUPON')
  assert.equal(aplicable({}, { maxRedemptions: 100 }, { usos: { ...sinUsos, deLaCampana: 100 } }), 'CAMPANA_AGOTADA')
  assert.equal(aplicable({}, { maxPerCustomer: 1 }, { usos: { ...sinUsos, deLaCampanaPorCliente: 1 } }), 'LIMITE_DE_CAMPANA_POR_CLIENTE')
  // El tope de la campaña se comprueba ANTES que el del cupón: es el que manda.
  assert.equal(aplicable({ maxRedemptions: 10 }, { maxRedemptions: 5 }, { usos: { ...sinUsos, totales: 10, deLaCampana: 5 } }), 'CAMPANA_AGOTADA')
})

test('10 · la oferta tiene que participar en la campaña, y la compra mínima se respeta', () => {
  assert.equal(aplicable({}, {}, { ofertaEnCampana: false }), 'OFERTA_FUERA_DE_CAMPANA')
  assert.equal(aplicable({ minPurchase: D(1500) }, {}, { importeDeLinea: D(1000) }), 'COMPRA_MINIMA')
  assert.equal(aplicable({ minPurchase: D(1000) }, {}, { importeDeLinea: D(1000) }), null)
})

test('11 · estado del cupón derivado de sus usos y su vencimiento', () => {
  assert.equal(estadoCuponSegunUsos({ status: 'ACTIVE', maxRedemptions: 2, timesRedeemed: 1, expiresAt: null }, AHORA), 'ACTIVE')
  assert.equal(estadoCuponSegunUsos({ status: 'ACTIVE', maxRedemptions: 2, timesRedeemed: 2, expiresAt: null }, AHORA), 'EXHAUSTED')
  assert.equal(estadoCuponSegunUsos({ status: 'ACTIVE', maxRedemptions: null, timesRedeemed: 99, expiresAt: null }, AHORA), 'ACTIVE')
  assert.equal(estadoCuponSegunUsos({ status: 'ACTIVE', maxRedemptions: 2, timesRedeemed: 0, expiresAt: new Date('2026-06-01T00:00:00.000Z') }, AHORA), 'EXPIRED')
  assert.equal(estadoCuponSegunUsos({ status: 'CANCELLED', maxRedemptions: null, timesRedeemed: 0, expiresAt: null }, AHORA), 'CANCELLED')
})

test('12 · los códigos aleatorios no se adivinan: alfabeto sin ambigüedades y suficiente entropía', () => {
  const bytes = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) % 256)
  const c = codigoAleatorio(bytes, 10)
  assert.equal(c.length, 10)
  assert.ok(/^[ACDEFGHJKMNPQRTVWXY34679]+$/.test(c), `alfabeto inesperado: ${c}`)
  // Sin 0/O ni 1/I/L: dictar un código por teléfono no genera errores.
  assert.ok(!/[01OIL]/.test(c))
  // 24^10 ≈ 6,3·10^13 combinaciones: barrerlo a mano no es una estrategia.
  assert.ok(Math.pow(24, 10) > 1e13)
})

// ── 13–16 · Presupuesto y financiación (§15–§17) ────────────────────────────

test('13 · presupuesto agotado: el disponible resta lo reservado y lo consumido de los beneficios', () => {
  const p = presupuestoDeCampana(10_000, [
    { budgetTotal: D(6000), budgetReserved: D(1000), budgetConsumed: D(2000) },
    { budgetTotal: D(4000), budgetReserved: D(0), budgetConsumed: D(3000) },
  ])
  assert.equal(p.comprometido.toFixed(2), '10000.00')
  assert.equal(p.reservado.toFixed(2), '1000.00')
  assert.equal(p.consumido.toFixed(2), '5000.00')
  assert.equal(p.disponible!.toFixed(2), '4000.00')
  assert.equal(p.algunBeneficioSinTope, false)
})

test('14 · el presupuesto de la campaña no se cuenta dos veces: sale de sus promociones', () => {
  // Una campaña con techo no admite promociones sin tope…
  const conTecho = presupuestoDeCampana(10_000, [{ budgetTotal: D(6000), budgetReserved: D(0), budgetConsumed: D(0) }])
  assert.match(cabeEnElPresupuesto(conTecho, null)!, /no pueden ir sin tope/)
  // …ni que la suma de sus techos pase del aprobado.
  assert.match(cabeEnElPresupuesto(conTecho, 5000)!, /sumarían 11000.00/)
  assert.equal(cabeEnElPresupuesto(conTecho, 4000), null)
  // Sin techo aprobado no hay nada que validar, y se marca como riesgo.
  const sinTecho = presupuestoDeCampana(null, [{ budgetTotal: null, budgetReserved: D(0), budgetConsumed: D(0) }])
  assert.equal(cabeEnElPresupuesto(sinTecho, null), null)
  assert.equal(sinTecho.algunBeneficioSinTope, true)
  assert.equal(sinTecho.disponible, null)
})

test('15 · una campaña que financia Membego exige techo, salvo autorización escrita (§17)', () => {
  assert.equal(validarCampana(datosCampana()), null)
  assert.match(validarCampana(datosCampana({ budgetTotal: null }))!, /necesita un presupuesto máximo/)
  assert.equal(validarCampana(datosCampana({ budgetTotal: null, budgetWaiverReason: 'Autorizado por finanzas el 1/10' })), null)
  // Si la financia el proveedor, no hay presupuesto de Membego que topar.
  assert.equal(validarCampana(datosCampana({ funding: 'SUPPLIER', supplierId: 'sp1', budgetTotal: null })), null)
  assert.match(validarCampana(datosCampana({ funding: 'SUPPLIER', supplierId: 'sp1', budgetTotal: 5000 }))!, /no consume presupuesto/)
})

test('16 · financiación de Membego, del proveedor y compartida, con el reparto del Slice 6', () => {
  // Membego: el valor contractual no cambia y el proveedor cobra igual.
  const soloMembego = calcularRepartoLinea({ saleUnitPrice: D(1000), quantity: 1, beneficio: { funding: 'MEMBEGO', valueType: 'FIXED_AMOUNT', membegoValue: D(300), supplierValue: D(0) }, sourceType: 'COMMISSION', commissionPercentage: D(8) })
  assert.deepEqual([soloMembego.contractualSaleValue.toFixed(2), soloMembego.customerPayable.toFixed(2), soloMembego.commissionAmount.toFixed(2), soloMembego.supplierNet.toFixed(2)], ['1000.00', '700.00', '80.00', '920.00'])
  // Proveedor: baja el valor contractual y con él la comisión.
  const soloProveedor = calcularRepartoLinea({ saleUnitPrice: D(1000), quantity: 1, beneficio: { funding: 'SUPPLIER', valueType: 'FIXED_AMOUNT', membegoValue: D(0), supplierValue: D(100) }, sourceType: 'COMMISSION', commissionPercentage: D(8) })
  assert.deepEqual([soloProveedor.contractualSaleValue.toFixed(2), soloProveedor.customerPayable.toFixed(2), soloProveedor.commissionAmount.toFixed(2), soloProveedor.supplierNet.toFixed(2)], ['900.00', '900.00', '72.00', '828.00'])
})

test('17 · EL CASO DEL ENUNCIADO: 1 000 − 100 (proveedor) − 300 (Membego) → paga 600, comisión 72, neto 828', () => {
  const r = calcularRepartoLinea({
    saleUnitPrice: D(1000),
    quantity: 1,
    beneficio: { funding: 'SHARED', valueType: 'FIXED_AMOUNT', membegoValue: D(300), supplierValue: D(100) },
    sourceType: 'COMMISSION',
    commissionPercentage: D(8),
  })
  assert.equal(r.gmv.toFixed(2), '1000.00')
  assert.equal(r.supplierDiscount.toFixed(2), '100.00')
  assert.equal(r.contractualSaleValue.toFixed(2), '900.00')
  assert.equal(r.membegoSubsidy.toFixed(2), '300.00')
  assert.equal(r.customerPayable.toFixed(2), '600.00')
  assert.equal(r.commissionAmount.toFixed(2), '72.00')
  assert.equal(r.supplierNet.toFixed(2), '828.00')
  // La comisión NO se calcula sobre los 600 salvo que el acuerdo lo diga.
  assert.notEqual(r.commissionAmount.toFixed(2), '48.00')
  const sobrePagado = calcularRepartoLinea({
    saleUnitPrice: D(1000),
    quantity: 1,
    beneficio: { funding: 'SHARED', valueType: 'FIXED_AMOUNT', membegoValue: D(300), supplierValue: D(100) },
    sourceType: 'COMMISSION',
    commissionPercentage: D(8),
    commissionBase: 'CUSTOMER_PAID_AMOUNT',
  })
  assert.equal(sobrePagado.commissionAmount.toFixed(2), '48.00', 'solo con esa base expresa en el acuerdo')
})

// ── 18–20 · Público, atribución y analítica (§13, §24–§25) ──────────────────

test('18 · público objetivo: nuevos, recurrentes, de campaña y lista seleccionada', () => {
  assert.equal(fueraDePublico('ALL', historialBase({ comprasPagadas: 7 })), null)
  assert.equal(fueraDePublico('NEW_CUSTOMERS', historialBase()), null)
  assert.equal(fueraDePublico('NEW_CUSTOMERS', historialBase({ comprasPagadas: 1 })), 'SOLO_CLIENTES_NUEVOS')
  assert.equal(fueraDePublico('RETURNING_CUSTOMERS', historialBase()), 'SOLO_CLIENTES_CON_COMPRAS')
  assert.equal(fueraDePublico('RETURNING_CUSTOMERS', historialBase({ comprasPagadas: 2 })), null)
  assert.equal(fueraDePublico('PAST_CAMPAIGN', historialBase()), 'SOLO_CLIENTES_DE_CAMPANA')
  assert.equal(fueraDePublico('PAST_CAMPAIGN', historialBase({ beneficiosDeCampanaUsados: 1 })), null)
  assert.equal(fueraDePublico('SELECTED', historialBase()), 'SOLO_LISTA_SELECCIONADA')
  assert.equal(fueraDePublico('SELECTED', historialBase({ asignadoAEstaCampana: true })), null)
  // Y el cupón respeta el público de su campaña.
  assert.equal(aplicable({}, { audience: 'NEW_CUSTOMERS' }, { historial: historialBase({ comprasPagadas: 3 }) }), 'FUERA_DE_PUBLICO')
})

test('19 · atribución determinista: una oferta en varias campañas elige UNA, siempre la misma', () => {
  const candidatas = [
    { campaignId: 'b', campaignCode: 'MBG-CP-2026-000002', startsAt: new Date('2026-06-05T00:00:00.000Z'), beneficio: D(300) },
    { campaignId: 'a', campaignCode: 'MBG-CP-2026-000001', startsAt: new Date('2026-06-01T00:00:00.000Z'), beneficio: D(500) },
    { campaignId: 'c', campaignCode: 'MBG-CP-2026-000003', startsAt: new Date('2026-06-02T00:00:00.000Z'), beneficio: D(500) },
  ]
  // La que más rebaja; con empate, la que empezó antes.
  assert.equal(campanaAtribuida(candidatas)!.campaignId, 'a')
  assert.equal(campanaAtribuida([...candidatas].reverse())!.campaignId, 'a', 'el orden de entrada no cambia el resultado')
  // Empate total en valor y fecha: decide el código, para que no haya azar.
  const mismaFecha = new Date('2026-06-01T00:00:00.000Z')
  const empate = [
    { campaignId: 'z', campaignCode: 'MBG-CP-2026-000009', startsAt: mismaFecha, beneficio: D(500) },
    { campaignId: 'y', campaignCode: 'MBG-CP-2026-000004', startsAt: mismaFecha, beneficio: D(500) },
  ]
  assert.equal(campanaAtribuida(empate)!.campaignId, 'y')
  assert.equal(campanaAtribuida([]), null)
})

test('20 · analítica: un pedido cuenta UNA vez, solo los pagados son ventas y la visita no es venta', () => {
  const venta = (id: string, status: VentaDeCampana['status']): VentaDeCampana => ({
    orderId: id,
    status,
    gmv: D(1000),
    contractualValue: D(900),
    supplierDiscount: D(100),
    membegoSubsidy: D(300),
    customerPaid: D(600),
    commission: D(72),
    supplierNet: D(828),
    derechosEmitidos: 1,
    derechosRedimidos: 1,
    derechosVencidos: 0,
  })
  const m = metricasDeCampana([venta('o1', 'PAID'), venta('o1', 'PAID'), venta('o2', 'PENDING'), venta('o3', 'CANCELLED'), venta('o4', 'PAID')])
  assert.equal(m.pedidos, 4, 'el pedido repetido no se cuenta dos veces')
  assert.equal(m.ventasConfirmadas, 2)
  assert.equal(m.pedidosEnCurso, 1, 'una reserva en curso se informa aparte, no como venta')
  assert.equal(m.gmv.toFixed(2), '2000.00', 'solo el GMV de las pagadas')
  assert.equal(m.contractualValue.toFixed(2), '1800.00')
  assert.equal(m.aportacionProveedor.toFixed(2), '200.00')
  assert.equal(m.subsidioMembego.toFixed(2), '600.00')
  assert.equal(m.costoPromocional.toFixed(2), '600.00')
  assert.equal(m.cobradoAlCliente.toFixed(2), '1200.00')
  assert.equal(m.comision.toFixed(2), '144.00')
  assert.equal(m.netoProveedor.toFixed(2), '1656.00')
  assert.equal(m.derechosEmitidos, 2)
  assert.equal(m.contribucionTrasSubsidio.toFixed(2), '-456.00', 'comisión 144 − subsidio 600')
})

// ── 21–26 · Ciclo de vida, cupón obligatorio, idempotencia y permisos ───────

test('21 · estados de la campaña: borrador → revisión → programada/activa → pausada; cerrada es final', () => {
  assert.ok(puedeTransicionar(TRANSICIONES_CAMPANA, 'DRAFT', 'PENDING_APPROVAL'))
  assert.ok(puedeTransicionar(TRANSICIONES_CAMPANA, 'PENDING_APPROVAL', 'SCHEDULED'))
  assert.ok(puedeTransicionar(TRANSICIONES_CAMPANA, 'PENDING_APPROVAL', 'DRAFT'), 'se puede devolver a borrador')
  assert.ok(puedeTransicionar(TRANSICIONES_CAMPANA, 'ACTIVE', 'PAUSED'))
  assert.ok(puedeTransicionar(TRANSICIONES_CAMPANA, 'PAUSED', 'ACTIVE'))
  assert.ok(!puedeTransicionar(TRANSICIONES_CAMPANA, 'DRAFT', 'ACTIVE'), 'no se publica sin pasar por revisión')
  assert.ok(!puedeTransicionar(TRANSICIONES_CAMPANA, 'COMPLETED', 'ACTIVE'))
  assert.ok(!puedeTransicionar(TRANSICIONES_CAMPANA, 'CANCELLED', 'ACTIVE'))
})

test('22 · una promoción de cupón NO se abre mandando el id del beneficio (§9, §28)', () => {
  const beneficio = (p: Partial<BeneficioParaElegibilidad> = {}): BeneficioParaElegibilidad => ({
    id: 'b1',
    status: 'ACTIVE',
    funding: 'MEMBEGO',
    scope: 'SPECIFIC_OFFER',
    offerId: 'of1',
    catalogItemId: null,
    supplierId: null,
    currency: 'DOP',
    startsAt: new Date('2026-06-01T00:00:00.000Z'),
    endsAt: null,
    requiresAssignment: false,
    requiresCoupon: true,
    perCustomerLimit: 1,
    budgetTotal: D(10_000),
    budgetReserved: D(0),
    budgetConsumed: D(0),
    ...p,
  })
  const oferta: OfertaParaElegibilidad = { id: 'of1', catalogItemId: 'ci1', supplierId: 'sp1', sourceType: 'COMMISSION', currency: 'DOP' }
  // Sin cupón: se para aquí, así el código sí protege algo.
  assert.equal(motivoNoElegible(beneficio(), oferta, 'cli1', null, 0, D(300), AHORA, false), 'EXIGE_CUPON')
  // Con el cupón ya validado por quien llama: pasa.
  assert.equal(motivoNoElegible(beneficio(), oferta, 'cli1', null, 0, D(300), AHORA, true), null)
  // Una promoción sin código no cambia de comportamiento.
  assert.equal(motivoNoElegible(beneficio({ requiresCoupon: false }), oferta, 'cli1', null, 0, D(300), AHORA, false), null)
})

test('23 · quien crea la campaña TAMBIÉN la aprueba, y queda marcado', () => {
  assert.equal(esAutoaprobacion('u1', 'u1'), true)
  assert.equal(esAutoaprobacion('u1', 'u2'), false)
})

test('24 · validación de la campaña: nombre, proveedor, vigencia, horario y límites', () => {
  assert.match(validarCampana(datosCampana({ name: '  ' }))!, /necesita un nombre/)
  assert.match(validarCampana(datosCampana({ organizer: 'SUPPLIER' }))!, /proveedor que la propone/)
  assert.match(validarCampana(datosCampana({ funding: 'SHARED' }))!, /qué proveedor/)
  assert.match(validarCampana(datosCampana({ endsAt: new Date('2026-05-01T00:00:00.000Z') }))!, /posterior al inicio/)
  assert.match(validarCampana(datosCampana({ activeFromMinute: 600 }))!, /van juntas/)
  assert.match(validarCampana(datosCampana({ activeFromMinute: 600, activeToMinute: 600 }))!, /posterior a la de activación/)
  assert.match(validarCampana(datosCampana({ activeFromMinute: -1, activeToMinute: 600 }))!, /dentro del día/)
  assert.match(validarCampana(datosCampana({ maxPerCustomer: 0 }))!, /entero positivo/)
  assert.match(validarCampana(datosCampana({ maxRedemptions: -5 }))!, /entero positivo/)
  assert.equal(validarCampana(datosCampana({ activeFromMinute: 18 * 60, activeToMinute: 23 * 60 })), null)
})

test('25 · un cupón no se aplica si su campaña no está activa, aunque el cupón esté perfecto', () => {
  assert.equal(aplicable({}, { status: 'PAUSED' }), 'CAMPANA_NO_ACTIVA')
  assert.equal(aplicable({}, { status: 'DRAFT' }), 'CAMPANA_NO_ACTIVA')
  assert.equal(aplicable({}, { status: 'CANCELLED' }), 'CAMPANA_NO_ACTIVA')
  assert.equal(aplicable({}, { status: 'COMPLETED' }), 'CAMPANA_NO_ACTIVA')
})

test('26 · los siete permisos de campañas existen y están separados (§27)', () => {
  for (const p of [
    'SUPPLY_V2_CAMPAIGN_VIEW',
    'SUPPLY_V2_CAMPAIGN_CREATE',
    'SUPPLY_V2_CAMPAIGN_APPROVE',
    'SUPPLY_V2_CAMPAIGN_PUBLISH',
    'SUPPLY_V2_COUPON_MANAGE',
    'SUPPLY_V2_CAMPAIGN_FINANCE_VIEW',
    'SUPPLY_V2_CAMPAIGN_REPORT_VIEW',
  ] as const) {
    assert.ok(SUPPLY_V2_PERMISSIONS.includes(p), `falta ${p}`)
  }
})

test('27 · compatibilidad: sin promoción el reparto es el de siempre, en precompra y a comisión', () => {
  const comision = calcularRepartoLinea({ saleUnitPrice: D(1000), quantity: 1, sourceType: 'COMMISSION', commissionPercentage: D(8) })
  assert.deepEqual([comision.contractualSaleValue.toFixed(2), comision.customerPayable.toFixed(2), comision.commissionAmount.toFixed(2), comision.supplierNet.toFixed(2)], ['1000.00', '1000.00', '80.00', '920.00'])
  const prepago = calcularRepartoLinea({ saleUnitPrice: D(500), quantity: 2, sourceType: 'PREPURCHASED_SUPPLY' })
  assert.deepEqual([prepago.contractualSaleValue.toFixed(2), prepago.customerPayable.toFixed(2), prepago.commissionAmount.toFixed(2)], ['1000.00', '1000.00', '0.00'])
  assert.equal(prepago.benefitApplied.toFixed(2), '0.00')
})

test('28 · una compra con campaña no duplica el GMV aunque la oferta esté en dos campañas', () => {
  // La atribución elige una campaña, y la analítica suma por pedido: el mismo
  // pedido en la lista de dos campañas seguiría contando una vez en cada una,
  // pero la atribución CONGELADA impide que esté en las dos.
  const elegida = campanaAtribuida([
    { campaignId: 'a', campaignCode: 'MBG-CP-2026-000001', startsAt: new Date('2026-06-01T00:00:00.000Z'), beneficio: D(400) },
    { campaignId: 'b', campaignCode: 'MBG-CP-2026-000002', startsAt: new Date('2026-06-01T00:00:00.000Z'), beneficio: D(200) },
  ])!
  assert.equal(elegida.campaignId, 'a')
  const m = metricasDeCampana([
    {
      orderId: 'o1',
      status: 'PAID',
      gmv: D(1000),
      contractualValue: D(1000),
      supplierDiscount: D(0),
      membegoSubsidy: D(400),
      customerPaid: D(600),
      commission: D(80),
      supplierNet: D(920),
      derechosEmitidos: 1,
      derechosRedimidos: 0,
      derechosVencidos: 0,
    },
  ])
  assert.equal(m.ventasConfirmadas, 1)
  assert.equal(m.gmv.toFixed(2), '1000.00')
})
