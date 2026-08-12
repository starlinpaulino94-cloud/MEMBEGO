import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * LA FRICCIÓN, EN LA ACCIÓN QUE LA NECESITA.
 *
 * Reiniciar una empresa de práctica borra datos INVENTADOS y pedía escribir una
 * palabra. Convertirla en real —que la saca del sandbox, la habilita para cobros
 * de verdad y hace que sus números empiecen a contar en la plataforma— era un
 * solo clic sin confirmación.
 *
 * Estas guardias no comprueban el resultado —haría falta base de datos— sino que
 * la confirmación siga EXIGIÉNDOSE EN EL SERVIDOR. Un campo en la pantalla que
 * el servidor no mira es un teatro: quien envíe el formulario desde otra pestaña
 * convierte la empresa igual.
 */

const ACTIONS = readFileSync(join('src', 'modules', 'demo', 'actions.ts'), 'utf8')
const PANEL = readFileSync(join('src', 'components', 'superadmin', 'DemoPanel.tsx'), 'utf8')

test('convertir en real exige confirmación en el servidor', () => {
  const bloque = ACTIONS.slice(ACTIONS.indexOf('export async function marcarComoDemo'))
  assert.match(
    bloque,
    /formData\.get\('confirmacion'\)/,
    'la acción tiene que leer la confirmación, no fiarse de que la pantalla la pidió'
  )
  assert.match(
    bloque,
    /empresa\.name/,
    'se compara contra el NOMBRE de la empresa: en una lista de tarjetas, una palabra genérica vale para cualquiera'
  )
})

test('convertir en real sigue exigiendo que esté vacía', () => {
  const bloque = ACTIONS.slice(ACTIONS.indexOf('export async function marcarComoDemo'))
  assert.match(bloque, /contarDatosDemo/)
  assert.match(bloque, /total > 0/)
})

test('reiniciar sigue pidiendo su confirmación escrita', () => {
  const bloque = ACTIONS.slice(ACTIONS.indexOf('export async function reiniciarDemo'))
  assert.match(bloque, /confirmacion/)
})

/**
 * Y la pantalla no ofrece un botón que siempre falla: con datos dentro, el
 * formulario de convertir no se enseña. Un control que se puede pulsar y nunca
 * funciona hace dudar de si el error es tuyo.
 */
test('con datos de práctica no se ofrece el botón de convertir', () => {
  assert.match(
    PANEL,
    /\{total === 0 && \(/,
    'el formulario de convertir en real solo aparece cuando la empresa está limpia'
  )
})

/** El plural mal es el detalle que hace dudar del resto de la pantalla. */
test('el panel no escribe plurales a mano', () => {
  assert.ok(!PANEL.includes('registro(s)'), 'nada de «registro(s)»: usa `plural()`')
  assert.match(PANEL, /from '@\/lib\/plural'/)
})
