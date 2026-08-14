/**
 * Cobertura de membresía · pruebas del módulo puro.
 * Ejecutar: npm test
 *
 * Lo que se protege aquí es que un satélite NUNCA cobre de más ni regale un
 * lavado por culpa de esta función. Las dos formas de equivocarse son
 * simétricas y las dos cuestan dinero, así que las dos tienen prueba:
 *
 *   · devolver `false` cuando en realidad no se preguntó → el cliente paga un
 *     lavado que su membresía cubría;
 *   · devolver `true` sin comprobar el vehículo → el negocio regala un lavado
 *     de SUV a un plan de sedán.
 *
 * Y la REGLA DE COMPATIBILIDAD: los planes existentes tienen
 * `nivelTarifarioMax: null` y las membresías existentes no tienen vehículos
 * asociados. Ninguna de las dos cosas puede quitarle la cobertura a nadie.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  coberturaDeMembresia,
  type PlanCobertura,
  type VehiculoCubierto,
} from '../src/modules/plataforma/cobertura'

/** Plan de sedán: acepta hasta nivel 1, cuatro lavados. */
const planSedan: PlanCobertura = {
  nivelTarifarioMax: 1,
  esIlimitado: false,
  lavadosIncluidos: 4,
}
/** Plan de los de antes: sin tope, cabe cualquier vehículo. */
const planSinTope: PlanCobertura = {
  nivelTarifarioMax: null,
  esIlimitado: false,
  lavadosIncluidos: 4,
}

const sedanDelCliente: VehiculoCubierto = {
  vehiculoId: 'v1', placa: 'A123456', nivelTarifario: 1,
}

// ── Sin contexto: no se preguntó ────────────────────────────────────────────

test('sin contexto, el veredicto es null y NO false', () => {
  const c = coberturaDeMembresia(planSedan, [], 3)
  assert.equal(c.covers, null, 'null significa «no se preguntó»; false haría pagar de más')
  assert.equal(c.reason, null)
})

test('un contexto vacío tampoco es una pregunta', () => {
  const c = coberturaDeMembresia(planSedan, [], 3, { nivelVehiculo: null, placa: null })
  assert.equal(c.covers, null)
})

test('sin contexto igual se informa qué cubre el plan', () => {
  const c = coberturaDeMembresia(planSedan, [sedanDelCliente], 3)
  assert.equal(c.vehicleLevelMax, 1)
  assert.equal(c.washesIncluded, 4)
  assert.equal(c.unlimited, false)
  assert.deepEqual(c.vehicles, [sedanDelCliente])
})

// ── Tope por nivel de vehículo ──────────────────────────────────────────────

test('un sedán cabe en un plan de sedán', () => {
  const c = coberturaDeMembresia(planSedan, [], 3, { nivelVehiculo: 1 })
  assert.equal(c.covers, true)
  assert.equal(c.reason, null)
})

test('una SUV NO cabe en un plan de sedán: es la diferencia a pagar', () => {
  const c = coberturaDeMembresia(planSedan, [], 3, { nivelVehiculo: 3 })
  assert.equal(c.covers, false)
  assert.equal(c.reason, 'VEHICLE_LEVEL_ABOVE_PLAN')
})

test('un plan de SUV cubre un sedán: el tope es techo, no igualdad', () => {
  const planSuv: PlanCobertura = { ...planSedan, nivelTarifarioMax: 3 }
  const c = coberturaDeMembresia(planSuv, [], 3, { nivelVehiculo: 1 })
  assert.equal(c.covers, true)
})

// ── Regla de compatibilidad ─────────────────────────────────────────────────

test('COMPATIBILIDAD: sin tope, cualquier vehículo cabe', () => {
  for (const nivel of [1, 3, 9]) {
    const c = coberturaDeMembresia(planSinTope, [], 3, { nivelVehiculo: nivel })
    assert.equal(c.covers, true, `nivel ${nivel} debería caber en un plan sin tope`)
  }
})

test('COMPATIBILIDAD: una membresía sin vehículos asociados no pierde cobertura', () => {
  const c = coberturaDeMembresia(planSedan, [], 3, { placa: 'A123456' })
  assert.equal(c.covers, true, 'las membresías anteriores a la asociación siguen valiendo')
})

// ── Vehículos nombrados ─────────────────────────────────────────────────────

test('si la membresía nombra sus vehículos, cubre ESE carro', () => {
  const c = coberturaDeMembresia(planSedan, [sedanDelCliente], 3, { placa: 'A123456' })
  assert.equal(c.covers, true)
})

test('y NO cubre el carro de otro, aunque sea del mismo nivel', () => {
  const c = coberturaDeMembresia(planSedan, [sedanDelCliente], 3, { placa: 'B999999' })
  assert.equal(c.covers, false)
  assert.equal(c.reason, 'VEHICLE_NOT_IN_MEMBERSHIP')
})

// ── Usos ────────────────────────────────────────────────────────────────────

test('sin lavados restantes no cubre nada', () => {
  const c = coberturaDeMembresia(planSedan, [sedanDelCliente], 0, { placa: 'A123456' })
  assert.equal(c.covers, false)
  assert.equal(c.reason, 'NO_USES_LEFT')
})

test('un plan ilimitado no gasta usos: cubre con cero', () => {
  const ilimitado: PlanCobertura = { ...planSedan, esIlimitado: true, lavadosIncluidos: 0 }
  const c = coberturaDeMembresia(ilimitado, [], 0, { nivelVehiculo: 1 })
  assert.equal(c.covers, true)
  assert.equal(c.unlimited, true)
})

test('los usos se comprueban ANTES que el vehículo', () => {
  // Con cero lavados y una SUV, los dos motivos aplican. El que importa es que
  // no le quedan usos: decirle «su carro es muy grande» a alguien que ya gastó
  // su plan lo manda a comprar un upgrade que no le sirve de nada.
  const c = coberturaDeMembresia(planSedan, [], 0, { nivelVehiculo: 3 })
  assert.equal(c.reason, 'NO_USES_LEFT')
})

// ── El dinero no vive aquí ──────────────────────────────────────────────────

test('la cobertura NO lleva importes: el precio lo pone el satélite', () => {
  const c = coberturaDeMembresia(planSedan, [sedanDelCliente], 3, { nivelVehiculo: 1 })
  const claves = Object.keys(c)
  for (const sospechosa of ['amount', 'precio', 'monto', 'shortfall', 'coveredAmount']) {
    assert.ok(
      !claves.includes(sospechosa),
      `«${sospechosa}» sería un precio inventado por MembeGo sobre la tarifa de otro`
    )
  }
})
