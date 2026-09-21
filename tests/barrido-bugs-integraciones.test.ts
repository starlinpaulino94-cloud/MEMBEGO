import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { partirToken } from '../src/modules/connect/entrantesNucleo'

/**
 * BARRIDO DE BUGS OCULTOS · integraciones.
 *
 * Fija los arreglos del lote #2/#3/#7/#8 para que no vuelvan a colarse. Lo puro
 * se prueba de verdad; lo que toca la base es una guardia estructural sobre el
 * fuente, igual que el resto de la suite.
 */

const raiz = join(__dirname, '..')
const leer = (r: string) => readFileSync(join(raiz, r), 'utf8')
// Sin comentarios: un comentario que explica «ya no se traga con .catch(()=>[])»
// contiene el propio patrón, y una guardia que se dispara con su documentación es
// una guardia que alguien acaba borrando.
const codigo = (r: string) =>
  leer(r)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

// ─── #3 · una resolución de cliente no traga el error de la base ─────────────

test('las resoluciones de cliente NO devuelven null ante un fallo de la base', () => {
  // Devolver null ante un error de infra convierte «la consulta falló» en «no
  // existe», y el empleado cobra el precio completo a un socio. El error debe
  // propagarse (el borde HTTP lo vuelve un 500 reintenable).
  const src = codigo('src/modules/plataforma/consultas.ts')
  for (const fn of ['clientePorId', 'clientePorEmail', 'clientePorTelefono', 'clientePorPlaca']) {
    const i = src.indexOf(`export async function ${fn}`)
    const cuerpo = src.slice(i, src.indexOf('\nexport ', i + 1))
    assert.ok(!/\.catch\(\(\)\s*=>\s*(null|\[\])\)/.test(cuerpo), `${fn} sigue tragando el error de la base`)
  }
})

test('la ruta resolve responde 500 (no 404) cuando la base falla', () => {
  const src = leer('src/app/api/platform/v1/customers/resolve/route.ts')
  assert.match(src, /try \{[\s\S]*clientePorTelefono[\s\S]*\} catch/)
  assert.match(src, /errorApi\('INTERNAL_ERROR'/)
})

// ─── #2 · el listado paginado no trunca en silencio ──────────────────────────

test('listarClientes NO traga el error (una página vacía sería «fin» falso)', () => {
  const src = codigo('src/modules/plataforma/consultas.ts')
  const i = src.indexOf('export async function listarClientes')
  // Acotado a ESTA función: la siguiente (`vehiculosDeCliente`) sí tiene su
  // `.catch(() => [])`, y sin acotar el regex la vería y daría un falso positivo.
  const cuerpo = src.slice(i, src.indexOf('\nexport ', i + 1))
  assert.ok(!/\.catch\(\(\)\s*=>\s*\[\]\)/.test(cuerpo), 'listarClientes sigue tragando el error')
})

test('la ruta GET /customers responde 500 cuando la base falla, no una página vacía', () => {
  const src = leer('src/app/api/platform/v1/customers/route.ts')
  const get = src.slice(src.indexOf('export async function GET'), src.indexOf('export async function POST'))
  assert.match(get, /try \{[\s\S]*listarClientes[\s\S]*\} catch/)
  assert.match(get, /errorApi\('INTERNAL_ERROR'/)
})

// ─── #7 · el guard por-petición re-chequea el estado del sistema ─────────────

test('leerCredencial exige que el SISTEMA esté ACTIVE, no solo la credencial', () => {
  // Suspender un sistema tiene que cortar sus tokens vivos ya, no en 15 minutos.
  const src = leer('src/modules/plataforma/api.ts')
  const fn = src.slice(src.indexOf('export async function leerCredencial'))
  assert.match(fn.slice(0, 1200), /sistema: \{ select: \{ slug: true, estado: true \} \}/)
  assert.match(fn.slice(0, 1200), /c\.sistema\.estado !== 'ACTIVE'/)
})

// ─── #8 · la clave del rate-limit entrante no lleva parte del secreto ────────

test('el prefijo público de un token entrante NO incluye el secreto', () => {
  const secreto = 's'.repeat(40) // >= 32, el mínimo del núcleo
  const p = partirToken(`whi_abcdef123456.${secreto}`)
  assert.ok(p, 'un token bien formado debería partirse')
  assert.equal(p!.prefijo, 'whi_abcdef123456')
  assert.equal(p!.secreto, secreto)
  // El prefijo es exactamente `whi_` + 12: no hay sitio para un char del secreto.
  assert.equal(p!.prefijo.length, 16)
})

test('el rate-limit entrante se llavea por el prefijo, no por token.slice(0,20)', () => {
  const src = leer('src/app/api/connect/entrante/[token]/route.ts')
  assert.match(src, /partirToken\(token\)\?\.prefijo/)
  assert.ok(!/token\.slice\(0,\s*20\)/.test(src), 'sigue metiendo 3 chars del secreto en la clave del limitador')
})
