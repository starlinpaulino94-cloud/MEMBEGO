import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * MIGRACIONES · LOS VERIFICADORES SQL DEL REGISTRO NO SE QUEDAN ATRÁS.
 *
 * `scripts/verificar-migraciones-resumen.sql` y `scripts/verificar-migraciones.sql` los genera `scripts/generar-verificar-migraciones.mjs` y
 * EMBEBEN el total, la última migración y las huellas de todas (nombre y checksum). Cada migración nueva los deja viejos: hasta el
 * 2026-10-16 llevaban 19 migraciones de retraso (INV-2a → INV-5b3) sin que nada lo avisara, y un verificador viejo dice «REVISAR: faltan N
 * migraciones» contra una base que en realidad está al día. Esta prueba falla si cualquiera de los dos no coincide con `prisma/migrations`;
 * la cura es `node scripts/generar-verificar-migraciones.mjs`.
 *
 * Ejecutar: npm test
 */

const DIR = 'prisma/migrations'
const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex')
const md5 = (s: string) => createHash('md5').update(s).digest('hex')

// Mismo orden y mismos bytes que el generador (orden byte a byte; checksum del archivo tal cual, como lo guarda Prisma).
const migraciones = readdirSync(DIR)
  .filter((n) => statSync(join(DIR, n)).isDirectory())
  .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  .map((n) => ({ n, c: sha256(readFileSync(join(DIR, n, 'migration.sql'))) }))

const HINT = 'Regenera con: node scripts/generar-verificar-migraciones.mjs'

test('MIGRACIONES · el verificador corto (resumen) coincide con prisma/migrations: total, última y huellas', () => {
  const sql = readFileSync('scripts/verificar-migraciones-resumen.sql', 'utf8')
  const m = sql.match(/SELECT (\d+) AS total, '([^']+)' AS ultima,\s+'([0-9a-f]{32})' AS nombres,\s+'([0-9a-f]{32})' AS checksums/)
  assert.ok(m, 'no encuentro la fila «esperado» del verificador corto')
  const [, total, ultima, nombres, checksums] = m
  assert.equal(Number(total), migraciones.length, `el verificador dice ${total} migraciones y el repo tiene ${migraciones.length}. ${HINT}`)
  assert.equal(ultima, migraciones[migraciones.length - 1].n, `la última migración del verificador no es la del repo. ${HINT}`)
  assert.equal(nombres, md5(migraciones.map((x) => x.n).join(',')), `las migraciones del verificador no son las del repo (nombres). ${HINT}`)
  assert.equal(checksums, md5(migraciones.map((x) => `${x.n}:${x.c}`).join(',')), `algún migration.sql cambió desde que se generó el verificador (checksums). ${HINT}`)
})

test('MIGRACIONES · el verificador largo lista exactamente las migraciones del repo, cada una con su checksum', () => {
  const sql = readFileSync('scripts/verificar-migraciones.sql', 'utf8')
  const filas = [...sql.matchAll(/^\s+\('([^']+)','([0-9a-f]{64})'\),?$/gm)].map((x) => ({ n: x[1], c: x[2] }))
  assert.equal(filas.length, migraciones.length, `el verificador largo lista ${filas.length} migraciones y el repo tiene ${migraciones.length}. ${HINT}`)
  assert.deepEqual(filas, migraciones, `el verificador largo no coincide con prisma/migrations. ${HINT}`)
})

test('MIGRACIONES · las migraciones nuevas del programa de inventario están, y selladas, en los dos sitios', () => {
  const sumas = readFileSync(join(DIR, 'SUMAS.txt'), 'utf8')
  for (const nombre of ['20261067_inventory_reason_codes', '20261068_inventory_lots', '20261069_inventory_count_lots', '20261070_inventory_lot_expiry_history', '20261071_inventory_serials', '20261072_inventory_kits', '20261073_rol_bodega']) {
    assert.ok(migraciones.some((x) => x.n === nombre), `${nombre} no está en prisma/migrations`)
    assert.ok(sumas.includes(nombre), `${nombre} no está sellada en SUMAS.txt (npm run migraciones:sellar)`)
    assert.ok(readFileSync('scripts/verificar-migraciones.sql', 'utf8').includes(`'${nombre}'`), `${nombre} no está en el verificador largo. ${HINT}`)
  }
})
