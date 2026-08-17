import { test } from 'node:test'
import assert from 'node:assert/strict'

import { escaparHtml } from '../src/lib/html'

/**
 * El escapado que protege los correos salientes. Lo que se prueba aquí no es
 * "la función reemplaza caracteres" —eso se ve leyéndola— sino los dos casos
 * en que las copias anteriores se quedaban cortas: el orden del `&` y las
 * comillas dentro de un atributo.
 */

test('escaparHtml: neutraliza las etiquetas', () => {
  assert.equal(
    escaparHtml('<script>alert(1)</script>'),
    '&lt;script&gt;alert(1)&lt;/script&gt;'
  )
})

test('escaparHtml: el & va primero, no se escapan las entidades dos veces', () => {
  // Si `&` se reemplazara DESPUÉS de `<`, esto daría `&amp;lt;` y el lector
  // vería `&lt;` escrito en el correo en vez de `<`.
  assert.equal(escaparHtml('<'), '&lt;')
  assert.equal(escaparHtml('&'), '&amp;')
  assert.equal(escaparHtml('&lt;'), '&amp;lt;')
})

test('escaparHtml: cubre las comillas (el caso que la copia vieja fallaba)', () => {
  // Este es el motivo de unificar: con solo `<>&`, un valor en un atributo
  // entrecomillado puede cerrar la comilla y añadir atributos propios.
  assert.equal(
    escaparHtml('" onmouseover="robar()'),
    '&quot; onmouseover=&quot;robar()'
  )
  assert.equal(escaparHtml("'"), '&#39;')
})

test('escaparHtml: el texto corriente no se toca', () => {
  const normal = 'Taller El Tanque, S.R.L. — servicio de frenos (2026)'
  assert.equal(escaparHtml(normal), normal)
})

test('escaparHtml: la cadena vacía no explota', () => {
  assert.equal(escaparHtml(''), '')
})

/**
 * Reproduce el hueco real que se cerró: un ticket de soporte cuyo asunto y
 * descripción los escribe el cliente y acaban en el `html:` del correo que
 * recibe el buzón del negocio.
 */
test('escaparHtml: un ticket malicioso llega como texto, no como enlace', () => {
  const descripcion = 'Mi tarjeta falla. <a href="https://sitio-falso.example">Verifica tu cuenta aquí</a>'
  const escapada = escaparHtml(descripcion)

  assert.ok(!escapada.includes('<a href'), 'no debe quedar una etiqueta <a> viva')
  assert.ok(escapada.includes('&lt;a href='), 'debe verse el texto literal de la etiqueta')
})
