import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * CONTRATO CANÓNICO DE DISEÑO DEL CLIENTE (Todo 1).
 *
 * Compara valores REALES extraídos de fuentes distintas (CSS, JS, MD) para
 * verificar que el primario del cliente, las paletas retail/vibe y la fuente
 * están alineados entre el contrato visual Stitch, globals.css y el tailwind
 * config de RN.
 *
 * NO es un test espejo (hex hardcoded contra sí mismo): parsea cada fuente
 * en su formato nativo y compara los valores resultantes.
 *
 * Docs: docs/design/client-design-contract.md
 */

// ── Helpers de parsing ───────────────────────────────────────────────────────

/** Extrae el valor hex de una variable CSS `--nombre: #xxxxxx` en un texto. */
function hexDeCSS(css: string, variable: string): string {
  const re = new RegExp(`${variable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*(#[0-9a-fA-F]{6})\\b`)
  const m = css.match(re)
  assert.ok(m, `No se encontró ${variable} como hex en globals.css`)
  return m[1].toLowerCase()
}

/** Extrae el valor DEFAULT de `primary` en tailwind.config.js (RN). */
function primaryDefaultDeTW(config: string): string {
  // Busca primary: { ... DEFAULT: '#xxxxxx' }
  const primaryBlock = config.match(/primary:\s*\{[^}]*\}/)
  assert.ok(primaryBlock, 'No se encontró el bloque primary en tailwind.config.js')
  const def = primaryBlock[0].match(/DEFAULT:\s*'(#[0-9a-fA-F]{6})'/)
  assert.ok(def, 'No se encontró primary.DEFAULT en tailwind.config.js')
  return def[1].toLowerCase()
}

/** Extrae el "Brand Primary" hex de la prosa del DESIGN.md de Stitch. */
function brandPrimaryDeStitch(md: string): string {
  // La prosa dice: **Brand Primary (`#0284C7`):**
  const m = md.match(/Brand Primary\s*\(`(#[0-9a-fA-F]{6})`\)/i)
  assert.ok(m, 'No se encontró "Brand Primary (`#xxxxxx`)" en la prosa del DESIGN.md')
  return m[1].toLowerCase()
}

/** Extrae la familia font-family del bloque sans en tailwind.config.js (RN). */
function fontFamilySansDeTW(config: string): string {
  const m = config.match(/fontFamily:\s*\{[^}]*sans:\s*\['([^']+)'/)
  assert.ok(m, 'No se encontró fontFamily.sans en tailwind.config.js')
  return m[1]
}

/** Extrae un token de paleta retail de globals.css (@theme inline). */
function retailTokenDeCSS(css: string, token: string): string {
  return hexDeCSS(css, `--color-${token}`)
}

/** Extrae un token de paleta retail del tailwind.config.js (RN). */
function retailTokenDeTW(config: string, token: string): string {
  // retail: { blue: '#0284c7', ... }
  const retailBlock = config.match(/retail:\s*\{([^}]*)\}/)
  assert.ok(retailBlock, 'No se encontró el bloque retail en tailwind.config.js')
  const re = new RegExp(`${token}:\\s*'(#[0-9a-fA-F]{6})'`)
  const m = retailBlock[1].match(re)
  assert.ok(m, `No se encontró retail.${token} en tailwind.config.js`)
  return m[1].toLowerCase()
}

// ── Fuentes ──────────────────────────────────────────────────────────────────

const globalsCSS = readFileSync(join('src', 'app', 'globals.css'), 'utf8')
const rnTWConfig = readFileSync(join('apps', 'client', 'tailwind.config.js'), 'utf8')
const stitchMD = readFileSync(
  join('docs', 'transformacion-membego', 'stitch', 'retail_commercial_mobile', 'DESIGN.md'),
  'utf8'
)

// ── Tests ────────────────────────────────────────────────────────────────────

/**
 * Desde «align shared UI with Vibe theme» (1e596cd, 2026-09-30) y «unify branding»
 * (dbbcac0, 2026-10-06) el primario del cliente es el violeta Vibe —el rediseño del
 * Inicio aprobado el 2026-09-10—, no el retail blue del Stitch comercial. El contrato
 * (docs/design/client-design-contract.md §1) registra el cambio; el Stitch comercial
 * sigue siendo la fuente de la PALETA retail, que el cliente conserva como tal.
 */
test('el primario del cliente (RN) es el violeta Vibe de globals.css (--color-vibe-deep)', () => {
  const rnPrimary = primaryDefaultDeTW(rnTWConfig)
  const cssVibeDeep = hexDeCSS(globalsCSS, '--color-vibe-deep')
  assert.equal(
    rnPrimary,
    cssVibeDeep,
    'primary.DEFAULT en apps/client/tailwind.config.js no coincide con --color-vibe-deep ' +
      'en globals.css. Ver docs/design/client-design-contract.md §1.'
  )
})

test('el Brand Primary del Stitch comercial es el retail-blue del cliente (paleta, ya no primario)', () => {
  const stitchPrimary = brandPrimaryDeStitch(stitchMD)
  assert.equal(stitchPrimary, retailTokenDeCSS(globalsCSS, 'retail-blue'))
  assert.equal(stitchPrimary, retailTokenDeTW(rnTWConfig, 'blue'))
  assert.notEqual(
    primaryDefaultDeTW(rnTWConfig),
    stitchPrimary,
    'si el primario vuelve a ser retail-blue, hay que registrar el cambio en el contrato §1'
  )
})

test('la paleta retail coincide entre globals.css y tailwind.config.js (RN)', () => {
  const tokens = ['retail-blue', 'retail-deep', 'retail-cyan', 'retail-mist', 'retail-star', 'retail-lagoon']
  for (const token of tokens) {
    const cssVal = retailTokenDeCSS(globalsCSS, token)
    // El nombre en tailwind es la parte después de "retail-"
    const twKey = token.replace('retail-', '')
    const twVal = retailTokenDeTW(rnTWConfig, twKey)
    assert.equal(
      cssVal,
      twVal,
      `Token ${token}: globals.css=${cssVal} vs tailwind.config.js=${twVal}`
    )
  }
})

test('la fuente canónica del cliente es Inter (no Geist ni Plus Jakarta Sans)', () => {
  const sans = fontFamilySansDeTW(rnTWConfig)
  assert.ok(
    sans.toLowerCase().includes('inter'),
    `fontFamily.sans en RN es "${sans}", debería ser Inter. ` +
      'Ver docs/design/client-design-contract.md §6.'
  )
})

test('el bloque primary del RN contiene la escala 50-900 completa', () => {
  const primaryBlock = rnTWConfig.match(/primary:\s*\{([^}]*)\}/)
  assert.ok(primaryBlock, 'bloque primary no encontrado')
  for (const paso of [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]) {
    assert.ok(
      primaryBlock[1].includes(`${paso}:`),
      `Falta primary.${paso} en tailwind.config.js`
    )
  }
})
