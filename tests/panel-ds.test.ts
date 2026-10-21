import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, sep } from 'node:path'

/**
 * EL ÁMBITO `.panel-ds`: DEFINIDO Y APAGADO (docs/auditoria-admin/12, fase 4 · tarea 4.8).
 *
 * La fase 4 promete «sin cambiar ninguna pantalla». El sistema tipográfico del panel (Inter, base 14/20, títulos en 600) se
 * define en `globals.css` detrás de la clase `.panel-ds`, que comparte archivo con el cliente. Esta prueba hace verificable la
 * promesa en las dos direcciones:
 *
 *   · LO DEFINIDO ES LO ESPECIFICADO. Los valores de `10` §2 están en el CSS, no «parecidos».
 *   · NADIE LO ENCIENDE TODAVÍA. Ningún archivo de `src/` aplica `panel-ds` ni importa la fuente del panel. Encenderlo es la
 *     fase 5 y es UN cambio en `AppShell`: entonces el contador de abajo pasa de 0 a 1 y esta prueba se actualiza a propósito,
 *     en el mismo commit, junto con la comparación de capturas. Si alguien lo enciende sin pasar por ahí, falla aquí.
 */

const RAIZ = join(import.meta.dirname, '..')
const CSS = readFileSync(join(RAIZ, 'src/app/globals.css'), 'utf8')

function archivos(dir: string): string[] {
  const acc: string[] = []
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) acc.push(...archivos(p))
    else if (/\.(tsx?|css)$/.test(p)) acc.push(p)
  }
  return acc
}
const rel = (p: string) => p.slice(RAIZ.length + 1).split(sep).join('/')

/** El bloque CSS de una regla (hasta su `}`), para comprobar sus valores sin depender del formato. */
function regla(selector: string): string {
  const i = CSS.indexOf(`${selector} {`)
  assert.ok(i >= 0, `no encuentro la regla «${selector}» en globals.css`)
  return CSS.slice(i, CSS.indexOf('}', i) + 1).replace(/\/\*[\s\S]*?\*\//g, '')
}

test('`.panel-ds` define la escala de docs/auditoria-admin/10 §2, con sus valores', () => {
  assert.match(regla('.panel-ds'), /font-size: 0\.875rem;[\s\S]*line-height: 1\.25rem;[\s\S]*font-variant-numeric: tabular-nums/, 'base 14/20 con cifras tabulares')
  assert.match(regla('.panel-ds'), /--font-panel-inter/, 'Inter')
  const h1 = regla('.panel-ds .text-h1')
  assert.match(h1, /font-size: 1\.5rem;[\s\S]*line-height: 2rem;[\s\S]*font-weight: 600/, 'título de página 24/32 en 600')
  assert.match(regla('.panel-ds .text-h2'), /font-size: 1\.125rem;[\s\S]*line-height: 1\.5rem;[\s\S]*font-weight: 600/, 'título de sección 18/24 en 600')
  assert.match(regla('.panel-ds .text-h3,\n.panel-ds .text-h4'), /font-size: 1rem;[\s\S]*line-height: 1\.375rem;[\s\S]*font-weight: 600/, 'título de tarjeta 16/22 en 600')
  assert.match(regla('.panel-ds .text-small'), /font-size: 0\.8125rem;[\s\S]*line-height: 1\.125rem/, 'texto secundario 13/18')
  assert.match(regla('.panel-ds .text-caption,\n.panel-ds .text-overline'), /font-size: 0\.75rem;[\s\S]*line-height: 1rem/, 'etiqueta 12/16: el suelo de 12 px se mantiene')
  assert.match(CSS, /@media \(max-width: 639px\) \{\s*\.panel-ds \.text-h1 \{ font-size: 1\.25rem; line-height: 1\.75rem; \}/, 'bajo 640 px el título es 20/28')
})

test('el peso máximo del panel es 600 (se retira el 800 de los títulos)', () => {
  const bloque = CSS.slice(CSS.indexOf('.panel-ds {'))
  assert.doesNotMatch(bloque, /font-weight: ?(?:700|800|900)/)
})

test('`.text-kpi` es una sola talla de cifra: 28/32 en 600, y 24/28 bajo 640 px', () => {
  assert.match(regla('.text-kpi'), /font-size: 1\.75rem;[\s\S]*font-weight: 600[\s\S]*line-height: 2rem/)
  assert.match(CSS, /\.text-kpi \{ font-size: 1\.5rem; line-height: 1\.75rem; \}/)
})

test('«pendiente» está expuesto a Tailwind UNA vez y su token existe en claro y en oscuro', () => {
  // Ya estaba expuesto antes de la fase 4 (`@theme inline`); una segunda declaración sería un duplicado sin efecto.
  assert.equal((CSS.match(/--color-pending: var\(--pending\);/g) ?? []).length, 1, '--color-pending se declara una sola vez')
  assert.equal((CSS.match(/^\s*--pending: /gm) ?? []).length >= 2, true, 'el token --pending en al menos dos temas')
})

test('NADIE enciende `.panel-ds` ni importa la fuente del panel todavía (la fase 4 no cambia pantallas)', () => {
  const usos = archivos(join(RAIZ, 'src'))
    .filter((p) => !rel(p).endsWith('app/globals.css'))
    .filter((p) => !rel(p).endsWith('components/layout/fuente-panel.ts'))
    .filter((p) => /panel-ds|fuentePanel|fuente-panel/.test(readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')))
    .map(rel)
  assert.deepEqual(usos, [], 'Algo enciende el ámbito del panel. Es la fase 5 y requiere comparar capturas: actualiza esta prueba en ese commit.')
})

test('el módulo de la fuente del panel carga Inter como variable, sin precarga', () => {
  const src = readFileSync(join(RAIZ, 'src/components/layout/fuente-panel.ts'), 'utf8')
  assert.match(src, /Inter\(\{[\s\S]*variable: '--font-panel-inter'[\s\S]*preload: false/)
  assert.doesNotMatch(src.replace(/\/\*[\s\S]*?\*\//g, ''), /weight:/, 'una fuente variable no fija pesos: cubre 100–900')
})

test('el cliente no cambió: `.retail` conserva su fuente y sus colores', () => {
  const retail = regla('.retail')
  assert.match(retail, /--font-sans: var\(--font-inter\)/)
  assert.match(retail, /color-scheme: light/)
})
