import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  RESULTADO,
  esError,
  inicioDeVentana,
  inicioDelDiaUTC,
  normalizarEndpoint,
  pareceId,
  resumirUso,
  type FilaMetrica,
} from '../src/modules/plataforma/metricas-nucleo'

/**
 * MÉTRICAS DE USO POR CREDENCIAL · hallazgo B-7 de la auditoría.
 *
 * Lo que decide qué se cuenta —la normalización del endpoint— y cómo se resume
 * es puro y se prueba aquí caso por caso. Lo que toca la base es una guardia
 * estructural: que el enganche esté donde ya se conoce la credencial y que un id
 * de cliente no pueda colarse en la tabla.
 */

const raiz = join(__dirname, '..')
const leer = (r: string) => readFileSync(join(raiz, r), 'utf8')

// ─── Normalización del endpoint: ningún id entra en la telemetría ────────────

test('el prefijo de la API se recorta', () => {
  assert.equal(normalizarEndpoint('/api/platform/v1/customers'), '/customers')
  assert.equal(normalizarEndpoint('/api/platform/v1/webhooks'), '/webhooks')
})

test('un id en la ruta se reemplaza por {id}, nunca se guarda', () => {
  // Es la regla que impide que la tabla tenga una fila por cliente consultado y,
  // peor, que un id de cliente acabe en una tabla de telemetría.
  assert.equal(normalizarEndpoint('/api/platform/v1/customers/cus_abc123'), '/customers/{id}')
  assert.equal(normalizarEndpoint('/api/platform/v1/webhooks/clh1234567890abcdefghij'), '/webhooks/{id}')
  assert.equal(
    normalizarEndpoint('/api/platform/v1/customers/550e8400-e29b-41d4-a716-446655440000'),
    '/customers/{id}'
  )
})

test('los nombres de recurso se conservan; lo demás es un id', () => {
  // Palabras cortas en minúscula con guiones = recurso. Todo lo otro = id, para
  // que un id nuevo no se cuele por no haberlo previsto: el defecto es id.
  for (const recurso of ['customers', 'resolve', 'search', 'vehicle-types', 'me', 'memberships']) {
    assert.equal(pareceId(recurso), false, `«${recurso}» debería tratarse como recurso`)
  }
  for (const id of ['cus_1', 'ABC', 'clh1234567890abcdefghij', 'a1b2c3', '42']) {
    assert.equal(pareceId(id), true, `«${id}» debería tratarse como id`)
  }
})

test('rutas anidadas: solo se sustituye el segmento que es id', () => {
  assert.equal(
    normalizarEndpoint('/api/platform/v1/customers/cus_9/vehicles'),
    '/customers/{id}/vehicles'
  )
})

// ─── El día del agregado ─────────────────────────────────────────────────────

test('el día se ancla a medianoche UTC', () => {
  const d = inicioDelDiaUTC(new Date('2026-09-17T23:30:00.000Z'))
  assert.equal(d.toISOString(), '2026-09-17T00:00:00.000Z')
})

test('la ventana de N días incluye hoy y va hacia atrás', () => {
  const ahora = new Date('2026-09-17T10:00:00.000Z')
  assert.equal(inicioDeVentana(1, ahora).toISOString(), '2026-09-17T00:00:00.000Z')
  assert.equal(inicioDeVentana(30, ahora).toISOString(), '2026-08-19T00:00:00.000Z')
  // Nunca menos de un día, aunque le pidan cero o negativo.
  assert.equal(inicioDeVentana(0, ahora).toISOString(), '2026-09-17T00:00:00.000Z')
})

// ─── El resumen ──────────────────────────────────────────────────────────────

const FILAS: FilaMetrica[] = [
  { dia: '2026-09-16', endpoint: '/customers', metodo: 'GET', resultado: 'OK', peticiones: 100 },
  { dia: '2026-09-16', endpoint: '/customers', metodo: 'GET', resultado: 'SCOPE', peticiones: 5 },
  { dia: '2026-09-17', endpoint: '/customers/{id}', metodo: 'PATCH', resultado: 'OK', peticiones: 20 },
  { dia: '2026-09-17', endpoint: '/customers', metodo: 'GET', resultado: 'OK', peticiones: 30 },
]

test('el resumen suma el total y la tasa de error', () => {
  const r = resumirUso(FILAS)
  assert.equal(r.total, 155)
  assert.equal(r.errores, 5)
  assert.ok(Math.abs(r.tasaError - 5 / 155) < 1e-9)
})

test('sin peticiones, la tasa es 0 y no NaN', () => {
  const r = resumirUso([])
  assert.equal(r.total, 0)
  assert.equal(r.tasaError, 0)
})

