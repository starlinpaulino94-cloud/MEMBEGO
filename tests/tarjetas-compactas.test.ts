import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Las tarjetas de producto y de oferta son COMPACTAS, como en un marketplace: de a
 * dos por fila en el móvil y con la foto cuadrada del formato del catálogo. Una
 * tarjeta a todo el ancho (o un carril de tarjetas de 14 rem) ocupa media pantalla
 * por producto y obliga a deslizar mucho para ver tres. Estas pruebas fijan la
 * decisión para que una lista nueva no vuelva a pintarse en una sola columna.
 */

const RAIZ = process.cwd()
const leer = (ruta: string) => readFileSync(join(RAIZ, ruta), 'utf8')

function tsx(dir: string): string[] {
  const acc: string[] = []
  for (const e of readdirSync(join(RAIZ, dir))) {
    const p = join(RAIZ, dir, e)
    if (statSync(p).isDirectory()) acc.push(...tsx(relative(RAIZ, p)))
    else if (p.endsWith('.tsx')) acc.push(relative(RAIZ, p))
  }
  return acc
}

test('la tarjeta de producto es compacta: foto cuadrada, nombre en dos líneas y relleno chico', () => {
  const src = leer('src/components/catalogo/TarjetaCatalogoPublica.tsx')
  assert.match(src, /aspect-square/)
  assert.match(src, /line-clamp-2/)
  assert.match(src, /p-2\.5/)
  assert.doesNotMatch(src, /p-4/, 'el relleno de 1 rem era lo que la hacía ancha y alta')
  assert.match(src, /sizes="\(max-width: 640px\) 50vw/, 'la foto se pide al tamaño de media pantalla, no a todo el ancho')
})

test('la tarjeta de oferta es compacta en las listas y completa solo en la página de la oferta', () => {
  const src = leer('src/components/deals/TarjetaOferta.tsx')
  assert.match(src, /detalle = false/)
  assert.match(src, /line-clamp-2/)
  for (const pagina of ['src/app/(cliente)/cliente/ofertas/[dealId]/page.tsx', 'src/app/(public)/ofertas/[dealId]/page.tsx']) {
    const tarjeta = leer(pagina).match(/<TarjetaOferta\b[\s\S]*?\/>/)
    assert.ok(tarjeta, `${pagina}: usa la tarjeta`)
    assert.match(tarjeta[0], /\bdetalle\b/, `${pagina}: la página de UNA oferta enseña la tarjeta completa`)
  }
})

test('toda lista de tarjetas arranca en dos columnas (nunca una sola) en el móvil', () => {
  const conTarjetas = [...tsx('src/app'), ...tsx('src/components')].filter((f) => /<Tarjeta(CatalogoPublica|Oferta)\b/.test(leer(f)))
  assert.ok(conTarjetas.length >= 8, 'el detector debe encontrar las pantallas con tarjetas')
  let listas = 0
  for (const f of conTarjetas) {
    const src = leer(f)
    for (const m of src.matchAll(/<Tarjeta(?:CatalogoPublica|Oferta)\b/g)) {
      // La rejilla es el último `className` con «grid» antes de la tarjeta.
      const antes = src.slice(Math.max(0, m.index! - 700), m.index!)
      const rejillas = [...antes.matchAll(/className="([^"]*\bgrid\b[^"]*)"/g)]
      if (rejillas.length === 0) continue // una sola tarjeta (página de la oferta) o un carril
      const clases = rejillas[rejillas.length - 1][1]
      listas++
      assert.match(clases, /\bgrid-cols-2\b/, `${f}: la lista de tarjetas debe empezar en 2 columnas (tiene «${clases}»)`)
      assert.doesNotMatch(clases, /\bgrid-cols-1\b/, `${f}: una columna deja una tarjeta por pantalla`)
    }
  }
  assert.ok(listas >= 10, `se esperaban ≥10 usos en lista y hay ${listas}`)
})

test('los carriles del inicio usan tarjetas angostas, para que se vea más de una a la vez', () => {
  const src = leer('src/components/cliente/inicio/VibeComercio.tsx')
  const anchos = [...src.matchAll(/className="w-(\d+) shrink-0 sm:w-(\d+)"/g)].map((m) => ({ movil: Number(m[1]), sm: Number(m[2]) }))
  assert.equal(anchos.length, 2, 'un carril de ofertas y uno de productos')
  for (const a of anchos) {
    assert.ok(a.movil <= 44, `w-${a.movil} (${a.movil / 4} rem) es demasiado ancha para el móvil: ocuparía más de la mitad de la pantalla`)
    assert.ok(a.sm <= 56, `w-${a.sm} es demasiado ancha para escritorio`)
  }
})
