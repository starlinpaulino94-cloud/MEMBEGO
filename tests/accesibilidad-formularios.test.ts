import { test } from 'node:test'
import assert from 'node:assert/strict'
import { camposSinNombre } from '../scripts/campos-sin-etiqueta.mjs'

/**
 * NOMBRE ACCESIBLE DE LOS CAMPOS (WCAG 3.3.2 / 4.1.2) — DS 2.0 · Fase 19.
 *
 * Un `<Input>` sin nombre se anuncia como "cuadro de edición" y nada más.
 * Quien navega sin ver no puede saber qué escribir; quien usa dictado no puede
 * enfocarlo por su nombre.
 *
 * Las dos trampas que había en el proyecto:
 *
 *  · `placeholder` usado como etiqueta. No lo es: desaparece al escribir —así
 *    que también deja tirado a quien SÍ ve, en cuanto se distrae a mitad del
 *    formulario— y los lectores de pantalla no lo anuncian de forma fiable.
 *  · Un `<Label>` puesto encima del campo sin `htmlFor`. Se ve como una
 *    etiqueta y no lo es: para el navegador son dos elementos sin relación.
 *
 * DOS EXIGENCIAS DISTINTAS, A PROPÓSITO:
 *
 *  · Donde entran CLIENTES y EMPLEADOS: cero. No es negociable — es gente que
 *    no eligió esta herramienta y que puede necesitar un lector de pantalla.
 *  · En el panel interno: un techo que solo baja, como la deuda tipográfica.
 *    Son 99 campos repartidos por formularios de administración; migrarlos de
 *    una barrida sin poder mirar ninguna pantalla sería peor que la deuda.
 */

/** Techo del panel interno. Bajarlo conforme se salde; nunca subirlo. */
const TECHO = 129

/** Áreas donde interactúa alguien que no es personal de oficina. */
const CARA_AL_USUARIO = /(?:components\/(?:cliente|auth|public|scanner|caja|geo|marketplace|membresia)|app\/\((?:cliente|public|empleado|auth)\))/

test('ningún campo de cara al usuario se queda sin nombre accesible', () => {
  const infractores = camposSinNombre().filter((r: string) => CARA_AL_USUARIO.test(r))
  assert.deepEqual(
    infractores,
    [],
    'Añade `aria-label` o un `<Label htmlFor>` que apunte al `id` del campo:\n' +
      infractores.join('\n')
  )
})

test('los campos sin nombre del panel interno no aumentan', () => {
  const total = camposSinNombre().length
  assert.ok(
    total <= TECHO,
    `Hay ${total} campos sin nombre accesible y el techo es ${TECHO}. ` +
      'Un campo nuevo debe nacer con su etiqueta.'
  )
})

test('el detector reconoce las formas válidas de nombrar (prueba de la prueba)', () => {
  // Si el parser se rompiera, devolvería cero y la guardia pasaría por no
  // encontrar nada — verde por estar ciega, que es peor que roja.
  const total = camposSinNombre().length
  assert.ok(total > 0, 'el detector no encontró NADA: probablemente dejó de parsear')
  assert.ok(
    total < 400,
    `el detector marcó ${total} campos: está contando de más, revisa el reconocimiento ` +
      'de `htmlFor={…}` con plantilla y de los campos envueltos en <label>'
  )
})
