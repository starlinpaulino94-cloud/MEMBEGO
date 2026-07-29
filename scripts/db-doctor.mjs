#!/usr/bin/env node
/**
 * DB DOCTOR — detector de desfase de esquema (schema drift).
 *
 * PROBLEMA QUE PREVIENE: en este proyecto las migraciones se aplican A MANO en
 * el SQL Editor de Supabase. Si se despliega código nuevo sin correr su SQL,
 * Prisma consulta columnas/tablas que no existen y las páginas mueren con
 * "No pudimos cargar tu información" (ya pasó: hotfix 2026-07-14, perfil del
 * cliente, etc.). Este script compara `prisma/schema/` (lo que el código
 * ESPERA) contra la base de datos real (lo que HAY) y lista exactamente qué
 * falta y qué migración lo crea.
 *
 * USO:
 *   npm run db:doctor          → conecta con DATABASE_URL y reporta (exit 1 si falta algo)
 *   npm run db:doctor:sql      → imprime un SQL de solo-lectura para pegar en
 *                                el SQL Editor de Supabase (no necesita acceso
 *                                local a la BD). Devuelve una tabla con lo que FALTA.
 *
 * CUÁNDO CORRERLO: antes y después de cada deploy que toque prisma/schema/
 * o agregue carpetas en prisma/migrations/.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCHEMA_DIR = join(ROOT, 'prisma', 'schema')

/**
 * El esquema vive REPARTIDO en `prisma/schema/*.prisma` (un archivo por
 * dominio). Prisma lee la carpeta entera como un solo esquema, y aquí se hace
 * lo mismo: se concatenan los archivos y se parsea el resultado.
 *
 * El orden alfabético es indiferente —los bloques son independientes entre
 * sí— pero se ordena de todas formas para que dos ejecuciones sobre el mismo
 * código produzcan exactamente la misma salida.
 */
function leerEsquema() {
  if (!existsSync(SCHEMA_DIR)) {
    console.error(`No existe ${SCHEMA_DIR}. ¿Se movió el esquema?`)
    process.exit(1)
  }
  const archivos = readdirSync(SCHEMA_DIR)
    .filter((f) => f.endsWith('.prisma'))
    .sort()
  if (archivos.length === 0) {
    console.error(`${SCHEMA_DIR} no contiene ningún .prisma`)
    process.exit(1)
  }
  return archivos.map((f) => readFileSync(join(SCHEMA_DIR, f), 'utf8')).join('\n')
}

// ── 1) Parseo del esquema ───────────────────────────────────────────────────

const SCALARS = new Set([
  'String', 'Boolean', 'Int', 'BigInt', 'Float', 'Decimal', 'DateTime', 'Json', 'Bytes',
])

function parseSchema(src) {
  const enums = new Map() // enumName -> [valores]
  const models = [] // { model, table, columns: [{field, column}] }

  const blockRe = /^(model|enum)\s+(\w+)\s*\{([\s\S]*?)^\}/gm
  const blocks = [...src.matchAll(blockRe)]

  for (const [, kind, name, body] of blocks) {
    if (kind !== 'enum') continue
    const values = []
    for (const raw of body.split('\n')) {
      const line = raw.trim()
      if (!line || line.startsWith('//') || line.startsWith('@@')) continue
      const m = line.match(/^(\w+)(?:\s+@map\("([^"]+)"\))?/)
      if (m) values.push(m[2] ?? m[1])
    }
    enums.set(name, values)
  }

  const modelNames = new Set(blocks.filter(([, k]) => k === 'model').map(([, , n]) => n))

  for (const [, kind, name, body] of blocks) {
    if (kind !== 'model') continue
    const mapMatch = body.match(/@@map\("([^"]+)"\)/)
    const table = mapMatch ? mapMatch[1] : name
    const columns = []
    for (const raw of body.split('\n')) {
      const line = raw.trim()
      if (!line || line.startsWith('//') || line.startsWith('@@')) continue
      const m = line.match(/^(\w+)\s+(\w+)(\[\])?\??/)
      if (!m) continue
      const [, field, type, isList] = m
      // Relaciones (el tipo es otro modelo) no son columnas propias.
      if (modelNames.has(type)) continue
      // Listas de escalares/enums sí son columnas (arrays de Postgres).
      if (!SCALARS.has(type) && !enums.has(type)) continue
      if (line.includes('@ignore')) continue
      const colMap = line.match(/@map\("([^"]+)"\)/)
      columns.push({ field, column: colMap ? colMap[1] : field })
      void isList
    }
    models.push({ model: name, table, columns })
  }

  return { models, enums }
}

// ── 2) ¿Qué migración crea cada cosa? (para el remedio) ────────────────────

function indexarMigraciones() {
  const dirs = [join(ROOT, 'prisma', 'migrations'), join(ROOT, 'scripts')]
  const archivos = []
  for (const dir of dirs) {
    if (!existsSync(dir)) continue
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        const sql = join(full, 'migration.sql')
        if (existsSync(sql)) archivos.push({ label: `prisma/migrations/${entry.name}`, sql: readFileSync(sql, 'utf8') })
      } else if (entry.name.endsWith('.sql')) {
        archivos.push({ label: `scripts/${entry.name}`, sql: readFileSync(full, 'utf8') })
      }
    }
  }
  return (needle) => {
    const hits = archivos.filter((a) => a.sql.includes(`"${needle}"`)).map((a) => a.label)
    return hits.length ? hits.slice(-2).join(' | ') : '(no encontrada: crea el ALTER a mano)'
  }
}

