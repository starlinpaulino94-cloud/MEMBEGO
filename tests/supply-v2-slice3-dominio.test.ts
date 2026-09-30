import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  estadoSesionQr,
  FORMATO_NONCE,
  MENSAJES_RECHAZO,
  motivoNoCanjeable,
  motivoSinVoucher,
  nonceConFormatoValido,
  normalizarCodigoLeido,
  nuevoCodigoVoucher,
  nuevoNonce,
  previewRechazado,
  segundosRestantes,
  type CanjeParaValidar,
} from '../src/modules/supply-v2/redemption/domain'
import { exigirTransicion, TRANSICIONES_DERECHO, TRANSICIONES_VOUCHER } from '../src/modules/supply-v2/core/estados'
import { aplicarMovimiento, invarianteCumplido, type Buckets } from '../src/modules/supply-v2/core/ledger'
import { ttlQrMinutos, vencimientoDeQr } from '../src/modules/supply-v2/core/config'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 3 · dominio puro (§71). Sin base de datos.
 */

const ahora = new Date('2026-10-01T12:00:00Z')
const min = (n: number) => new Date(ahora.getTime() + n * 60_000)

function canjeBase(): CanjeParaValidar {
  return {
    sesion: { expiresAt: min(4), consumedAt: null, branchId: null },
    voucher: { status: 'ACTIVE', validUntil: min(60 * 24 * 30) },
    derecho: { status: 'ACTIVE', expiresAt: min(60 * 24 * 30), supplierId: 'sup-1', customerId: 'cli-1' },
    proveedor: { status: 'ACTIVE', companyId: 'emp-1' },
    empleado: { supplierId: 'sup-1', companyId: 'emp-1' },
    sucursal: { id: 'suc-a', companyId: 'emp-1', activa: true },
    proveedorTieneSucursales: true,
    lotIssued: 1,
  }
}

// 1
test('voucher · un derecho ACTIVE y vigente del cliente puede generar voucher', () => {
  assert.equal(motivoSinVoucher({ status: 'ACTIVE', expiresAt: min(60), customerId: 'cli-1' }, 'cli-1', ahora), null)
  assert.equal(motivoSinVoucher({ status: 'ACTIVE', expiresAt: null, customerId: 'cli-1' }, 'cli-1', ahora), null)
})

// 2
test('voucher · cancelado, vencido o ya utilizado no genera voucher; el de otro tampoco', () => {
  assert.equal(motivoSinVoucher({ status: 'CANCELLED', expiresAt: null, customerId: 'cli-1' }, 'cli-1', ahora), 'ENTITLEMENT_CANCELLED')
  assert.equal(motivoSinVoucher({ status: 'EXPIRED', expiresAt: null, customerId: 'cli-1' }, 'cli-1', ahora), 'ENTITLEMENT_EXPIRED')
  assert.equal(motivoSinVoucher({ status: 'ACTIVE', expiresAt: min(-1), customerId: 'cli-1' }, 'cli-1', ahora), 'ENTITLEMENT_EXPIRED')
  assert.equal(motivoSinVoucher({ status: 'REDEEMED', expiresAt: null, customerId: 'cli-1' }, 'cli-1', ahora), 'ALREADY_REDEEMED')
  assert.equal(motivoSinVoucher({ status: 'ACTIVE', expiresAt: null, customerId: 'cli-1' }, 'cli-2', ahora), 'NOT_OWNER')
})

// 3
test('nonce · 24 bytes aleatorios en base64url, 32 caracteres, nunca repetido, formato validable', () => {
  const vistos = new Set<string>()
  for (let i = 0; i < 2000; i++) {
    const n = nuevoNonce()
    assert.match(n, FORMATO_NONCE)
    assert.equal(n.length, 32)
    assert.ok(!vistos.has(n), 'nonce repetido')
    vistos.add(n)
  }
  assert.ok(nonceConFormatoValido(nuevoNonce()))
  assert.ok(!nonceConFormatoValido('cmuo686t3002a7d0jwzz4tjt5'), 'un id de Prisma no es un nonce')
  assert.ok(!nonceConFormatoValido(''))
  assert.ok(!nonceConFormatoValido('a'.repeat(31)))
  assert.ok(nuevoCodigoVoucher().length >= 43, 'el código del voucher es más largo que el nonce')
  const n = nuevoNonce()
  assert.equal(normalizarCodigoLeido(`  https://app.membego.com/c/${n}\n`), n)
  assert.equal(normalizarCodigoLeido(n), n)
})

