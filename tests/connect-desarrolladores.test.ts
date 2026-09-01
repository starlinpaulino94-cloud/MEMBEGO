import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  EVENTOS_CONECTOR,
  textoNegocio,
  textoTecnico,
} from '../src/modules/connect/bitacoraNucleo'

/**
 * MEMBEGO CONNECT · Fase 11 (Desarrolladores: estructura, navegación y estados).
 *
 * Lo puro —los dos idiomas de la bitácora— se prueba ejecutándolo. La
 * estructura de rutas y las decisiones de pantalla se vigilan leyendo el
 * fuente, igual que en el resto de la suite.
 */

const leer = (r: string) => readFileSync(join(__dirname, '..', r), 'utf8')

/**
 * Fuente SIN comentarios, para las comprobaciones de AUSENCIA.
 *
 * Sin esto, un archivo que explica «igualdad exacta y no `startsWith`» falla la
 * prueba que prohíbe `startsWith` — encontrándose a sí mismo. Es la misma
 * trampa que documenta `scripts/auditar-diseno.mjs`, y ya cayeron en ella dos
 * guardias de este trabajo.
 */
const codigo = (r: string) =>
  leer(r)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
const DEV = 'src/app/(admin)/admin/integraciones/desarrolladores'

// ─── Los dos idiomas de la bitácora ──────────────────────────────────────────

test('bitácora: todo evento conocido tiene traducción técnica', () => {
  for (const e of EVENTOS_CONECTOR) {
    const t = textoTecnico(e)
    assert.notEqual(t, e, `${e} no tiene texto técnico`)
    assert.ok(t.length > 0)
  }
})

test('bitácora: un evento desconocido se enseña CRUDO al desarrollador', () => {
  // Preferible una línea rara a una línea que falta: quien depura necesita ver
  // el código aunque nadie le haya escrito todavía una descripción.
  assert.equal(textoTecnico('oauth.refresh.fallo'), 'oauth.refresh.fallo')
})

test('bitácora: un evento desconocido NO se le enseña a la empresa', () => {
  // Enseñarle `oauth.refresh.fallo` a la dueña de un salón no le dice nada.
  assert.equal(textoNegocio('oauth.refresh.fallo'), null)
})

test('bitácora: lo que le importa a la empresa habla de SU cuenta, no del sistema', () => {
  // Los eventos de conexión sí se cuentan…
  for (const e of ['conexion.creada', 'conexion.desconectada', 'conexion.fallo'] as const) {
    assert.equal(typeof textoNegocio(e), 'string', `${e} debería contarse a la empresa`)
  }
  // …y las herramientas de programador, no: son ruido en un historial que se
  // lee para responder «¿qué le pasó a mi conexión?».
  for (const e of ['clave_api.creada', 'webhook.suscrito'] as const) {
    assert.equal(textoNegocio(e), null, `${e} no debería salir en el historial de negocio`)
  }
})

test('bitácora: el idioma de negocio no filtra jerga técnica', () => {
  const prohibidas = ['token', 'oauth', 'webhook', 'api', 'null', 'error 4', 'http']
  for (const e of EVENTOS_CONECTOR) {
    const t = textoNegocio(e)
    if (!t) continue
    for (const p of prohibidas) {
      assert.ok(
        !t.toLowerCase().includes(p),
        `«${t}» (${e}) usa jerga técnica: ${p}`
      )
    }
  }
})

// ─── Las rutas ───────────────────────────────────────────────────────────────