// ── 3) Modo --sql: verificador pegable en Supabase ──────────────────────────

function emitSql({ models, enums }) {
  const cols = models.flatMap((m) => m.columns.map((c) => `('${m.table}','${c.column}')`))
  const enumVals = [...enums.entries()].flatMap(([name, values]) =>
    values.map((v) => `('${name}','${v}')`)
  )
  console.log(`-- DB DOCTOR (generado desde prisma/schema/ — solo lectura)
-- Pega TODO en el SQL Editor de Supabase. Devuelve SOLO lo que FALTA:
-- si el resultado está vacío, la BD está al día con el código.
WITH columnas_esperadas(tabla, columna) AS (VALUES
  ${cols.join(',\n  ')}
), enums_esperados(tipo, valor) AS (VALUES
  ${enumVals.join(',\n  ')}
), faltan_columnas AS (
  SELECT e.tabla AS objeto, e.columna AS detalle,
         CASE WHEN t.table_name IS NULL THEN 'TABLA COMPLETA FALTA' ELSE 'columna falta' END AS problema
  FROM columnas_esperadas e
  LEFT JOIN information_schema.tables t
    ON t.table_schema = 'public' AND t.table_name = e.tabla
  LEFT JOIN information_schema.columns c
    ON c.table_schema = 'public' AND c.table_name = e.tabla AND c.column_name = e.columna
  WHERE c.column_name IS NULL
), faltan_enums AS (
  SELECT e.tipo AS objeto, e.valor AS detalle, 'valor de enum falta' AS problema
  FROM enums_esperados e
  LEFT JOIN (
    SELECT t.typname, en.enumlabel
    FROM pg_type t
    JOIN pg_enum en ON en.enumtypid = t.oid
    JOIN pg_namespace n ON n.oid = t.typnamespace AND n.nspname = 'public'
  ) x ON x.typname = e.tipo AND x.enumlabel = e.valor
  WHERE x.enumlabel IS NULL
)
SELECT * FROM faltan_columnas
UNION ALL
SELECT * FROM faltan_enums
ORDER BY problema, objeto, detalle;`)
}

// ── 4) Modo conectado: reporte con remedios ─────────────────────────────────

async function runConnected({ models, enums }) {
  if (!process.env.DATABASE_URL) {
    console.error('✗ Falta DATABASE_URL. Alternativa sin conexión local: npm run db:doctor:sql')
    process.exit(2)
  }
  const { PrismaClient } = await import('@prisma/client')
  const prisma = new PrismaClient()
  const buscarMigracion = indexarMigraciones()

  try {
    const dbCols = await prisma.$queryRawUnsafe(
      `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`
    )
    const dbEnums = await prisma.$queryRawUnsafe(
      `SELECT t.typname AS name, e.enumlabel AS value
       FROM pg_type t
       JOIN pg_enum e ON e.enumtypid = t.oid
       JOIN pg_namespace n ON n.oid = t.typnamespace AND n.nspname = 'public'`
    )

    const tablasDb = new Set(dbCols.map((r) => r.table_name))
    const colsDb = new Set(dbCols.map((r) => `${r.table_name}.${r.column_name}`))
    const enumsDb = new Map()
    for (const r of dbEnums) {
      if (!enumsDb.has(r.name)) enumsDb.set(r.name, new Set())
      enumsDb.get(r.name).add(r.value)
    }

    const problemas = []
    for (const m of models) {
      if (!tablasDb.has(m.table)) {
        problemas.push({ tipo: 'TABLA', objeto: m.table, remedio: buscarMigracion(m.table) })
        continue
      }
      for (const c of m.columns) {
        if (!colsDb.has(`${m.table}.${c.column}`)) {
          problemas.push({ tipo: 'COLUMNA', objeto: `${m.table}.${c.column}`, remedio: buscarMigracion(c.column) })
        }
      }
    }
    for (const [name, values] of enums) {
      const enDb = enumsDb.get(name)
      if (!enDb) {
        problemas.push({ tipo: 'ENUM', objeto: name, remedio: buscarMigracion(name) })
        continue
      }
      for (const v of values) {
        if (!enDb.has(v)) {
          problemas.push({ tipo: 'VALOR ENUM', objeto: `${name}.${v}`, remedio: buscarMigracion(v) })
        }
      }
    }

    if (problemas.length === 0) {
      console.log(`✓ Esquema al día: ${models.length} modelos y ${enums.size} enums verificados contra la BD. Nada pendiente.`)
      return
    }

    console.error(`✗ SCHEMA DRIFT: ${problemas.length} objeto(s) que el código espera y la BD NO tiene.\n`)
    for (const p of problemas) {
      console.error(`  [${p.tipo}] ${p.objeto}\n      → aplicar: ${p.remedio}`)
    }
    console.error(
      `\nRemedio general: ejecuta en el SQL Editor de Supabase las migraciones indicadas\n` +
        `(en orden cronológico) y vuelve a correr npm run db:doctor hasta ver ✓.`
    )
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

// ── main ────────────────────────────────────────────────────────────────────

const parsed = parseSchema(leerEsquema())
if (process.argv.includes('--sql')) {
  emitSql(parsed)
} else {
  await runConnected(parsed)
}
