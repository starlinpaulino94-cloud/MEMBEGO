/**
 * MEMBEGO SUPPLY · pruebas de UNIT ECONOMICS (Fases 35-38, 61, 62).
 * Ejecutar: npm test
 *
 * La propiedad que estas pruebas defienden es UNA, y es la que hace que todos
 * los números de arriba signifiquen algo:
 *
 *     EMITIDO ≠ REDIMIDO
 *
 * Una unidad emitida es una promesa; solo la redimida costó dinero. Contar
 * vouchers como gasto infla el costo de toda campaña y hace que regalar
 * parezca más caro de lo que es — justo la decisión que estos números tienen
 * que informar.
 *
 * Los ejemplos son los del prompt: pizza de RD$700 comprada a RD$300, campaña
 * de bienvenida de 200 unidades con 173 emitidas y 128 redimidas.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  costosDeLote,
  desglosarSubsidio,
  economiaCampana,
  economiaUnidad,
  ltvVsCac,
  metricasAdquisicion,
  scorecard,
} from '../src/modules/supply/economia'
import { saldoDeAsientos, type AsientoLedger } from '../src/modules/supply/ledger'
import {
  GRAVEDAD_HALLAZGO,
  HALLAZGO_LABELS,
  TIPOS_HALLAZGO,
} from '../src/modules/supply/hallazgos'

// ── Costos separados (Fase 62) ──────────────────────────────────────────────

test('el costo de un lote se reparte entre las cubetas y suma el contrato', () => {
  const asientos: AsientoLedger[] = [
    { tipo: 'COMPRA', origen: null, destino: 'DISPONIBLE', cantidad: 1000 },
    { tipo: 'ASIGNACION', origen: 'DISPONIBLE', destino: 'ASIGNADO', cantidad: 200 },
    { tipo: 'EMISION', origen: 'ASIGNADO', destino: 'EMITIDO', cantidad: 173 },
    { tipo: 'REDENCION', origen: 'EMITIDO', destino: 'REDIMIDO', cantidad: 128 },
  ]
  const c = costosDeLote(saldoDeAsientos(asientos), 300)

  assert.equal(c.contratado, 300_000)
  assert.equal(c.consumido, 128 * 300, 'solo lo redimido es gasto real')
  assert.equal(c.expuesto, 45 * 300, 'los 45 vouchers sin canjear son obligación viva')
  assert.equal(c.asignado, 27 * 300)
  assert.equal(c.disponible, 800 * 300)
  assert.equal(
    c.disponible + c.asignado + c.retenido + c.expuesto + c.consumido + c.cerrado,
    c.contratado
  )
})

// ── Economía por unidad (Fase 35) ───────────────────────────────────────────

test('una pizza REGALADA cuesta RD$300 de adquisición y no tiene margen', () => {
  const e = economiaUnidad(300, 0, 700)
  assert.equal(e.costoAdquisicion, 300)
  assert.equal(e.ingresoCliente, 0)
  assert.equal(e.margenBruto, -300)
  assert.equal(e.cac, 300, 'un regalo es costo de adquisición, no pérdida')
})

test('una pizza VENDIDA a RD$399 deja RD$99 de margen y CAC cero', () => {
  const e = economiaUnidad(300, 399, 700)
  assert.equal(e.margenBruto, 99)
  assert.equal(e.cac, 0, 'una venta con margen no es costo de adquisición')
  assert.equal(e.descuentoPorcentaje, 57.1, 'RD$300 sobre RD$700 es un 57% de descuento')
})

// ── Economía de campaña (Fase 36) ───────────────────────────────────────────

test('la campaña del ejemplo cuadra con las cifras del prompt', () => {
  const eco = economiaCampana({
    asignadas: 200,
    emitidas: 173,
    liberadas: 0,
    redimidas: 128,
    costoUnitario: 300,
  })
  assert.equal(eco.porEmitir, 27)
  assert.equal(eco.activasSinCanjear, 45)
  assert.equal(eco.costoConsumido, 38_400, 'RD$38.400 es lo que de verdad se gastó')
  assert.equal(eco.costoExpuesto, 13_500)
  assert.equal(eco.costoComprometido, 8_100)
  assert.equal(eco.tasaRedencion, 74)
})

test('una campaña que emitió y no redimió nada todavía no costó nada', () => {
  const eco = economiaCampana({
    asignadas: 200,
    emitidas: 100,
    liberadas: 0,
    redimidas: 0,
    costoUnitario: 300,
  })
  assert.equal(eco.costoConsumido, 0, 'entregar 100 vouchers no es entregar 100 pizzas')
  assert.equal(eco.costoExpuesto, 30_000)
  assert.equal(eco.tasaRedencion, 0)
})

test('liberar unidades devuelve cupo sin cambiar el gasto', () => {
  const eco = economiaCampana({
    asignadas: 200,
    emitidas: 50,
    liberadas: 100,
    redimidas: 40,
    costoUnitario: 300,
  })
  assert.equal(eco.porEmitir, 50)
  assert.equal(eco.costoConsumido, 12_000)
})

// ── Subsidio ≠ compra completa (Fase 24) ────────────────────────────────────

test('un subsidio se desglosa en las tres cifras del contrato', () => {
  const d = desglosarSubsidio('SUBSIDIO', 700, 300)
  assert.equal(d.aporteMembego, 300)
  assert.equal(d.aporteCliente, 400, 'el cliente le paga RD$400 AL COMERCIO')
  assert.equal(d.porCobrarComercio, 700)
})

test('desglosar una compra completa como subsidio es un error', () => {
  assert.throws(
    () => desglosarSubsidio('COMPRA_UNIDAD_COMPLETA', 700, 300),
    /no paga la unidad base/
  )
})

// ── Adquisición (Fase 37) ───────────────────────────────────────────────────

test('el CAC se da por cliente alcanzado Y por cliente activado', () => {
  const m = metricasAdquisicion({
    clientesAlcanzados: 173,
    clientesQueRedimieron: 128,
    costoConsumido: 38_400,
  })
  assert.equal(m.costoPorCliente, 221.97)
  assert.equal(m.costoPorClienteActivado, 300, 'el que se paga de verdad')
  assert.equal(m.tasaActivacion, 74)
})

test('una campaña sin nadie activado no divide entre cero', () => {
  const m = metricasAdquisicion({
    clientesAlcanzados: 50,
    clientesQueRedimieron: 0,
    costoConsumido: 0,
  })
  assert.equal(m.costoPorClienteActivado, 0)
  assert.equal(m.tasaActivacion, 0)
})

// ── LTV vs CAC (Fase 38) ────────────────────────────────────────────────────

test('LTV y CAC salen de datos registrados, sin proyecciones', () => {
  const r = ltvVsCac({ costoAdquisicionTotal: 38_400, clientes: 128, gmvPosterior: 140_000 })
  assert.equal(r.cac, 300)
  assert.equal(r.ltvPorCliente, 1093.75)
  assert.equal(r.multiplo, 3.65)
})

test('sin clientes no se inventa un múltiplo', () => {
  const r = ltvVsCac({ costoAdquisicionTotal: 0, clientes: 0, gmvPosterior: 0 })
  assert.equal(r.multiplo, null)
})

// ── Scorecard de proveedor (Fase 31) ────────────────────────────────────────

test('un proveedor que cumple casi todo puntúa alto', () => {
  const s = scorecard({
    contratadas: 1000,
    emitidas: 412,
    redimidas: 384,
    reversadas: 2,
    incidencias: 5,
    incumplimientos: 1,
  })
  assert.equal(s.tasaCumplimiento, 93.2)
  assert.ok(s.puntaje > 85, `puntaje ${s.puntaje} debería ser alto`)
})

test('las reversas y los incumplimientos pesan más que el volumen', () => {
  const malo = scorecard({
    contratadas: 1000,
    emitidas: 400,
    redimidas: 300,
    reversadas: 60,
    incidencias: 90,
    incumplimientos: 60,
  })
  assert.ok(malo.puntaje < 40, `puntaje ${malo.puntaje} debería ser bajo`)
  assert.ok(malo.puntaje >= 0, 'el puntaje nunca baja de 0')
})

test('un proveedor sin entregas todavía no es ni bueno ni malo', () => {
  const nuevo = scorecard({
    contratadas: 1000,
    emitidas: 0,
    redimidas: 0,
    reversadas: 0,
    incidencias: 0,
    incumplimientos: 0,
  })
  assert.equal(nuevo.puntaje, 100, 'darle 0 lo dejaría fuera por no haber tenido una primera vez')
})

// ── Conciliación: catálogo de hallazgos (Fase 32) ───────────────────────────

test('todo hallazgo tiene etiqueta y gravedad', () => {
  for (const t of TIPOS_HALLAZGO) {
    assert.ok(HALLAZGO_LABELS[t], `falta etiqueta de ${t}`)
    assert.ok(GRAVEDAD_HALLAZGO[t], `falta gravedad de ${t}`)
  }
})

test('lo que invalida las cifras es CRÍTICO', () => {
  // Si el ledger no cuadra o una unidad se entregó dos veces, nada de lo que
  // hay encima —reportes, liquidaciones, unit economics— se puede creer.
  for (const t of ['INVARIANTE_ROTO', 'CUBETA_NEGATIVA', 'REDENCION_DUPLICADA', 'ASIENTO_FALTANTE'] as const) {
    assert.equal(GRAVEDAD_HALLAZGO[t], 'CRITICA', `${t} debería ser crítico`)
  }
})
