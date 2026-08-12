import { test } from 'node:test'
import assert from 'node:assert/strict'
import { desdeHace, plural, soloPlural } from '../src/lib/plural'

test('uno va en singular, el resto en plural', () => {
  assert.equal(plural(1, 'cliente', 'clientes'), '1 cliente')
  assert.equal(plural(2, 'cliente', 'clientes'), '2 clientes')
})

/**
 * EL CERO ES PLURAL EN ESPAÑOL. «0 cliente» suena a error de programa; se dice
 * «0 clientes». Es el caso que más veces se escapa porque casi nunca se prueba.
 */
test('cero va en plural', () => {
  assert.equal(plural(0, 'cliente', 'clientes'), '0 clientes')
})

/**
 * El plural entero y no un sufijo `+s`: «mes» no hace «mess». Una función que
 * solo sepa añadir `s` obliga a escribir el caso raro a mano justo donde nadie
 * se acuerda de que existe.
 */
test('sirve para plurales irregulares', () => {
  assert.equal(plural(3, 'mes', 'meses'), '3 meses')
  assert.equal(plural(1, 'mes', 'meses'), '1 mes')
  assert.equal(plural(2, 'vez', 'veces'), '2 veces')
})

test('soloPlural devuelve la palabra, sin el número', () => {
  assert.equal(soloPlural(1, 'registro', 'registros'), 'registro')
  assert.equal(soloPlural(0, 'registro', 'registros'), 'registros')
})

test('desdeHace: minutos, horas, días y meses', () => {
  assert.equal(desdeHace(null), 'sin actividad')
  assert.equal(desdeHace(5 * 60_000), 'hace un momento')
  assert.equal(desdeHace(3 * 3_600_000), 'hace 3 h')
  assert.equal(desdeHace(86_400_000), 'hace 1 día')
  assert.equal(desdeHace(23 * 86_400_000), 'hace 23 días')
  assert.equal(desdeHace(90 * 86_400_000), 'hace 3 meses')
})

test('desdeHace no dice «1 días» ni «1 meses»', () => {
  assert.equal(desdeHace(31 * 86_400_000), 'hace 1 mes')
  assert.ok(!desdeHace(86_400_000).includes('días'))
})