test('el corte por endpoint agrupa método+ruta y ordena por volumen', () => {
  const r = resumirUso(FILAS)
  // GET /customers: 100 OK + 5 SCOPE + 30 OK = 135, es el más usado.
  assert.equal(r.porEndpoint[0].endpoint, '/customers')
  assert.equal(r.porEndpoint[0].metodo, 'GET')
  assert.equal(r.porEndpoint[0].peticiones, 135)
  assert.equal(r.porEndpoint[0].errores, 5)
  // PATCH /customers/{id} es un endpoint distinto, no se mezcla con el GET.
  const patch = r.porEndpoint.find((e) => e.metodo === 'PATCH')
  assert.equal(patch?.peticiones, 20)
})

test('el corte por día va en orden', () => {
  const r = resumirUso(FILAS)
  assert.deepEqual(r.porDia.map((d) => d.dia), ['2026-09-16', '2026-09-17'])
  assert.equal(r.porDia[0].peticiones, 105)
  assert.equal(r.porDia[1].peticiones, 50)
})

test('SCOPE cuenta como error; OK no', () => {
  assert.ok(esError(RESULTADO.SCOPE))
  assert.ok(!esError(RESULTADO.OK))
})

// ─── Guardia estructural del enganche ────────────────────────────────────────

test('el uso se anota donde YA se conoce la credencial, no antes', () => {
  /**
   * Contar en `autenticar` una petición que no se identificó (token inválido,
   * límite) sería atribuir a una credencial algo que no es suyo. La guardia
   * comprueba que cada `registrarUso` va DESPUÉS de haber resuelto la credencial
   * —después de `resolverClaveApi` para la clave, y de `leerCredencial` para el
   * satélite—.
   */
  const src = leer('src/modules/plataforma/api.ts')
  assert.ok(src.includes('registrarUso('), 'autenticar no registra el uso')
  // La clave de empresa: su registro va después de resolverla.
  assert.ok(
    src.indexOf('resolverClaveApi(bruto)') < src.indexOf('registrarUso('),
    'se registra la clave antes de resolverla'
  )
  // El satélite: su registro va después de leer la credencial.
  assert.ok(
    src.indexOf('leerCredencial(') < src.lastIndexOf('registrarUso('),
    'se registra el satélite antes de leer su credencial'
  )
})

test('el registro de uso es best-effort: no bloquea la petición', () => {
  // `registrarUso` devuelve void y lanza la escritura con `void`, igual que
  // `anotarUsoClave`. Si esperáramos la escritura, cada llamada de la API
  // pagaría su latencia; si lanzara, la tumbaría.
  const src = leer('src/modules/plataforma/metricas.ts')
  assert.match(src, /export function registrarUso\(/)
  assert.match(src, /void sinEmpresa\(/)
  assert.match(src, /\.catch\(/)
  // Y normaliza el endpoint DENTRO, pase lo que pase: la última red contra un id.
  assert.match(src, /normalizarEndpoint\(/)
})

test('la lectura del integrador se acota por empresa (RLS + where)', () => {
  // El uso de una clave se lee bajo `conEmpresa`: RLS es la segunda barrera y el
  // `companyId` en el where la primera. Leerlo con `sinEmpresa` abriría el uso de
  // una empresa a otra.
  const src = leer('src/modules/plataforma/metricas.ts')
  const fn = src.slice(src.indexOf('export async function usoDeClaves'))
  assert.match(fn.slice(0, 900), /conEmpresa\(companyId/)
  assert.match(fn.slice(0, 900), /companyId,/)
})

// ─── Guardia de la migración ─────────────────────────────────────────────────

test('la migración crea el agregado con su clave única y es idempotente', () => {
  const sql = leer('prisma/migrations/20260923_metricas_uso_credencial/migration.sql')
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "metricas_uso_credencial"/)
  // El único índice único sobre la combinación es lo que hace atómico el upsert.
  assert.match(
    sql,
    /CREATE UNIQUE INDEX IF NOT EXISTS[\s\S]*?"dia",\s*"origen",\s*"credencialId",\s*"endpoint",\s*"metodo",\s*"resultado"/
  )
  // El origen acotado, para que ninguna fila quede sin credencial atribuible.
  assert.match(sql, /CHECK \("origen" IN \('CLAVE_API','SISTEMA'\)\)/)
  // Nunca DROP ni CREATE sin IF NOT EXISTS: se aplica a mano sobre producción.
  assert.equal(/CREATE TABLE (?!IF NOT EXISTS)/.test(sql), false)
})