// 4
test('QR · expira: estado derivado y segundos restantes', () => {
  assert.equal(estadoSesionQr({ expiresAt: min(1), consumedAt: null }, ahora), 'ACTIVE')
  assert.equal(estadoSesionQr({ expiresAt: ahora, consumedAt: null }, ahora), 'EXPIRED')
  assert.equal(estadoSesionQr({ expiresAt: min(-1), consumedAt: null }, ahora), 'EXPIRED')
  assert.equal(segundosRestantes(min(1), ahora), 60)
  assert.equal(segundosRestantes(min(-1), ahora), 0)
  const c = canjeBase()
  c.sesion.expiresAt = min(-1)
  assert.equal(motivoNoCanjeable(c, ahora), 'QR_EXPIRED')
  assert.match(MENSAJES_RECHAZO.QR_EXPIRED, /expiró/)
})

// 5
test('QR · consumido no se reutiliza, aunque el voucher siga activo', () => {
  assert.equal(estadoSesionQr({ expiresAt: min(1), consumedAt: min(-1) }, ahora), 'CONSUMED')
  const c = canjeBase()
  c.sesion.consumedAt = min(-1)
  assert.equal(motivoNoCanjeable(c, ahora), 'QR_CONSUMED')
  c.derecho.status = 'REDEEMED'
  assert.equal(motivoNoCanjeable(c, ahora), 'ALREADY_REDEEMED')
})

// 6
test('voucher vencido falla, y no se confunde con el QR', () => {
  const c = canjeBase()
  c.voucher.validUntil = min(-1)
  assert.equal(motivoNoCanjeable(c, ahora), 'VOUCHER_EXPIRED')
  c.voucher.validUntil = min(60)
  c.voucher.status = 'EXPIRED'
  assert.equal(motivoNoCanjeable(c, ahora), 'VOUCHER_EXPIRED')
  c.voucher.status = 'REVOKED'
  assert.equal(motivoNoCanjeable(c, ahora), 'VOUCHER_INACTIVE')
})

// 7
test('derecho vencido o cancelado falla', () => {
  const c = canjeBase()
  c.derecho.expiresAt = min(-1)
  assert.equal(motivoNoCanjeable(c, ahora), 'ENTITLEMENT_EXPIRED')
  c.derecho.expiresAt = null
  c.derecho.status = 'EXPIRED'
  assert.equal(motivoNoCanjeable(c, ahora), 'ENTITLEMENT_EXPIRED')
  c.derecho.status = 'CANCELLED'
  assert.equal(motivoNoCanjeable(c, ahora), 'ENTITLEMENT_CANCELLED')
})

// 8
test('proveedor incorrecto falla: otro supplier, otra empresa o proveedor inactivo', () => {
  const c = canjeBase()
  c.empleado = { supplierId: 'sup-2', companyId: 'emp-2' }
  assert.equal(motivoNoCanjeable(c, ahora), 'WRONG_SUPPLIER')
  const d = canjeBase()
  d.empleado.companyId = 'emp-otra'
  assert.equal(motivoNoCanjeable(d, ahora), 'WRONG_SUPPLIER')
  const e = canjeBase()
  e.proveedor.status = 'BLOCKED'
  assert.equal(motivoNoCanjeable(e, ahora), 'SUPPLIER_INACTIVE')
})

