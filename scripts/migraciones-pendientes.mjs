#!/usr/bin/env node
/**
 * MIGRACIONES PENDIENTES · que le falta ejecutar a una base.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUE PREGUNTA RESPONDE, Y CUAL NO
 *
 * Responde: que migraciones del repositorio no constan como aplicadas en
 * `_prisma_migrations`. Compara los directorios de `prisma/migrations/` —con su
 * suma SHA-256, la misma que Prisma guarda— contra lo que la base dice.
 *
 * NO responde «esta la base al dia con el codigo». Eso es otra cosa y ya tiene
 * herramienta: `npm run db:doctor:sql`, que compara columnas y enums.
 *
 * LA DIFERENCIA IMPORTA AQUI MAS QUE EN OTROS PROYECTOS. Las migraciones de
 * MembeGo se aplicaron durante meses pegandolas en el SQL Editor de Supabase, y
 * el SQL Editor no escribe en `_prisma_migrations`. Asi que:
 *
 *   FALTA  !=  «este SQL no se ha ejecutado»
 *   FALTA  ==  «Prisma no tiene constancia de que se ejecutara»
 *
 * Se arreglan distinto: lo primero con `migrate deploy`, lo segundo con
 * `npm run migraciones:baseline`. Reejecutar una migracion ya aplicada falla
 * con «already exists», asi que hay que saber en cual de los dos casos se esta.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUE EL SQL SALE PELADO, SIN UN SOLO COMENTARIO
 *
 * Porque el SQL Editor de Supabase preprocesa el texto antes de mandarlo, y lo
 * hace mal. Dos veces seguidas devolvio «42601: syntax error at end of input»
 * apuntando a la linea 0 —un mensaje que no dice donde esta el fallo— por dos
 * causas distintas:
 *
 *   1. Trocea por punto y coma sin respetar las comillas. Un ';' dentro de una
 *      cadena partia la sentencia por la mitad.
 *   2. Corta en '--' sin respetar las comillas. Un '-->' dentro de una cadena
 *      dejaba la cadena abierta y se comia el resto.
 *
 * En vez de ir adivinando cual de sus preprocesadores es, el SQL que se emite
 * no contiene NINGUNA de las construcciones que se pueden mangonear: ni
 * comentarios de linea, ni de bloque, ni '--' en ningun sitio (tampoco dentro
 * de cadenas), y un unico punto y coma, el del final. Las tres cosas se
 * comprueban sobre el texto ya generado antes de imprimirlo.
 *
 * La explicacion, que antes vivia en comentarios dentro del .sql, se imprime
 * ahora por stderr: asi `npm run migraciones:pendientes > x.sql` recoge solo
 * el SQL y la guia se sigue leyendo en la terminal.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUE SE GENERA Y NO SE GUARDA ESCRITO
 *
 * La lista de migraciones crece. Un .sql con los nombres pegados a mano nace
 * desactualizado en la siguiente migracion y nadie se entera, porque un
 * verificador incompleto no da error: simplemente deja de mirar lo nuevo.
 * La fuente es `prisma/migrations/SUMAS.txt`, que el CI ya vigila.
 *
 * Uso:
 *   npm run migraciones:pendientes            -> SQL por stdout, guia por stderr
 *   npm run migraciones:pendientes > x.sql    -> guarda solo el SQL
 *
 * El SQL que emite es de SOLO LECTURA: no escribe nada en la base.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIR = join(ROOT, 'prisma', 'migrations')

// ── Las sumas selladas, que son la lista de verdad ──────────────────────────
const sumas = new Map()
for (const linea of readFileSync(join(DIR, 'SUMAS.txt'), 'utf8').split('\n')) {
  const t = linea.trim()
  if (!t || t.startsWith('#')) continue
  const [suma, nombre] = t.split(/\s+/)
  if (suma && nombre) sumas.set(nombre, suma)
}

// ── Los directorios que hay de verdad, por si SUMAS se quedo corto ──────────
const dirs = readdirSync(DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort()

const sinSellar = dirs.filter((d) => !sumas.has(d))
if (sinSellar.length > 0) {
  console.error(`✗ ${sinSellar.length} migracion(es) sin sellar en SUMAS.txt:`)
  for (const d of sinSellar) console.error(`   ${d}`)
  console.error('  Sella con: npm run migraciones:sellar')
  process.exit(1)
}

const filas = dirs.map((n, i) => `  (${i + 1},'${n}','${sumas.get(n)}')`)

// ── El SQL emitido no puede llevar nada que un preprocesador rompa ──────────
//
// No basta con que el SQL sea valido para PostgreSQL: las dos versiones
// anteriores lo eran y corrian bien en psql. Se rompian al pasar por el editor
// web. Por eso se comprueba el texto GENERADO, no la plantilla.
function comprobarSqlPelado(sql) {
  const cuerpo = sql.trimEnd()
  const fallos = []
  if (!cuerpo.endsWith(';')) fallos.push('no termina en punto y coma')
  const puntoYComa = (cuerpo.slice(0, -1).match(/;/g) || []).length
  if (puntoYComa > 0) fallos.push(`${puntoYComa} punto(s) y coma de mas (Supabase trocea por ahi)`)
  const guiones = (cuerpo.match(/--/g) || []).length
  if (guiones > 0) fallos.push(`${guiones} secuencia(s) '--' (Supabase corta ahi, aun dentro de comillas)`)
  if (cuerpo.includes('/*')) fallos.push("comentario de bloque '/*'")
  if (fallos.length > 0) {
    console.error('✗ El SQL generado lleva algo que el SQL Editor puede romper:')
    for (const f of fallos) console.error(`   - ${f}`)
    console.error('  Sintoma tipico: «42601: syntax error at end of input» en la linea 0.')
    process.exit(1)
  }
}

const sql = `WITH esperadas(orden, nombre, suma) AS (VALUES
${filas.join(',\n')}
),
reales AS (
  SELECT migration_name, checksum, finished_at, rolled_back_at
  FROM _prisma_migrations
),
diagnostico AS (
  SELECT
    e.orden,
    e.nombre,
    CASE
      WHEN r.migration_name IS NULL           THEN 'FALTA'
      WHEN r.rolled_back_at IS NOT NULL       THEN 'REVERTIDA'
      WHEN r.finished_at IS NULL              THEN 'A MEDIAS'
      WHEN r.checksum IS DISTINCT FROM e.suma THEN 'EDITADA'
      ELSE 'OK'
    END AS estado
  FROM esperadas e
  LEFT JOIN reales r ON r.migration_name = e.nombre
),
sobrantes AS (
  SELECT r.migration_name
  FROM reales r
  LEFT JOIN esperadas e ON e.nombre = r.migration_name
  WHERE e.nombre IS NULL
),
problemas AS (
  SELECT orden, estado, nombre,
    CASE estado
      WHEN 'FALTA'     THEN 'Prisma no lo tiene. Mira con db:doctor:sql si el cambio ya esta. Si esta, baseline. Si no, migrate deploy'
      WHEN 'REVERTIDA' THEN 'Marcada como revertida. Hay que decidir a mano si se vuelve a aplicar'
      WHEN 'A MEDIAS'  THEN 'Empezo y no termino. La base puede estar a medio migrar. REVISALA ANTES DE TOCAR NADA'
      WHEN 'EDITADA'   THEN 'Aplicada, pero el archivo cambio despues. El SQL del repo ya no es lo que corrio en la base'
    END AS remedio
  FROM diagnostico
  WHERE estado <> 'OK'
  UNION ALL
  SELECT 900000, 'SOBRA', migration_name,
         'Registrada en la base pero no esta en el repositorio (rama vieja, o borrada)'
  FROM sobrantes
)
SELECT "#", "estado", "migracion", "que hacer" FROM (
  SELECT
    CASE WHEN orden >= 900000 THEN ' ' ELSE to_char(orden, 'FM000') END AS "#",
    estado  AS "estado",
    nombre  AS "migracion",
    remedio AS "que hacer",
    orden   AS _orden
  FROM problemas
  UNION ALL
  SELECT '===', '===', '===', '===', 1000000
  UNION ALL
  SELECT
    'TOT',
    'RESUMEN',
    (SELECT count(*) FROM diagnostico WHERE estado = 'OK')::text || ' de ${dirs.length} al dia',
    CASE WHEN (SELECT count(*) FROM problemas) = 0
      THEN 'Todo en orden: el repositorio y el registro coinciden'
      ELSE (SELECT count(*) FROM problemas)::text || ' fila(s) que revisar arriba'
    END,
    1000001
) t
ORDER BY _orden, "migracion";`

comprobarSqlPelado(sql)

console.error(`
MIGRACIONES PENDIENTES  ·  ${dirs.length} migraciones en el repositorio

  Pega el SQL en el SQL Editor de Supabase. Es de solo lectura.
  Devuelve SOLO lo que hay que revisar. Si todo esta bien, una linea:
  "${dirs.length} de ${dirs.length} al dia".

  Si falla con  relation "_prisma_migrations" does not exist
  esa ES la respuesta: no hay registro ninguno. Empieza por
  npm run migraciones:baseline

  OJO CON "FALTA": significa que Prisma no tiene constancia, NO que el
  SQL no se haya ejecutado. Aqui muchas migraciones se aplicaron pegandolas
  en el SQL Editor, que no escribe en _prisma_migrations. Cruza con
  npm run db:doctor:sql
     no se queja        -> el cambio YA esta -> migraciones:baseline
     lista lo que falta -> el cambio NO esta -> db:migrate:deploy
`)

console.log(sql)
