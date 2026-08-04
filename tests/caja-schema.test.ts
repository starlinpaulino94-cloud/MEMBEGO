/**
 * Caja (POS) · esquemas Zod — validación de los formularios de turno y cobro
 * (`src/modules/caja/schema.ts`). Replica exactamente la semántica del helper
 * `num()` que sustituye: `''`/no numérico se trata según cada campo.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  abrirCajaSchema,
  cerrarCajaSchema,
  movimientoCajaSchema,
  cobrarOrdenSchema,
} from '../src/modules/caja/schema'

test('abrirCaja válido', () => {
  const r = abrirCajaSchema.safeParse({
    sucursalId: ' suc-1 ',
    balanceInicial: '1000.5',
    turno: ' mañana ',
  })
  assert.equal(r.success, true)
  if (!r.success) return
  assert.equal(r.data.sucursalId, 'suc-1')
  assert.equal(r.data.balanceInicial, 1000.5)
  assert.equal(r.data.turno, 'mañana')
})

test('abrirCaja: sucursal obligatoria', () => {
  const r = abrirCajaSchema.safeParse({ sucursalId: '', balanceInicial: '0', turno: '' })
  assert.equal(r.success, false)
  if (r.success) return
  assert.equal(r.error.issues[0].message, 'Selecciona la sucursal.')
})

test('abrirCaja: balance negativo', () => {
  const r = abrirCajaSchema.safeParse({ sucursalId: 's', balanceInicial: '-1', turno: '' })
  assert.equal(r.success, false)
  if (r.success) return
  assert.equal(r.error.issues[0].message, 'El balance inicial no puede ser negativo.')
})

test('abrirCaja: balance vacío o no numérico = 0 (comportamiento de num() ?? 0)', () => {
  for (const v of ['', 'abc']) {
    const r = abrirCajaSchema.safeParse({ sucursalId: 's', balanceInicial: v, turno: '' })
    assert.equal(r.success, true, `balanceInicial '${v}' debe aceptarse como 0`)
    if (r.success) assert.equal(r.data.balanceInicial, 0)
  }
})

test('cerrarCaja válido', () => {
  const r = cerrarCajaSchema.safeParse({
    cajaSesionId: ' sesion-1 ',
    balanceFinal: '3500.25',
    observaciones: ' nada ',
  })
  assert.equal(r.success, true)
  if (!r.success) return
  assert.equal(r.data.cajaSesionId, 'sesion-1')
  assert.equal(r.data.balanceFinal, 3500.25)
  assert.equal(r.data.observaciones, 'nada')
})

test('cerrarCaja: balanceFinal vacío o no numérico', () => {
  for (const v of ['', 'abc']) {
    const r = cerrarCajaSchema.safeParse({ cajaSesionId: 's', balanceFinal: v, observaciones: '' })
    assert.equal(r.success, false, `balanceFinal '${v}' debe fallar`)
    if (r.success) continue
    assert.equal(r.error.issues[0].message, 'Indica el efectivo contado al cerrar.')
  }
})

test('cerrarCaja: sesión obligatoria', () => {
  const r = cerrarCajaSchema.safeParse({ cajaSesionId: '', balanceFinal: '10', observaciones: '' })
  assert.equal(r.success, false)
  if (r.success) return
  assert.equal(r.error.issues[0].message, 'Sesión no especificada.')
})

test('movimiento válido', () => {
  const r = movimientoCajaSchema.safeParse({
    cajaSesionId: 's',
    tipo: 'ENTRADA',
    monto: '500',
    concepto: 'Aporte',
  })
  assert.equal(r.success, true)
  if (!r.success) return
  assert.equal(r.data.tipo, 'ENTRADA')
  assert.equal(r.data.monto, 500)
  assert.equal(r.data.concepto, 'Aporte')
})

test('movimiento: tipo inválido', () => {
  const r = movimientoCajaSchema.safeParse({
    cajaSesionId: 's',
    tipo: 'RETIRO',
    monto: '10',
    concepto: 'x',
  })
  assert.equal(r.success, false)
  if (r.success) return
  assert.equal(r.error.issues[0].message, 'Tipo de movimiento no válido.')
})

test('movimiento: monto vacío, cero o no numérico', () => {
  for (const v of ['', '0', '-5', 'abc']) {
    const r = movimientoCajaSchema.safeParse({
      cajaSesionId: 's',
      tipo: 'ENTRADA',
      monto: v,
      concepto: 'x',
    })
    assert.equal(r.success, false, `monto '${v}' debe fallar`)
    if (r.success) continue
    assert.equal(r.error.issues[0].message, 'Indica un monto mayor que cero.')
  }
})

test('movimiento: concepto obligatorio', () => {
  const r = movimientoCajaSchema.safeParse({
    cajaSesionId: 's',
    tipo: 'ENTRADA',
    monto: '10',
    concepto: '',
  })
  assert.equal(r.success, false)
  if (r.success) return
  assert.equal(r.error.issues[0].message, 'Describe el concepto del movimiento.')
})

test('cobrarOrden válido (simple y mixto)', () => {
  const simple = cobrarOrdenSchema.safeParse({
    cajaSesionId: 's',
    ordenId: 'o1',
    ordenTipo: 'MEMBRESIA',
    metodoCobro: 'EFECTIVO',
    observaciones: '',
    montoEfectivo: '',
    montoTransferencia: '',
  })
  assert.equal(simple.success, true)
  if (simple.success) assert.equal(simple.data.montoEfectivo, 0)

  const mixto = cobrarOrdenSchema.safeParse({
    cajaSesionId: 's',
    ordenId: 'o1',
    ordenTipo: 'PROMOCION',
    metodoCobro: 'MIXTO',
    observaciones: 'nota',
    montoEfectivo: '100.5',
    montoTransferencia: '50.456',
  })
  assert.equal(mixto.success, true)
  if (!mixto.success) return
  assert.equal(mixto.data.montoEfectivo, 100.5)
  assert.equal(mixto.data.montoTransferencia, 50.46)
})

test('cobrarOrden: datos incompletos', () => {
  const r = cobrarOrdenSchema.safeParse({
    cajaSesionId: 's',
    ordenId: '',
    ordenTipo: 'MEMBRESIA',
    metodoCobro: 'EFECTIVO',
    observaciones: '',
    montoEfectivo: '',
    montoTransferencia: '',
  })
  assert.equal(r.success, false)
  if (r.success) return
  assert.equal(r.error.issues[0].message, 'Datos incompletos.')
})

test('cobrarOrden: tipo de orden inválido', () => {
  const r = cobrarOrdenSchema.safeParse({
    cajaSesionId: 's',
    ordenId: 'o1',
    ordenTipo: 'PAGO',
    metodoCobro: 'EFECTIVO',
    observaciones: '',
    montoEfectivo: '',
    montoTransferencia: '',
  })
  assert.equal(r.success, false)
  if (r.success) return
  assert.equal(r.error.issues[0].message, 'Tipo de orden no válido.')
})

test('cobrarOrden: forma de pago inválida', () => {
  const r = cobrarOrdenSchema.safeParse({
    cajaSesionId: 's',
    ordenId: 'o1',
    ordenTipo: 'MEMBRESIA',
    metodoCobro: 'CREDITO',
    observaciones: '',
    montoEfectivo: '',
    montoTransferencia: '',
  })
  assert.equal(r.success, false)
  if (r.success) return
  assert.equal(r.error.issues[0].message, 'Selecciona la forma de pago.')
})
