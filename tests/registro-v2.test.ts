/**
 * Onboarding v2 · pruebas del REGISTRO CON VEHÍCULO (Fase 4).
 * Ejecutar: npm test
 *
 * Protege el contrato del asistente: en un flujo car wash, el vehículo del
 * registro NUEVO llega COMPLETO (categoría, marca, modelo, año, color, placa
 * válida) o el alta se rechaza con mensaje — nunca el descarte silencioso del
 * formulario clásico. La normalización de placa es la del dominio.
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

test('cada campo faltante rechaza con mensaje propio (nunca descarte silencioso)', () => {
  const casos: Array<[Partial<typeof completo>, RegExp]> = [
    [{ tipoVehiculoId: '' }, /categoría/i],
    [{ marca: '' }, /marca/i],
    [{ modelo: '' }, /modelo/i],
    [{ anioRaw: '' }, /año/i],
    [{ color: '' }, /color/i],
    [{ placa: '' }, /placa/i],
  ]
  for (const [cambio, patron] of casos) {
    const r = validarVehiculoNuevo({ ...completo, ...cambio })
    assert.equal(r.ok, false)
    if (!r.ok) assert.match(r.error, patron)
  }
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
