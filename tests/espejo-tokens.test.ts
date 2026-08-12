import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
// `.mjs` sin tipos: se declara la forma que devuelve para no indexar un `{}`.
import { leerTokens as leerTokensSinTipar } from '../scripts/contraste.mjs'

import { state, primary, cyanBrand } from '../packages/ui/src/tokens'

const leerTokens = leerTokensSinTipar as (
  css: string,
  selector: string
) => Record<string, [number, number, number] | undefined>

/**
 * EL ESPEJO DE TOKENS NO PUEDE DESINCRONIZARSE (DS 2.0 · Fase 20).
 *
 * Los valores de diseño viven en dos sitios a propósito: `globals.css` manda
 * en la web, y `packages/ui/src/tokens.ts` es su espejo en hexadecimal para lo
 * que NO pasa por CSS — la app móvil, los correos, las imágenes OG y los PDFs.
 *
 * PASÓ DE VERDAD, Y EN ESTE MISMO TRABAJO. La Fase 19 oscureció `--success`,
 * `--warning` e `--info` para que llegaran a AA como texto, y no tocó el
 * espejo. Durante dos fases, un correo o un comprobante habrían salido con los
 * colores viejos —los que fallaban el contraste— mientras la web ya usaba los
 * corregidos. Nada habría avisado: son dos archivos que nadie lee juntos.
 *
 * Esta guardia los lee juntos.
 */

const OKLCH_A_HEX = (L: number, C: number, H: number): string => {
  const h = (H * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const lineal = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
  return (
    '#' +
    lineal
      .map((v) => {
        const c = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(0, v), 1 / 2.4) - 0.055
        return Math.max(0, Math.min(255, Math.round(c * 255)))
          .toString(16)
          .padStart(2, '0')
      })
      .join('')
  )
}

/** Distancia entre dos hex, componente a componente (0–255). */
function distancia(a: string, b: string): number {
  const comp = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
  const [x, y] = [comp(a), comp(b)]
  return Math.max(...x.map((v, i) => Math.abs(v - y[i])))
}

test('los estados semánticos del espejo coinciden con globals.css', () => {
  const css = readFileSync(join('src', 'app', 'globals.css'), 'utf8')
  const tokens = leerTokens(css, ':root')

  const pares: [keyof typeof state, string][] = [
    ['success', '--success'],
    ['warning', '--warning'],
    ['info', '--info'],
    ['danger', '--destructive'],
  ]

  for (const [clave, token] of pares) {
    const oklch = tokens[token]
    assert.ok(oklch, `falta ${token} en globals.css`)
    const esperado = OKLCH_A_HEX(oklch[0], oklch[1], oklch[2])
    const real = state[clave]
    // Tolerancia de 2/255: la conversión OKLCH→sRGB redondea, y exigir el hex
    // exacto convertiría la guardia en una molestia sin ganar precisión.
    assert.ok(
      distancia(esperado, real) <= 2,
      `state.${clave} = ${real} pero ${token} equivale a ${esperado}. ` +
        'Los correos y los PDFs saldrían con el color viejo.'
    )
  }
})

/**
 * LA ESCALA DE MARCA — el hueco por el que se coló A-13.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA GUARDIA DE ARRIBA MIRABA CUATRO TOKENS DE VEINTICUATRO
 *
 * Comparaba `success`, `warning`, `info` y `danger`. La ESCALA DE MARCA no la
 * miraba nadie, y llevaba tiempo separada: `globals.css` decía un azul puro y
 * `tokens.ts` el azul de Tailwind, con 65 unidades sRGB de distancia en el paso
 * 500 — se ven distintos.
 *
 * Se notaba donde el cliente lo ve: el espejo alimenta correos, imágenes al
 * compartir, PDFs y recibos. Quien recibía un correo de MembeGo y abría la
 * aplicación veía DOS AZULES DE MARCA distintos.
 *
 * Y explicaba una contradicción que parecía documental: `MDS.md` decía que el
 * azul era `#2563eb` porque leyó el espejo; la interfaz pintaba `#006bed`. Los
 * dos documentos tenían razón — lo que no coincidía eran las dos fuentes.
 *
 * Se descubrió convirtiendo los OKLCH a hex para documentarlos, en vez de
 * copiar los del espejo. Una guardia parcial da la sensación de estar cubierto
 * sin estarlo, que es peor que no tener guardia.
 */
test('la escala de marca del espejo coincide con globals.css', () => {
  const css = readFileSync(join('src', 'app', 'globals.css'), 'utf8')
  // Las escalas numéricas viven en `@theme inline`, no en `:root`.
  const tokens = leerTokens(css, '@theme inline')

  for (const paso of [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const) {
    const oklch = tokens[`--color-primary-${paso}`]
    assert.ok(oklch, `falta --color-primary-${paso} en globals.css`)
    const esperado = OKLCH_A_HEX(oklch[0], oklch[1], oklch[2])
    const real = primary[paso]
    assert.ok(
      distancia(esperado, real) <= 2,
      `primary[${paso}] = ${real} pero --color-primary-${paso} equivale a ${esperado}. ` +
        'Es A-13: el correo saldría con un azul de marca y la aplicación con otro.'
    )
  }
})

test('la escala cyan del espejo coincide con globals.css', () => {
  const css = readFileSync(join('src', 'app', 'globals.css'), 'utf8')
  const tokens = leerTokens(css, '@theme inline')

  for (const paso of [300, 500, 700] as const) {
    const oklch = tokens[`--color-cyan-brand-${paso}`]
    assert.ok(oklch, `falta --color-cyan-brand-${paso} en globals.css`)
    const esperado = OKLCH_A_HEX(oklch[0], oklch[1], oklch[2])
    assert.ok(
      distancia(esperado, cyanBrand[paso]) <= 2,
      `cyanBrand[${paso}] = ${cyanBrand[paso]} pero equivale a ${esperado}.`
    )
  }
})

test('el espejo no conserva alias retirados', () => {
  // `landingPrimary` era un alias de `primary[600]` que sobrevivió a la Fase 0
  // "para no romper importaciones" y al que nadie importaba.
  const src = readFileSync(join('packages', 'ui', 'src', 'tokens.ts'), 'utf8')
  assert.ok(!src.includes('landingPrimary'), 'landingPrimary se retiró en la Fase 20')
})
