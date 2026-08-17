import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  comisionesDelPeriodo,
  totalLiquidacion,
  numeroLiquidacion,
  puedeTransicionarLiquidacion,
  motivoTransicionLiquidacion,
  validarPeriodo,
  validarPagoLiquidacion,
  type ComisionLiquidable,
} from '../src/modules/excursiones/liquidaciones/nucleo'

/**
 * Excursiones · Fase 7 — la liquidación es el momento en que el dinero sale de
 * la empresa. Lo que decide qué se paga y cuánto se prueba sin base de datos.
 */

const dia = (d: string) => new Date(`2026-08-${d}T12:00:00Z`)

const c = (p: Partial<ComisionLiquidable> & { id: string }): ComisionLiquidable => ({
  vendedorId: 'juan',
  estado: 'APROBADA',
  neto: 100,
  createdAt: dia('10'),
  liquidacionId: null,
  ...p,
})

const criterio = {
  vendedorId: 'juan',
  desde: new Date('2026-08-01T00:00:00.000Z'),
  hasta: new Date('2026-08-31T23:59:59.999Z'),
}

test('entran las aprobadas y las pendientes de pago del vendedor y del período', () => {
  const dentro = comisionesDelPeriodo(
    [
      c({ id: 'a' }),
      c({ id: 'b', estado: 'PENDIENTE_PAGO' }),
      c({ id: 'c', estado: 'GENERADA' }), // nadie la aprobó todavía
      c({ id: 'd', estado: 'PAGADA' }), // ya no debe nada
      c({ id: 'e', estado: 'ANULADA' }),
    ],
    criterio
  )
  assert.deepEqual(dentro.map((x) => x.id), ['a', 'b'])
})

test('nadie cobra dos veces: la que ya está en otra liquidación queda fuera', () => {
  const dentro = comisionesDelPeriodo(
    [c({ id: 'a' }), c({ id: 'ya-pagada-en-otra', liquidacionId: 'PAY-0001' })],
    criterio
  )
  assert.deepEqual(dentro.map((x) => x.id), ['a'])
})

test('no se mezclan vendedores ni comisiones fuera del período', () => {
  const dentro = comisionesDelPeriodo(
    [
      c({ id: 'a' }),
      c({ id: 'de-ana', vendedorId: 'ana' }),
      c({ id: 'mes-pasado', createdAt: new Date('2026-07-20T12:00:00Z') }),
      c({ id: 'mes-que-viene', createdAt: new Date('2026-09-02T12:00:00Z') }),
    ],
    criterio
  )
  assert.deepEqual(dentro.map((x) => x.id), ['a'])
})

test('el último día del período cuenta entero, hasta la noche', () => {
  const r = validarPeriodo({ vendedorId: 'juan', desde: '2026-08-01', hasta: '2026-08-31' })
  assert.equal(r.ok, true)
  if (!r.ok) return
  const tarde = c({ id: 'tarde', createdAt: new Date('2026-08-31T22:45:00Z') })
  const dentro = comisionesDelPeriodo([tarde], {
    vendedorId: 'juan',
    desde: r.datos.desde,
    hasta: r.datos.hasta,
  })
  assert.equal(dentro.length, 1)
})

test('una comisión que quedó en cero por ajustes no entra: no es un pago', () => {
  const dentro = comisionesDelPeriodo([c({ id: 'a', neto: 0 })], criterio)
  assert.equal(dentro.length, 0)
})

test('el total se calcula sumando netos, nunca se teclea', () => {
  assert.equal(totalLiquidacion([100, 250.5, 49.5]), 400)
  assert.equal(totalLiquidacion([]), 0)
})

test('el número de liquidación es legible y estable', () => {
  assert.equal(numeroLiquidacion('PAY', 2026, 14), 'PAY-2026-0014')
  assert.equal(numeroLiquidacion('', 2026, 1), 'PAY-2026-0001')
})

test('una liquidación pagada solo puede anularse, y una anulada no se mueve', () => {
  assert.equal(puedeTransicionarLiquidacion('BORRADOR', 'APROBADA'), true)
  assert.equal(puedeTransicionarLiquidacion('APROBADA', 'PAGADA'), true)
  assert.equal(puedeTransicionarLiquidacion('BORRADOR', 'PAGADA'), false) // no se salta la aprobación
  assert.equal(puedeTransicionarLiquidacion('PAGADA', 'APROBADA'), false)
  assert.equal(puedeTransicionarLiquidacion('PAGADA', 'ANULADA'), true)
  assert.equal(puedeTransicionarLiquidacion('ANULADA', 'BORRADOR'), false)
  assert.match(motivoTransicionLiquidacion('PAGADA', 'APROBADA') ?? '', /solo puede anularse/i)
  assert.equal(motivoTransicionLiquidacion('APROBADA', 'PAGADA'), null)
})

test('el período exige vendedor y fechas coherentes', () => {
  assert.equal(validarPeriodo({ desde: '2026-08-01', hasta: '2026-08-31' }).ok, false)
  assert.equal(validarPeriodo({ vendedorId: 'juan', desde: 'ayer', hasta: 'hoy' }).ok, false)
  assert.equal(
    validarPeriodo({ vendedorId: 'juan', desde: '2026-08-31', hasta: '2026-08-01' }).ok,
    false
  )
})

test('un pago que no es en efectivo exige su referencia', () => {
  assert.equal(validarPagoLiquidacion({ metodo: 'TRANSFERENCIA' }).ok, false)
  assert.equal(validarPagoLiquidacion({ metodo: 'EFECTIVO' }).ok, true)
  const r = validarPagoLiquidacion({ metodo: 'transferencia', referencia: 'TRX-99120' })
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal(r.datos.metodo, 'TRANSFERENCIA')
    assert.equal(r.datos.referencia, 'TRX-99120')
  }
})
