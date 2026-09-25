#!/usr/bin/env node
/**
 * ENSAYO DE RLS CAPA 2 · el paso 4 del runbook, automatizado.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ PARTE DEL ENSAYO CUBRE ESTO, Y QUÉ PARTE NO
 *
 * `docs/runbooks/rls-encender.md` pide cuatro cosas antes del cutover. Las
 * tres primeras —esquema, políticas, aislamiento— ya las hace el CI en cada PR
 * y `npm run rls:probar` las resume en catorce comprobaciones.
 *
 * La cuarta es «ejercitar la app entera con `membego_app` buscando pantallas o
 * listas VACÍAS», y es la que decide si el cutover rompe producción. Nadie la
 * había hecho, porque suena a clicar doscientas pantallas a mano.
 *
 * No hace falta clicarlas. Una pantalla vacía es siempre lo mismo por debajo:
 * una tabla que TIENE filas y que, con el contexto de su empresa puesto,
 * devuelve cero. Eso se puede preguntar tabla por tabla, y es determinista.
 *
 * LO QUE ESTO NO PRUEBA, dicho antes de que nadie se fíe de más: se cambia de
 * rol con `SET LOCAL ROLE`, no se abre una conexión nueva con la contraseña de
 * `membego_app`. Las políticas y los permisos de tabla se comportan igual —el
 * rol es el mismo y no tiene BYPASSRLS—, pero no se ejercita el pooler, ni el
 * `search_path` de una sesión nueva, ni que la contraseña sea correcta. Eso lo
 * dice el primer despliegue, y por eso el runbook mantiene su smoke test.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CÓMO SE LEE EL RESULTADO
 *
 *   VACÍA        la tabla tiene filas y ninguna empresa las ve. Pantalla en
 *                blanco garantizada el día del cutover.
 *   SIN PERMISO  falta un GRANT. Peor que vacía: revienta con error.
 *   OK           al menos una empresa ve sus filas (comprobado con datos).
 *   ALCANZABLE   está vacía, pero su política se puede satisfacer: se sigue la
 *                cadena de `EXISTS` hasta una columna de inquilino. Es un
 *                razonamiento sobre la política real que hay en la base, no una
 *                suposición — y es lo que convierte 180 «no lo sé» en respuesta.
 *   VACÍA        tiene filas y ninguna empresa las ve, o su política no se puede
 *                satisfacer nunca. Pantalla en blanco el día del cutover.
 *   SIN PERMISO  falta un GRANT. Peor que vacía: revienta con error.
 *
 * Correr:  node --env-file=.env.local scripts/ensayo-rls.mjs
 * En CI:   el flujo «Ensayo de RLS Capa 2» (se dispara a mano).
 */

import { execFileSync } from 'node:child_process'

const C = { ok: '\x1b[32m', mal: '\x1b[31m', avi: '\x1b[33m', dim: '\x1b[2m', off: '\x1b[0m' }
const URL_BASE = process.env.DATABASE_URL

if (!URL_BASE) {
  console.error(`${C.mal}✗${C.off} Falta DATABASE_URL.`)
  process.exit(1)
}

// Este guion NO escribe, pero se corre junto al sembrador de demo, que sí. La
// guarda es la misma que `probar-rls.mjs`: contra una base de Supabase hay que
// decirlo a propósito.
if (/supabase\.(co|com)|pooler\.supabase/i.test(URL_BASE) && process.env.RLS_PERMITIR_REMOTA !== 'si') {
  console.error(
    `${C.mal}✗${C.off} DATABASE_URL apunta a Supabase. El ensayo va en una base DESECHABLE.\n` +
    `  Si de verdad es una base de prueba: RLS_PERMITIR_REMOTA=si`
  )
  process.exit(1)
}

