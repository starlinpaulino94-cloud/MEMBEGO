#!/usr/bin/env node
/**
 * CAPA 2 · COMPROBACIÓN PREVIA — ¿qué tablas se quedarían denegadas?
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ PROBLEMA RESUELVE
 *
 * `2026-07-rls-capa2-aislamiento.sql` no lleva una lista escrita a mano de
 * tablas: DEDUCE la política de cada una del esquema, y al final imprime por
 * pantalla las que se quedaron «SIN ruta al inquilino». Esas tablas acaban con
 * RLS encendido y sin política, o sea DENEGADAS para `membego_app`.
 *
 * El problema es CUÁNDO se lee ese aviso: cuando ya lo ejecutaste. Y en
 * producción el síntoma de una tabla denegada no es un error, es una pantalla
 * vacía — RLS no lanza, devuelve cero filas.
 *
 * Este script corre el MISMO razonamiento contra `prisma/schema/`, sin base de
 * datos, para poder leer esa lista ANTES. Cada tabla que aparezca aquí y no
 * esté en las decididas a mano dentro del SQL es una que hay que resolver
 * antes de encender nada.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ NO ES
 *
 * No sustituye a `npm run rls:probar`, que siembra dos empresas contra un
 * Postgres real y comprueba que una no ve a la otra. Esto es de papel: mira el
 * esquema, no la base. Su valor es que se puede correr en cualquier máquina y
 * en cualquier momento, sin credenciales.
 *
 * Tampoco valida las políticas de las tablas que SÍ tienen ruta: da por bueno
 * que una tabla con `companyId`, o con una clave foránea NOT NULL a una tabla
 * ya cubierta, quedará bien. Eso es exactamente lo que hace el SQL.
 *
 * USO
 *   node scripts/rls-capa2-preflight.mjs
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIR_ESQUEMA = join(RAIZ, 'prisma', 'schema')
const SQL_CAPA2 = join(RAIZ, 'prisma', 'migrations_manual', '2026-07-rls-capa2-aislamiento.sql')

const C = { ok: '\x1b[32m', mal: '\x1b[31m', avi: '\x1b[33m', dim: '\x1b[2m', off: '\x1b[0m' }

// ── 1) Leer el esquema ───────────────────────────────────────────────────────

if (!existsSync(DIR_ESQUEMA)) {
  console.error(`No existe ${DIR_ESQUEMA}. ¿Se movió el esquema?`)
  process.exit(1)
}

const fuente = readdirSync(DIR_ESQUEMA)
  .filter((f) => f.endsWith('.prisma'))
  .sort()
  .map((f) => readFileSync(join(DIR_ESQUEMA, f), 'utf8'))
  .join('\n')

/**
 * De cada modelo interesan tres cosas y ninguna más: cómo se llama su tabla,
 * si lleva `companyId` encima, y por qué claves foráneas de UNA columna y NOT
 * NULL se puede llegar a otra tabla.
 */
function parsearModelos(src) {
  const bloques = [...src.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)]
  const porModelo = new Map()

  for (const [, nombre, cuerpo] of bloques) {
    const map = cuerpo.match(/@@map\("([^"]+)"\)/)
    const tabla = map ? map[1] : nombre

    const escalaresNoNulos = new Set()
    const columnas = new Set()
    const relaciones = []

    for (const bruta of cuerpo.split('\n')) {
      const linea = bruta.trim()
      if (!linea || linea.startsWith('//') || linea.startsWith('@@')) continue

      // `campo Tipo` / `campo Tipo?` / `campo Tipo[]`
      const m = linea.match(/^(\w+)\s+(\w+)(\[\])?(\?)?/)
      if (!m) continue
      const [, campo, tipo, lista, opcional] = m

      if (!lista) {
        columnas.add(campo)
        if (!opcional) escalaresNoNulos.add(campo)
      }

      // `@relation(fields: [x], references: [y])` — solo las de UNA columna,
      // que es lo único que cubre el SQL (`cardinality(con.conkey) = 1`).
      const rel = linea.match(/@relation\([^)]*fields:\s*\[([^\]]+)\][^)]*references:\s*\[([^\]]+)\]/)
      if (rel) {
        const campos = rel[1].split(',').map((s) => s.trim()).filter(Boolean)
        if (campos.length === 1) {
          relaciones.push({ columna: campos[0], modeloDestino: tipo })
        }
      }
    }

    porModelo.set(nombre, { modelo: nombre, tabla, columnas, escalaresNoNulos, relaciones })
  }

  return porModelo
}

const modelos = parsearModelos(fuente)
if (modelos.size === 0) {
  console.error('No se pudo leer ningún modelo del esquema.')
  process.exit(1)
}

const tablaDeModelo = new Map([...modelos.values()].map((m) => [m.modelo, m.tabla]))
const todasLasTablas = new Set([...modelos.values()].map((m) => m.tabla))

// ── 2) El mismo razonamiento que el SQL ──────────────────────────────────────

const cubiertas = new Set()

// Nivel 0: la tabla lleva `companyId` encima.
for (const m of modelos.values()) {
  if (m.columnas.has('companyId')) cubiertas.add(m.tabla)
}
const nivel0 = cubiertas.size

// `companies`: su propia clave ES el inquilino.
if (todasLasTablas.has('companies')) cubiertas.add('companies')

