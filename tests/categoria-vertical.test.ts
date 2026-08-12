import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  capacidadesEfectivas,
  capacidadesSinCategoriaContradictoria,
  categoriaDeVertical,
  categoriaExplicitaDeType,
} from '../src/modules/capacidades/catalogo'

/**
 * DOS SISTEMAS DE CATEGORÍA, UNA SOLA DECISIÓN (12-08-2026).
 *
 * El bug real: el superadmin asignaba el vertical Restaurante
 * (tipoNegocioCodigo), la pantalla lo mostraba, y el registro seguía pidiendo
 * vehículo porque leía el `type` heredado que aún decía carwash. Estas pruebas
 * fijan la precedencia: capacidades a mano > vertical afirmado > type legacy.
 */

test('el vertical afirmado GANA sobre el type heredado (el bug de MESTIZO)', () => {
  const { categoriaExplicita } = capacidadesEfectivas('carwash', null, 'RESTAURANTE')
  assert.equal(categoriaExplicita, 'RESTAURANTE')
})

test('sin vertical, el type reconocido sigue mandando (nada cambia para los viejos)', () => {
  assert.equal(capacidadesEfectivas('carwash', null).categoriaExplicita, 'CAR_WASH')
  assert.equal(capacidadesEfectivas('carwash', null, null).categoriaExplicita, 'CAR_WASH')
})

test('la categoría elegida a mano en capacidades gana sobre todo', () => {
  const { categoriaExplicita } = capacidadesEfectivas(
    'carwash',
    { categoria: 'GYM' },
    'RESTAURANTE'
  )
  assert.equal(categoriaExplicita, 'GYM')
})

test('un vertical desconocido no afirma nada (cae al type)', () => {
  assert.equal(capacidadesEfectivas('restaurante', null, 'OTRO_RARO').categoriaExplicita, 'RESTAURANTE')
  assert.equal(categoriaDeVertical('OTRO_RARO'), null)
  assert.equal(categoriaDeVertical(''), null)
  assert.equal(categoriaDeVertical(null), null)
})

/**
 * SEGUNDO ROUND del bug de MESTIZO (12-08-2026): el vertical ya ganaba sobre
 * el `type`… pero la empresa tenía además `"categoria":"CAR_WASH"` fijada en
 * el JSON de capacidades (de cuando se configuró como car wash), y esa gana
 * sobre todo. Regla nueva: asignar el vertical desde la pantalla de edición
 * RETIRA la categoría vieja contradictoria — la afirmación más reciente gana.
 */

test('asignar el vertical retira la categoría contradictoria conservando el resto (MESTIZO)', () => {
  const caps = {
    categoria: 'CAR_WASH',
    overrides: { TURNOS: true, COLA_VEHICULOS: true },
    modulosCliente: { VEHICULOS: 'OCULTAR' },
  }
  const limpio = capacidadesSinCategoriaContradictoria(caps, 'RESTAURANTE')
  assert.deepEqual(limpio, {
    overrides: { TURNOS: true, COLA_VEHICULOS: true },
    modulosCliente: { VEHICULOS: 'OCULTAR' },
  })
  // Y con el JSON limpio, la decisión final es la del vertical: sin vehículo.
  assert.equal(capacidadesEfectivas('carwash', limpio, 'RESTAURANTE').categoriaExplicita, 'RESTAURANTE')
})

test('si la categoría coincide con el vertical no hay nada que escribir', () => {
  assert.equal(
    capacidadesSinCategoriaContradictoria({ categoria: 'CAR_WASH' }, 'CAR_WASH'),
    undefined
  )
})

test('sin vertical o sin categoría fijada, la columna no se toca', () => {
  assert.equal(capacidadesSinCategoriaContradictoria({ categoria: 'CAR_WASH' }, ''), undefined)
  assert.equal(capacidadesSinCategoriaContradictoria({ categoria: 'CAR_WASH' }, null), undefined)
  assert.equal(capacidadesSinCategoriaContradictoria({ overrides: {} }, 'RESTAURANTE'), undefined)
  assert.equal(capacidadesSinCategoriaContradictoria(null, 'RESTAURANTE'), undefined)
  assert.equal(capacidadesSinCategoriaContradictoria('basura', 'RESTAURANTE'), undefined)
})

test('si solo quedaba la categoría, el JSON entero se vacía (columna a NULL)', () => {
  assert.equal(capacidadesSinCategoriaContradictoria({ categoria: 'CAR_WASH' }, 'RESTAURANTE'), null)
})

test('el código canónico del vertical guardado en type se reconoce (bug latente)', () => {
  // El formulario de edición del superadmin guarda el código del catálogo en
  // `type`: un car wash real editado desde ahí no debe perder el requisito.
  assert.equal(categoriaExplicitaDeType('CAR_WASH'), 'CAR_WASH')
  assert.equal(categoriaExplicitaDeType('car_wash'), 'CAR_WASH')
  assert.equal(categoriaExplicitaDeType('RESTAURANTE'), 'RESTAURANTE')
  assert.equal(categoriaExplicitaDeType('GYM'), 'GYM')
})
