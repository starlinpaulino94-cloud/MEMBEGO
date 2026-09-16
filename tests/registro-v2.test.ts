/**
 * Onboarding v2 · pruebas del REGISTRO CON VEHÍCULO (Fase 4).
 * Ejecutar: npm test
 *
 * Protege el contrato del asistente: en un flujo car wash, el vehículo del
 * registro NUEVO llega con placa + categoría (marca, modelo, año y color son
 * opcionales con defaults) o el alta se rechaza con mensaje — nunca el
 * descarte silencioso del formulario clásico. La normalización de placa es
 * la del dominio.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validarVehiculoNuevo } from '../src/modules/registro/vehiculo-nuevo'
import { buscarMarcas, MARCAS_FRECUENTES } from '../src/modules/onboarding/marcas'

const completo = {
  tipoVehiculoId: 'tv1',
  marca: 'Toyota',
  modelo: 'Corolla',
  anioRaw: '2022',
  color: 'Blanco',
  placa: 'a 123-456',
}

test('vehículo completo: pasa, normaliza placa y aplica país por defecto', () => {
  const r = validarVehiculoNuevo(completo)
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal(r.vehiculo.placaNormalizada, 'A123456')
    assert.equal(r.vehiculo.placa, 'a 123-456') // lo escrito se conserva
    assert.equal(r.vehiculo.pais, 'DO')
    assert.equal(r.vehiculo.anio, 2022)
  }
})

test('solo placa y categoría son obligatorias; marca, modelo, año y color usan defaults', () => {
  const soloMinimo = validarVehiculoNuevo({ tipoVehiculoId: 'tv1', placa: 'a 123-456' })
  assert.equal(soloMinimo.ok, true)
  if (soloMinimo.ok) {
    assert.equal(soloMinimo.vehiculo.marca, 'Sin marca')
    assert.equal(soloMinimo.vehiculo.modelo, 'Sin modelo')
    assert.equal(soloMinimo.vehiculo.anio, new Date().getFullYear())
    assert.equal(soloMinimo.vehiculo.color, 'Sin color')
  }

  const sinCategoria = validarVehiculoNuevo({ ...completo, tipoVehiculoId: '' })
  assert.equal(sinCategoria.ok, false)
  if (!sinCategoria.ok) assert.match(sinCategoria.error, /categoría/i)

  const sinPlaca = validarVehiculoNuevo({ ...completo, placa: '' })
  assert.equal(sinPlaca.ok, false)
  if (!sinPlaca.ok) assert.match(sinPlaca.error, /placa/i)
})

test('placa inválida y año fuera de rango usan los mensajes del dominio', () => {
  const placaMala = validarVehiculoNuevo({ ...completo, placa: 'ABCDEF' })
  assert.equal(placaMala.ok, false)

  const anioMalo = validarVehiculoNuevo({ ...completo, anioRaw: '1890' })
  assert.equal(anioMalo.ok, false)
})

test('país explícito se respeta y se normaliza a mayúsculas', () => {
  const r = validarVehiculoNuevo({ ...completo, pais: 'us' })
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.vehiculo.pais, 'US')
})

// ── Marcas sugeridas ─────────────────────────────────────────────────────────

test('buscarMarcas: vacío → las más frecuentes; texto → prefijo primero', () => {
  assert.deepEqual(buscarMarcas(''), MARCAS_FRECUENTES.slice(0, 8))
  const porTo = buscarMarcas('to')
  assert.equal(porTo[0], 'Toyota')
  assert.ok(buscarMarcas('benz').includes('Mercedes-Benz')) // subcadena
  assert.deepEqual(buscarMarcas('zzz'), []) // sin coincidencias: lista vacía
})
