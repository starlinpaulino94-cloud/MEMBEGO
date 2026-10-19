#!/usr/bin/env node
/**
 * Regenera los dos SQL de verificación de migraciones a partir de
 * prisma/migrations, para que nunca queden desfasados respecto al repo:
 *
 *   scripts/verificar-migraciones-resumen.sql  → corto, para pegar en el SQL
 *     Editor: una fila con el veredicto, comparando huellas md5.
 *   scripts/verificar-migraciones.sql          → largo, para `psql -f`: lista
 *     qué falta, qué está a medias, qué difiere y qué sobra.
 *
 * Uso:  node scripts/generar-verificar-migraciones.mjs
 * El checksum es el SHA-256 de migration.sql, el mismo que guarda Prisma.
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const RAIZ = fileURLToPath(new URL('..', import.meta.url))
const DIR = join(RAIZ, 'prisma', 'migrations')
const sha256 = (b) => createHash('sha256').update(b).digest('hex')
const md5 = (s) => createHash('md5').update(s).digest('hex')
// Orden byte a byte: el SQL usa `COLLATE "C"` para coincidir con esto.
const nombres = readdirSync(DIR)
  .filter((n) => statSync(join(DIR, n)).isDirectory())
  .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
const migs = nombres.map((n) => ({ n, c: sha256(readFileSync(join(DIR, n, 'migration.sql'))) }))
const total = migs.length
const ultima = migs[total - 1].n
const huellaNombres = md5(migs.map((m) => m.n).join(','))
const huellaChecksums = md5(migs.map((m) => `${m.n}:${m.c}`).join(','))
let commit = 'sin git'
try { commit = execSync('git rev-parse --short HEAD', { cwd: RAIZ, encoding: 'utf8' }).trim() } catch {}
const cabecera = `Generado con scripts/generar-verificar-migraciones.mjs en ${commit}: ${total} migraciones, última ${ultima}.`

writeFileSync(join(RAIZ, 'scripts', 'verificar-migraciones-resumen.sql'), `-- ¿Están aplicadas TODAS las migraciones de prisma/migrations? (versión corta)
-- ${cabecera}
-- Pégalo entero en el SQL Editor de Supabase. Solo lee. Devuelve UNA fila.
--   veredicto = 'OK' → no falta ninguna y coinciden nombre y contenido.
--   Si no, el detalle de qué falta lo da scripts/verificar-migraciones.sql
--   (ejecutado con psql -f, no pegado: es largo).
-- Si el repo cambió, regenera con: node scripts/generar-verificar-migraciones.mjs
WITH base AS (
  SELECT migration_name AS n, checksum AS c
  FROM _prisma_migrations
  WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
), esperado AS (
  SELECT ${total} AS total, '${ultima}' AS ultima,
         '${huellaNombres}' AS nombres,
         '${huellaChecksums}' AS checksums
), real AS (
  SELECT count(*) AS aplicadas,
         max(n COLLATE "C") AS ultima,
         md5(string_agg(n, ',' ORDER BY n COLLATE "C")) AS nombres,
         md5(string_agg(n || ':' || c, ',' ORDER BY n COLLATE "C")) AS checksums,
         (SELECT count(*) FROM _prisma_migrations
          WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL) AS incompletas
  FROM base
)
SELECT r.aplicadas, e.total AS esperadas, r.ultima AS ultima_aplicada, e.ultima AS ultima_del_repo,
       r.nombres = e.nombres AS nombres_ok, r.checksums = e.checksums AS checksums_ok, r.incompletas,
       CASE WHEN r.nombres = e.nombres AND r.checksums = e.checksums AND r.incompletas = 0 THEN 'OK'
            WHEN r.incompletas > 0 THEN 'REVISAR: hay migraciones a medias o revertidas'
            WHEN r.aplicadas < e.total THEN 'REVISAR: faltan ' || (e.total - r.aplicadas) || ' migración(es)'
            WHEN r.aplicadas > e.total THEN 'REVISAR: la base tiene ' || (r.aplicadas - e.total) || ' migración(es) que el repo no tiene'
            WHEN r.nombres <> e.nombres THEN 'REVISAR: hay migraciones distintas a las del repo'
            ELSE 'REVISAR: algún migration.sql aplicado difiere del repo' END AS veredicto
FROM real r, esperado e;
`)

writeFileSync(join(RAIZ, 'scripts', 'verificar-migraciones.sql'), `-- =============================================================================
-- ¿ESTÁN APLICADAS TODAS LAS MIGRACIONES DE prisma/migrations? (versión larga)
-- ${cabecera}
-- Solo lee; no modifica nada. Es UNA sola sentencia.
--
-- Ejecútalo desde el archivo, no pegado (es largo y los pegados se recortan):
--   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f scripts/verificar-migraciones.sql
-- Si el repo cambió, regenera con: node scripts/generar-verificar-migraciones.mjs
--
-- Resultado: una fila por hallazgo. Si solo sale RESUMEN con 'OK', no falta nada.
--   FALTANTE     → está en el repo y no en la base
--   INCOMPLETA   → registrada sin terminar o revertida      (deploy roto)
--   ALTERADA     → aplicada con un migration.sql distinto   (Prisma la rechazará)
--   DESCONOCIDA  → en la base pero no en el repo            (a mano u otra rama)
-- =============================================================================
WITH repo(nombre, checksum) AS (VALUES
${migs.map((m) => `  ('${m.n}','${m.c}')`).join(',\n')}
),
hallazgos AS (
  SELECT 1 AS orden, 'FALTANTE' AS tipo, r.nombre AS migracion,
         'no está en _prisma_migrations' AS detalle
  FROM repo r LEFT JOIN _prisma_migrations m ON m.migration_name = r.nombre
  WHERE m.id IS NULL
  UNION ALL
  SELECT 2, 'INCOMPLETA', m.migration_name,
         format('started_at=%s finished_at=%s rolled_back_at=%s pasos=%s',
                m.started_at, m.finished_at, m.rolled_back_at, m.applied_steps_count)
  FROM _prisma_migrations m
  WHERE m.finished_at IS NULL OR m.rolled_back_at IS NOT NULL
  UNION ALL
  SELECT 3, 'ALTERADA', m.migration_name,
         format('checksum base=%s repo=%s', m.checksum, r.checksum)
  FROM _prisma_migrations m JOIN repo r ON r.nombre = m.migration_name
  WHERE m.checksum <> r.checksum
  UNION ALL
  SELECT 4, 'DESCONOCIDA', m.migration_name,
         format('finished_at=%s pasos=%s', m.finished_at, m.applied_steps_count)
  FROM _prisma_migrations m LEFT JOIN repo r ON r.nombre = m.migration_name
  WHERE r.nombre IS NULL
)
SELECT 0 AS orden, 'RESUMEN' AS tipo,
       format('%s en repo / %s en base', (SELECT count(*) FROM repo),
              (SELECT count(*) FROM _prisma_migrations)) AS migracion,
       CASE WHEN NOT EXISTS (SELECT 1 FROM hallazgos) THEN 'OK'
            ELSE format('%s hallazgo(s): revisa las filas siguientes', (SELECT count(*) FROM hallazgos))
       END AS detalle
UNION ALL
SELECT orden, tipo, migracion, detalle FROM hallazgos
ORDER BY orden, migracion;
`)
console.log(`${cabecera}\n  huella nombres   ${huellaNombres}\n  huella checksums ${huellaChecksums}`)
