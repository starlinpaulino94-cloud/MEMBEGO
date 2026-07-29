#!/usr/bin/env node
/**
 * BASELINE · registrar el historial en una base que ya lo tiene todo.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ PROBLEMA RESUELVE
 *
 * Las migraciones de MembeGo se aplicaron durante meses copiándolas en el SQL
 * Editor de Supabase. El SQL Editor **no escribe en `_prisma_migrations`**, así
 * que la base tiene todos los cambios y Prisma no lo sabe.
 *
 * Si se corriera `prisma migrate deploy` tal cual, intentaría aplicar las 74
 * migraciones desde cero sobre una base que ya está completa: fallaría en la
 * primera con "type AppRole already exists", y bloquearía el despliegue.
 *
 * Este script hace lo que Prisma llama *baselining*: le dice "esto ya está
 * hecho" sin ejecutar nada. Después de correrlo, `migrate deploy` solo aplicará
 * lo que de verdad falte.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ NO HACE, Y ES LO IMPORTANTE
 *
 * **No ejecuta una sola sentencia SQL sobre tus datos.** Solo inserta filas en
 * la tabla de control `_prisma_migrations`. Si te equivocas, se deshace
 * borrando esas filas.
 *
 * **No marca `20260770_reconciliacion`.** Esa sí tiene que EJECUTARSE, porque
 * corrige diferencias reales entre la base y el esquema (claves foráneas con
 * la regla ON DELETE equivocada, índices con nombre viejo, columnas con
 * DEFAULT de más). Se aplica sola en el `migrate deploy` siguiente.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * USO
 *
 *   DATABASE_URL="<DIRECT_URL de producción>" npm run migraciones:baseline
 *
 * Sin `--aplicar` solo ENSEÑA lo que haría. Nada cambia hasta que lo pidas:
 *
 *   DATABASE_URL="…" npm run migraciones:baseline -- --aplicar
 *
 * ANTES DE CORRERLO: `npm run db:doctor`. Si el doctor dice que falta algo, la
 * base NO tiene todo el historial y marcarlo como aplicado escondería el
 * agujero en vez de cerrarlo. Ver docs/DEVOPS.md.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { execFileSync } from 'node:child_process'
import { readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIR = join(ROOT, 'prisma', 'migrations')

/**
 * Migraciones que NO se marcan: tienen que ejecutarse de verdad.
 *
 * Al añadir una migración de reconciliación futura, va aquí. La regla: si su
 * SQL es idempotente Y corrige algo que la base todavía no tiene, no se marca.
 */
const EJECUTAR_DE_VERDAD = [
  '20260770_reconciliacion',
  // RLS · Capa 1. Si se marcara sin ejecutar, Prisma daría el historial por
  // completo y la clave anónima seguiría leyendo `public` entera — con el
  // agravante de que `migrate status` diría que todo está al día.
  '20260771_rls_barrera_publica',
]

const C = { ok: '\x1b[32m', mal: '\x1b[31m', avi: '\x1b[33m', dim: '\x1b[2m', off: '\x1b[0m' }
const aplicar = process.argv.includes('--aplicar')

if (!process.env.DATABASE_URL) {
  console.error(`${C.mal}✗${C.off} Falta DATABASE_URL. Usa la conexión DIRECTA (puerto 5432).`)
  process.exit(1)
}

if (!existsSync(DIR)) {
  console.error(`${C.mal}✗${C.off} No existe ${DIR}`)
  process.exit(1)
}

const migraciones = readdirSync(DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort()

console.log(`\nBaseline de migraciones — ${migraciones.length} en el repositorio`)
console.log('─'.repeat(64))

// Qué hay ya registrado. Si la tabla no existe todavía, no hay nada.
let registradas = new Set()
try {
  const salida = execFileSync(
    'npx',
    ['prisma', 'db', 'execute', '--stdin', '--schema', join(ROOT, 'prisma', 'schema')],
    { input: 'SELECT 1;', encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  )
  void salida
} catch {
  /* la comprobación de conexión real la hace el propio `migrate resolve` */
}

try {
  const psql = execFileSync(
    'psql',
    [process.env.DATABASE_URL, '-At', '-c',
     "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL"],
    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  )
  registradas = new Set(psql.split('\n').map((s) => s.trim()).filter(Boolean))
  console.log(`Ya registradas en la base: ${registradas.size}`)
} catch {
  console.log(
    `${C.dim}No se pudo leer _prisma_migrations con psql (puede que no exista todavía).${C.off}`
  )
  console.log(`${C.dim}Se intentará marcar todas; las ya registradas se saltarán solas.${C.off}`)
}

const porMarcar = migraciones.filter(
  (m) => !registradas.has(m) && !EJECUTAR_DE_VERDAD.includes(m)
)
const porEjecutar = migraciones.filter(
  (m) => !registradas.has(m) && EJECUTAR_DE_VERDAD.includes(m)
)

console.log(`\nSe marcarían como aplicadas (sin ejecutar nada): ${porMarcar.length}`)
for (const m of porMarcar.slice(0, 5)) console.log(`${C.dim}   ${m}${C.off}`)
if (porMarcar.length > 5) console.log(`${C.dim}   … y ${porMarcar.length - 5} más${C.off}`)

if (porEjecutar.length > 0) {
  console.log(`\n${C.avi}Se EJECUTARÁN de verdad en el próximo \`migrate deploy\`:${C.off}`)
  for (const m of porEjecutar) console.log(`   ${m}`)
}

if (!aplicar) {
  console.log(`\n${C.avi}Simulación.${C.off} Nada se ha cambiado.`)
  console.log(`Para hacerlo de verdad: ${C.dim}npm run migraciones:baseline -- --aplicar${C.off}\n`)
  process.exit(0)
}

console.log('\nMarcando…')
let hechas = 0
let fallidas = 0
for (const m of porMarcar) {
  try {
    execFileSync('npx', ['prisma', 'migrate', 'resolve', '--applied', m], {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: process.env,
    })
    hechas++
  } catch (e) {
    const msg = String(e.stderr ?? e.message)
    // Ya estaba registrada: no es un fallo, es el resultado deseado.
    if (/already recorded|is already applied/i.test(msg)) {
      hechas++
    } else {
      fallidas++
      console.log(`${C.mal}   ✗ ${m}${C.off}`)
      console.log(`${C.dim}     ${msg.split('\n').find((l) => l.trim()) ?? ''}${C.off}`)
    }
  }
}

console.log(`\n${fallidas === 0 ? C.ok + '✓' : C.avi + '!'}${C.off} ${hechas} marcadas, ${fallidas} con error.`)
if (fallidas === 0) {
  console.log('\nAhora sí puedes correr:')
  console.log(`  ${C.dim}npx prisma migrate deploy${C.off}   (aplicará solo ${porEjecutar.join(', ') || 'lo que falte'})`)
  console.log(`  ${C.dim}npm run db:doctor${C.off}           (comprobar que quedó al día)\n`)
}
process.exit(fallidas > 0 ? 1 : 0)
