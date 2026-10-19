import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, sep } from 'node:path'

/**
 * SEPARACIÓN ESTRICTA (Plan Maestro §F4, riesgo n.º 4): Merchant Billing (empresa →
 * Membego) y Supply Economics (Membego → proveedor) NUNCA comparten tablas, ledgers
 * ni código. Estas pruebas leen las fuentes y fallan si alguien los junta.
 */

const RAIZ = join(__dirname, '..')

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? archivos(p) : /\.(ts|tsx)$/.test(n) ? [p] : []
  })
}

const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
const leer = (p: string) => sinComentarios(readFileSync(p, 'utf8'))

test('Merchant Billing no importa nada de Supply ni de los pedidos', () => {
  for (const a of archivos(join(RAIZ, 'src/modules/billing'))) {
    const t = leer(a)
    assert.doesNotMatch(t, /from ['"][^'"]*(supply-v2|supply-bridge|modules\/supply\b)/, `${a} importa de Supply`)
    assert.doesNotMatch(t, /from ['"][^'"]*modules\/orders/, `${a} importa de los pedidos (la dependencia va de pedidos hacia billing)`)
    assert.doesNotMatch(t, /supplyV2/i, `${a} toca tablas de Supply`)
  }
})

test('Supply Economics no importa nada de Merchant Billing', () => {
  for (const dir of ['src/modules/supply-v2', 'src/modules/supply-bridge']) {
    for (const a of archivos(join(RAIZ, dir))) {
      const t = leer(a)
      assert.doesNotMatch(t, /modules\/billing/, `${a} importa de Merchant Billing`)
      assert.doesNotMatch(t, /merchantLedgerEntry|merchantBillingConfig|merchantStatement|\b(tx|prisma)\.commission\b/, `${a} toca tablas de Merchant Billing`)
    }
  }
})

test('en el esquema, ninguna tabla de Merchant Billing se relaciona con una de Supply (ni al revés)', () => {
  const schema = (n: string) => readFileSync(join(RAIZ, 'prisma/schema', n), 'utf8')
  const billing = sinComentarios(schema('facturacion-comercial.prisma'))
  assert.doesNotMatch(billing, /SupplyV2|supply_v2|Supply/, 'el esquema de billing menciona Supply')
  for (const f of readdirSync(join(RAIZ, 'prisma/schema')).filter((x) => /supply/i.test(x))) {
    assert.doesNotMatch(sinComentarios(schema(f)), /MerchantLedgerEntry|MerchantBillingConfig|MerchantStatement|\bCommission\b/, `${f} se relaciona con billing`)
  }
})

test('la migración de billing no referencia tablas de Supply salvo para rechazarlas', () => {
  const sql = readFileSync(join(RAIZ, 'prisma/migrations/20261044_merchant_billing/migration.sql'), 'utf8')
  const codigo = sql.replace(/--.*$/gm, '')
  assert.doesNotMatch(codigo, /REFERENCES\s+"supply/i, 'una FK hacia Supply')
  assert.doesNotMatch(codigo, /supply_v2_/, 'una tabla de Supply (el literal SUPPLY_V2_CUSTOMER_ORDER, en mayúsculas, es el tipo de documento con el que se las rechaza)')
  // Y la guardia existe: el libro solo admite las referencias de su dominio.
  assert.match(codigo, /"referenceType" IN \('COMMISSION', 'PAYMENT', 'MANUAL', 'STATEMENT'\)/)
})

test('solo el servicio de pedidos llama a billing desde los pedidos, y solo con los tres puntos de cierre/reembolso', () => {
  const t = leer(join(RAIZ, 'src/modules/orders/service.ts'))
  assert.equal((t.match(/registrarComisionDePedidoEnTx\(/g) ?? []).length, 1, 'un único punto cobra la comisión (cobrarComisionDelPedido)')
  assert.equal((t.match(/cobrarComisionDelPedido\(/g) ?? []).length, 3, 'definición + QR + cierre externo')
  assert.equal((t.match(/revertirComisionDePedidoEnTx\(/g) ?? []).length, 1, 'el reembolso revierte')
  for (const a of archivos(join(RAIZ, 'src/modules/orders')).filter((x) => !x.endsWith('service.ts'))) {
    assert.doesNotMatch(leer(a), /modules\/billing\/service/, `${a} llama al servicio de billing`)
  }
})

test('nadie fuera del servicio de billing escribe en el libro, las comisiones ni los cortes', () => {
  for (const a of archivos(join(RAIZ, 'src'))) {
    if (a.includes(sep + join('modules', 'billing') + sep)) continue
    const t = leer(a)
    assert.doesNotMatch(t, /merchantLedgerEntry\.(create|createMany|update|updateMany|delete|deleteMany|upsert)/, `${a} escribe en el libro`)
    assert.doesNotMatch(t, /\.commission\.(create|createMany|update|updateMany|delete|deleteMany|upsert)/, `${a} escribe comisiones`)
    assert.doesNotMatch(t, /merchantStatement\.(create|createMany|update|updateMany|delete|deleteMany|upsert)/, `${a} escribe cortes`)
    assert.doesNotMatch(t, /merchantBillingConfig\.(create|createMany|update|updateMany|delete|deleteMany|upsert)/, `${a} escribe la configuración de cobro`)
  }
})

test('dentro de billing, solo el servicio escribe el libro', () => {
  for (const a of archivos(join(RAIZ, 'src/modules/billing')).filter((x) => !x.endsWith('service.ts'))) {
    assert.doesNotMatch(leer(a), /merchantLedgerEntry\.(create|update|delete|upsert)/, `${a} escribe en el libro`)
  }
})
