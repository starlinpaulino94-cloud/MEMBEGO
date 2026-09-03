#!/usr/bin/env node
/**
 * AUDITORÍA DE CONTRASTE DE LOS TOKENS (WCAG 2.1) — DS 2.0 · Fase 19.
 *
 * Lee `src/app/globals.css`, resuelve los tokens OKLCH de cada tema y calcula
 * el contraste de los pares que de verdad aparecen juntos en pantalla.
 *
 * POR QUÉ UN SCRIPT Y NO EL OJO: el contraste no se estima mirando. Un par que
 * "se ve bien" en un monitor bueno a las tres de la tarde puede ser ilegible en
 * un móvil al sol, que es donde se usa el escáner. Y son tres temas (claro,
 * oscuro y landing) por unos veinte pares: a mano no se revisa nunca, y por eso
 * nadie lo hacía.
 *
 * Se ejecuta con `node scripts/contraste.mjs`. La prueba
 * `tests/contraste-tokens.test.ts` usa este mismo cálculo como guardia.
 */

import { readFileSync } from 'node:fs'

// ── OKLCH → sRGB → luminancia relativa ──────────────────────────────────────

/** OKLCH a sRGB lineal (Björn Ottosson). Devuelve componentes 0..1 recortadas. */
function oklchALinear(L, C, H) {
  const h = (H * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b
  const l = l_ ** 3
  const m = m_ ** 3
  const s = s_ ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((v) => Math.max(0, Math.min(1, v)))
}

/** Luminancia relativa WCAG. La entrada YA es lineal, así que no se degamma. */
function luminancia([r, g, b]) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contraste(colorA, colorB) {
  const a = luminancia(oklchALinear(...colorA))
  const b = luminancia(oklchALinear(...colorB))
  const [claro, oscuro] = a > b ? [a, b] : [b, a]
  return (claro + 0.05) / (oscuro + 0.05)
}

// ── Lectura de los tokens ───────────────────────────────────────────────────

const TOKEN = /^\s*(--[a-z0-9-]+):\s*oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*[\d.%]+)?\)/gm

/** Extrae los tokens OKLCH de un bloque de reglas (`:root`, `.dark`, …). */
export function leerTokens(css, selector) {
  const inicio = css.indexOf(selector + ' {')
  if (inicio === -1) throw new Error(`No se encontró el bloque ${selector}`)
  const fin = css.indexOf('\n}', inicio)
  const bloque = css.slice(inicio, fin)
  const out = {}
  for (const m of bloque.matchAll(TOKEN)) {
    out[m[1]] = [Number(m[2]), Number(m[3]), Number(m[4])]
  }
  return out
}

/**
 * Pares que aparecen juntos en pantalla de verdad.
 *
 * `minimo` es el umbral WCAG que le toca a cada uno:
 *  · 4.5 → texto normal (AA)
 *  · 3.0 → texto grande (≥24px o ≥19px en negrita) y bordes/iconos (AA no textual)
 */
export const PARES = [
  { texto: '--foreground', fondo: '--background', minimo: 4.5, que: 'Texto sobre el fondo' },
  { texto: '--card-foreground', fondo: '--card', minimo: 4.5, que: 'Texto sobre tarjeta' },
  { texto: '--popover-foreground', fondo: '--popover', minimo: 4.5, que: 'Texto sobre popover' },
  { texto: '--muted-foreground', fondo: '--background', minimo: 4.5, que: 'Texto secundario' },
  { texto: '--muted-foreground', fondo: '--card', minimo: 4.5, que: 'Texto secundario en tarjeta' },
  { texto: '--primary-foreground', fondo: '--primary', minimo: 4.5, que: 'Botón principal' },
  { texto: '--destructive-foreground', fondo: '--destructive', minimo: 4.5, que: 'Botón destructivo' },
  { texto: '--sidebar-foreground', fondo: '--sidebar', minimo: 4.5, que: 'Texto del menú' },
  { texto: '--sidebar-primary', fondo: '--sidebar', minimo: 4.5, que: 'Ítem activo del menú' },
  // DS 3.0 - Navegacion de dos niveles: el riel es otra superficie, asi que
  // el texto de encima necesita su propia medida. Y la pastilla de seleccion
  // es un relleno solido, no un tinte: se audita como un boton.
  { texto: '--sidebar-foreground', fondo: '--sidebar-rail', minimo: 4.5, que: 'Texto sobre el riel' },
  { texto: '--sidebar-selected-foreground', fondo: '--sidebar-selected', minimo: 4.5, que: 'Modulo seleccionado' },
  { texto: '--primary', fondo: '--background', minimo: 4.5, que: 'Enlace de marca' },
  { texto: '--primary', fondo: '--card', minimo: 4.5, que: 'Enlace de marca en tarjeta' },
  { texto: '--success', fondo: '--card', minimo: 4.5, que: 'Texto de éxito' },
  { texto: '--warning', fondo: '--card', minimo: 4.5, que: 'Texto de alerta' },
  { texto: '--destructive', fondo: '--card', minimo: 4.5, que: 'Texto de error' },
  { texto: '--info', fondo: '--card', minimo: 4.5, que: 'Texto informativo' },
  // DS 2.0 · Fase 1. El estado PENDIENTE no existía: se resolvía con
  // `--muted-foreground`, el color del texto secundario. Un estado que comparte
  // color con «esto es menos importante» no se lee como estado — y nadie lo
  // había medido como texto, que es como se usa.
  { texto: '--pending', fondo: '--card', minimo: 4.5, que: 'Texto pendiente' },
  { texto: '--ring', fondo: '--background', minimo: 3, que: 'Anillo de foco' },
  { texto: '--border', fondo: '--card', minimo: 1.4, que: 'Borde de tarjeta (separación visible)' },
]

export const TEMAS = [
  { nombre: 'claro', selector: ':root' },
  { nombre: 'oscuro', selector: '.dark' },
  { nombre: 'landing', selector: '.theme-landing' },
]

/** Evalúa todos los pares en todos los temas. Devuelve solo los que fallan. */
export function auditar(css) {
  const base = leerTokens(css, ':root')
  const fallos = []
  const todos = []
  for (const tema of TEMAS) {
    // Un tema hereda de `:root` lo que no redefine.
    const tokens = { ...base, ...leerTokens(css, tema.selector) }
    for (const par of PARES) {
      const a = tokens[par.texto]
      const b = tokens[par.fondo]
      if (!a || !b) continue
      const ratio = contraste(a, b)
      const fila = { tema: tema.nombre, ...par, ratio }
      todos.push(fila)
      if (ratio < par.minimo) fallos.push(fila)
    }
  }
  return { todos, fallos }
}

// ── Ejecución directa ───────────────────────────────────────────────────────

if (process.argv[1]?.endsWith('contraste.mjs')) {
  const css = readFileSync('src/app/globals.css', 'utf8')
  const { todos, fallos } = auditar(css)
  let temaActual = ''
  for (const f of todos) {
    if (f.tema !== temaActual) {
      temaActual = f.tema
      console.log(`\n── ${temaActual.toUpperCase()} ${'─'.repeat(52 - temaActual.length)}`)
    }
    const ok = f.ratio >= f.minimo
    console.log(
      `${ok ? '  ' : '✗ '}${f.que.padEnd(34)} ${f.ratio.toFixed(2).padStart(6)}:1   (min ${f.minimo})`
    )
  }
  console.log(
    fallos.length === 0
      ? '\n✓ Todos los pares cumplen su umbral.'
      : `\n✗ ${fallos.length} par(es) por debajo del umbral.`
  )
  process.exit(fallos.length === 0 ? 0 : 1)
}
