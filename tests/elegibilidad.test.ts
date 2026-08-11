/**
 * Elegibilidad · pruebas del MOTOR DE DECISIÓN (Fase 3).
 * Ejecutar: npm test
 *
 * La propiedad más importante que se protege aquí es la REGLA DE
 * COMPATIBILIDAD: un cliente registrado antes del rediseño —sin vehículo, o
 * con un vehículo sin placa ni categoría— sigue usando la app, su QR y su
 * membresía sin que el motor le exija nada. Los requisitos solo existen para
 * COMPRAS NUEVAS. Si alguien rompe esa garantía, estas pruebas fallan.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  requisitosParaAccion,
  decidirPlan,
  vehiculoAutorizadoEnMembresia,
  type VehiculoInfo,
  type PlanReglas,
} from '../src/modules/elegibilidad/decidir'
import { categoriaExplicitaDeType } from '../src/modules/capacidades/catalogo'
import { flujoRequiereVehiculo } from '../src/modules/onboarding/flujos'

const vehiculoCompleto: VehiculoInfo = {
  id: 'v1',
  placaNormalizada: 'A123456',
  tipoVehiculoId: 'suv',
  nivelTarifario: 3,
}
const vehiculoHistorico: VehiculoInfo = {
  id: 'v2',
  placaNormalizada: null,
  tipoVehiculoId: null,
  nivelTarifario: null,
}

// ── Regla de compatibilidad (grandfathering) ────────────────────────────────

test('COMPATIBILIDAD: usar la membresía nunca exige nada, ni sin vehículos', () => {
  for (const vehiculos of [[], [vehiculoHistorico]]) {
    const r = requisitosParaAccion({ accion: 'USAR_MEMBRESIA', categoria: 'CAR_WASH', vehiculos })
    assert.equal(r.canProceed, true)
    assert.deepEqual(r.missingRequirements, [])
  }
})

test('COMPATIBILIDAD: renovar una membresía existente nunca exige nada', () => {
  const r = requisitosParaAccion({ accion: 'RENOVAR_MEMBRESIA', categoria: 'CAR_WASH', vehiculos: [] })
  assert.equal(r.canProceed, true)
})

test('COMPATIBILIDAD: vehículo histórico (sin categoría) compra a precio base, jamás bloqueado', () => {
  const plan: PlanReglas = { id: 'p', precioBase: 1000, precioCategoria: null, nivelTarifarioMax: null }
  const d = decidirPlan(plan, vehiculoHistorico)
  assert.equal(d.puedeComprar, true)
  if (d.puedeComprar) {
    assert.equal(d.precio, 1000)
    assert.equal(d.precioOrigen, 'BASE')
  }
})

// ── Requisitos de compra nueva ───────────────────────────────────────────────

test('compra en car wash sin vehículos → VEHICLE_REQUIRED y redirección al onboarding', () => {
  const r = requisitosParaAccion({ accion: 'COMPRAR_PLAN', categoria: 'CAR_WASH', vehiculos: [] })
  assert.equal(r.canProceed, false)
  assert.deepEqual(r.missingRequirements, ['VEHICLE_REQUIRED'])
  assert.equal(r.nextAction, 'START_VEHICLE_ONBOARDING')
})

test('compra en car wash con vehículo sin placa ni categoría → pide ambas', () => {
  const r = requisitosParaAccion({
    accion: 'COMPRAR_PLAN',
    categoria: 'CAR_WASH',
    vehiculos: [vehiculoHistorico],
  })
  assert.equal(r.canProceed, false)
  assert.ok(r.missingRequirements.includes('LICENSE_PLATE_REQUIRED'))
  assert.ok(r.missingRequirements.includes('VEHICLE_CATEGORY_REQUIRED'))
})

test('compra en car wash: basta UN vehículo completo aunque haya otros a medias', () => {
  const r = requisitosParaAccion({
    accion: 'COMPRAR_PLAN',
    categoria: 'CAR_WASH',
    vehiculos: [vehiculoHistorico, vehiculoCompleto],
  })
  assert.equal(r.canProceed, true)
})

test('compra en salón/restaurante/gym o registro general → sin requisitos de vehículo', () => {
  for (const categoria of ['BARBERIA', 'RESTAURANTE', 'GYM', null] as const) {
    const r = requisitosParaAccion({ accion: 'COMPRAR_PLAN', categoria, vehiculos: [] })
    assert.equal(r.canProceed, true, `categoría ${categoria} no debe exigir vehículo`)
  }
})

// ── Precio por categoría y niveles ───────────────────────────────────────────

test('decidirPlan: el precio de la categoría gana; sin fila, cae al base (fail-open)', () => {
  const conCategoria: PlanReglas = { id: 'p', precioBase: 1000, precioCategoria: 1300, nivelTarifarioMax: null }
  const sinCategoria: PlanReglas = { id: 'p', precioBase: 1000, precioCategoria: null, nivelTarifarioMax: null }

  const d1 = decidirPlan(conCategoria, vehiculoCompleto)
  assert.ok(d1.puedeComprar && d1.precio === 1300 && d1.precioOrigen === 'CATEGORIA')

  const d2 = decidirPlan(sinCategoria, vehiculoCompleto)
  assert.ok(d2.puedeComprar && d2.precio === 1000 && d2.precioOrigen === 'BASE')
})

test('decidirPlan: plan sin nivel máximo (todos los actuales) acepta cualquier vehículo', () => {
  const plan: PlanReglas = { id: 'p', precioBase: 1000, precioCategoria: null, nivelTarifarioMax: null }
  assert.equal(decidirPlan(plan, vehiculoCompleto).puedeComprar, true)
})

test('decidirPlan: vehículo de nivel superior → bloqueado CON opciones, nunca error mudo', () => {
  const planSedan: PlanReglas = { id: 'p', precioBase: 1000, precioCategoria: null, nivelTarifarioMax: 1 }
  const d = decidirPlan(planSedan, vehiculoCompleto) // SUV nivel 3
  assert.equal(d.puedeComprar, false)
  if (!d.puedeComprar) {
    assert.equal(d.motivo, 'NIVEL_SUPERIOR')
    assert.ok(d.opciones.includes('ACTUALIZAR_MEMBRESIA'))
    assert.ok(d.opciones.length >= 3)
    assert.equal(typeof d.precio, 'number') // precio informativo para la UI
  }
})

test('decidirPlan: sedán (nivel 1) sí cabe en un plan con tope de SUV (nivel 3)', () => {
  const planSuv: PlanReglas = { id: 'p', precioBase: 1300, precioCategoria: null, nivelTarifarioMax: 3 }
  const sedan: VehiculoInfo = { id: 'v', placaNormalizada: 'B111222', tipoVehiculoId: 'sedan', nivelTarifario: 1 }
  assert.equal(decidirPlan(planSuv, sedan).puedeComprar, true)
})

test('decidirPlan: sin vehículo (negocio sin paso de vehículo) → precio base, compra permitida', () => {
  const plan: PlanReglas = { id: 'p', precioBase: 800, precioCategoria: null, nivelTarifarioMax: null }
  const d = decidirPlan(plan, null)
  assert.ok(d.puedeComprar && d.precio === 800 && d.precioOrigen === 'BASE')
})

// ── Uso de la membresía con un vehículo (§13) ────────────────────────────────

test('COMPATIBILIDAD: membresía SIN vehículos asociados autoriza siempre (QR como siempre)', () => {
  assert.deepEqual(vehiculoAutorizadoEnMembresia([], 'cualquiera'), { autorizado: true })
  assert.deepEqual(vehiculoAutorizadoEnMembresia([], null), { autorizado: true })
})

test('§13: escanear sin elegir vehículo autoriza; el vehículo asociado autoriza', () => {
  const asociados = [{ vehiculoId: 'v1', etiqueta: 'Toyota Corolla (A123456)' }]
  assert.equal(vehiculoAutorizadoEnMembresia(asociados, null).autorizado, true)
  assert.equal(vehiculoAutorizadoEnMembresia(asociados, '').autorizado, true)
  assert.equal(vehiculoAutorizadoEnMembresia(asociados, 'v1').autorizado, true)
})

test('§13: OTRO vehículo identificado se rechaza con la placa del asociado en el mensaje', () => {
  const asociados = [{ vehiculoId: 'v1', etiqueta: 'Toyota Corolla (A123456)' }]
  const r = vehiculoAutorizadoEnMembresia(asociados, 'v2')
  assert.equal(r.autorizado, false)
  if (!r.autorizado) assert.match(r.mensaje, /A123456/)
})

// ── La cadena completa: tipo de empresa → requisito ──────────────────────────
//
// La regla pura de arriba (categoría null → sin requisitos) siempre estuvo
// bien. Lo que fallaba era el eslabón anterior: la capa de base de datos NUNCA
// devolvía null porque un tipo desconocido caía en CAR_WASH. Por eso al cliente
// de un restaurante se le pedía registrar un vehículo para ver los planes. Esta
// prueba cubre el eslabón, no la regla.

test('un tipo de negocio que el catálogo no reconoce no exige vehículo', () => {
  for (const type of ['restaurante', 'otro', '', null, undefined]) {
    const categoria = categoriaExplicitaDeType(type)
    assert.equal(
      flujoRequiereVehiculo(categoria),
      false,
      `el tipo "${type}" no debería exigir vehículo`
    )
    const r = requisitosParaAccion({ accion: 'COMPRAR_PLAN', categoria, vehiculos: [] })
    assert.equal(r.canProceed, true)
  }
})

test('el car wash sí sigue exigiéndolo (la corrección no aflojó nada)', () => {
  const categoria = categoriaExplicitaDeType('carwash')
  assert.equal(categoria, 'CAR_WASH')
  assert.equal(flujoRequiereVehiculo(categoria), true)
  const r = requisitosParaAccion({ accion: 'COMPRAR_PLAN', categoria, vehiculos: [] })
  assert.equal(r.canProceed, false)
  assert.ok(r.missingRequirements.includes('VEHICLE_REQUIRED'))
})
