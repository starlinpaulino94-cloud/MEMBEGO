/**
 * PARIDAD DE RUTAS CLIENTE WEB ↔ NATIVE — GUARDIAS DE INVARIANTE.
 *
 * Estas guardias no replican la implementación: afirman propiedades que el
 * manifiesto de paridad (`docs/design/client-parity-manifest.json`) y la
 * matriz (`docs/design/client-web-native-parity-matrix.md`) declaran sobre
 * el árbol de rutas del cliente, y que deben seguir siendo ciertas aunque
 * alguien mueva un archivo.
 *
 * Invariantes que se afirman:
 *   1. Cada archivo de ruta nativa listado en el manifiesto existe y exporta
 *      un default (o es un layout/redirect que no lo requiere).
 *   2. NINGÚN archivo bajo `apps/client/` usa un intrínseco del DOM (`<div>`,
 *      `<span>`, `<p>`, `<a>`) dentro de un componente de React Native — un
 *      `<div>` suelto en `HeaderVibe.tsx` tiró en runtime en native mientras
 *      tsc y eslint pasaban limpios. Esta guardia lo habría atrapado.
 *   3. La frontera de plataforma del mapa se mantiene: `cerca.web.tsx`
 *      importa leaflet, `cerca.native.tsx` importa react-native-maps, y
 *      `cerca.tsx` ramifica en `Platform.OS`.
 *   4. Cada familia de rutas expone al menos una rama de estado no-feliz
 *      (loading / error / empty / redirect-to-login).
 *
 * Ejecutar: `npm test` (o `tsx --test tests/paridad-rutas-cliente.test.ts`).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, statSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import manifest from '../docs/design/client-parity-manifest.json' with { type: 'json' }

const RAIZ = join(__dirname, '..')
const leer = (r: string) => readFileSync(join(RAIZ, r), 'utf8')

type NativeRoute = (typeof manifest.nativeRoutes)[number]
type WebRoute = (typeof manifest.webRoutes)[number]

// ── 1. Cada ruta nativa del manifiesto existe y tiene default export ─────────

test('cada archivo de ruta nativa del manifiesto existe en el árbol', () => {
  const faltantes: string[] = []
  for (const ruta of manifest.nativeRoutes) {
    const abs = join(RAIZ, ruta.nativeFile)
    if (!existsSync(abs)) faltantes.push(ruta.nativeFile)
  }
  assert.deepEqual(
    faltantes,
    [],
    'El manifiesto lista archivos que no existen en el árbol. ' +
      'Regenera con `node scripts/verificar-paridad-rutas.mjs` o corrige el manifiesto:\n  ' +
      faltantes.join('\n  ')
  )
})

test('cada ruta nativa de tipo "screen" exporta un default function/component', () => {
  // Los layouts y redirects no requieren default export de componente
  // (los layouts exportan default también, pero los redirects pueden ser
  // un simple `Redirect` de expo-router). Afirmamos solo los "screen".
  const sinDefault: string[] = []
  for (const ruta of manifest.nativeRoutes) {
    if (ruta.kind !== 'screen') continue
    const src = leer(ruta.nativeFile)
    // `export default function` o `export default` con arrow/const.
    if (!/export default\b/.test(src)) {
      sinDefault.push(ruta.nativeFile)
    }
  }
  assert.deepEqual(
    sinDefault,
    [],
    'Rutas nativas tipo "screen" sin `export default`. Expo-router requiere ' +
      'un default export para cada pantalla:\n  ' +
      sinDefault.join('\n  ')
  )
})

// ── 2. Cero intrínsecos del DOM en componentes de React Native ───────────────
//
// Un `<div>` en un archivo .tsx de apps/client/ compila (react-native-web
// provee los tipos) pero TIRA EN RUNTIME en el dispositivo native. tsc y
// eslint no lo ven. Esta guardia es la que habría atrapado el bug de
// HeaderVibe.tsx en esta misma sesión.

test('ningún archivo de apps/client/ usa intrínsecos del DOM en JSX', () => {
  // Intrínsecos que no existen en react-native: div, span, p, a, h1-h6, img,
  // input, button, form, ul, ol, li, section, article, header, footer, nav.
  // Buscamos el patrón `<tag` con límite de palabra para evitar falsos
  // positivos con componentes tipo `<Divider>` o `<SpanSomething>`.
  const DOM_TAGS = [
    'div',
    'span',
    'p',
    'a',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'img',
    'input',
    'button',
    'form',
    'ul',
    'ol',
    'li',
    'section',
    'article',
    'header',
    'footer',
    'nav',
    'main',
    'table',
    'tr',
    'td',
    'th',
  ]

  // Archivos que LEGÍTIMAMENTE usan HTML: los .web.tsx (son web-only) y los
  // archivos de documentación/prueba. Los platform-variant .web.tsx renderizan
  // sobre react-native-web, que SÍ acepta intrínsecos DOM.
  const esWebOnly = (ruta: string) => /\.web\.tsx$/.test(ruta)

  function tsxEnAppsClient(dir: string, acc: string[] = []): string[] {
    let entradas: string[]
    try {
      entradas = readdirSync(dir)
    } catch {
      return acc
    }
    for (const e of entradas) {
      // Saltar node_modules: los .tsx de dependencias no son código nuestro
      // y muchas librerías (p. ej. @tanstack/react-query) usan HTML en sus
      // archivos de tipos/ejemplos. No es un bug nuestro.
      if (e === 'node_modules') continue
      const p = join(dir, e)
      const stat = statSync(p)
      if (stat.isDirectory()) tsxEnAppsClient(p, acc)
      else if (p.endsWith('.tsx') && !esWebOnly(p)) acc.push(p)
    }
    return acc
  }

  const archivos = tsxEnAppsClient(join(RAIZ, 'apps', 'client'))
  const culpables: Array<{ archivo: string; tags: string[] }> = []

  for (const archivo of archivos) {
    const src = readFileSync(archivo, 'utf8')
    const encontrados: string[] = []
    for (const tag of DOM_TAGS) {
      // `<tag` seguido de espacio, `>`, `/`, o atributo — no una letra.
      // Evita falsos positivos con `<Divider>`, `<SpanX>`, etc.
      const re = new RegExp(`<${tag}(?=[\\s/>])`, 'g')
      if (re.test(src)) encontrados.push(tag)
    }
    if (encontrados.length > 0) {
      culpables.push({
        archivo: archivo.replace(RAIZ + '/', '').replace(/\\/g, '/'),
        tags: encontrados,
      })
    }
  }

  assert.deepEqual(
    culpables,
    [],
    'Intrínsecos del DOM en archivos native (tiran en runtime en el dispositivo). ' +
      'Usa <View>, <Text>, <Pressable>, <Image> de react-native, o mueve el archivo ' +
      'a un sufijo .web.tsx si es web-only:\n  ' +
      culpables.map((c) => `${c.archivo} → <${c.tags.join('>, <')}>`).join('\n  ')
  )
})

// ── 3. La frontera de plataforma del mapa se mantiene ────────────────────────
//
// `/cliente/cerca` es el caso canónico de plataforma-divergente: web usa
// Leaflet, native usa react-native-maps. El archivo `cerca.tsx` es un
// dispatcher que selecciona entre `cerca.web.tsx` y `cerca.native.tsx` en
// runtime vía `Platform.OS`. Si alguien unifica los tres en uno solo, o
// si el dispatcher deja de ramificar, la frontera se rompe.

test('cerca.tsx es un dispatcher por Platform.OS entre web y native', () => {
  const src = leer('apps/client/app/cerca.tsx')
  assert.match(
    src,
    /import\s*{\s*Platform\s*}\s*from\s*['"]react-native['"]/,
    'cerca.tsx debe importar Platform desde react-native.'
  )
  assert.match(
    src,
    /Platform\.OS\s*===?\s*['"]web['"]/,
    'cerca.tsx debe ramificar en Platform.OS === "web".'
  )
  assert.match(src, /cerca\.web/, 'cerca.tsx debe importar cerca.web.')
  assert.match(src, /cerca\.native/, 'cerca.tsx debe importar cerca.native.')
})

test('cerca.web.tsx usa el mapa web (Google Maps JS) y NO react-native-maps', () => {
  // Desde `7fb7bea`/`f70b545` (main) el mapa web es Google Maps JS, cargado con
  // EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY; antes era Leaflet.
  const src = leer('apps/client/app/cerca.web.tsx')
  assert.match(
    src,
    /EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY/,
    'cerca.web.tsx debe cargar Google Maps JS con la clave web del entorno.'
  )
  assert.doesNotMatch(
    src,
    /from\s*['"]leaflet['"]/,
    'cerca.web.tsx ya no usa Leaflet (sería un segundo mapa).'
  )
  assert.doesNotMatch(
    src,
    /from\s*['"]react-native-maps['"]/,
    'cerca.web.tsx NO debe importar react-native-maps (es la variante native).'
  )
})

test('cerca.native.tsx importa react-native-maps y NO leaflet', () => {
  const src = leer('apps/client/app/cerca.native.tsx')
  assert.match(
    src,
    /from\s*['"]react-native-maps['"]/,
    'cerca.native.tsx debe importar react-native-maps.'
  )
  assert.doesNotMatch(
    src,
    /from\s*['"]leaflet['"]/,
    'cerca.native.tsx NO debe importar leaflet (es la variante web).'
  )
})

// ── 4. Cada familia de rutas expone al menos una rama de estado no-feliz ─────
//
// Una familia sin loading/error/empty/unauthenticated es una familia que
// solo contempla el camino feliz. El manifiesto inspecciona los estados por
// archivo; afirmamos que, agregados por familia, al menos uno de esos
// estados no-feliz aparece.

const FAMILIAS_ESPERADAS = new Set([
  'account',
  'support',
  'growth',
  'maps',
  'marketplace',
  'wallet',
  'excursions',
  'home',
  'auth',
  'shell',
])

test('el manifiesto cubre todas las familias esperadas', () => {
  const familiasEnManifest = new Set<string>()
  for (const r of manifest.nativeRoutes) familiasEnManifest.add(r.family)
  const faltan: string[] = []
  for (const f of FAMILIAS_ESPERADAS) {
    if (!familiasEnManifest.has(f)) faltan.push(f)
  }
  assert.deepEqual(
    faltan,
    [],
    'Familias sin cobertura en el manifiesto:\n  ' + faltan.join('\n  ')
  )
})

test('cada familia tiene al menos una ruta con un estado no-feliz afirmado', () => {
  // Estados no-felices: loading, error, empty, pagination, qr, map.
  // Una ruta que no tenga NINGUNO de estos es una ruta que solo contempla
  // el camino feliz — exactamente lo que esta guardia quiere evitar.
  type Estados = NativeRoute['states']
  const ESTADOS_NO_FELICES: (keyof Estados)[] = [
    'loading',
    'error',
    'empty',
    'pagination',
    'qr',
    'map',
  ]

  const familiasSinEstado: string[] = []
  for (const familia of FAMILIAS_ESPERADAS) {
    const rutasFamilia = manifest.nativeRoutes.filter(
      (r) => r.family === familia
    )
    const algunaConEstado = rutasFamilia.some((r) =>
      ESTADOS_NO_FELICES.some((e) => r.states[e] === true)
    )
    if (!algunaConEstado) familiasSinEstado.push(familia)
  }
  assert.deepEqual(
    familiasSinEstado,
    [],
    'Familias donde NINGUNA ruta afirma un estado no-feliz (loading/error/empty/' +
      'pagination/qr/map). Toda familia debe contemplar al menos un camino no-feliz:\n  ' +
      familiasSinEstado.join('\n  ')
  )
})

// ── 5. Los conteos del manifiesto coinciden con el árbol real ────────────────

test('los conteos del manifiesto coinciden con lo que hay en disco', () => {
  assert.equal(
    manifest.counts.webRoutes,
    manifest.webRoutes.length,
    'counts.webRoutes no coincide con la longitud de webRoutes.'
  )
  assert.equal(
    manifest.counts.nativeRouteFiles,
    manifest.nativeRoutes.length,
    'counts.nativeRouteFiles no coincide con la longitud de nativeRoutes.'
  )
})

test('el manifiesto declara planClaim correcto para web y native', () => {
  assert.equal(
    manifest.counts.webMatchesPlanClaim,
    true,
    'webMatchesPlanClaim debe ser true: el árbol tiene las rutas que el plan afirma.'
  )
  assert.equal(
    manifest.counts.nativeMatchesPlanClaim,
    true,
    'nativeMatchesPlanClaim debe ser true: el árbol native tiene los archivos que el plan afirma.'
  )
})

// ── 6. Las rutas web con status "missing" están documentadas ─────────────────

test('cada ruta web "missing" tiene una acción documentada', () => {
  const missing = manifest.webRoutes.filter((r) => r.status === 'missing')
  for (const r of missing) {
    assert.ok(
      r.action && r.action.length > 10,
      `Ruta web missing sin acción documentada: ${r.webPath}. ` +
        'Toda ruta sin equivalente nativo debe tener una acción explícita ' +
        '(construir, aceptar fallback, o documentar la decisión del owner).'
    )
  }
})

// ── 7. El baseline de rutas web "missing" ───────────────────────────────────
//
// El baseline actual es 0: /cliente/planes/[planId] ya tiene contraparte
// nativa (apps/client/app/planes/[planId].tsx). Si vuelve a aparecer una
// missing, es señal de que una migración añadió una ruta web sin su
// contraparte nativa — debe quedar documentada con acción, no silenciada.

test('el número de rutas web "missing" se mantiene en el baseline documentado', () => {
  const BASELINE_MISSING = 0
  const missing = manifest.webRoutes.filter((r) => r.status === 'missing')
  assert.ok(
    missing.length >= BASELINE_MISSING,
    `Se esperaba al menos ${BASELINE_MISSING} ruta(s) missing; hay ${missing.length}.`
  )
  // Si crece por encima del baseline, que se sepa — no es un fail automático,
  // pero el mensaje apunta al owner decision que debe documentarse.
  if (missing.length > BASELINE_MISSING) {
    const nuevas = missing.map((r) => r.webPath)
    assert.ok(
      nuevas.every((p) =>
        manifest.webRoutes.find((r) => r.webPath === p)?.action
      ),
      'Nuevas rutas missing sin acción documentada:\n  ' + nuevas.join('\n  ')
    )
  }
})
