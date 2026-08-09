import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { auditar, contraste } from '../scripts/contraste.mjs'

/**
 * CONTRASTE DE LOS TOKENS (WCAG 2.1 AA) — DS 2.0 · Fase 19.
 *
 * El contraste no se estima mirando. Un par que "se ve bien" en un monitor
 * bueno puede ser ilegible en un móvil al sol, que es donde se usa el escáner.
 * Son tres temas por diecisiete pares: a mano no se revisa nunca, y por eso
 * nadie lo revisaba.
 *
 * Lo que encontró al ejecutarse por primera vez, todo en tema claro:
 *   · texto de alerta   2.28:1  (mínimo 4.5)
 *   · texto informativo 3.44:1
 *   · texto de éxito    3.62:1
 *   · borde de tarjeta  1.29:1  — la tarjeta no se separaba de la página
 */

const css = () => readFileSync(join('src', 'app', 'globals.css'), 'utf8')

test('todos los pares de token cumplen su umbral en los tres temas', () => {
  const { fallos } = auditar(css())
  assert.deepEqual(
    fallos.map((f: { tema: string; que: string; ratio: number; minimo: number }) =>
      `${f.tema}: ${f.que} = ${f.ratio.toFixed(2)}:1 (min ${f.minimo})`
    ),
    []
  )
})

test('la auditoría detecta de verdad un par malo (prueba de la prueba)', () => {
  // Sin esto, un fallo en el parseo del CSS haría que la guardia pasara
  // siempre — verde por no encontrar nada, que es la peor forma de pasar.
  const roto = css().replace('--foreground: oklch(0.14 0.02 264)', '--foreground: oklch(0.97 0.02 264)')
  const { fallos } = auditar(roto)
  assert.ok(fallos.length > 0, 'la auditoría no detectó un texto casi blanco sobre fondo claro')
})

test('un blanco puro sobre blanco puro da 1:1', () => {
  assert.equal(Math.round(contraste([1, 0, 0], [1, 0, 0])), 1)
})

/**
 * `--x-foreground` ES EL TEXTO QUE VA ENCIMA DEL RELLENO SÓLIDO `bg-x`.
 *
 * Usarlo como texto sobre un tinte (`bg-warning/15`) o sobre una tarjeta es
 * una categoría equivocada, y estaba en 103 sitios. Lo grave es cuánto se
 * notaba: NADA. En tema oscuro daba 1.06:1 —texto invisible— y
 * `success`/`info` fallaban también en claro con 1.03:1. Nadie lo reportó
 * porque el texto no desaparece: se funde con el fondo, y quien lo ve asume
 * que ahí no había nada escrito.
 *
 * Para texto se usa el token semántico a secas (`text-warning`), que desde
 * esta fase pasa AA en los tres temas.
 */
test('los tokens -foreground solo se usan sobre su relleno sólido', () => {
  const RAICES = ['src', 'packages/ui/src']
  const FG = /\btext-(warning|success|info)-foreground\b/g
  const SOLIDO = /\bbg-(warning|success|info)(?![/\w-])/

  function archivosTsx(dir: string, acc: string[] = []): string[] {
    for (const entrada of readdirSync(dir)) {
      if (entrada === 'node_modules' || entrada === '.next') continue
      const ruta = join(dir, entrada)
      if (statSync(ruta).isDirectory()) archivosTsx(ruta, acc)
      else if (ruta.endsWith('.tsx')) acc.push(ruta)
    }
    return acc
  }

  const infractores: string[] = []
  for (const raiz of RAICES) {
    for (const archivo of archivosTsx(raiz)) {
      const src = readFileSync(archivo, 'utf8')
      src.split('\n').forEach((linea, i) => {
        const solidos = new Set([...linea.matchAll(new RegExp(SOLIDO, 'g'))].map((m) => m[1]))
        for (const m of linea.matchAll(FG)) {
          if (!solidos.has(m[1])) infractores.push(`${archivo}:${i + 1} ${m[0]}`)
        }
      })
    }
  }
  assert.deepEqual(
    infractores,
    [],
    'Para texto usa `text-warning` / `text-success` / `text-info`; ' +
      'el `-foreground` solo va sobre el relleno sólido:\n' + infractores.join('\n')
  )
})
