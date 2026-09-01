import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  CODIGOS_ERROR,
  INVENTARIO_API,
  generarOpenApi,
  recursosParaClaveDeEmpresa,
} from '../packages/contracts/src/index'

/**
 * MEMBEGO CONNECT · Fase 8 — plataforma de desarrolladores.
 *
 * La prueba que da valor a todo lo demás es la primera: si alguien añade una
 * ruta a la API y no la documenta, la CI se para. La documentación no se puede
 * quedar vieja porque no se le permite.
 */

const raiz = join(__dirname, '..')

/** Las rutas que existen DE VERDAD en el disco, en formato de inventario. */
function rutasReales(): string[] {
  const base = join(raiz, 'src', 'app', 'api', 'platform', 'v1')
  const acc: string[] = []
  const recorrer = (dir: string, prefijo: string) => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e)
      if (statSync(p).isDirectory()) {
        // `[id]` en el disco es `{id}` en el contrato.
        recorrer(p, `${prefijo}/${e.replace(/^\[(.+)\]$/, '{$1}')}`)
      } else if (e === 'route.ts') {
        acc.push(prefijo || '/')
      }
    }
  }
  recorrer(base, '')
  return acc.sort()
}

test('inventario: cubre EXACTAMENTE las rutas que existen', () => {
  const reales = rutasReales()
  // `openapi` se sirve a sí misma: documentar la documentación sería un bucle.
  const documentadas = [...new Set(INVENTARIO_API.map((r) => r.ruta))].sort()
  const sinDocumentar = reales.filter((r) => r !== '/openapi' && !documentadas.includes(r))
  const inventadas = documentadas.filter((d) => !reales.includes(d))

  assert.deepEqual(sinDocumentar, [], `rutas sin documentar:\n${sinDocumentar.join('\n')}`)
  // Y al revés: documentar un recurso que no existe es peor que no documentarlo
  // — quien integra escribe código contra algo que responde 404.
  assert.deepEqual(inventadas, [], `documentadas pero inexistentes:\n${inventadas.join('\n')}`)
})

test('inventario: lo que dice del principal coincide con el código', () => {
  // `sistema-o-empresa` significa que la ruta abrió la puerta con
  // `claveDeEmpresa: true`. Si el inventario lo dijera y el código no, quien
  // integra con una clave recibiría un 403 que la documentación niega.
  for (const r of INVENTARIO_API) {
    if (r.principal !== 'sistema-o-empresa') continue
    const archivo = join(
      raiz,
      'src/app/api/platform/v1',
      r.ruta.replace(/\{(\w+)\}/g, '[$1]').replace(/^\//, ''),
      'route.ts'
    )
    const src = readFileSync(archivo, 'utf8')
    assert.ok(src.includes('claveDeEmpresa'), `${r.ruta} dice aceptar claves y no las acepta`)
  }
})

test('inventario: ninguna escritura se abrió a claves de empresa', () => {
  // OJO: POST no significa escritura. `benefits/evaluate` es POST porque lleva
  // un cuerpo, y solo consulta. Lo que marca una escritura es que necesite
  // clave de idempotencia — y una escritura sí necesita saber QUÉ sistema la
  // respalda, cosa que una clave de empresa no puede decir.
  for (const r of INVENTARIO_API) {
    if (!r.idempotente) continue
    assert.notEqual(r.principal, 'sistema-o-empresa', `${r.ruta} escribe y acepta claves`)
  }
})

test('inventario: toda escritura declara idempotencia salvo las que no la necesitan', () => {
  const escrituras = INVENTARIO_API.filter((r) => r.metodo === 'POST' && r.principal === 'sistema')
  for (const r of escrituras) {
    // `sso/redeem` es de un solo uso POR DISEÑO (el jti se consume): pedirle
    // además una clave de idempotencia sería redundante.
    if (r.ruta === '/sso/redeem') continue
    assert.equal(r.idempotente, true, `${r.ruta} escribe y no declara idempotencia`)
  }
})

// ── OpenAPI ──────────────────────────────────────────────────────────────────

test('openapi: es válido en lo esencial y no inventa servidores', () => {
  const spec = generarOpenApi('https://www.membego.com') as {
    openapi: string
    servers: { url: string }[]
    paths: Record<string, Record<string, { security: unknown[] }>>
    components: { securitySchemes: Record<string, unknown> }
  }
  assert.equal(spec.openapi, '3.1.0')
  assert.equal(spec.servers[0].url, 'https://www.membego.com/api/platform/v1')
  assert.ok(Object.keys(spec.paths).length >= 20)
  assert.ok('claveDeEmpresa' in spec.components.securitySchemes)
})

test('openapi: un recurso abierto a los dos principales ofrece DOS alternativas', () => {
  const spec = generarOpenApi('https://x') as {
    paths: Record<string, Record<string, { security: Record<string, string[]>[] }>>
  }
  // En OpenAPI, entradas distintas del array `security` son un O lógico. Si
  // fueran una sola entrada con dos esquemas, se exigirían LAS DOS a la vez.
  const branches = spec.paths['/branches'].get.security
  assert.equal(branches.length, 2)
  assert.ok('tokenDeSistema' in branches[0])
  assert.ok('claveDeEmpresa' in branches[1])
})

test('openapi: el diagnóstico de operación NO se publica como contrato', () => {
  const spec = generarOpenApi('https://x') as { paths: Record<string, unknown> }
  assert.ok(!('/diag' in spec.paths), 'diag no es contrato público')
})

test('openapi: las escrituras piden la cabecera de idempotencia', () => {
  const spec = generarOpenApi('https://x') as {
    paths: Record<string, Record<string, { parameters?: { name: string }[] }>>
  }
  const params = spec.paths['/redemptions'].post.parameters ?? []
  assert.ok(params.some((p) => p.name === 'Idempotency-Key'))
})

test('openapi: los códigos de error del esquema son los del contrato', () => {
  const spec = generarOpenApi('https://x') as {
    components: { schemas: { Error: { properties: { error: { properties: { code: { enum: string[] } } } } } } }
  }
  const enumerados = spec.components.schemas.Error.properties.error.properties.code.enum
  assert.deepEqual(enumerados.sort(), Object.keys(CODIGOS_ERROR).sort())
})

test('inventario: la lista para claves de empresa es solo de lectura', () => {
  const paraClaves = recursosParaClaveDeEmpresa()
  assert.ok(paraClaves.length >= 10)
  for (const r of paraClaves) {
    assert.ok(
      r.metodo === 'GET' || r.ruta === '/benefits/evaluate',
      `${r.ruta} no debería estar abierto a claves`
    )
  }
})
