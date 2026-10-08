import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { REGLAS } from '../src/modules/conciliacion/domain'

/** CONCILIACIÓN · solo lectura, solo del superadmin, sin Supply (Fase 9). */

const leer = (f: string) => readFileSync(f, 'utf8')
const limpio = (f: string) => leer(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

test('cada regla del catálogo tiene su consulta, y cada consulta su regla', () => {
  const q = limpio('src/modules/conciliacion/queries.ts')
  const cuerpo = q.slice(q.indexOf('const CONSULTAS'), q.indexOf('interface FilaCruda'))
  const claves = [...cuerpo.matchAll(/^\s{2}([A-Z]\d{2}): \(a\) =>/gm)].map((m) => m[1])
  assert.deepEqual([...claves].sort(), REGLAS.map((r) => r.codigo).sort())
})

test('el módulo es SOLO LECTURA: ninguna consulta escribe ni cambia el esquema, y no usa $executeRaw ni escrituras de Prisma', () => {
  for (const f of readdirSync('src/modules/conciliacion').filter((x) => x.endsWith('.ts'))) {
    // Lo único que se ejecuta (no se consulta) son los puntos de guardado que aíslan una regla de otra.
    const t = limpio(join('src/modules/conciliacion', f)).replace(/await tx\.\$executeRawUnsafe\('(SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT) regla_conciliacion'\)/g, '')
    assert.doesNotMatch(t, /\b(INSERT\s+INTO|UPDATE\s+"|DELETE\s+FROM|ALTER\s+TABLE|DROP\s+|TRUNCATE|CREATE\s+TABLE)\b/i, `${f} escribe`)
    assert.doesNotMatch(t, /\$executeRaw|\.\$transaction\(|\.(create|update|updateMany|delete|deleteMany|upsert)\(/, `${f} escribe con Prisma`)
    for (const m of t.matchAll(/from\s+['"]([^'"]+)['"]/g)) assert.doesNotMatch(m[1], /supply/i, `${f} importa ${m[1]}`)
  }
})

test('lo único que entra a una consulta por parámetro es la empresa; el resto son constantes del código', () => {
  const q = limpio('src/modules/conciliacion/queries.ts')
  // Las interpolaciones de las consultas son filtros de alcance, ayudas de formato o fragmentos propios.
  const interpoladas = [...q.matchAll(/\$\{([^}]+)\}/g)].map((m) => m[1]).filter((x) => !/^(dinero|alcance|lineasPorPedido)\(/.test(x))
  // `CANALES_ATRIBUIDOS` es la lista de canales que comisionan (constante del código, en literales): no es un parámetro.
  for (const i of interpoladas) assert.match(i, /^(c|col|regla\.codigo|a\.companyId|muestra|consulta\(a\)|CANALES_ATRIBUIDOS|Prisma\.join\(\[\.\.\.nombres\.keys\(\)\]\))$/, `interpolación inesperada: ${i}`)
})

test('la pantalla es solo del superadmin, autoriza antes de leer y corre sin contexto de empresa', () => {
  const p = limpio('src/app/(superadmin)/superadmin/conciliacion/page.tsx')
  assert.match(p, /requireRole\('SUPERADMIN'\)/)
  assert.ok(p.indexOf("requireRole('SUPERADMIN')") < p.indexOf('conciliarEnTx('), 'autoriza antes de leer')
  assert.match(p, /sinEmpresa\(/)
  assert.doesNotMatch(p, /searchParams|params/, 'nada viaja por la URL: ni la empresa ni el alcance')
})

test('el menú del superadmin la ofrece y la plataforma deja fuera las empresas de práctica', () => {
  assert.match(leer('src/components/layout/nav-config.ts'), /href: '\/superadmin\/conciliacion'/)
  assert.match(limpio('src/modules/conciliacion/queries.ts'), /"esDemo" = true/)
})

test('una regla que falla no tumba a las demás: cada una corre en su punto de guardado', () => {
  const q = limpio('src/modules/conciliacion/queries.ts')
  assert.match(q, /SAVEPOINT regla_conciliacion/)
  assert.match(q, /RELEASE SAVEPOINT regla_conciliacion/)
  assert.match(q, /ROLLBACK TO SAVEPOINT regla_conciliacion/)
})