// 9
test('sucursal incorrecta falla: de otra empresa, inactiva, distinta a la del QR, o ninguna cuando hay sucursales', () => {
  const c = canjeBase()
  c.sucursal = { id: 'suc-x', companyId: 'emp-2', activa: true }
  assert.equal(motivoNoCanjeable(c, ahora), 'WRONG_BRANCH')
  const d = canjeBase()
  d.sucursal = { id: 'suc-a', companyId: 'emp-1', activa: false }
  assert.equal(motivoNoCanjeable(d, ahora), 'WRONG_BRANCH')
  const e = canjeBase()
  e.sesion.branchId = 'suc-b'
  assert.equal(motivoNoCanjeable(e, ahora), 'WRONG_BRANCH')
  e.sucursal = { id: 'suc-b', companyId: 'emp-1', activa: true }
  assert.equal(motivoNoCanjeable(e, ahora), null)
  const f = canjeBase()
  f.sucursal = null
  assert.equal(motivoNoCanjeable(f, ahora), 'BRANCH_REQUIRED')
  f.proveedorTieneSucursales = false
  assert.equal(motivoNoCanjeable(f, ahora), null, 'sin sucursales, cualquier empleado del proveedor entrega')
})

// 10
test('preview válido: todo en orden devuelve null y el rechazo lleva mensaje sin ids', () => {
  assert.equal(motivoNoCanjeable(canjeBase(), ahora), null)
  const p = previewRechazado('WRONG_SUPPLIER')
  assert.equal(p.valid, false)
  assert.equal(p.message, 'Este beneficio pertenece a otro comercio.')
  assert.equal(p.customerPaysMerchant, '0.00')
  assert.equal(p.entitlementId, undefined)
})

// 11
test('redeem · ISSUED → REDEEMED mantiene el invariante del lote', () => {
  const antes: Buckets = { AVAILABLE: 900, ALLOCATED: 99, RESERVED: 0, ISSUED: 1, REDEEMED: 0, CLOSED: 0 }
  const despues = aplicarMovimiento(antes, { type: 'REDEMPTION', sourceBucket: 'ISSUED', destinationBucket: 'REDEEMED', quantity: 1 })
  assert.deepEqual(despues, { ...antes, ISSUED: 0, REDEEMED: 1 })
  assert.ok(invarianteCumplido(1000, despues))
  assert.throws(() => aplicarMovimiento(antes, { type: 'REDEMPTION', sourceBucket: 'AVAILABLE', destinationBucket: 'REDEEMED', quantity: 1 }), /no permitido|REDEMPTION/i)
})

// 12
test('doble redeem falla: el derecho REDEEMED no vuelve a REDEEMED y el voucher tampoco', () => {
  assert.throws(() => exigirTransicion(TRANSICIONES_DERECHO, 'REDEEMED', 'REDEEMED', 'Beneficio'), /no se puede pasar/)
  assert.throws(() => exigirTransicion(TRANSICIONES_VOUCHER, 'REDEEMED', 'REDEEMED', 'Voucher'), /no se puede pasar/)
  const c = canjeBase()
  c.derecho.status = 'REDEEMED'
  assert.equal(motivoNoCanjeable(c, ahora), 'ALREADY_REDEEMED')
  assert.equal(MENSAJES_RECHAZO.ALREADY_REDEEMED, 'Este beneficio ya fue utilizado.')
})

// 13
test('reversal · REDEEMED → ISSUED en el ledger, nunca hacia AVAILABLE', () => {
  const antes: Buckets = { AVAILABLE: 900, ALLOCATED: 99, RESERVED: 0, ISSUED: 0, REDEEMED: 1, CLOSED: 0 }
  const despues = aplicarMovimiento(antes, { type: 'REVERSAL', sourceBucket: 'REDEEMED', destinationBucket: 'ISSUED', quantity: 1, reason: 'Entrega marcada por error.' })
  assert.deepEqual(despues, { ...antes, ISSUED: 1, REDEEMED: 0 })
  assert.throws(() => aplicarMovimiento(antes, { type: 'REVERSAL', sourceBucket: 'REDEEMED', destinationBucket: 'AVAILABLE', quantity: 1, reason: 'x' }))
  assert.throws(() => aplicarMovimiento(antes, { type: 'REVERSAL', sourceBucket: 'REDEEMED', destinationBucket: 'ISSUED', quantity: 1 }), /motivo/, 'una reversa exige motivo')
})

