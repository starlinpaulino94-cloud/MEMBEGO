import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CANALES_DE_COBRO,
  esCanalDeCobro,
  etiquetaDeCobroConTarjeta,
  sanearAutorizacion,
  sanearTarjeta,
  snapshotDeCobroConTarjeta,
} from '../src/modules/pagos/comprobante-tarjeta'

test('sanearTarjeta: marca conocida y exactamente 4 dígitos; lo demás se descarta', () => {
  assert.deepEqual(sanearTarjeta({ marca: 'visa', ultimos4: '4242' }), { marca: 'VISA', ultimos4: '4242' })
  assert.deepEqual(sanearTarjeta({ marca: 'Master Card', ultimos4: 4242 }), { marca: 'Mastercard', ultimos4: '4242' })
  assert.deepEqual(sanearTarjeta({ marca: 'American Express', ultimos4: ' 0005 ' }), { marca: 'American Express', ultimos4: '0005' })
  assert.deepEqual(sanearTarjeta(null), { marca: null, ultimos4: null })
  assert.deepEqual(sanearTarjeta({ marca: 'MarcaInventada', ultimos4: '12' }), { marca: null, ultimos4: null })
})

test('sanearTarjeta NUNCA deja pasar un número de tarjeta, venga en el campo que venga', () => {
  const pan = '4111111111111111'
  for (const entrada of [{ ultimos4: pan }, { ultimos4: '4111 1111 1111 1111' }, { marca: pan }, { ultimos4: `x${pan}` }, { ultimos4: Number(pan) }]) {
    const t = sanearTarjeta(entrada)
    assert.equal(t.ultimos4, null)
    assert.equal(JSON.stringify(t).includes('4111'), false)
  }
})

test('sanearAutorizacion: alfanumérica corta; una cadena con otra forma no se imprime', () => {
  assert.equal(sanearAutorizacion('AUTH-123'), 'AUTH-123')
  assert.equal(sanearAutorizacion(123456), '123456')
  for (const mala of [null, undefined, '', 'tiene espacio', 'a'.repeat(25), '4111 1111 1111 1111', '<script>', { x: 1 }]) assert.equal(sanearAutorizacion(mala), null)
})

test('la etiqueta dice marca, últimos 4 y canal', () => {
  assert.equal(etiquetaDeCobroConTarjeta('APP', { marca: 'VISA', ultimos4: '4242' }), 'Tarjeta VISA ••••4242 (en la app)')
  assert.equal(etiquetaDeCobroConTarjeta('WEB', { marca: null, ultimos4: '4242' }), 'Tarjeta ••••4242 (en la web)')
  assert.equal(etiquetaDeCobroConTarjeta('RENOVACION_AUTOMATICA', { marca: null, ultimos4: null }), 'Tarjeta (renovación automática)')
})

test('los canales son un conjunto cerrado', () => {
  assert.deepEqual([...CANALES_DE_COBRO], ['APP', 'WEB', 'RENOVACION_AUTOMATICA'])
  assert.equal(esCanalDeCobro('APP'), true)
  assert.equal(esCanalDeCobro('POS'), false)
  assert.equal(esCanalDeCobro(undefined), false)
})

test('el snapshot trae lo que el motor de recibos imprime, la trazabilidad al intento y ningún dato de tarjeta más allá de marca y últimos 4', () => {
  const s = snapshotDeCobroConTarjeta({
    detalle: 'Membresía Plan Oro',
    clienteNombre: 'Ana Pérez',
    monto: 500,
    canal: 'APP',
    pagoIntentoId: 'cmintento123456789012345',
    autorizacion: 'AUTH-777',
    tarjeta: { marca: 'visa', ultimos4: '4242', numero: '4111111111111111', cvv: '123' } as never,
    sucursalNombre: 'Principal',
  })
  assert.equal(s.metodoCobroLabel, 'Tarjeta VISA ••••4242 (en la app)')
  assert.equal(s.referenciaPago, 'Aut. AUTH-777')
  assert.equal(s.total, '500.00')
  assert.deepEqual(s.lineas, [{ descripcion: 'Membresía Plan Oro', cantidad: 1, precioUnitario: 500, descuento: 0, total: 500 }])
  assert.equal(s.pagoIntentoId, 'cmintento123456789012345')
  assert.deepEqual(s.tarjeta, { marca: 'VISA', ultimos4: '4242' })
  const texto = JSON.stringify(s)
  for (const prohibido of ['4111', 'cvv', '123"']) assert.equal(texto.includes(prohibido), false, prohibido)
})

test('sin datos de tarjeta ni autorización el snapshot sigue siendo válido', () => {
  const s = snapshotDeCobroConTarjeta({ detalle: 'Renovación', clienteNombre: 'X', monto: 1600, canal: 'RENOVACION_AUTOMATICA', pagoIntentoId: 'i1' })
  assert.equal(s.metodoCobroLabel, 'Tarjeta (renovación automática)')
  assert.equal(s.referenciaPago, undefined)
  assert.equal(s.tarjeta, undefined)
  assert.equal(s.canalDeCobro, 'RENOVACION_AUTOMATICA')
})
