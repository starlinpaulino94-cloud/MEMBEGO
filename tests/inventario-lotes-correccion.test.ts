import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { motivoParaNoDeshacerLotes, planDeCorreccionDeVencimiento } from '../src/modules/inventory/lotes'

/**
 * INV-5b5 · CORREGIR EL VENCIMIENTO DE UN LOTE y DESHACER LA ACTIVACIÓN — las reglas PURAS y las guardias estáticas (migración, servicio,
 * lecturas, acciones y pantallas). El comportamiento contra PostgreSQL está en `tests/postgres/inventory-lotes-correccion.db.test.ts`.
 *
 * Ejecutar: npm test
 */

const leer = (ruta: string) => readFileSync(ruta, 'utf8')
const sinComent = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
function cuerpoDe(src: string, nombre: string): string {
  const inicio = src.search(new RegExp(`^(export )?(async )?function ${nombre}\\b`, 'm'))
  assert.ok(inicio >= 0, `no encuentro la función ${nombre}`)
  const resto = src.slice(inicio + 10)
  const fin = resto.search(/^(export |async function |function |const |interface |type )/m)
  return src.slice(inicio, fin < 0 ? undefined : inicio + 10 + fin)
}

const lote = (vencimiento: string | null, legado = false) => ({ vencimiento, legado })

test('INV-5b5 · corregir un vencimiento: fecha real, vacía = no vence, la misma fecha no cambia nada, y el «SIN LOTE» no se corrige', () => {
  assert.deepEqual(planDeCorreccionDeVencimiento(lote('2027-07-01'), '2027-10-20', false), { ok: true, sinCambio: false, anterior: '2027-07-01', nuevo: '2027-10-20' })
  assert.deepEqual(planDeCorreccionDeVencimiento(lote('2027-07-01'), ' 2027-10-20 ', false), { ok: true, sinCambio: false, anterior: '2027-07-01', nuevo: '2027-10-20' }, 'se recorta')
  assert.deepEqual(planDeCorreccionDeVencimiento(lote('2027-07-01'), '', false), { ok: true, sinCambio: false, anterior: '2027-07-01', nuevo: null })
  assert.deepEqual(planDeCorreccionDeVencimiento(lote('2027-07-01'), null, false), { ok: true, sinCambio: false, anterior: '2027-07-01', nuevo: null })
  assert.deepEqual(planDeCorreccionDeVencimiento(lote(null), '2027-10-20', true), { ok: true, sinCambio: false, anterior: null, nuevo: '2027-10-20' }, 'ponerle fecha a uno que no la tenía')
  assert.deepEqual(planDeCorreccionDeVencimiento(lote('2027-07-01'), '2027-07-01', false), { ok: true, sinCambio: true })
  assert.deepEqual(planDeCorreccionDeVencimiento(lote(null), '', false), { ok: true, sinCambio: true }, 'no vencía y sigue sin vencer')
  const codigo = (r: ReturnType<typeof planDeCorreccionDeVencimiento>) => (r.ok ? 'OK' : r.codigo)
  assert.equal(codigo(planDeCorreccionDeVencimiento(lote(null, true), '2027-10-20', false)), 'LOTE_LEGADO')
  assert.equal(codigo(planDeCorreccionDeVencimiento(lote('2027-07-01'), '', true)), 'VENCIMIENTO_REQUERIDO', 'un producto que exige fecha no admite quitarla')
  assert.equal(codigo(planDeCorreccionDeVencimiento(lote('2027-07-01'), null, true)), 'VENCIMIENTO_REQUERIDO')
  for (const mala of ['2027-02-30', '31/12/2027', '0225-01-01', '2205-01-01', '1999-12-31', 'mañana', 20271201, {}]) {
    assert.equal(codigo(planDeCorreccionDeVencimiento(lote('2027-07-01'), mala, false)), 'VENCIMIENTO_INVALIDO', String(mala))
  }
})

test('INV-5b5 · la activación solo se deshace mientras los lotes son configuración: ni movimientos repartidos, ni lotes propios, ni conteos, ni correcciones', () => {
  const nada = { movimientosRepartidos: 0, lotesPropios: 0, lineasDeConteo: 0, correcciones: 0 }
  assert.equal(motivoParaNoDeshacerLotes(nada), null)
  assert.equal(motivoParaNoDeshacerLotes({ ...nada, movimientosRepartidos: 1 })?.codigo, 'DESACTIVAR_CON_HISTORIAL')
  assert.equal(motivoParaNoDeshacerLotes({ ...nada, lotesPropios: 1 })?.codigo, 'DESACTIVAR_CON_HISTORIAL')
  assert.equal(motivoParaNoDeshacerLotes({ ...nada, lineasDeConteo: 1 })?.codigo, 'DESACTIVAR_CON_CONTEO')
  assert.equal(motivoParaNoDeshacerLotes({ ...nada, correcciones: 1 })?.codigo, 'DESACTIVAR_CON_HISTORIAL')
  assert.equal(motivoParaNoDeshacerLotes({ ...nada, movimientosRepartidos: 3, lineasDeConteo: 2 })?.codigo, 'DESACTIVAR_CON_HISTORIAL', 'gana el motivo más fuerte')
})

