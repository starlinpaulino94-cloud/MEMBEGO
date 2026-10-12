import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** RIESGO · solo lectura, solo del superadmin, sin acciones automáticas (Fase 9). */

const leer = (f: string) => readFileSync(f, 'utf8')
const limpio = (f: string) => leer(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

test('el módulo es SOLO LECTURA: no escribe, no cambia el esquema y no importa Supply', () => {
  for (const f of readdirSync('src/modules/riesgo-comercio').filter((x) => x.endsWith('.ts'))) {
    const t = limpio(join('src/modules/riesgo-comercio', f))
    assert.doesNotMatch(t, /\b(INSERT\s+INTO|UPDATE\s+"|DELETE\s+FROM|ALTER\s+TABLE|DROP\s+|TRUNCATE|CREATE\s+TABLE)\b/i, `${f} escribe`)
    assert.doesNotMatch(t, /\$executeRaw|\.\$transaction\(|\.(create|update|updateMany|delete|deleteMany|upsert)\(/, `${f} escribe con Prisma`)
    for (const m of t.matchAll(/from\s+['"]([^'"]+)['"]/g)) assert.doesNotMatch(m[1], /supply/i, `${f} importa ${m[1]}`)
  }
})

test('una señal NO actúa: el módulo no suspende, no bloquea, no notifica ni toca la cuenta Membego', () => {
  for (const f of readdirSync('src/modules/riesgo-comercio').filter((x) => x.endsWith('.ts'))) {
    const t = limpio(join('src/modules/riesgo-comercio', f))
    assert.doesNotMatch(t, /fijarEstadoManualEnTx|actualizarConfigEnTx|asentarManualEnTx|notificar|enviarCorreo|suspender\(/i, `${f} actúa`)
    assert.doesNotMatch(t, /from '@\/modules\/(billing|orders|deals)\/service'/, `${f} importa un servicio que escribe`)
  }
})

test('los umbrales viven como constantes con nombre y exigen un mínimo de muestra', () => {
  const d = limpio('src/modules/riesgo-comercio/domain.ts')
  assert.match(d, /export const UMBRALES = \{/)
  assert.match(d, /minimoDePedidos/)
  assert.match(d, /pedidos >= U\.minimoDePedidos/)
  assert.match(d, /cerrados >= U\.minimoDePedidos/)
})

test('la pantalla es solo del superadmin, autoriza antes de leer, corre sin contexto de empresa y nada viaja por la URL', () => {
  const p = limpio('src/app/(superadmin)/superadmin/riesgo/page.tsx')
  assert.match(p, /requireRole\('SUPERADMIN'\)/)
  assert.ok(p.indexOf("requireRole('SUPERADMIN')") < p.indexOf('riesgoDeLaPlataformaEnTx('), 'autoriza antes de leer')
  assert.match(p, /sinEmpresa\(/)
  assert.doesNotMatch(p, /searchParams|params/)
})

test('la plataforma deja fuera las empresas de práctica, solo mira el marketplace y el menú la ofrece', () => {
  const q = limpio('src/modules/riesgo-comercio/queries.ts')
  assert.match(q, /"esDemo" = true/)
  assert.equal([...q.matchAll(/o\."origin" = 'MARKETPLACE'/g)].length, 2)
  assert.match(leer('src/components/layout/nav-config.ts'), /href: '\/superadmin\/riesgo'/)
})
