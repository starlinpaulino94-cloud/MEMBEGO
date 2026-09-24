/**
 * MEMBEGO SUPPLY · pruebas del LEDGER DE DERECHOS.
 * Ejecutar: npm test
 *
 * Es el sistema que responde «¿cuántas pizzas me quedan?». Tres propiedades
 * son críticas y se prueban aquí:
 *
 *   1. EL INVARIANTE. comprado = disponible + asignado + retenido + emitido +
 *      redimido + cerrado, pase lo que pase y en cualquier orden.
 *   2. NO HAY SOBREGIRO. Ni con la última unidad, ni encadenando asientos, ni
 *      moviendo desde una cubeta vacía.
 *   3. LOS TRASLADOS ILEGALES NO OCURREN. Redimir algo que nadie emitió, o
 *      pasar de REDIMIDO a DISPONIBLE por la puerta de atrás, se rechaza.
 *
 * PURO: sin base de datos. Lo que se prueba es la aritmética y las reglas;
 * lo que las escribe (`movimientos.ts`) se apoya encima.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MOVIMIENTOS_CON_MOTIVO_OBLIGATORIO,
  MOVIMIENTO_TRASLADO,
  agotado,
  aplicarMovimiento,
  comprobarInvariante,
  compradoDeAsientos,
  cubetasVivas,
  expuestas,
  saldoDeAsientos,
  saldoVacio,
  totalCubetas,
  utilizables,
  validarMovimiento,
  type AsientoLedger,
} from '../src/modules/supply/ledger'
import { SUPPLY_CUBETAS, CUBETAS_CONSUMIDAS } from '../src/modules/supply/catalogo'

// ── Utilidades del caso real del prompt ─────────────────────────────────────

/** El caso de la pizzería: 1.000 pizzas compradas. */
const COMPRA: AsientoLedger = {
  tipo: 'COMPRA',
  origen: null,
  destino: 'DISPONIBLE',
  cantidad: 1000,
}

function mov(
  tipo: AsientoLedger['tipo'],
  origen: AsientoLedger['origen'],
  destino: AsientoLedger['destino'],
  cantidad: number
): AsientoLedger {
  return { tipo, origen, destino, cantidad }
}

// ── Catálogo íntegro ────────────────────────────────────────────────────────

test('todo tipo de movimiento declara sus traslados (salvo AJUSTE, que es comodín)', () => {
  for (const [tipo, traslados] of Object.entries(MOVIMIENTO_TRASLADO)) {
    if (tipo === 'AJUSTE') {
      assert.equal(traslados.length, 0, 'AJUSTE es el único comodín')
      continue
    }
    assert.ok(traslados.length > 0, `${tipo} no declara ningún traslado`)
    for (const t of traslados) {
      assert.ok(
        t.origen !== null || t.destino !== null,
        `${tipo} declara un traslado que no entra ni sale de ninguna cubeta`
      )
    }
  }
})

test('las cubetas del ledger y las del catálogo son las mismas', () => {
  assert.deepEqual([...SUPPLY_CUBETAS].sort(), Object.keys(saldoVacio()).sort())
})

// ── El invariante (Fase 78) ─────────────────────────────────────────────────

test('el invariante se cumple tras la compra', () => {
  const r = comprobarInvariante([COMPRA])
  assert.equal(r.cuadra, true)
  assert.equal(r.comprado, 1000)
  assert.equal(r.suma, 1000)
  assert.equal(r.cubetas.DISPONIBLE, 1000)
})

test('el invariante se cumple en el reparto completo del ejemplo', () => {
  // 200 bienvenida, 500 oferta, 100 referidos, 50 membresías, 50 influencers,
  // 100 sin asignar. Después se emiten 173 y se redimen 128 de la bienvenida.
  const asientos: AsientoLedger[] = [
    COMPRA,
    mov('ASIGNACION', 'DISPONIBLE', 'ASIGNADO', 200),
    mov('ASIGNACION', 'DISPONIBLE', 'ASIGNADO', 500),
    mov('ASIGNACION', 'DISPONIBLE', 'ASIGNADO', 100),
    mov('ASIGNACION', 'DISPONIBLE', 'ASIGNADO', 50),
    mov('ASIGNACION', 'DISPONIBLE', 'ASIGNADO', 50),
    mov('EMISION', 'ASIGNADO', 'EMITIDO', 173),
    mov('REDENCION', 'EMITIDO', 'REDIMIDO', 128),
  ]
  const r = comprobarInvariante(asientos)
  assert.equal(r.cuadra, true)
  assert.equal(r.comprado, 1000)
  assert.equal(r.cubetas.DISPONIBLE, 100, 'quedan 100 sin asignar')
  assert.equal(r.cubetas.ASIGNADO, 900 - 173)
  assert.equal(r.cubetas.EMITIDO, 173 - 128, '45 vouchers vivos sin canjear')
  assert.equal(r.cubetas.REDIMIDO, 128)
  assert.equal(totalCubetas(r.cubetas), 1000)
})

