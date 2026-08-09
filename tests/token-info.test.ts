import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * `--info` ES UN ESTADO, NO UN ACENTO (DS 2.0 · Fase 16½).
 *
 * QUÉ PASÓ. En la Fase 0 `--info` estaba en tono 230 y la marca en 255: dos
 * azules casi iguales. Se desplazó `--info` a 215 —hoy es un cian, `#0097b3`,
 * a 0,165 de distancia perceptual de la marca— y con eso la confusión de color
 * quedó resuelta. Pero quedó lo otro: 34 clases que usaban `info` como "el
 * color de acento" en sitios donde no se estaba informando de nada.
 *
 * Eran de dos clases, y las dos dicen lo mismo:
 *
 *  · HOVER — pasar el ratón por una tarjeta no comunica un estado
 *    informativo. Ese acento es de la marca.
 *  · SELECCIÓN — "esto es lo que elegiste" lo dice `primary` en toda la app:
 *    las pestañas, los chips del mapa, el ítem activo del menú. Un plan
 *    seleccionado en cian rompía esa lectura, y encima su hover ya era azul.
 *
 * ESTA GUARDIA no persigue `info` —es un token legítimo y tiene su sitio en
 * `Badge`, `StatusBanner`, `StatusChip` y `AppIcon`—, sino su uso como acento.
 * Solo hay una excepción: el hover de la propia insignia informativa.
 */

const RAICES = ['src', 'packages/ui/src']

/** El hover de `Badge variant="info"` sí es info: es la insignia informativa. */
const EXENTOS = new Set([join('packages', 'ui', 'src', 'ui', 'badge.tsx')])

function archivosTsx(dir: string, acc: string[] = []): string[] {
  for (const entrada of readdirSync(dir)) {
    if (entrada === 'node_modules' || entrada === '.next') continue
    const ruta = join(dir, entrada)
    if (statSync(ruta).isDirectory()) archivosTsx(ruta, acc)
    else if (ruta.endsWith('.tsx')) acc.push(ruta)
  }
  return acc
}

const HOVER_INFO = /(?:group-)?(?:hover|focus|focus-visible):(?:text|bg|border|ring)-info\b/g

test('`info` no se usa como color de hover', () => {
  const infractores: string[] = []
  for (const raiz of RAICES) {
    for (const archivo of archivosTsx(raiz)) {
      if (EXENTOS.has(archivo)) continue
      for (const m of readFileSync(archivo, 'utf8').matchAll(HOVER_INFO)) {
        infractores.push(`${archivo}: ${m[0]}`)
      }
    }
  }
  assert.deepEqual(
    infractores,
    [],
    'Un hover no informa de nada: ese acento es `primary`.\n' + infractores.join('\n')
  )
})

test('`info` no se mezcla con `primary` en el mismo elemento', () => {
  // `bg-info/15 text-primary` era el patrón: fondo de un token y contenido de
  // otro en el mismo chip. Nunca es intencional; es un token a medio cambiar.
  const MEZCLA = /class(?:Name)?="[^"]*\b(?:bg|border|ring)-info(?:\/\d+)?\b[^"]*\btext-primary\b[^"]*"/g
  const infractores: string[] = []
  for (const raiz of RAICES) {
    for (const archivo of archivosTsx(raiz)) {
      for (const m of readFileSync(archivo, 'utf8').matchAll(MEZCLA)) {
        infractores.push(`${archivo}: ${m[0].slice(0, 90)}…`)
      }
    }
  }
  assert.deepEqual(infractores, [], 'Elige un token para el elemento entero:\n' + infractores.join('\n'))
})

test('el token sigue existiendo y con su propio tono', () => {
  // Retirarlo habría borrado `variant="info"` de cuatro primitivos y con él la
  // capacidad de decir "aviso neutro", distinto de éxito, alerta y error. El
  // problema nunca fue el token: era usarlo donde no se informaba.
  const css = readFileSync(join('src', 'app', 'globals.css'), 'utf8')
  const info = css.match(/--info:\s*oklch\([\d.]+\s+[\d.]+\s+(\d+)\)/)
  const primary = css.match(/--primary:\s*oklch\([\d.]+\s+[\d.]+\s+(\d+)\)/)
  assert.ok(info && primary, 'faltan --info o --primary en globals.css')

  const separacion = Math.abs(Number(info![1]) - Number(primary![1]))
  assert.ok(
    separacion >= 30,
    `--info (${info![1]}) y --primary (${primary![1]}) están a ${separacion}° de tono. ` +
      'Con menos de 30° vuelven a leerse como el mismo color, que es de donde se venía.'
  )
})