function sql(texto) {
  return execFileSync('psql', [URL_BASE, '-v', 'ON_ERROR_STOP=1', '-tAF', '\t', '-c', texto], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

/**
 * Tablas que SOLO se leen en modo omnisciente, y está decidido así en el SQL de
 * la Capa 2. Aparecer aquí no es un pase libre: si una de estas dejara de estar
 * denegada, este guion lo dice igual — una tabla que se abre sin que nadie lo
 * decida es tan noticia como una que se cierra.
 */
const DENEGADAS_A_PROPOSITO = new Set([
  'geo_cities',
  'geo_countries',
  'geo_regions',
  'geo_sectors',
  'location_search_events',
  'credenciales_sistema',
])

console.log('\nEnsayo de RLS Capa 2 · ¿qué pantalla se quedaría en blanco?')
console.log('─'.repeat(70))

// ── Precondiciones ──────────────────────────────────────────────────────────

const rol = sql(`select coalesce((select case when rolbypassrls then 'BYPASS' else 'ok' end
    from pg_roles where rolname='membego_app'), 'NO_EXISTE')`)
if (rol !== 'ok') {
  console.error(
    `${C.mal}✗${C.off} ` +
    (rol === 'NO_EXISTE'
      ? 'El rol membego_app no existe. Aplica prisma/migrations_manual/2026-07-rls-capa2-aislamiento.sql.'
      : 'membego_app tiene BYPASSRLS: las políticas no le aplican y este ensayo no mediría nada.')
  )
  process.exit(1)
}

const empresas = sql(`select id from companies order by id`).split('\n').filter(Boolean)
if (empresas.length === 0) {
  console.error(
    `${C.mal}✗${C.off} No hay ni una empresa en la base. Siembra datos antes:\n` +
    `  node --import tsx scripts/sembrar-demo.mts`
  )
  process.exit(1)
}

const tablas = sql(`
  select tablename from pg_tables
   where schemaname='public' and tablename <> '_prisma_migrations'
   order by tablename`).split('\n').filter(Boolean)

console.log(`${C.dim}${tablas.length} tablas · ${empresas.length} empresa(s) sembrada(s)${C.off}\n`)

// ── Censo: cuántas filas hay de verdad ──────────────────────────────────────
//
// Una sola consulta con todas las tablas unidas. Doscientas idas y vueltas a la
// base para contar filas es la diferencia entre un ensayo de diez segundos y uno
// que nadie corre porque tarda.

function censo(prefijo) {
  const union = tablas
    .map((t) => `select '${t}' as t, count(*) as n from public."${t}"`)
    .join(' union all ')
  const salida = sql(`begin; ${prefijo} ${union}; rollback;`)
  const mapa = new Map()
  for (const linea of salida.split('\n')) {
    const [t, n] = linea.split('\t')
    if (t && n !== undefined && /^\d+$/.test(n)) mapa.set(t, Number(n))
  }
  return mapa
}

const real = censo(`set local app.omnisciente = 'on';`)

// ── Lo que ve cada empresa ──────────────────────────────────────────────────

const visible = new Map(tablas.map((t) => [t, 0]))
const sinPermiso = new Set()

for (const empresa of empresas) {
  let vista
  try {
    vista = censo(`set local role membego_app; set local app.company_id = '${empresa}';`)
  } catch (e) {
    // Un `permission denied` tumba la consulta entera, así que hay que aislar
    // la tabla culpable preguntando una por una. Solo pasa cuando falta un
    // GRANT, que es raro y merece la pasada lenta.
    const texto = String(e.stderr ?? e.message)
    console.log(`${C.avi}  ⚠${C.off} ${empresa}: alguna tabla niega el permiso; se buscan una por una.`)
    console.log(`${C.dim}     ${texto.split('\n')[0]}${C.off}`)
    vista = new Map()
    for (const t of tablas) {
      try {
        const n = sql(
          `begin; set local role membego_app; set local app.company_id = '${empresa}';` +
          ` select count(*) from public."${t}"; rollback;`
        )
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => /^\d+$/.test(l))
          .pop()
        vista.set(t, Number(n ?? 0))
      } catch {
        sinPermiso.add(t)
        vista.set(t, 0)
      }
    }
  }
  for (const [t, n] of vista) {
    if (n > (visible.get(t) ?? 0)) visible.set(t, n)
  }
}

// ── Las tablas vacías: se resuelve por la POLÍTICA, no por los datos ────────
//
// Sembrar las 203 tablas no es realista, y dejar 180 en «no lo sé» haría de este
// ensayo un trámite. Para una tabla vacía la pregunta se puede contestar igual,
// porque la política está escrita en la base y dice de qué depende:
//
//   · filtra por una columna de inquilino → se satisface en cuanto haya una fila
//     de esa empresa. ALCANZABLE.
//   · filtra por `EXISTS (... FROM padre ...)` → se satisface si el padre es
//     alcanzable. Se sigue la cadena.
//   · no tiene política → RLS deniega. VACÍA, y se verá el primer día.
//
// Es un razonamiento sobre la política REAL que hay en la base, no sobre lo que
// debería haber. Si alguien la cambia a mano, esto lo lee cambiado.

const politica = new Map()
// El `qual` viene con saltos de línea: PostgreSQL lo devuelve formateado. Se
// aplana EN LA CONSULTA porque leerlo línea a línea parte la expresión en
// trozos, y entonces media tabla parece no tener política — que es exactamente
// lo que pasó la primera vez que se corrió esto: 55 falsos positivos, uno de
// ellos `supply_lotes`, cuya política se acababa de escribir a mano.
const filas = sql(`
  select tablename, regexp_replace(coalesce(qual, 'true'), '\\s+', ' ', 'g')
    from pg_policies
   where schemaname='public' and policyname like 'membego_%'`)
for (const linea of filas.split('\n')) {
  const i = linea.indexOf('\t')
  if (i === -1) continue
  const t = linea.slice(0, i)
  const qual = linea.slice(i + 1)
  if (!politica.has(t)) politica.set(t, [])
  politica.get(t).push(qual)
}

/**
 * ¿Puede esta tabla darle alguna fila a una empresa?
 *
 * Basta que UNA de sus políticas lo permita, y una política llega al inquilino
 * de tres formas —las tres salen del SQL de la Capa 2 y se comprobaron leyendo
 * lo que hay de verdad en `pg_policies`:
 *
 *   `true`                        catálogo de lectura abierta.
 *   `…app.company_id…`            filtra por la empresa, sea por igualdad
 *                                 directa o por concatenación
 *                                 (`transaction_counters` usa 'TICKET:' || …).
 *   `EXISTS (… FROM padre p …)`   hereda del padre. Se sigue la cadena.
 *
 * El nombre del padre se lee con mayúsculas y minúsculas: las tablas del CRM son
 * PascalCase (`"Lead"`, `"NotaSeguimiento"`) y una expresión que solo aceptara
 * minúsculas las daría por denegadas — pasó, y eran cinco falsos positivos.
 */
const cache = new Map()
function alcanzable(tabla, vistas = new Set()) {
  if (cache.has(tabla)) return cache.get(tabla)
  if (vistas.has(tabla)) return false // ciclo: no se puede afirmar que sí
  vistas.add(tabla)

  const quals = politica.get(tabla) ?? []
  let veredicto = false
  for (const qual of quals) {
    if (qual.trim() === 'true' || /app\.company_id/.test(qual)) {
      veredicto = true
      break
    }
    const padres = [...qual.matchAll(/FROM (?:public\.)?"?([A-Za-z_][A-Za-z0-9_]*)"? p\b/g)].map(
      (m) => m[1]
    )
    if (padres.some((padre) => alcanzable(padre, new Set(vistas)))) {
      veredicto = true
      break
    }
  }
  cache.set(tabla, veredicto)
  return veredicto
}

// ── Veredicto ───────────────────────────────────────────────────────────────

const vacias = []
const abiertasSinDecidir = []
const porPolitica = []
let ok = 0

for (const t of tablas) {
  const hay = real.get(t) ?? 0
  const ve = visible.get(t) ?? 0
  if (sinPermiso.has(t)) continue
  if (DENEGADAS_A_PROPOSITO.has(t)) {
    // Al revés que el resto: aquí lo esperado es NO ver.
    if (ve > 0) abiertasSinDecidir.push(t)
    continue
  }
  if (hay > 0) {
    if (ve === 0) vacias.push(t)
    else ok++
    continue
  }
  // Vacía: decide la política.
  if (alcanzable(t)) porPolitica.push(t)
  else vacias.push(t)
}

console.log(`${C.ok}  ✓${C.off} ${ok} tabla(s) con datos que su empresa SÍ ve`)
console.log(`${C.ok}  ✓${C.off} ${porPolitica.length} tabla(s) vacía(s) cuya política SÍ se puede satisfacer`)

if (sinPermiso.size) {
  console.log(`\n${C.mal}  ✗ SIN PERMISO — falta un GRANT; esto no se queda vacío, revienta:${C.off}`)
  for (const t of [...sinPermiso].sort()) console.log(`      ${t}`)
}
if (vacias.length) {
  console.log(`\n${C.mal}  ✗ SE VERÍAN VACÍAS:${C.off}`)
  for (const t of vacias) {
    const hay = real.get(t) ?? 0
    console.log(
      `      ${t}  ` +
      (hay > 0
        ? `(${hay} fila(s) reales que nadie ve)`
        : '(sin política que una empresa pueda satisfacer)')
    )
  }
}
if (abiertasSinDecidir.length) {
  console.log(`\n${C.avi}  ⚠ ABIERTAS SIN DECIDIRLO — estaban solo en modo omnisciente:${C.off}`)
  for (const t of abiertasSinDecidir) console.log(`      ${t}`)
}

console.log('─'.repeat(70))
const fallos = vacias.length + sinPermiso.size + abiertasSinDecidir.length
if (fallos === 0) {
  console.log(`${C.ok}✓${C.off} Ninguna tabla con datos se quedaría a oscuras.`)
  console.log(
    `${C.dim}  Queda el smoke test del runbook: esto no ejercita el pooler ni una` +
    ` conexión nueva.${C.off}\n`
  )
  process.exit(0)
}
console.log(`${C.mal}✗${C.off} ${fallos} problema(s). NO cambies DATABASE_URL todavía.`)
console.log(
  `${C.avi}Cada tabla de arriba es una pantalla en blanco el día del cutover. Decide su` +
  ` regla en prisma/migrations_manual/2026-07-rls-capa2-aislamiento.sql, vuelve a` +
  ` aplicarlo (es idempotente) y repite este ensayo.${C.off}\n`
)
process.exit(1)
