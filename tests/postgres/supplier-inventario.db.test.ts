import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../../src/lib/prisma'
import { sinEmpresa } from '../../src/lib/tenant'
import { abrirSesionQrEnTx, confirmarEntregaEnTx, reversarRedencionEnTx } from '../../src/modules/supply-v2/redemption/service'
import { inventarioDelProveedor, movimientosDelProveedor, signoDeMovimiento } from '../../src/modules/supply-v2/portal/inventario'
import { cubetasDeLote, invarianteCumplido, saldoDeAsientos } from '../../src/modules/supply-v2/core/ledger'
import { como, montarSupplierLite, type ArnesSupplierLite } from './supplier-lite-arnes'

/**
 * SUPPLIER & FULFILLMENT COMMERCE · Slice 3 contra PostgreSQL: el inventario
 * Membego visto por el proveedor (§9–§11).
 *
 *   Membego compra 1.000 cappuccinos; el cliente compra 2 → el proveedor ve
 *   1.000 compradas, 998 por vender (100 apartadas en la oferta cuentan como
 *   por vender), 2 pendientes de entrega, 0 canjeadas, capacidad diaria 20/0.
 *   Canjea uno → 1 canjeada, 1 pendiente, capacidad usada 1; el ledger explica
 *   la diferencia (+1000 RECEIPT, −1 REDEMPTION) y nunca se edita.
 *   Reversa → +1 REVERSAL; otro proveedor no ve nada de esto.
 *
 * `npm run test:db`.
 */

let a: ArnesSupplierLite
let redencionId = ''

before(async () => {
  a = await montarSupplierLite({ prefijo: 'inv', unidadesCompradas: 1000, unidadesCliente: 2, capacidadDiaria: 20 })
})

test('1 · tras la compra de Membego y la venta de 2 unidades, el proveedor ve sus cubetas, su contrato y su capacidad', async () => {
  const filas = await inventarioDelProveedor(a.supplierId)
  assert.equal(filas.length, 1)
  const f = filas[0]!
  assert.equal(f.producto, 'Cappuccino grande')
  assert.equal(f.compradas, 1000)
  assert.equal(f.porVender, 998)
  assert.equal(f.reservadas, 0)
  assert.equal(f.pendientesDeEntrega, 2)
  assert.equal(f.canjeadas, 0)
  assert.equal(f.cerradas, 0)
  assert.equal(f.compradas, f.porVender + f.reservadas + f.pendientesDeEntrega + f.canjeadas + f.cerradas, 'las cubetas suman lo comprado')
  assert.deepEqual(f.contratos.map((c) => c.id), [a.agreementId])
  assert.match(f.contratos[0]!.code, /^MBG-AG-/)
  assert.equal(f.backing, 'SERVICE_CAPACITY')
  assert.deepEqual(f.capacidadDiaria, { total: 20, usada: 0, disponible: 20 })
  assert.ok(f.proximoVencimiento && f.proximoVencimiento.getTime() > Date.now())
})

test('2 · un canje baja «pendientes» y sube «canjeadas»; el ledger lo explica (+1000 / −1) sin editar nada', async () => {
  const qr = await sinEmpresa('prueba', (tx) => abrirSesionQrEnTx(tx, { entitlementId: a.entitlements[0]!, customerId: a.cliente, branchId: a.sucursalId }, como(a.cliente)))
  const r = await sinEmpresa('prueba', (tx) => confirmarEntregaEnTx(tx, { nonce: qr.nonce, empleado: a.empleado, branchId: a.sucursalId, idempotencyKey: `inv-${a.sufijo}` }, como(a.duenoId)))
  redencionId = r.id

  const f = (await inventarioDelProveedor(a.supplierId))[0]!
  assert.equal(f.pendientesDeEntrega, 1)
  assert.equal(f.canjeadas, 1)
  assert.equal(f.compradas, 1000)
  assert.deepEqual(f.capacidadDiaria, { total: 20, usada: 1, disponible: 19 })

  const mov = await movimientosDelProveedor(a.supplierId, a.itemId)
  assert.ok(mov)
  const tipos = mov.movimientos.map((m) => `${signoDeMovimiento(m)}${m.quantity}:${m.type}`)
  assert.ok(tipos.includes('+1000:RECEIPT'), tipos.join(' '))
  assert.ok(tipos.includes('-1:REDEMPTION'), tipos.join(' '))
  // La verdad es el ledger: Σ asientos = cubetas del lote, y el invariante del lote se cumple.
  const lote = await prisma.supplyV2Lot.findUniqueOrThrow({ where: { id: a.lotId } })
  assert.ok(invarianteCumplido(lote.quantityReceived, cubetasDeLote(lote)))
  const asientos = await prisma.supplyV2LedgerEntry.findMany({ where: { lotId: a.lotId } })
  assert.deepEqual(saldoDeAsientos(asientos), cubetasDeLote(lote))
  assert.equal(lote.quantityRedeemed, 1)
})

test('3 · la reversa suma +1 REVERSAL (no borra el canje) y la capacidad usada vuelve a 0', async () => {
  await sinEmpresa('prueba', (tx) => reversarRedencionEnTx(tx, redencionId, 'Se entregó por error', como(a.admin)))
  const f = (await inventarioDelProveedor(a.supplierId))[0]!
  assert.equal(f.pendientesDeEntrega, 2)
  assert.equal(f.canjeadas, 0)
  assert.deepEqual(f.capacidadDiaria, { total: 20, usada: 0, disponible: 20 })
  const mov = await movimientosDelProveedor(a.supplierId, a.itemId)
  const tipos = mov!.movimientos.map((m) => `${signoDeMovimiento(m)}${m.quantity}:${m.type}`)
  assert.ok(tipos.includes('+1:REVERSAL'))
  assert.ok(tipos.includes('-1:REDEMPTION'), 'el canje reversado sigue en el ledger')
  assert.equal(await prisma.supplyV2Redemption.count({ where: { id: redencionId } }), 1, 'nada se borra')
})

test('4 · aislamiento: otro proveedor no ve este inventario ni sus movimientos', async () => {
  const otro = await montarSupplierLite({ prefijo: 'inv2', unidadesCompradas: 10, unidadesCliente: 1 })
  const filas = await inventarioDelProveedor(otro.supplierId)
  assert.equal(filas.length, 1)
  assert.equal(filas[0]!.compradas, 10)
  assert.equal(await movimientosDelProveedor(otro.supplierId, a.itemId), null, 'el producto de otro proveedor no resuelve')
})