test('INV-5b5 · la migración 20261070 es aditiva, idempotente y de una sola transacción; la base exige la historia para cambiar la fecha', () => {
  const sql = leer('prisma/migrations/20261070_inventory_lot_expiry_history/migration.sql')
  const codigo = sql.replace(/^--.*$/gm, '')
  assert.match(codigo, /^\s*BEGIN;/)
  assert.match(codigo, /COMMIT;\s*$/)
  assert.match(codigo, /SET LOCAL lock_timeout = '5s'/)
  assert.match(codigo, /CREATE TABLE IF NOT EXISTS "inventory_lot_expiry_changes"/)
  assert.doesNotMatch(codigo, /\bDROP (TABLE|COLUMN)\b|\bALTER TABLE "inventory_lots"|\bDELETE FROM\b|\bUPDATE "/i, 'no borra ni reescribe nada')
  // El cambio de fecha exige una fila de historia de ESTA transacción, con exactamente ese cambio.
  const fn = codigo.slice(codigo.indexOf('FUNCTION inventory_lots_solo_vencimiento'))
  assert.match(fn, /c\."txid" = txid_current\(\)/)
  assert.match(fn, /c\."previousExpiresOn" IS NOT DISTINCT FROM OLD\."expiresOn"/)
  assert.match(fn, /c\."newExpiresOn" IS NOT DISTINCT FROM NEW\."expiresOn"/)
  for (const col of ['id', 'companyId', 'catalogVariantId', 'code', 'legacy', 'createdBy', 'createdAt']) assert.match(fn, new RegExp(`NEW\\."${col}" IS DISTINCT FROM OLD\\."${col}"`), `${col} no cambia`)
  assert.match(codigo, /BEFORE UPDATE OR DELETE ON "inventory_lot_expiry_changes"[\s\S]*inventory_lot_inmutable/, 'la historia no se edita ni se borra')
  assert.match(codigo, /BEFORE TRUNCATE ON "inventory_lot_expiry_changes"/)
  assert.match(codigo, /CREATE OR REPLACE FUNCTION inventory_lot_tiene_historial[\s\S]*FROM "inventory_movement_lots" ml/, 'la historia de lotes son los repartos')
  const prisma = leer('prisma/schema/inventario.prisma')
  assert.match(prisma, /model InventoryLotExpiryChange \{[\s\S]*txid\s+BigInt\s+@default\(dbgenerated\("txid_current\(\)"\)\)[\s\S]*@@map\("inventory_lot_expiry_changes"\)/)
})

test('INV-5b5 · la migración está sellada y la base de E2E la aplica', () => {
  assert.ok(leer('prisma/migrations/SUMAS.txt').includes('20261070_inventory_lot_expiry_history'))
  assert.match(leer('scripts/e2e/base-limpia.mjs'), /20261070_inventory_lot_expiry_history\/migration\.sql/)
})

test('INV-5b5 · el servicio: corregir pide motivo, toma el candado compartido y la fila del lote, escribe la historia ANTES del cambio y deja bitácora', () => {
  const svc = sinComent(leer('src/modules/inventory/service.ts'))
  const f = cuerpoDe(svc, 'corregirVencimientoLoteEnTx')
  assert.match(f, /fallo\('MOTIVO_OBLIGATORIO'/)
  assert.match(f, /candadoDeLotes\(tx, companyId, false\)/, 'compartido: no compite con las ventas')
  assert.ok(f.indexOf('candadoDeLotes(') < f.indexOf('FOR UPDATE'), 'candado antes de la fila')
  assert.match(f, /"companyId" = \$\{companyId\} FOR UPDATE/, 'solo lotes de la empresa, y bloqueado')
  assert.match(f, /planDeCorreccionDeVencimiento\(/)
  assert.match(f, /if \(plan\.sinCambio\) return/, 'repetir no escribe una segunda fila')
  assert.ok(f.indexOf('inventoryLotExpiryChange.create') < f.indexOf('inventoryLot.update'), 'la historia va primero')
  assert.match(f, /changedBy: ctx\.actorId/)
  assert.match(f, /auditarInventario\(/)
  assert.doesNotMatch(f, /inventoryLevel\.update|inventoryLotBalance|escribirMovimiento/, 'no mueve ningún saldo')
  assert.match(f, /data: \{ expiresOn: diaDe\(plan\.nuevo\) \}/, 'solo cambia la fecha')
})

test('INV-5b5 · el servicio: deshacer toma el candado EXCLUSIVO, bloquea los saldos, comprueba la historia bajo el candado y quita en el orden de las llaves', () => {
  const svc = sinComent(leer('src/modules/inventory/service.ts'))
  const f = cuerpoDe(svc, 'desactivarLotesEnTx')
  assert.match(f, /candadoDeLotes\(tx, companyId, true\)/)
  assert.ok(f.indexOf('candadoDeLotes(') < f.indexOf('bloquear(tx') && f.indexOf('bloquear(tx') < f.indexOf('motivoParaNoDeshacerLotes('), 'candado, saldos y solo entonces la comprobación')
  assert.match(f, /historiaDeLotesEnTx\(tx, companyId, variante\.id\)/)
  const orden = ['inventoryLotOpening.deleteMany', 'inventoryLotBalance.deleteMany', 'inventoryLot.deleteMany', 'inventoryLotTracking.deleteMany'].map((x) => f.indexOf(x))
  assert.ok(orden.every((n) => n > 0) && orden.every((n, i) => i === 0 || n > orden[i - 1]), 'aperturas, saldos por lote, lotes y activación')
  assert.doesNotMatch(f, /inventoryLevel\.update|inventoryMovement\.(create|delete)|escribirMovimiento/, 'no toca existencias ni ledger')
  assert.match(f, /politicasPorTx\.get\(tx\)\?\.delete\(variante\.id\)/, 'olvida lo recordado del producto')
  const q = sinComent(leer('src/modules/inventory/lotes-queries.ts'))
  const h = cuerpoDe(q, 'historiaDeLotesEnTx')
  assert.match(h, /inventoryMovementLot\.count/)
  assert.match(h, /inventoryCountLine\.count[\s\S]*lotId: \{ not: null \}/)
  assert.match(h, /legacy: false/)
  assert.doesNotMatch(h, /create|update|delete/i, 'solo lee')
})

test('INV-5b5 · las acciones piden «ajustar» antes de tocar la base y las pantallas usan la acción, no el servicio', () => {
  const a = sinComent(leer('src/modules/inventory/actions.ts'))
  for (const nombre of ['corregirVencimientoLote', 'desactivarLotesInventario']) {
    const f = cuerpoDe(a, nombre)
    assert.match(f, /await contexto\('ajustar'\)/, nombre)
    assert.ok(f.indexOf("contexto('ajustar')") < f.indexOf('conEmpresa('), `${nombre} autoriza antes de tocar la base`)
  }
  assert.match(cuerpoDe(a, 'corregirVencimientoLote'), /vencimiento: entrada\.vencimiento, motivo: entrada\.motivo/)
  const fila = sinComent(leer('src/components/inventario/LotesDeSucursal.tsx'))
  assert.match(fila, /l\.legado \? null : <CorregirVencimientoLote/, 'el «SIN LOTE» no se corrige')
  const tarjeta = sinComent(leer('src/components/inventario/SucursalInventarioCard.tsx'))
  assert.match(tarjeta, /corregir=\{puedeAjustar \? \{ exigeVencimiento: lotes\.exigeVencimiento \} : undefined\}/, 'solo quien puede ajustar ve la corrección')
  const form = sinComent(leer('src/components/inventario/CorregirVencimientoLote.tsx'))
  assert.match(form, /corregirVencimientoLote\(\{ loteId, vencimiento: fecha, motivo \}\)/)
  assert.match(form, /id=\{`cv-motivo-\$\{loteId\}`\} value=\{motivo\} required/, 'el motivo es obligatorio en el formulario')
  const ficha = sinComent(leer('src/app/(admin)/admin/inventario/[varianteId]/page.tsx'))
  assert.match(ficha, /sePuedeDesactivar = puedeAjustar && /, 'deshacer solo se ofrece a quien puede ajustar y mientras se pueda')
  assert.match(ficha, /\{sePuedeDesactivar && <DesactivarLotesCard/)
  assert.match(ficha, /<HistorialDeVencimientos cambios=\{cambiosDeVencimiento\}/)
  assert.match(sinComent(leer('src/components/inventario/DesactivarLotesCard.tsx')), /setConfirmando\(true\)/, 'en dos pasos')
})
