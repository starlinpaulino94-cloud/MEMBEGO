import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * El enlace «← volver» de las pantallas de Car Wash apuntaba a `/admin/app/carwash`, una ruta que no tiene página: daba un 404 en
 * las trece. Ahora lleva al Resumen del panel. Esta prueba impide que vuelva a enlazarse a esa ruta mientras siga sin página.
 */
const raiz = join(__dirname, '..')
const carwash = join(raiz, 'src', 'app', '(admin)', 'admin', 'app', 'carwash')

test('las pantallas de Car Wash no enlazan a /admin/app/carwash mientras esa ruta no tenga página', () => {
  assert.equal(existsSync(join(carwash, 'page.tsx')), false, 'si ya existe la página, esta prueba sobra')
  const paginas = readdirSync(carwash, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => join(carwash, d.name, 'page.tsx'))
  assert.ok(paginas.length >= 13)
  const rotas = paginas.filter((f) => /href="\/admin\/app\/carwash"/.test(readFileSync(f, 'utf8')))
  assert.deepEqual(rotas, [])
})

test('el enlace de volver de Car Wash lleva al Resumen del panel', () => {
  const cola = readFileSync(join(carwash, 'cola', 'page.tsx'), 'utf8')
  assert.match(cola, /href="\/admin\/dashboard"[\s\S]{0,200}Resumen/)
})
