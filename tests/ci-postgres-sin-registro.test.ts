import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * POSTGRES DE CI SIN DESCARGAR IMÁGENES (17-10-2026).
 *
 * Los trabajos que bloquean un PR (E2E y «Esquema de base de datos») levantaban
 * Postgres como `services:` con una imagen del espejo de ECR. Esa descarga tiene
 * una cuota compartida entre runners y, agotada, el job moría a los 10 s con
 * `toomanyrequests`, antes de ejecutar una sola prueba — sin relación con el
 * código (#621, #624). Ahora usan el PostgreSQL 16 del runner a través de
 * `.github/actions/postgres`. Estas guardas fijan esa decisión y los detalles que
 * hacen que el Postgres local se comporte como el del contenedor.
 */

const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), 'utf8')
const sinComentarios = (s: string) => s.replace(/^\s*#.*$/gm, '')

const ACCION = '.github/actions/postgres/action.yml'

test('el E2E y el trabajo de esquema ya no descargan una imagen de Postgres', () => {
  for (const wf of ['.github/workflows/e2e.yml', '.github/workflows/ci.yml']) {
    const src = sinComentarios(leer(wf))
    assert.doesNotMatch(src, /^\s*services:/m, `${wf}: un servicio-contenedor vuelve a depender de la cuota del registro`)
    assert.doesNotMatch(src, /ecr\.aws|docker\.io|library\/postgres/, `${wf}: no debe nombrar una imagen de Postgres`)
    assert.match(src, /uses: \.\/\.github\/actions\/postgres/, `${wf} no usa la acción de Postgres local`)
  }
  // Cada uno con el usuario/contraseña/base que ya esperaban sus DATABASE_URL.
  assert.match(leer('.github/workflows/e2e.yml'), /password: e2e\s+database: membego_e2e/)
  assert.match(leer('.github/workflows/ci.yml'), /password: ci\s+database: sombra/)
})

test('la acción comporta como el contenedor: mismo locale, mismo puerto, y no se rompe si el runner no trae Postgres', () => {
  const a = leer(ACCION)
  assert.match(a, /pg_createcluster "\$VERSION" ci --locale=en_US\.UTF-8 --port="\$PG_PORT" --start/, 'el orden de los textos y unaccent dependen del locale que traía la imagen')
  assert.match(a, /default: '5432'/, 'las DATABASE_URL de los trabajos apuntan a localhost:5432')
  assert.match(a, /pg_trgm','unaccent/, 'comprueba las extensiones que el esquema necesita (índices GIN)')
  // Caída: si no hay nativo, el contenedor con reintentos y espera creciente (no morir al primer rechazo).
  assert.match(a, /for intento in 1 2 3 4 5 6; do/)
  assert.match(a, /espera=\$\(\(espera \* 2\)\)/)
  assert.match(a, /pg_dropcluster --stop "\$VERSION" ci/, 'un clúster a medias no debe ocupar el puerto del contenedor')
})

test('la acción recibe sus entradas por variables de entorno, nunca interpoladas en el script', () => {
  const a = leer(ACCION)
  const script = a.slice(a.indexOf('      run: |'))
  assert.ok(script.length > 200)
  assert.doesNotMatch(script, /\$\{\{/, 'una expresión ${{ }} dentro del script permite inyectar comandos')
  for (const v of ['PG_PASSWORD', 'PG_DATABASE', 'PG_PORT']) assert.match(a, new RegExp(`${v}: \\$\\{\\{ inputs\\.`))
})
