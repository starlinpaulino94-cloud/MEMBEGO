import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  slugificar,
  slugDisponible,
  pareceId,
  rutaPublicaPromo,
  MAX_SLUG,
} from '../src/modules/promociones/slug'

/**
 * El slug es la dirección pública de una promoción: lo que se pega en WhatsApp.
 * Un error aquí no se ve en el panel — se ve cuando un cliente abre el enlace
 * que le mandaron y encuentra un 404.
 */

test('un título con acentos y símbolos se vuelve una URL legible', () => {
  assert.equal(slugificar('¡Lavado Premium GRATIS!'), 'lavado-premium-gratis')
  assert.equal(slugificar('Promoción de Año Nuevo'), 'promocion-ano-nuevo')
  assert.equal(slugificar('2x1 en cera & brillo'), '2x1-cera-brillo')
})

test('la ñ no desaparece: se convierte en n', () => {
  // Sin este cuidado, «Año» quedaría «ao» y el enlace perdería la palabra.
  assert.equal(slugificar('Año'), 'ano')
  assert.equal(slugificar('Mañana'), 'manana')
})

test('las palabras vacías se van, salvo que no quede nada', () => {
  assert.equal(slugificar('El lavado de la semana'), 'lavado-semana')
  // Si solo hay palabras vacías, es preferible un slug feo a una URL vacía.
  assert.equal(slugificar('De la y el'), 'de-la-y-el')
})

test('un título imposible no deja el slug vacío sin avisar', () => {
  assert.equal(slugificar('¿¡!?'), '')
  assert.equal(slugificar('   '), '')
  // Quien lo use decide la reserva; el núcleo no inventa nombres a escondidas.
  assert.equal(slugDisponible('¿¡!?', []), 'promocion')
})

test('un título larguísimo se corta por palabra completa y respeta el tope', () => {
  const largo = slugificar(
    'Lavado premium completo con cera carnauba brillo de llantas y aspirado profundo interior'
  )
  assert.ok(largo.length <= MAX_SLUG, `mide ${largo.length}`)
  assert.ok(!largo.endsWith('-'), 'no debe terminar en guion')
  // Cortar a media palabra deja cosas como «aspir»: se corta antes del guion.
  assert.ok(!/-[a-z]{1,3}$/.test(largo) || largo.split('-').every((p) => p.length > 0))
})

test('dos promociones con el mismo título no se pisan', () => {
  assert.equal(slugDisponible('Lavado Premium', []), 'lavado-premium')
  assert.equal(slugDisponible('Lavado Premium', ['lavado-premium']), 'lavado-premium-2')
  assert.equal(
    slugDisponible('Lavado Premium', ['lavado-premium', 'lavado-premium-2']),
    'lavado-premium-3'
  )
})

test('el sufijo no hace crecer el slug por encima del tope', () => {
  const titulo = 'a'.repeat(80)
  const base = slugificar(titulo)
  const segundo = slugDisponible(titulo, [base])
  assert.ok(segundo.length <= MAX_SLUG, `mide ${segundo.length}`)
  assert.ok(segundo.endsWith('-2'))
})

test('los slugs ocupados se comparan sin importar mayúsculas', () => {
  assert.equal(slugDisponible('Lavado Premium', ['LAVADO-PREMIUM']), 'lavado-premium-2')
})

test('se distingue un id viejo de la base de un slug', () => {
  // Los enlaces ya compartidos llevan el id: deben seguir resolviéndose.
  assert.equal(pareceId('cmd7k2p9x0001qz3f8b2h4t1a'), true)
  assert.equal(pareceId('lavado-premium'), false)
  assert.equal(pareceId('promo2026'), false)
  assert.equal(pareceId('cera'), false, 'empieza con c pero es una palabra')
})

test('la ruta pública prefiere el slug y cae al id si no lo hay', () => {
  assert.equal(rutaPublicaPromo({ id: 'abc123', slug: 'lavado-premium' }), '/promocion/lavado-premium')
  assert.equal(rutaPublicaPromo({ id: 'abc123', slug: null }), '/promocion/abc123')
  assert.equal(rutaPublicaPromo({ id: 'abc123', slug: '' }), '/promocion/abc123')
})
