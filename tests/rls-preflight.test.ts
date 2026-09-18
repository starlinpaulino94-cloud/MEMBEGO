import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * PREFLIGHT DE RLS CAPA 2 · guardia de drift (B-8 · encender RLS).
 *
 * El código ya está migrado a `conEmpresa`/`sinEmpresa` y las políticas están
 * escritas y probadas; lo único que separa «escrito» de «aplicado» es cambiar el
 * rol de conexión a `membego_app`. El riesgo del cutover es una tabla NUEVA sin
 * ruta al inquilino: con `membego_app`, RLS la deniega y el síntoma es una
 * pantalla en blanco, no un error.
 *
 * `rls:probar` no lo ve —solo siembra ciertas tablas—, así que sin este guard el
 * drift solo aparecía en el cutover. Aquí corre el preflight (de papel, sin base)
 * y exige que ninguna tabla se quede denegada sin una decisión escrita en el SQL.
 * Es el mismo gate que CI, pero también en la suite local: el «✓ verde que
 * mentía» que documenta docs/RLS.md no vuelve por esta puerta.
 */

const raiz = join(__dirname, '..')

test('el preflight de RLS Capa 2 pasa: ninguna tabla queda denegada sin decidir', () => {
  // Falla (exit 1) si hay una tabla sin ruta y sin decisión en el SQL; el
  // execFileSync propaga ese fallo como una excepción con la salida adjunta.
  try {
    const salida = execFileSync('node', ['scripts/rls-capa2-preflight.mjs'], {
      cwd: raiz,
      encoding: 'utf8',
    })
    assert.match(salida, /Ninguna tabla se quedaría denegada/)
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string }
    assert.fail(
      'El preflight de RLS falló: una tabla nueva se quedaría denegada con membego_app.\n' +
        'Decídela en prisma/migrations_manual/2026-07-rls-capa2-aislamiento.sql.\n\n' +
        (err.stdout ?? '') +
        (err.stderr ?? '')
    )
  }
})

test('el catálogo de conectores tiene su decisión de RLS (no vuelve a driftar)', () => {
  // Fija el arreglo de esta tanda: `conectores` es un catálogo global y sin su
  // decisión saldría vacío con membego_app. Que no se caiga en un futuro rebase.
  const sql = readFileSync(
    join(raiz, 'prisma/migrations_manual/2026-07-rls-capa2-aislamiento.sql'),
    'utf8'
  )
  const catalogos = sql.slice(sql.indexOf('FOREACH cond IN ARRAY ARRAY['))
  assert.match(catalogos.slice(0, 300), /'conectores'/, 'conectores no está entre los catálogos globales')
})
