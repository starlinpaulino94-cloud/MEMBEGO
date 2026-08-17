import { test } from 'node:test'
import assert from 'node:assert/strict'

import { comparacionConstante } from '../src/lib/secretos'

/**
 * `autorizarCron` no se prueba directamente aquí: arrastra `next/server`, que
 * necesita el entorno de Next para construir un `NextRequest`. Lo que sí se
 * puede probar —y es donde estaba el fallo— es la primitiva de comparación.
 *
 * La diferencia de respuesta (503 sin secreto configurado vs 401 con
 * credencial mala) queda cubierta por lectura: son dos ramas explícitas en
 * `src/lib/cron-auth.ts`.
 */

test('comparacionConstante: iguales dan true', () => {
  assert.equal(comparacionConstante('Bearer abc123', 'Bearer abc123'), true)
})

test('comparacionConstante: distintos dan false', () => {
  assert.equal(comparacionConstante('Bearer abc123', 'Bearer abc124'), false)
})

test('comparacionConstante: longitudes distintas no lanzan', () => {
  // `timingSafeEqual` en crudo LANZA si los búferes miden distinto. El hash
  // previo es justo lo que evita que una credencial corta tumbe el endpoint
  // con un 500 en vez de devolver 401.
  assert.doesNotThrow(() => comparacionConstante('x', 'una credencial larguísima'))
  assert.equal(comparacionConstante('x', 'una credencial larguísima'), false)
})

test('comparacionConstante: la cadena vacía no acierta contra un secreto real', () => {
  assert.equal(comparacionConstante('', 'Bearer secreto'), false)
  assert.equal(comparacionConstante('', ''), true)
})

test('comparacionConstante: un prefijo correcto no basta', () => {
  // El punto del cambio: con `===` el tiempo de respuesta delata cuántos
  // caracteres se acertaron. La función debe tratar igual a quien acierta 1
  // carácter que a quien acierta 13.
  assert.equal(comparacionConstante('Bearer secreto', 'Bearer secretoX'), false)
  assert.equal(comparacionConstante('B', 'Bearer secreto'), false)
})
