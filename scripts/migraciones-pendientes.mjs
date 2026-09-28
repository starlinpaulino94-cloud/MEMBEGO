#!/usr/bin/env node
/**
 * MIGRACIONES PENDIENTES · qué le falta ejecutar a una base.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ PREGUNTA RESPONDE, Y CUÁL NO
 *
 * Responde: **¿qué migraciones del repositorio no constan como aplicadas en
 * `_prisma_migrations`?** Compara los 157 directorios de `prisma/migrations/`
 * —con su suma SHA-256, la misma que Prisma guarda— contra lo que la base dice.
 *
 * NO responde «¿está la base al día con el código?». Eso es otra cosa y ya
 * tiene herramienta: `npm run db:doctor:sql`, que compara columnas y enums.
 *
 * LA DIFERENCIA IMPORTA AQUÍ MÁS QUE EN OTROS PROYECTOS. Las migraciones de
 * MembeGo se aplicaron durante meses pegándolas en el SQL Editor de Supabase, y
 * el SQL Editor **no escribe en `_prisma_migrations`**. Así que:
 *
 *   FALTA  ≠  «este SQL no se ha ejecutado»
 *   FALTA  =  «Prisma no tiene constancia de que se ejecutara»
 *
 * Las dos cosas se arreglan distinto: lo primero con `migrate deploy`, lo
 * segundo con `npm run migraciones:baseline`. Ejecutar de nuevo una migración
 * ya aplicada falla en la primera línea («type ... already exists»), así que
 * antes de correr nada hay que saber en cuál de los dos casos se está. Por eso
 * el SQL que emite este script dice, para cada fila, cuál es el remedio.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ SE GENERA Y NO SE GUARDA ESCRITO
 *
 * La lista de migraciones crece. Un .sql con 157 nombres pegados a mano nace
 * desactualizado en la siguiente migración y nadie se entera, porque un
 * verificador incompleto no da error: simplemente deja de mirar lo nuevo.
 * La fuente es `prisma/migrations/SUMAS.txt`, que el CI ya vigila.
 *
 * Uso:
 *   npm run migraciones:pendientes            → imprime el SQL
 *   npm run migraciones:pendientes > x.sql    → lo guarda
 *
 * Es de SOLO LECTURA: el SQL que emite no escribe nada en la base.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIR = join(ROOT, 'prisma', 'migrations')

// ── Las sumas selladas, que es la lista de verdad ───────────────────────────
const sumas = new Map()
for (const linea of readFileSync(join(DIR, 'SUMAS.txt'), 'utf8').split('\n')) {
  const t = linea.trim()
  if (!t || t.startsWith('#')) continue
  const [suma, nombre] = t.split(/\s+/)
  if (suma && nombre) sumas.set(nombre, suma)
}

// ── Los directorios que hay de verdad, por si SUMAS se quedó corto ──────────
const dirs = readdirSync(DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort()

const sinSellar = dirs.filter((d) => !sumas.has(d))
if (sinSellar.length > 0) {
  console.error(`✗ ${sinSellar.length} migración(es) sin sellar en SUMAS.txt:`)
  for (const d of sinSellar) console.error(`   ${d}`)
  console.error('  Sella con: npm run migraciones:sellar')
  process.exit(1)
}

const filas = dirs.map((n, i) => `  (${i + 1},'${n}','${sumas.get(n)}')`)

// ── El SQL que emitimos tiene que ser UNA sentencia ─────────────────────────
//
// El SQL Editor de Supabase trocea el texto por punto y coma sin mirar si está
// dentro de una cadena o de un comentario. Uno de más no da un error legible:
// da «syntax error at end of input» apuntando a la linea 0, que no dice nada y
// manda a buscar el fallo donde no esta. Ya paso una vez.
//
// Por eso el unico punto y coma admisible es el que cierra el archivo. Se
// comprueba aqui, sobre el texto ya generado, en vez de confiar en que nadie
// lo rompa al editarlo.
function comprobarUnaSolaSentencia(sql) {
  const cuerpo = sql.trimEnd()
  if (!cuerpo.endsWith(';')) {
    console.error('\u2717 El SQL generado no termina en punto y coma.')
    process.exit(1)
  }
  const sobrantes = (cuerpo.slice(0, -1).match(/;/g) || []).length
  if (sobrantes > 0) {
    console.error(`\u2717 El SQL generado tiene ${sobrantes} punto(s) y coma de mas (solo vale el final).`)
    console.error('  Supabase trocea por ese caracter y devolveria «syntax error at end of input».')
    process.exit(1)
  }
}

const sql = `-- ════════════════════════════════════════════════════════════════════════
-- MIGRACIONES PENDIENTES · generado desde prisma/migrations/SUMAS.txt
-- ${dirs.length} migraciones en el repositorio · SOLO LECTURA, no escribe nada
--
-- Pega este archivo entero en el SQL Editor de Supabase.
--
-- LEE ESTO ANTES DE EJECUTAR NADA DE LO QUE TE DIGA:
-- «FALTA» significa que Prisma no tiene constancia, NO que el SQL no se haya
-- ejecutado. En MembeGo muchas migraciones se aplicaron pegándolas en el SQL
-- Editor, que no escribe en _prisma_migrations. Si vuelves a ejecutar una que
-- ya estaba aplicada, fallará con «already exists».
--
-- Para distinguir los dos casos, corre también: npm run db:doctor:sql
--   · db:doctor no se queja  → el cambio YA está  → baseline (solo registrar)
--   · db:doctor lista lo que falta → el cambio NO está → migrate deploy
-- ════════════════════════════════════════════════════════════════════════

-- SI FALLA CON «relation "_prisma_migrations" does not exist»:
-- esa ES la respuesta. No hay registro ninguno, así que no hay nada que
-- comparar. Empieza por:  npm run migraciones:baseline
--
-- Este archivo es UNA SOLA sentencia a propósito. El SQL Editor de Supabase
-- trocea el texto por punto y coma sin respetar comillas ni comentarios, así
-- que varias sentencias —o un punto y coma dentro de una cadena— acaban en
-- «syntax error at end of input» apuntando a la línea 0. Si lo editas, no
-- metas puntos y coma: el único que vale es el que cierra el archivo.

WITH esperadas(orden, nombre, suma) AS (VALUES
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
      WHEN r.migration_name IS NULL              THEN 'FALTA'
      WHEN r.rolled_back_at IS NOT NULL          THEN 'REVERTIDA'
      WHEN r.finished_at IS NULL                 THEN 'A MEDIAS'
      WHEN r.checksum IS DISTINCT FROM e.suma    THEN 'EDITADA'
      ELSE 'OK'
    END AS estado,
    r.finished_at
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
      -- Sin punto y coma dentro del texto: el SQL Editor trocea por ese
      -- carácter sin respetar las comillas y partiría la cadena por la mitad.
      WHEN 'FALTA'     THEN 'Prisma no lo tiene. Mira con db:doctor:sql si el cambio YA está. Si está --> baseline. Si no --> migrate deploy'
      WHEN 'REVERTIDA' THEN 'Se marcó como revertida. Hay que decidir a mano si se vuelve a aplicar'
      WHEN 'A MEDIAS'  THEN 'Empezó y no terminó. La base puede estar a medio migrar: REVÍSALA ANTES DE TOCAR NADA'
      WHEN 'EDITADA'   THEN 'Aplicada, pero el archivo cambió después. El SQL del repo ya no es lo que corrió en la base'
    END AS remedio
  FROM diagnostico
  WHERE estado <> 'OK'
  UNION ALL
  -- 900000 las manda al final de la lista: no tienen sitio en el orden del
  -- repositorio porque no están en él.
  SELECT 900000, 'SOBRA', migration_name,
         'Registrada en la base pero no está en el repositorio (¿rama vieja, o borrada?)'
  FROM sobrantes
)
SELECT "#", "estado", "migración", "qué hacer" FROM (
  SELECT
    CASE WHEN orden >= 900000 THEN '—' ELSE to_char(orden, 'FM000') END AS "#",
    estado  AS "estado",
    nombre  AS "migración",
    remedio AS "qué hacer",
    orden   AS _orden
  FROM problemas
  UNION ALL
  SELECT '---', '---', '---', '---', 1000000
  UNION ALL
  SELECT
    'TOT',
    'RESUMEN',
    (SELECT count(*) FROM diagnostico WHERE estado = 'OK')::text || ' de ${dirs.length} al día',
    CASE WHEN (SELECT count(*) FROM problemas) = 0
      THEN 'Todo en orden: el repositorio y el registro coinciden'
      ELSE (SELECT count(*) FROM problemas)::text || ' fila(s) que revisar arriba'
    END,
    1000001
) t
ORDER BY _orden, "migración";`

comprobarUnaSolaSentencia(sql)
console.log(sql)