test('el invariante aguanta reversas, expiraciones y ajustes', () => {
  const asientos: AsientoLedger[] = [
    COMPRA,
    mov('ASIGNACION', 'DISPONIBLE', 'ASIGNADO', 300),
    mov('EMISION', 'ASIGNADO', 'EMITIDO', 100),
    mov('REDENCION', 'EMITIDO', 'REDIMIDO', 60),
    mov('REVERSA_REDENCION', 'REDIMIDO', 'EMITIDO', 2),
    mov('EXPIRACION', 'EMITIDO', 'CERRADO', 10),
    mov('LIBERACION_ASIGNACION', 'ASIGNADO', 'DISPONIBLE', 50),
    mov('AJUSTE', null, 'DISPONIBLE', 25),
  ]
  const r = comprobarInvariante(asientos)
  assert.equal(r.cuadra, true)
  assert.equal(r.comprado, 1025)
  assert.equal(r.cubetas.REDIMIDO, 58)
  assert.equal(r.cubetas.EMITIDO, 100 - 60 + 2 - 10)
  assert.deepEqual(r.negativas, [])
})

test('el orden de los asientos no cambia el saldo', () => {
  const base: AsientoLedger[] = [
    COMPRA,
    mov('ASIGNACION', 'DISPONIBLE', 'ASIGNADO', 200),
    mov('EMISION', 'ASIGNADO', 'EMITIDO', 50),
    mov('REDENCION', 'EMITIDO', 'REDIMIDO', 30),
  ]
  const revuelto = [base[0], base[2], base[3], base[1]]
  assert.deepEqual(saldoDeAsientos(base), saldoDeAsientos(revuelto))
})

test('una transferencia saca unidades del lote y baja lo comprado', () => {
  const asientos: AsientoLedger[] = [COMPRA, mov('TRANSFERENCIA', 'DISPONIBLE', null, 200)]
  const r = comprobarInvariante(asientos)
  assert.equal(r.comprado, 800)
  assert.equal(r.cubetas.DISPONIBLE, 800)
  assert.equal(r.cuadra, true)
})

test('comprobarInvariante DETECTA un descuadre en vez de tragárselo', () => {
  // Un asiento imposible metido a mano: saca de EMITIDO sin que nadie emitiera.
  const r = comprobarInvariante([COMPRA, mov('REDENCION', 'EMITIDO', 'REDIMIDO', 5)])
  assert.equal(r.cuadra, false)
  assert.deepEqual(r.negativas, ['EMITIDO'])
})

// ── Sin sobregiro (Fase 9) ──────────────────────────────────────────────────

test('no se puede asignar más de lo disponible', () => {
  const saldo = saldoDeAsientos([COMPRA])
  const v = validarMovimiento(saldo, mov('ASIGNACION', 'DISPONIBLE', 'ASIGNADO', 1001))
  assert.equal(v.ok, false)
  assert.match(v.ok === false ? v.error : '', /No hay suficientes unidades en DISPONIBLE/)
})

test('LA ÚLTIMA UNIDAD: el segundo intento se rechaza', () => {
  // Una sola unidad y dos peticiones. La primera la aplica; la segunda valida
  // contra el saldo YA movido y no pasa. Es lo que garantiza el FOR UPDATE de
  // movimientos.ts: que la segunda lea el saldo de después.
  let saldo = saldoDeAsientos([{ ...COMPRA, cantidad: 1 }])
  const peticion = mov('EMISION', 'DISPONIBLE', 'EMITIDO', 1)

  const primera = validarMovimiento(saldo, peticion)
  assert.equal(primera.ok, true)
  saldo = aplicarMovimiento(saldo, peticion)

  const segunda = validarMovimiento(saldo, peticion)
  assert.equal(segunda.ok, false)
  assert.equal(saldo.EMITIDO, 1, 'solo una persona se lleva la unidad')
})

test('no se puede mover desde una cubeta vacía', () => {
  const v = validarMovimiento(saldoVacio(), mov('REDENCION', 'EMITIDO', 'REDIMIDO', 1))
  assert.equal(v.ok, false)
})

test('la cantidad tiene que ser un entero positivo', () => {
  const saldo = saldoDeAsientos([COMPRA])
  for (const cantidad of [0, -5, 1.5, NaN]) {
    const v = validarMovimiento(saldo, mov('ASIGNACION', 'DISPONIBLE', 'ASIGNADO', cantidad))
    assert.equal(v.ok, false, `cantidad ${cantidad} debería rechazarse`)
  }
})

// ── Traslados ilegales ──────────────────────────────────────────────────────

test('REDENCION solo va de EMITIDO a REDIMIDO', () => {
  const saldo = saldoDeAsientos([COMPRA])
  const v = validarMovimiento(saldo, mov('REDENCION', 'DISPONIBLE', 'REDIMIDO', 1))
  assert.equal(v.ok, false)
  assert.match(v.ok === false ? v.error : '', /no puede ir de DISPONIBLE a REDIMIDO/)
})