test('rutas: el hub se partió en cuatro pantallas de verdad', () => {
  for (const ruta of ['page.tsx', 'claves/page.tsx', 'webhooks/page.tsx', 'registros/page.tsx']) {
    const src = leer(`${DEV}/${ruta}`)
    // Cada una se nombra a sí misma: sin esto la pestaña del navegador dice
    // «Membego» en las cuatro y no se distinguen entre marcadores.
    assert.match(src, /export const metadata = \{ title: '[^']+' \}/, `${ruta} sin metadata`)
  }
})

test('rutas: cada pantalla con datos exige la sección por su cuenta', () => {
  // El layout NO es una frontera de seguridad: no se ejecuta antes que todo en
  // cada navegación. Las páginas que leen datos vuelven a exigirlo.
  for (const ruta of ['claves/page.tsx', 'webhooks/page.tsx', 'registros/page.tsx']) {
    const src = leer(`${DEV}/${ruta}`)
    assert.match(src, /await requireSection\('integraciones'\)/, `${ruta} sin guardia`)
    assert.match(src, /if \(!user\?\.metadata\.companyId\) redirect\(/, `${ruta} sin empresa`)
  }
})

test('rutas: hay migas de pan y navegación, no solo un botón de ida', () => {
  const layout = leer(`${DEV}/layout.tsx`)
  assert.match(layout, /aria-label="Ruta"/)
  assert.match(layout, /href="\/admin\/integraciones"/)
  assert.match(layout, /<NavDesarrolladores \/>/)

  const nav = leer('src/components/connect/NavDesarrolladores.tsx')
  // Igualdad exacta: con `startsWith`, «Resumen» quedaría activo en las cuatro.
  assert.match(nav, /active: ruta === s\.href/)
  assert.ok(!codigo('src/components/connect/NavDesarrolladores.tsx').includes('startsWith'))
})

test('rutas: el esqueleto de carga cubre el segmento entero', () => {
  // Uno en el segmento sirve a los cuatro hijos; repetirlo sería copiarlo.
  assert.ok(leer(`${DEV}/loading.tsx`).includes('Skeleton'))
})

// ─── Estados del plan ────────────────────────────────────────────────────────

test('plan: «no concedido» y «lleno» son dos hechos distintos', () => {
  for (const panel of ['ClavesApiPanel', 'WebhooksPanel']) {
    const src = leer(`src/components/connect/${panel}.tsx`)
    assert.match(src, /const sinConcesion = limite === 0/, `${panel} no distingue`)
    assert.match(src, /const lleno = !puedeCrear && !sinConcesion/, `${panel} no distingue`)
    // La frase falsa que había antes: decía «tu plan no incluye» también
    // cuando sí lo incluía y estaba lleno.
    assert.ok(
      !/Tu plan no incluye/.test(src),
      `${panel} conserva el mensaje que mentía cuando el límite estaba lleno`
    )
  }
})

test('plan: sin concesión NO se pinta un botón que va a rechazar la operación', () => {
  for (const panel of ['ClavesApiPanel', 'WebhooksPanel']) {
    const src = leer(`src/components/connect/${panel}.tsx`)
    assert.match(src, /puedeCrear \? \(/, `${panel} enseña el botón siempre`)
    assert.match(src, /CandadoPlan/, `${panel} sin candado`)
  }
})

test('plan: el vacío honesto explica y ofrece salida, no avisa de una avería', () => {
  const src = leer('src/components/connect/EstadoPlanConnect.tsx')
  // Vacío, no banner amarillo: no hay nada roto, hay algo que no se ha pedido.
  assert.match(src, /<EmptyState/)
  assert.match(src, /action=\{/)
  const claves = leer(`${DEV}/claves/page.tsx`)
  assert.match(claves, /if \(limite === 0 && claves\.length === 0\) return <PlanNoIncluye/)
  // Pero si YA tiene claves, se enseñan aunque el límite sea 0: esconderle
  // credenciales vivas sería dejarle puertas abiertas que no puede cerrar.
  assert.match(claves, /claves\.length === 0/)
})

// ─── Los dos idiomas, cada uno en su pantalla ────────────────────────────────

test('pantallas: el técnico ve el código del evento; la empresa, no', () => {
  const tecnica = leer('src/components/connect/ActividadConnect.tsx')
  assert.match(tecnica, /textoTecnico/)
  // El nombre exacto, para poder buscarlo en un incidente.
  assert.match(tecnica, /\{r\.evento\}/)

  const negocio = leer('src/components/connect/HistorialIntegracion.tsx')
  assert.match(negocio, /textoNegocio/)
  const negocioSinComentarios = codigo('src/components/connect/HistorialIntegracion.tsx')
  assert.ok(
    !/\{r\.evento\}/.test(negocioSinComentarios),
    'el historial de negocio enseña códigos internos'
  )
  assert.ok(!/nivel/i.test(negocioSinComentarios), 'el historial de negocio enseña niveles de log')
})

test('pantallas: el historial de una integración pide SOLO sus apuntes', () => {
  const detalle = leer('src/app/(admin)/admin/integraciones/[slug]/page.tsx')
  // Filtrado en la consulta, no en memoria: traerse las claves y los webhooks
  // de toda la empresa para descartarlos después es trabajo tirado.
  assert.match(detalle, /origenId: entrada\.conexionId/)
  assert.match(detalle, /origen: 'CONEXION'/)
})

// ─── Dominio canónico ────────────────────────────────────────────────────────

test('oauth: la redirect_uri sale de appUrl(), único dueño de las URLs de la app', () => {
  const src = leer('src/modules/connect/oauthRutas.ts')
  assert.match(src, /return `\$\{appUrl\(\)\}\/api\/connect\/oauth\/callback`/)
  // Leer la variable a mano se saltaba la abstracción de dominios: el día que
  // la aplicación se mude, apuntaría a la landing.
  const sinComentarios = codigo('src/modules/connect/oauthRutas.ts')
  assert.ok(
    !sinComentarios.includes('NEXT_PUBLIC_APP_URL'),
    'el callback vuelve a leer la variable de la landing a mano'
  )
  assert.ok(
    !/https:\/\/[a-z]/.test(sinComentarios),
    'hay un dominio escrito a mano en el callback'
  )
})

// ─── Guardias de diseño y móvil ──────────────────────────────────────────────

test('auditor: la excepción de marcas es por ruta EXACTA, no por patrón', () => {
  const src = leer('scripts/auditar-diseno.mjs')
  assert.match(src, /const EXENTOS_EXACTOS = new Set\(\[/)
  assert.match(src, /'src\/modules\/connect\/proveedores\/metadatos\.ts'/)
  assert.match(src, /EXENTOS_EXACTOS\.has\(/)
  // Un patrón habría eximido también a un futuro `metadatos-extra.tsx`.
  assert.ok(!/connect\\\/proveedores\\\/metadatos/.test(src))
})

test('móvil: ninguna fila de Connect empuja su botón con ml-auto incondicional', () => {
  // `ml-auto` en una fila con una URL larga saca el botón de la pantalla en un
  // teléfono. Se permite solo a partir de `sm:`.
  for (const f of ['ClavesApiPanel', 'WebhooksPanel', 'TarjetaIntegracion', 'ActividadConnect']) {
    const src = leer(`src/components/connect/${f}.tsx`)
    // `sm:ml-auto` sí vale. El `(?<![:-])` es lo que distingue el permitido
    // del prohibido: sin él, `sm:ml-auto` también coincidiría, porque los dos
    // puntos son frontera de palabra.
    assert.ok(
      !/(?<![:-])\bml-auto\b/.test(src),
      `${f} usa ml-auto sin condición de tamaño`
    )
  }
})

test('móvil: lo que puede ser más largo que la pantalla se parte', () => {
  const webhooks = leer('src/components/connect/WebhooksPanel.tsx')
  assert.match(webhooks, /break-all[^"]*">\s*\{w\.url\}|break-all/)
  const guia = leer('src/components/connect/GuiaDesarrolladores.tsx')
  assert.match(guia, /break-all font-mono text-caption">\{r\.ruta\}/)
  // Los bloques de código desplazan en horizontal en vez de desbordar.
  assert.match(guia, /<pre className="overflow-x-auto/)
})