// Niveles 1..N: clave foránea de UNA columna, NOT NULL, hacia una ya cubierta.
const porRonda = []
for (let ronda = 1; ronda <= 10; ronda++) {
  let nuevas = 0
  for (const m of modelos.values()) {
    if (cubiertas.has(m.tabla)) continue
    for (const rel of m.relaciones) {
      const destino = tablaDeModelo.get(rel.modeloDestino)
      if (!destino || destino === m.tabla) continue          // nada de autorreferencias
      if (!cubiertas.has(destino)) continue
      if (!m.escalaresNoNulos.has(rel.columna)) continue     // solo NOT NULL
      cubiertas.add(m.tabla)
      nuevas++
      break
    }
  }
  porRonda.push(nuevas)
  if (nuevas === 0) break
}

// ── 3) Las decididas a mano en los SQL ───────────────────────────────────────
//
// Se leen DE LOS PROPIOS SQL en vez de copiarlas aquí: una segunda copia se
// desincroniza el día que alguien añada una tabla a la lista de allá y no a la
// de acá, y este script empezaría a dar falsas alarmas justo cuando hay que
// confiar en él.
//
// Y se miran TODOS los archivos de `migrations_manual/`, no solo el de la Capa
// 2. La primera versión de este script solo leía ese, y avisó de que las cuatro
// tablas del catálogo geo y `location_search_events` quedarían denegadas —
// cuando las cubre `2026-08-rls-geo.sql`, que se aplica justo después. Un
// preflight que da falsos positivos se deja de mirar a la segunda vez.

const DIR_MANUAL = join(RAIZ, 'prisma', 'migrations_manual')

function decididasAMano() {
  if (!existsSync(SQL_CAPA2)) return null
  const nombres = new Set()

  const archivos = existsSync(DIR_MANUAL)
    ? readdirSync(DIR_MANUAL).filter((f) => f.endsWith('.sql')).sort()
    : []

  for (const archivo of archivos) {
    // Los comentarios se quitan ANTES de buscar. `2026-08-rls-geo.sql` lleva
    // en un comentario el SQL de marcha atrás, con su lista de tablas dentro;
    // contarlas como decididas silenciaría un aviso de verdad el día que una
    // de ellas deje de tener política.
    const sql = readFileSync(join(DIR_MANUAL, archivo), 'utf8').replace(/--[^\n]*/g, '')

    // Cualquier tabla que reciba una política con nombre propio ya está
    // decidida, venga del archivo que venga.
    for (const m of sql.matchAll(/CREATE\s+POLICY\s+\w+\s+ON\s+(?:public\.)?"?(\w+)"?/gi)) {
      nombres.add(m[1])
    }

    // Los `FOREACH <var> IN ARRAY ARRAY[ 'a', 'b', … ]`: ahí el nombre de la
    // tabla es el valor del bucle, así que el `CREATE POLICY` lleva `%I` y la
    // expresión de arriba no lo ve. El nombre de la variable cambia entre
    // archivos (`cond` en la Capa 2, `t` en el de geo), así que no se fija.
    for (const m of sql.matchAll(/FOREACH\s+\w+\s+IN\s+ARRAY\s+ARRAY\[([\s\S]*?)\]/g)) {
      for (const t of m[1].matchAll(/'([^']+)'/g)) nombres.add(t[1])
    }

    // Y la que se trata aparte, con su propia regla de ámbito.
    if (/tablename\s*=\s*'transaction_counters'/.test(sql)) nombres.add('transaction_counters')
  }

  return nombres
}

const aMano = decididasAMano()
if (aMano === null) {
  console.error(`No se encontró ${SQL_CAPA2}; no se puede contrastar la lista.`)
  process.exit(1)
}

const sinRuta = [...todasLasTablas].filter((t) => !cubiertas.has(t)).sort()
const yaDecididas = sinRuta.filter((t) => aMano.has(t))
const nuevas = sinRuta.filter((t) => !aMano.has(t))

// ── 4) Informe ───────────────────────────────────────────────────────────────

console.log('Capa 2 · comprobación previa (sobre prisma/schema, sin base de datos)')
console.log('─'.repeat(70))
console.log(
  `${C.dim}Tablas en el esquema: ${todasLasTablas.size} · con companyId propio: ${nivel0} · ` +
    `alcanzadas por clave foránea: ${porRonda.map((n) => n).join('+')} ` +
    `· cubiertas en total: ${cubiertas.size}${C.off}`
)

if (yaDecididas.length > 0) {
  console.log(
    `\n${C.dim}Sin ruta, pero YA decididas a mano en el SQL (catálogos globales,` +
      ` credenciales, contadores):\n   ${yaDecididas.join(', ')}${C.off}`
  )
}

if (nuevas.length === 0) {
  console.log(`\n${C.ok}✓${C.off} Ninguna tabla se quedaría denegada sin que alguien lo haya decidido.`)
  process.exit(0)
}

console.log(
  `\n${C.mal}✗ ${nuevas.length} tabla(s) sin ruta al inquilino y SIN decisión en el SQL:${C.off}`
)
for (const t of nuevas) console.log(`   ${t}`)
console.log(
  `\n${C.avi}Con la Capa 2 encendida, RLS DENIEGA estas tablas para membego_app.${C.off}\n` +
    `${C.dim}El síntoma no será un error: será una pantalla vacía o una lista sin\n` +
    `elementos, porque RLS no lanza — devuelve cero filas.\n\n` +
    `Para cada una hay que decidir, igual que se decidió con las de arriba:\n` +
    `  · ¿es un catálogo global?      → lectura abierta, escritura omnisciente\n` +
    `  · ¿es de una empresa concreta? → darle camino (companyId o FK NOT NULL)\n` +
    `  · ¿es de plataforma?           → solo omnisciente\n` +
    `y añadirla a 2026-07-rls-capa2-aislamiento.sql antes de ejecutarlo.${C.off}`
)
process.exit(1)
