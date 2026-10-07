import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Ninguna credencial escrita en el repositorio.
 *
 * Los scripts `run-e2e-verify.mjs` y `run-auth-e2e.mjs` llevaron durante semanas las claves
 * `anon` y `service_role` de un proyecto de Supabase y la contraseña de su base de datos
 * (hallazgo C1 de la auditoría del 2026-10-07). Esta prueba recorre TODOS los archivos
 * versionados y falla si encuentra:
 *
 *  · un JWT completo (tres partes en base64url): las claves `anon`/`service_role` de Supabase
 *    lo son;
 *  · una cadena de conexión `postgres://usuario:contraseña@host` con una contraseña real hacia un
 *    host que no es local (los de CI y de pruebas locales —127.0.0.1, localhost— son válidos).
 *
 * Es la red barata que corre en `npm test`; el job `secretos` de CI (gitleaks) es la amplia.
 * Las claves que ya estuvieron en git hay que ROTARLAS: seguirán en el historial.
 */

const RAIZ = join(__dirname, '..')
const archivos = execFileSync('git', ['ls-files', '-z'], { cwd: RAIZ, maxBuffer: 64 * 1024 * 1024 })
  .toString('utf8')
  .split('\0')
  .filter((f) => f !== '' && !/(^|\/)(package-lock\.json|.*\.(png|jpe?g|gif|webp|ico|pdf|woff2?|ttf|otf|zip|gz|mp4|webm|svg|lock))$/i.test(f))

const JWT = /\beyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}/
const CONEXION = /postgres(?:ql)?:\/\/([^:\s'"`/@]+):([^@\s'"`]+)@([^\s'"`/:?]+)/g
const HOSTS_LOCALES = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', 'postgres', 'db', 'host.docker.internal'])
const MARCADOR = /^(synthetic[\w-]*|sintetic[\w-]*|fake[\w-]*|dummy[\w-]*|ejemplo[\w-]*|<[^>]*>|\$\{?[A-Za-z_][A-Za-z0-9_]*\}?|\[?YOUR[-_ ]?PASSWORD\]?|PASSWORD|password|contrasena|contraseña|secret|xxx+|\*+|\.\.\.|…|%s|\{\{[^}]*\}\})$/i

function hallazgos(): string[] {
  const salida: string[] = []
  for (const f of archivos) {
    const ruta = join(RAIZ, f)
    let tamano = 0
    try {
      tamano = statSync(ruta).size
    } catch {
      continue
    }
    if (tamano > 2_000_000) continue
    const texto = readFileSync(ruta, 'utf8')
    if (JWT.test(texto)) salida.push(`${f}: contiene un JWT completo`)
    for (const m of texto.matchAll(CONEXION)) {
      const [, , contrasena, host] = m
      if (HOSTS_LOCALES.has(host)) continue
      if (MARCADOR.test(contrasena)) continue
      salida.push(`${f}: cadena de conexión a ${host} con una contraseña escrita`)
    }
  }
  return salida
}

test('el escáner recorre el repositorio', () => {
  assert.ok(archivos.length > 1000, `solo vio ${archivos.length} archivos`)
})

test('ningún archivo versionado trae un JWT completo ni una cadena de conexión remota con contraseña', () => {
  assert.deepEqual(hallazgos(), [], 'saca la credencial a una variable de entorno y ROTA la que se escribió (queda en el historial de git)')
})

test('el detector reconoce lo que busca (no es una prueba que siempre pasa)', () => {
  const jwtDePrueba = ['eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', 'eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoic3VwYWJhc2UifQ', 'c2lnbmF0dXJlLWRlLXBydWViYS1zaW4tdmFsb3I'].join('.')
  assert.ok(JWT.test(`const k = '${jwtDePrueba}'`))
  assert.ok(!JWT.test('Authorization: Bearer eyJhbGciOi…'), 'un ejemplo truncado no es una credencial')
  // Armada por partes: el propio archivo no puede traer una cadena de conexión remota con contraseña escrita.
  const remota = ['postgresql://postgres.abc', 'UnaClaveReal123@aws-0-us-west-2.pooler.supabase.com'].join(':') + ':6543/postgres'
  const m = [...remota.matchAll(CONEXION)][0]
  assert.equal(m[3], 'aws-0-us-west-2.pooler.supabase.com')
  assert.ok(!HOSTS_LOCALES.has(m[3]) && !MARCADOR.test(m[2]))
  assert.ok(MARCADOR.test('<PASSWORD>') && MARCADOR.test('${DB_PASSWORD}') && MARCADOR.test('[YOUR-PASSWORD]') && MARCADOR.test('synthetic-1'))
  assert.ok(HOSTS_LOCALES.has('127.0.0.1'))
})

test('el CI tiene un trabajo de secret scanning y los scripts E2E remotos leen todo del entorno', () => {
  const wf = readFileSync(join(RAIZ, '.github/workflows/secretos.yml'), 'utf8')
  assert.match(wf, /gitleaks\/gitleaks-action@/)
  assert.match(wf, /fetch-depth: 0/)
  for (const s of ['scripts/run-e2e-verify.mjs', 'scripts/run-auth-e2e.mjs']) {
    assert.match(readFileSync(join(RAIZ, s), 'utf8'), /entornoRemotoDesdeProceso\(\)/, `${s} lee el entorno de quien lo corre`)
  }
})