// 14
test('doble reversal falla: un derecho ACTIVE no «vuelve» a ACTIVE por reversa', () => {
  assert.throws(() => exigirTransicion(TRANSICIONES_DERECHO, 'ACTIVE', 'ACTIVE', 'Beneficio'), /no se puede pasar/)
  const vacio: Buckets = { AVAILABLE: 900, ALLOCATED: 99, RESERVED: 0, ISSUED: 1, REDEEMED: 0, CLOSED: 0 }
  assert.throws(() => aplicarMovimiento(vacio, { type: 'REVERSAL', sourceBucket: 'REDEEMED', destinationBucket: 'ISSUED', quantity: 1, reason: 'segunda reversa' }), /negativ|insuficiente|saldo|no hay/i)
})

// 15
test('QR previo no revive tras reversal: una sesión consumida sigue consumida aunque el derecho vuelva a ACTIVE', () => {
  const c = canjeBase()
  c.sesion.consumedAt = min(-10)
  c.derecho.status = 'ACTIVE'
  assert.equal(motivoNoCanjeable(c, ahora), 'QR_CONSUMED')
})

// 16
test('entitlement vuelve ACTIVE tras reversal: transiciones permitidas y terminales', () => {
  exigirTransicion(TRANSICIONES_DERECHO, 'REDEEMED', 'ACTIVE', 'Beneficio')
  exigirTransicion(TRANSICIONES_VOUCHER, 'REDEEMED', 'ACTIVE', 'Voucher')
  assert.throws(() => exigirTransicion(TRANSICIONES_DERECHO, 'EXPIRED', 'ACTIVE', 'Beneficio'))
  assert.throws(() => exigirTransicion(TRANSICIONES_DERECHO, 'CANCELLED', 'ACTIVE', 'Beneficio'))
  assert.throws(() => exigirTransicion(TRANSICIONES_VOUCHER, 'REVOKED', 'ACTIVE', 'Voucher'))
  assert.throws(() => exigirTransicion(TRANSICIONES_VOUCHER, 'EXPIRED', 'ACTIVE', 'Voucher'))
})

// 17
test('invariantes ledger · una redención sobre un lote sin ISSUED es inconsistente', () => {
  const c = canjeBase()
  c.lotIssued = 0
  assert.equal(motivoNoCanjeable(c, ahora), 'LEDGER_INCONSISTENT')
  const antes: Buckets = { AVAILABLE: 1, ALLOCATED: 0, RESERVED: 0, ISSUED: 0, REDEEMED: 0, CLOSED: 0 }
  assert.throws(() => aplicarMovimiento(antes, { type: 'REDEMPTION', sourceBucket: 'ISSUED', destinationBucket: 'REDEEMED', quantity: 1 }))
})

// 18
test('ownership cliente · solo el dueño del derecho genera voucher/QR; TTL del QR configurable en un solo sitio', () => {
  assert.equal(motivoSinVoucher({ status: 'ACTIVE', expiresAt: null, customerId: 'cli-1' }, 'cli-2', ahora), 'NOT_OWNER')
  assert.equal(MENSAJES_RECHAZO.NOT_OWNER, 'Este beneficio no es tuyo.')
  const previo = process.env.SUPPLY_V2_QR_TTL_MINUTES
  delete process.env.SUPPLY_V2_QR_TTL_MINUTES
  assert.equal(ttlQrMinutos(), 5)
  assert.equal(vencimientoDeQr(ahora).getTime(), min(5).getTime())
  process.env.SUPPLY_V2_QR_TTL_MINUTES = '2'
  assert.equal(ttlQrMinutos(), 2)
  process.env.SUPPLY_V2_QR_TTL_MINUTES = 'x'
  assert.equal(ttlQrMinutos(), 5)
  if (previo === undefined) delete process.env.SUPPLY_V2_QR_TTL_MINUTES
  else process.env.SUPPLY_V2_QR_TTL_MINUTES = previo
})