test('de REDIMIDO no se sale salvo por REVERSA_REDENCION', () => {
  const saldo = saldoDeAsientos([
    COMPRA,
    mov('EMISION', 'DISPONIBLE', 'EMITIDO', 10),
    mov('REDENCION', 'EMITIDO', 'REDIMIDO', 10),
  ])
  assert.equal(validarMovimiento(saldo, mov('EMISION', 'REDIMIDO', 'EMITIDO', 1)).ok, false)
  assert.equal(
    validarMovimiento(saldo, {
      ...mov('REVERSA_REDENCION', 'REDIMIDO', 'EMITIDO', 1),
      motivo: 'Se escaneó el voucher equivocado.',
    }).ok,
    true
  )
})

test('una emisión puede salir de DISPONIBLE, de ASIGNADO o de un hold', () => {
  const saldo = saldoDeAsientos([
    COMPRA,
    mov('ASIGNACION', 'DISPONIBLE', 'ASIGNADO', 100),
    mov('RETENCION', 'DISPONIBLE', 'RETENIDO', 10),
  ])
  for (const origen of ['DISPONIBLE', 'ASIGNADO', 'RETENIDO'] as const) {
    assert.equal(validarMovimiento(saldo, mov('EMISION', origen, 'EMITIDO', 1)).ok, true)
  }
})

test('un hold vuelve a la cubeta de la que salió', () => {
  const saldo = saldoDeAsientos([COMPRA, mov('RETENCION', 'DISPONIBLE', 'RETENIDO', 5)])
  assert.equal(
    validarMovimiento(saldo, mov('LIBERACION_RETENCION', 'RETENIDO', 'DISPONIBLE', 5)).ok,
    true
  )
  assert.equal(
    validarMovimiento(saldo, mov('LIBERACION_RETENCION', 'RETENIDO', 'REDIMIDO', 5)).ok,
    false,
    'soltar un hold no puede entregar la unidad'
  )
})

// ── Motivo obligatorio (nada se corrige en silencio) ────────────────────────

test('los movimientos correctivos exigen motivo por escrito', () => {
  const saldo = saldoDeAsientos([
    COMPRA,
    mov('EMISION', 'DISPONIBLE', 'EMITIDO', 5),
    mov('REDENCION', 'EMITIDO', 'REDIMIDO', 5),
  ])
  for (const tipo of MOVIMIENTOS_CON_MOTIVO_OBLIGATORIO) {
    const origen = tipo === 'REVERSA_REDENCION' ? 'REDIMIDO' : 'DISPONIBLE'
    const destino = tipo === 'REVERSA_REDENCION' ? 'EMITIDO' : 'CERRADO'
    const sinMotivo = validarMovimiento(saldo, {
      ...mov(tipo, origen, destino, 1),
      motivo: '   ',
    })
    assert.equal(sinMotivo.ok, false, `${tipo} sin motivo debería rechazarse`)

    const conMotivo = validarMovimiento(saldo, {
      ...mov(tipo, origen, destino, 1),
      motivo: 'El empleado escaneó el voucher equivocado.',
    })
    assert.equal(conMotivo.ok, true, `${tipo} con motivo debería pasar`)
  }
})

// ── Lecturas derivadas ──────────────────────────────────────────────────────

test('utilizables no incluye los holds vivos', () => {
  const saldo = saldoDeAsientos([
    COMPRA,
    mov('ASIGNACION', 'DISPONIBLE', 'ASIGNADO', 200),
    mov('RETENCION', 'DISPONIBLE', 'RETENIDO', 50),
  ])
  assert.equal(utilizables(saldo), 750 + 200)
  assert.equal(expuestas(saldo), 200 + 50)
})

test('solo lo REDIMIDO cuenta como costo consumido', () => {
  assert.deepEqual([...CUBETAS_CONSUMIDAS], ['REDIMIDO'])
})

test('un lote está agotado cuando no queda nada que entregar', () => {
  const saldo = saldoDeAsientos([
    { ...COMPRA, cantidad: 10 },
    mov('EMISION', 'DISPONIBLE', 'EMITIDO', 10),
    mov('REDENCION', 'EMITIDO', 'REDIMIDO', 10),
  ])
  assert.equal(agotado(saldo), true)
  assert.deepEqual(cubetasVivas(saldo), [])
})

test('un lote con vouchers sin canjear NO está agotado', () => {
  const saldo = saldoDeAsientos([
    { ...COMPRA, cantidad: 10 },
    mov('EMISION', 'DISPONIBLE', 'EMITIDO', 10),
    mov('REDENCION', 'EMITIDO', 'REDIMIDO', 9),
  ])
  assert.equal(agotado(saldo), false, 'la unidad emitida sin canjear sigue siendo una obligación')
  assert.deepEqual(cubetasVivas(saldo), ['EMITIDO'])
})

test('compradoDeAsientos ignora los traslados internos', () => {
  const asientos = [COMPRA, mov('ASIGNACION', 'DISPONIBLE', 'ASIGNADO', 999)]
  assert.equal(compradoDeAsientos(asientos), 1000)
})
