import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * SEPARACIONES de las ofertas con presupuesto (Fase 5). Leen las fuentes y fallan si alguien
 * junta lo que tiene que estar separado:
 *
 *  · la liquidación de un reclamo (`reclamos.ts`) NO importa los pedidos ni Merchant Billing:
 *    los pedidos la llaman, así que si ella los importara habría un círculo;
 *  · los pedidos llaman a las ofertas solo por `reclamos.ts` y solo en tres puntos;
 *  · Merchant Billing no sabe que existen las ofertas (la cuota llega como un texto opaco);
 *  · Supply y las ofertas no se tocan, y Merchant Billing nunca se mezcla con Supply por aquí;
 *  · nadie fuera del módulo escribe las tablas de las ofertas.
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
const importsDe = (t: string) => [...t.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1])

test('la liquidación de reclamos no importa los pedidos ni Merchant Billing (los pedidos la llaman)', () => {
  const t = leer(join(RAIZ, 'src/modules/deals/reclamos.ts'))
  for (const origen of importsDe(t)) assert.doesNotMatch(origen, /modules\/(orders|billing|supply|supply-v2|supply-bridge)/, `reclamos.ts importa ${origen}`)
  for (const f of ['domain.ts', 'errores.ts', 'auditoria.ts']) {
    for (const origen of importsDe(leer(join(RAIZ, 'src/modules/deals', f)))) assert.doesNotMatch(origen, /modules\/(orders|billing|supply|supply-v2|supply-bridge)/, `${f} importa ${origen}`)
  }
})

test('los pedidos llaman a las ofertas solo por reclamos.ts y solo en los tres puntos (canje, cancelación, reembolso)', () => {
  for (const a of archivos(join(RAIZ, 'src/modules/orders'))) {
    for (const origen of importsDe(leer(a))) if (/modules\/deals/.test(origen)) assert.equal(origen, '@/modules/deals/reclamos', `${a} importa ${origen}`)
  }
  const t = leer(join(RAIZ, 'src/modules/orders/service.ts'))
  assert.equal((t.match(/liquidarReclamoEnTx\(/g) ?? []).length, 1, 'el canje liquida')
  assert.equal((t.match(/cerrarReclamoSinCanjeEnTx\(/g) ?? []).length, 1, 'la cancelación libera')
  assert.equal((t.match(/revertirReclamoEnTx\(/g) ?? []).length, 1, 'el reembolso revierte')
})

test('el orden de candados del canje es pedido → oferta → inventario → cuenta de billing', () => {
  const t = leer(join(RAIZ, 'src/modules/orders/service.ts'))
  const f = t.slice(t.indexOf('export async function completarPorQrEnTx'), t.indexOf('export async function cerrarPedidoExternoEnTx'))
  const orden = ['pedidoBloqueado(', 'liquidarReclamoEnTx(', 'venderLinea(tx', 'cobrarComisionDelPedido(tx']
  const pos = orden.map((s) => f.indexOf(s))
  assert.ok(pos.every((x) => x > 0), `faltan pasos: ${pos}`)
  assert.deepEqual([...pos].sort((a, b) => a - b), pos, 'los candados se toman en otro orden')
  const c = t.slice(t.indexOf('export async function cancelarPedidoEnTx'), t.indexOf('export async function reembolsarPedidoEnTx'))
  assert.ok(c.indexOf('cerrarReclamoSinCanjeEnTx(') > 0 && c.indexOf('cerrarReclamoSinCanjeEnTx(') < c.indexOf('liberarReservaEnTx('), 'cancelar: la oferta antes del inventario')
  const r = t.slice(t.indexOf('export async function reembolsarPedidoEnTx'), t.indexOf('export function nuevaClaveDePedido'))
  assert.ok(r.indexOf('revertirReclamoEnTx(') > 0 && r.indexOf('revertirReclamoEnTx(') < r.indexOf('devolverEnTx(') && r.indexOf('devolverEnTx(') < r.indexOf('revertirComisionDePedidoEnTx('), 'reembolsar: oferta → inventario → cuenta')
})

test('Merchant Billing no sabe que existen las ofertas, y Supply tampoco', () => {
  for (const dir of ['src/modules/billing', 'src/modules/supply-v2', 'src/modules/supply', 'src/modules/supply-bridge']) {
    for (const a of archivos(join(RAIZ, dir))) {
      for (const origen of importsDe(leer(a))) assert.doesNotMatch(origen, /modules\/deals/, `${a} importa ${origen}`)
    }
  }
  // Y las ofertas no importan Supply.
  for (const a of archivos(join(RAIZ, 'src/modules/deals'))) {
    for (const origen of importsDe(leer(a))) assert.doesNotMatch(origen, /modules\/(supply|supply-v2|supply-bridge)/, `${a} importa ${origen}`)
  }
  // La tabla de comisiones guarda la oferta como texto, sin referencia a las tablas de las ofertas.
  const m = readFileSync(join(RAIZ, 'prisma/migrations/20261048_merchant_billing_cuota_de_oferta/migration.sql'), 'utf8')
  assert.doesNotMatch(m, /REFERENCES\s+"deals?"/i)
  assert.doesNotMatch(m, /deal_claims/)
})

test('nadie fuera del módulo de ofertas escribe sus tablas', () => {
  const escritura = /\b(tx|prisma)\.(deal|dealClaim)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b|"(deals|deal_claims)"\s+SET|INSERT INTO "(deals|deal_claims)"/
  const infractores = archivos(join(RAIZ, 'src')).filter((a) => !a.includes('/modules/deals/') && escritura.test(leer(a)))
  assert.deepEqual(infractores, [])
  // Dentro del módulo, solo el servicio y la liquidación escriben.
  for (const a of archivos(join(RAIZ, 'src/modules/deals'))) {
    if (/\/(service|reclamos)\.ts$/.test(a)) continue
    assert.doesNotMatch(leer(a), escritura, `${a} escribe tablas de ofertas`)
  }
})

test('una cuota de oferta es CPA aunque el modelo de la cuenta sea otro (el dominio de billing la separa del cálculo normal)', () => {
  const t = leer(join(RAIZ, 'src/modules/billing/service.ts'))
  assert.match(t, /cuotaDeOferta \? calcularCuotaDeOferta\(/)
  const d = leer(join(RAIZ, 'src/modules/billing/domain.ts'))
  assert.match(d, /type: 'CPA_FIXED', feeModel, baseAmount: base, rate: null, amount, dealId: cuota\.dealId/)
})
