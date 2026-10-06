/**
 * MEMBEGO SUPPLY · pruebas de PROCUREMENT (contrato → orden → lote).
 * Ejecutar: npm test
 *
 * Lo que se protege aquí es la parte que mueve dinero:
 *
 *   · las máquinas de estado no tienen atajos (no se pasa de BORRADOR a
 *     ACTIVA sin aprobar ni confirmar);
 *   · un contrato mal formado se rechaza ANTES de existir, y con un mensaje
 *     que dice qué falta;
 *   · la distinción compra completa / subsidio se sostiene en las reglas, no
 *     solo en la documentación;
 *   · los códigos legibles son estables y las credenciales al portador no son
 *     adivinables.
 *
 * PURO: sin base de datos.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  LOTE_PUEDE_EMITIR,
  ORDEN_PUEDE_GENERAR_LOTE,
  TRANSICIONES_ACUERDO,
  TRANSICIONES_DERECHO,
  TRANSICIONES_INCIDENCIA,
  TRANSICIONES_LOTE,
  TRANSICIONES_ORDEN,
  TRANSICIONES_VOUCHER,
  esTerminal,
  exigirTransicion,
  puedeTransicionar,
  type Transiciones,
} from '../src/modules/supply/estados'
import { validarAcuerdo, type DatosAcuerdo } from '../src/modules/supply/contrato'
import {
  claveIdempotencia,
  codigoAcuerdo,
  codigoLote,
  numeroOrden,
  nuevoCodigoVoucher,
  nuevoNonceQr,
  siglaProveedor,
} from '../src/modules/supply/codigos'
import {
  SUPPLY_ACUERDO_ESTADO_LABELS,
  SUPPLY_DERECHO_ESTADO_LABELS,
  SUPPLY_LOTE_ESTADO_LABELS,
  SUPPLY_MODELO_EXPLICACION,
  SUPPLY_ORDEN_ESTADO_LABELS,
  SUPPLY_TIPOS,
  SUPPLY_TIPO_LABELS,
  clientePagaAlComercio,
  esDestino,
  ORIGEN_POR_DESTINO,
  SUPPLY_DESTINOS,
  nivelRiesgoVencimiento,
  usaCapacidad,
} from '../src/modules/supply/catalogo'

// ── Integridad de las máquinas de estado ────────────────────────────────────

const MAQUINAS: [string, Transiciones<string>][] = [
  ['acuerdo', TRANSICIONES_ACUERDO as Transiciones<string>],
  ['orden', TRANSICIONES_ORDEN as Transiciones<string>],
  ['lote', TRANSICIONES_LOTE as Transiciones<string>],
  ['derecho', TRANSICIONES_DERECHO as Transiciones<string>],
  ['voucher', TRANSICIONES_VOUCHER as Transiciones<string>],
  ['incidencia', TRANSICIONES_INCIDENCIA as Transiciones<string>],
]

test('ninguna máquina de estados apunta a un estado que no existe', () => {
  for (const [nombre, tabla] of MAQUINAS) {
    const conocidos = new Set(Object.keys(tabla))
    for (const [desde, destinos] of Object.entries(tabla)) {
      for (const hasta of destinos) {
        assert.ok(conocidos.has(hasta), `${nombre}: ${desde} → ${hasta} no es un estado válido`)
        assert.notEqual(hasta, desde, `${nombre}: ${desde} no debería transicionar a sí mismo`)
      }
    }
  }
})

test('toda máquina tiene al menos un estado terminal (nada gira para siempre)', () => {
  for (const [nombre, tabla] of MAQUINAS) {
    const terminales = Object.keys(tabla).filter((e) => esTerminal(tabla, e))
    assert.ok(terminales.length > 0, `${nombre} no tiene ningún estado terminal`)
  }
})

test('todo estado tiene etiqueta legible', () => {
  for (const e of Object.keys(TRANSICIONES_ACUERDO)) {
    assert.ok(SUPPLY_ACUERDO_ESTADO_LABELS[e as keyof typeof SUPPLY_ACUERDO_ESTADO_LABELS])
  }
  for (const e of Object.keys(TRANSICIONES_ORDEN)) {
    assert.ok(SUPPLY_ORDEN_ESTADO_LABELS[e as keyof typeof SUPPLY_ORDEN_ESTADO_LABELS])
  }
  for (const e of Object.keys(TRANSICIONES_LOTE)) {
    assert.ok(SUPPLY_LOTE_ESTADO_LABELS[e as keyof typeof SUPPLY_LOTE_ESTADO_LABELS])
  }
  for (const e of Object.keys(TRANSICIONES_DERECHO)) {
    assert.ok(SUPPLY_DERECHO_ESTADO_LABELS[e as keyof typeof SUPPLY_DERECHO_ESTADO_LABELS])
  }
})

// ── Sin atajos en la compra ─────────────────────────────────────────────────

test('una orden NO pasa de borrador a activa sin aprobar y confirmar', () => {
  assert.equal(puedeTransicionar(TRANSICIONES_ORDEN, 'BORRADOR', 'ACTIVA'), false)
  assert.equal(puedeTransicionar(TRANSICIONES_ORDEN, 'BORRADOR', 'APROBADA'), false)
  assert.equal(puedeTransicionar(TRANSICIONES_ORDEN, 'PENDIENTE_APROBACION', 'APROBADA'), true)
  assert.equal(puedeTransicionar(TRANSICIONES_ORDEN, 'APROBADA', 'CONFIRMADA'), true)
  assert.equal(puedeTransicionar(TRANSICIONES_ORDEN, 'CONFIRMADA', 'ACTIVA'), true)
})

test('una orden cancelada o completada ya no se mueve', () => {
  assert.equal(esTerminal(TRANSICIONES_ORDEN, 'CANCELADA'), true)
  assert.equal(esTerminal(TRANSICIONES_ORDEN, 'COMPLETADA'), true)
})

test('PAGO_POR_REDENCION puede entregar sin fondeo previo', () => {
  // Si generar lote exigiera FONDEADA, la modalidad "el proveedor cobra cuando
  // alguien consume" sería imposible de implementar.
  assert.ok(ORDEN_PUEDE_GENERAR_LOTE.includes('CONFIRMADA'))
  assert.ok(!ORDEN_PUEDE_GENERAR_LOTE.includes('BORRADOR'))
  assert.ok(!ORDEN_PUEDE_GENERAR_LOTE.includes('PENDIENTE_APROBACION'))
  assert.ok(!ORDEN_PUEDE_GENERAR_LOTE.includes('APROBADA'))
})

test('un lote agotado puede volver a ACTIVO tras una reversa', () => {
  assert.equal(puedeTransicionar(TRANSICIONES_LOTE, 'AGOTADO', 'ACTIVO'), true)
  assert.deepEqual([...LOTE_PUEDE_EMITIR], ['ACTIVO'])
})

test('un derecho redimido solo vuelve por una reversa', () => {
  assert.deepEqual([...TRANSICIONES_DERECHO.REDIMIDO], ['ACTIVO'])
  assert.deepEqual([...TRANSICIONES_VOUCHER.REDIMIDO], ['ACTIVO'])
})

test('un derecho retenido (hold) nunca se redime directamente', () => {
  assert.equal(puedeTransicionar(TRANSICIONES_DERECHO, 'RETENIDO', 'REDIMIDO'), false)
  assert.equal(puedeTransicionar(TRANSICIONES_DERECHO, 'RETENIDO', 'ACTIVO'), true)
})

test('exigirTransicion nombra los dos estados en el error', () => {
  assert.throws(
    () => exigirTransicion(TRANSICIONES_ORDEN, 'BORRADOR', 'ACTIVA', 'Orden de supply'),
    /Orden de supply: no se puede pasar de BORRADOR a ACTIVA/
  )
})

// ── Validación del contrato ─────────────────────────────────────────────────

function acuerdoBase(): DatosAcuerdo {
  return {
    proveedorId: 'c_litre',
    tipo: 'ON_DEMAND',
    modeloComercial: 'COMPRA_UNIDAD_COMPLETA',
    modalidadPago: 'PREPAGO_TOTAL',
    politicaSobrante: 'EXPIRAR',
    itemNombre: 'Pizza Grande Pepperoni',
    cantidad: 1000,
    costoUnitario: 300,
    precioReferencia: 700,
    inicioAt: new Date('2026-10-01'),
    finAt: new Date('2026-12-31'),
  }
}

test('el contrato del ejemplo (1.000 pizzas a RD$300) es válido', () => {
  assert.equal(validarAcuerdo(acuerdoBase()), null)
})

test('un contrato sin cantidad entera positiva se rechaza', () => {
  for (const cantidad of [0, -1, 2.5]) {
    assert.notEqual(validarAcuerdo({ ...acuerdoBase(), cantidad }), null)
  }
})

test('una vigencia que termina antes de empezar se rechaza', () => {
  const d = { ...acuerdoBase(), inicioAt: new Date('2026-12-31'), finAt: new Date('2026-10-01') }
  assert.match(validarAcuerdo(d) ?? '', /vigencia/i)
})

test('un SUBSIDIO sin aporte declarado se rechaza', () => {
  const d: DatosAcuerdo = { ...acuerdoBase(), modeloComercial: 'SUBSIDIO', aporteMembego: null }
  assert.match(validarAcuerdo(d) ?? '', /aporta Membego/)
})

test('el aporte de un subsidio no puede superar el precio público', () => {
  const d: DatosAcuerdo = {
    ...acuerdoBase(),
    modeloComercial: 'SUBSIDIO',
    aporteMembego: 900,
    precioReferencia: 700,
  }
  assert.match(validarAcuerdo(d) ?? '', /no puede superar el precio público/)
})

test('un subsidio bien formado (pizza 700, aporte 300) pasa', () => {
  const d: DatosAcuerdo = {
    ...acuerdoBase(),
    modeloComercial: 'SUBSIDIO',
    aporteMembego: 300,
    precioReferencia: 700,
  }
  assert.equal(validarAcuerdo(d), null)
})

test('un anticipo parcial fuera de 1-99% se rechaza', () => {
  for (const pct of [0, 100, -5, 150]) {
    const d: DatosAcuerdo = {
      ...acuerdoBase(),
      modalidadPago: 'PREPAGO_PARCIAL',
      anticipoPorcentaje: pct,
    }
    assert.notEqual(validarAcuerdo(d), null, `${pct}% debería rechazarse`)
  }
  assert.equal(
    validarAcuerdo({ ...acuerdoBase(), modalidadPago: 'PREPAGO_PARCIAL', anticipoPorcentaje: 30 }),
    null
  )
})

test('la capacidad agendada exige cupo diario', () => {
  const d: DatosAcuerdo = { ...acuerdoBase(), tipo: 'CAPACIDAD_AGENDADA', capacidadDiaria: null }
  assert.match(validarAcuerdo(d) ?? '', /cupo diario/)
  assert.equal(validarAcuerdo({ ...d, capacidadDiaria: 20 }), null)
})

// ── Compra completa ≠ subsidio (Fase 24) ────────────────────────────────────

test('en compra completa el cliente NO le paga la unidad base al comercio', () => {
  assert.equal(clientePagaAlComercio('COMPRA_UNIDAD_COMPLETA'), false)
  assert.equal(clientePagaAlComercio('SUBSIDIO'), true)
  assert.match(SUPPLY_MODELO_EXPLICACION.COMPRA_UNIDAD_COMPLETA, /solo los extras/)
})

// ── Una arquitectura, seis industrias (Fase 74) ─────────────────────────────

test('los cuatro tipos de supply tienen etiqueta y ejemplo', () => {
  for (const t of SUPPLY_TIPOS) {
    assert.ok(SUPPLY_TIPO_LABELS[t], `falta etiqueta de ${t}`)
  }
})

test('el stock físico reservado no consume cupo de capacidad', () => {
  // 500 termos apartados no se "preparan": se entregan. Contarlos contra el
  // cupo diario de una cocina no significa nada.
  assert.equal(usaCapacidad('STOCK_RESERVADO'), false)
  assert.equal(usaCapacidad('ON_DEMAND'), true)
  assert.equal(usaCapacidad('CAPACIDAD_SERVICIO'), true)
  assert.equal(usaCapacidad('CAPACIDAD_AGENDADA'), true)
})

// ── Destinos de asignación ──────────────────────────────────────────────────

test('todo destino de asignación sabe qué origen le pone al derecho', () => {
  for (const d of SUPPLY_DESTINOS) {
    assert.ok(ORIGEN_POR_DESTINO[d], `falta ORIGEN_POR_DESTINO[${d}]`)
    assert.equal(esDestino(d), true)
  }
  assert.equal(esDestino('LO_QUE_SEA'), false)
})

// ── Códigos ─────────────────────────────────────────────────────────────────

test('la sigla del proveedor sobrevive a acentos y espacios', () => {
  assert.equal(siglaProveedor('Litré Pizza'), 'LITRE')
  assert.equal(siglaProveedor('Café  del  Sur'), 'CAFED')
  assert.equal(siglaProveedor('!!!'), 'PROV')
})

test('el código de acuerdo tiene el formato del ejemplo', () => {
  assert.equal(codigoAcuerdo('Litre Pizza', 2026, 1), 'MBG-LITRE-2026-001')
  assert.equal(numeroOrden(127), 'MBG-PO-000127')
})

test('el primer lote de un acuerdo no lleva sufijo; el segundo sí', () => {
  assert.equal(codigoLote('MBG-LITRE-2026-001', 1), 'MBG-LITRE-2026-001')
  assert.equal(codigoLote('MBG-LITRE-2026-001', 2), 'MBG-LITRE-2026-001-L2')
})

test('las credenciales al portador no son adivinables ni se repiten', () => {
  const codigos = new Set<string>()
  for (let i = 0; i < 500; i++) codigos.add(nuevoCodigoVoucher())
  assert.equal(codigos.size, 500, 'dos vouchers con el mismo código valen una pizza gratis')
  assert.ok(nuevoCodigoVoucher().length >= 32, 'un voucher lleva al menos 192 bits')
  assert.ok(nuevoNonceQr().length >= 20, 'un nonce de QR lleva al menos 128 bits')
  assert.match(nuevoCodigoVoucher(), /^[A-Za-z0-9_-]+$/, 'base64url: cabe en un QR sin escapar')
})

test('la clave de idempotencia es determinista y acotada', () => {
  assert.equal(
    claveIdempotencia('derecho', 'camp_1', 'cli_7'),
    claveIdempotencia('derecho', 'camp_1', 'cli_7')
  )
  assert.notEqual(claveIdempotencia('derecho', 'camp_1', 'cli_7'), claveIdempotencia('derecho', 'camp_1', 'cli_8'))
  assert.ok(claveIdempotencia('x'.repeat(500)).length <= 190)
})

// ── Riesgo de vencimiento ───────────────────────────────────────────────────

test('el nivel de riesgo por vencimiento es determinista', () => {
  assert.equal(nivelRiesgoVencimiento(1), 'CRITICO')
  assert.equal(nivelRiesgoVencimiento(3), 'CRITICO')
  assert.equal(nivelRiesgoVencimiento(5), 'ALTO')
  assert.equal(nivelRiesgoVencimiento(10), 'MEDIO')
  assert.equal(nivelRiesgoVencimiento(30), 'BAJO')
})
