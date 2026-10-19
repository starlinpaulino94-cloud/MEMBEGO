/**
 * Cobros en línea del día: la cuenta que el personal ve el día del cuadre.
 * La regla que se vigila: el pago con tarjeta de la pasarela NO es efectivo de la gaveta.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SUCURSAL_EN_LINEA,
  efectivoEsperadoSinCobrosEnLinea,
  resumirCobrosEnLinea,
  type CobroEnLinea,
} from '../src/modules/pagos/cobros-en-linea-resumen'

const cobro = (extra: Partial<CobroEnLinea> = {}): CobroEnLinea => ({
  id: 't1',
  codigo: 'TX-1',
  ticketNumero: 'TCK-1',
  creadoAt: new Date('2026-10-16T14:00:00Z'),
  cliente: 'Ana',
  detalle: 'Membresía Oro',
  monto: 500,
  formaDePago: 'Tarjeta VISA ••••4242 (en la app)',
  canal: 'APP',
  autorizacion: 'A1',
  sucursal: SUCURSAL_EN_LINEA,
  impresa: false,
  ...extra,
})

test('sin cobros el resumen es cero y no inventa filas', () => {
  const r = resumirCobrosEnLinea([])
  assert.deepEqual(r, { cantidad: 0, total: 0, porCanal: [], porSucursal: [] })
})

test('agrupa por canal y por sucursal, de mayor a menor, y suma a centavos exactos', () => {
  const r = resumirCobrosEnLinea([
    cobro({ id: 'a', monto: 0.1 }),
    cobro({ id: 'b', monto: 0.2 }),
    cobro({ id: 'c', monto: 1000, canal: 'WEB', sucursal: 'Piantini' }),
    cobro({ id: 'd', monto: 300, canal: 'RENOVACION_AUTOMATICA' }),
  ])
  assert.equal(r.cantidad, 4)
  assert.equal(r.total, 1300.3, '0.1 + 0.2 no puede salir 0.30000000000000004')
  assert.deepEqual(r.porCanal.map((c) => [c.canal, c.cantidad, c.total]), [
    ['WEB', 1, 1000],
    ['RENOVACION_AUTOMATICA', 1, 300],
    ['APP', 2, 0.3],
  ])
  assert.deepEqual(r.porCanal.map((c) => c.etiqueta), ['en la web', 'renovación automática', 'en la app'])
  assert.deepEqual(r.porSucursal.map((s) => [s.sucursal, s.cantidad, s.total]), [
    ['Piantini', 1, 1000],
    [SUCURSAL_EN_LINEA, 3, 300.3],
  ])
})

test('un cobro anterior a que se guardara el canal no se pierde: queda en su propio grupo', () => {
  const r = resumirCobrosEnLinea([cobro({ canal: null, monto: 250 })])
  assert.equal(r.porCanal.length, 1)
  assert.equal(r.porCanal[0]!.canal, null)
  assert.equal(r.porCanal[0]!.etiqueta, 'canal no registrado')
  assert.equal(r.total, 250)
})

test('los cobros en línea NO se suman al efectivo esperado de la gaveta', () => {
  const enLinea = resumirCobrosEnLinea([cobro({ monto: 5000 }), cobro({ id: 'z', monto: 2500 })])
  assert.equal(enLinea.total, 7500)
  assert.equal(efectivoEsperadoSinCobrosEnLinea(1234.5, enLinea), 1234.5)
})
