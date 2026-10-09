import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { rutaDeEmpresa } from '../src/modules/comercio/rutas'

/**
 * EL MAPA DE RUTAS ENTRE LA LANDING Y LA APP (separación · F1).
 *
 * `tsc` obliga a que cada `<TarjetaOferta>` declare su `espacio`, pero no a que
 * diga la verdad: una pantalla de la app que escribiera `espacio="publico"`
 * compilaría y sacaría al cliente a la landing. Eso es lo que vigila el segundo
 * test.
 */

const RAIZ = join(import.meta.dirname, '..')

test('la vitrina de una empresa tiene una ruta por espacio', () => {
  assert.equal(rutaDeEmpresa('publico', 'tech-store'), '/empresas/tech-store')
  assert.equal(rutaDeEmpresa('app', 'tech-store'), '/cliente/empresas/tech-store')
})

test('las rutas de la app no salen del prefijo /cliente y las públicas no lo usan', () => {
  for (const slug of ['a', 'con-guion', 'x1']) {
    assert.match(rutaDeEmpresa('app', slug), /^\/cliente\//)
    assert.doesNotMatch(rutaDeEmpresa('publico', slug), /^\/cliente/)
  }
})

function tsx(dir: string): string[] {
  const acc: string[] = []
  for (const e of readdirSync(join(RAIZ, dir))) {
    const p = join(RAIZ, dir, e)
    if (statSync(p).isDirectory()) acc.push(...tsx(relative(RAIZ, p)))
    else if (p.endsWith('.tsx')) acc.push(relative(RAIZ, p))
  }
  return acc
}

test('cada tarjeta de oferta declara el espacio que le corresponde a donde se pinta', () => {
  const esDeLaApp = (f: string) => f.startsWith('src/app/(cliente)') || f.startsWith('src/components/cliente/')
  const esDeLaLanding = (f: string) => f.startsWith('src/app/(public)')
  const usos: string[] = []
  for (const f of [...tsx('src/app'), ...tsx('src/components')]) {
    const src = readFileSync(join(RAIZ, f), 'utf8')
    for (const m of src.matchAll(/<TarjetaOferta\b[^>]*?(?:\/>|>)/g)) {
      usos.push(f)
      const etiqueta = m[0]
      const espacio = etiqueta.match(/espacio=(?:"(\w+)"|\{([^}]+)\})/)
      assert.ok(espacio, `${f}: <TarjetaOferta> sin espacio`)
      const valor = espacio[1] ?? espacio[2]
      if (esDeLaApp(f)) assert.equal(valor, 'app', `${f}: la app debe pasar espacio="app"`)
      else if (esDeLaLanding(f)) assert.equal(valor, 'publico', `${f}: la landing debe pasar espacio="publico"`)
      else assert.match(valor, /isApp|app|publico/, `${f}: el espacio debe salir del modo del componente`)
    }
  }
  assert.ok(usos.length >= 5, 'el detector debe encontrar los usos de la tarjeta')
})

test('el componente de la tarjeta no escribe a mano la ruta de la empresa', () => {
  const src = readFileSync(join(RAIZ, 'src/components/deals/TarjetaOferta.tsx'), 'utf8')
  assert.match(src, /rutaDeEmpresa\(espacio,/)
  assert.doesNotMatch(src, /`\/empresas\//)
})
