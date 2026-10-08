import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * ANALÍTICA · separación y solo lectura (Fase 6).
 *
 *  · El módulo de analítica no importa Supply (Commerce Core nunca importa de `supply-v2`): los pedidos
 *    de Supply entran como el origen `SUPPLY` de un pedido Membego; la economía de Supply se enseña
 *    aparte, en la página que compone las dos cosas.
 *  · Es SOLO LECTURA: ninguna escritura a la base.
 *  · Toda consulta crua con la zona horaria convierte UTC → zona (las columnas son `timestamp` sin
 *    zona): la conversión simple movería las ventas de la noche al día siguiente.
 *  · La plataforma excluye las empresas de práctica.
 */

const RAIZ = join(__dirname, '..')
const archivos = readdirSync(join(RAIZ, 'src/modules/analytics')).filter((f) => f.endsWith('.ts')).map((f) => join(RAIZ, 'src/modules/analytics', f))
const leer = (f: string) => readFileSync(f, 'utf8')
const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

test('el módulo de analítica no importa Supply ni sus finanzas', () => {
  assert.ok(archivos.length >= 2)
  for (const a of archivos) {
    for (const m of leer(a).matchAll(/from\s+['"]([^'"]+)['"]/g)) assert.doesNotMatch(m[1], /supply/i, `${a} importa ${m[1]}`)
  }
})

test('es solo lectura: nada de create, update, delete, upsert ni SQL de escritura', () => {
  for (const a of archivos) {
    const t = sinComentarios(leer(a))
    assert.doesNotMatch(t, /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/, a)
    assert.doesNotMatch(t, /\b(INSERT\s+INTO|UPDATE\s+"|DELETE\s+FROM|TRUNCATE|\$executeRaw)\b/i, a)
  }
})

test('el corte por día convierte UTC → zona; la conversión simple está prohibida', () => {
  const q = sinComentarios(leer(join(RAIZ, 'src/modules/analytics/queries.ts')))
  const usos = [...q.matchAll(/AT TIME ZONE[^\n]*/g)].map((m) => m[0])
  assert.ok(usos.length >= 1)
  for (const u of usos) assert.match(u, /AT TIME ZONE 'UTC' AT TIME ZONE/, u)
})

test('la plataforma deja fuera las empresas de práctica y la empresa solo ve la suya', () => {
  const q = sinComentarios(leer(join(RAIZ, 'src/modules/analytics/queries.ts')))
  assert.match(q, /"esDemo" = true/)
  assert.match(q, /company: \{ esDemo: false \}/)
  assert.match(q, /AND \$\{c\} = \$\{a\.companyId\}/)
})

test('solo los comisionables entran en la toma: la toma usa el GMV del marketplace, no el de todos los orígenes', () => {
  const q = sinComentarios(leer(join(RAIZ, 'src/modules/analytics/queries.ts')))
  assert.match(q, /toma: \{ valor: tomaDeComision\(mk\.comisiones, mk\.ventas\)/)
})

test('«qué comisiona» de la analítica es lo mismo que decide Merchant Billing (auditoría F5–F9): si billing añade un origen, esta prueba obliga a revisar la toma', () => {
  const billing = leer(join(RAIZ, 'src/modules/billing/domain.ts'))
  const lista = /export const ORIGENES_COMISIONABLES[^=]*=\s*\[([^\]]*)\]/.exec(billing)
  assert.ok(lista, 'billing declara ORIGENES_COMISIONABLES')
  const origenes = [...lista[1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1])
  assert.deepEqual(origenes, ['MARKETPLACE'], 'billing comisiona otros orígenes: actualiza COMISIONABLE y sqlAlcance de analytics/queries.ts')
  const queries = sinComentarios(leer(join(RAIZ, 'src/modules/analytics/queries.ts')))
  assert.match(queries, /const COMISIONABLE: MembegoOrderOrigin = 'MARKETPLACE'/)
})

test('las ventas suman la base comisionable (sin impuestos), no el total, que por esquema incluye el impuesto', () => {
  const queries = sinComentarios(leer(join(RAIZ, 'src/modules/analytics/queries.ts')))
  assert.doesNotMatch(queries, /sum\(o\."total"\)/)
  assert.match(queries, /sum\(o\."commissionableBase"\)/)
})
