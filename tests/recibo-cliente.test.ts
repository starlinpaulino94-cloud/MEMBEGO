/**
 * El recibo que ve el cliente se arma desde el snapshot de la venta con los mismos sanadores que lo escribieron.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { armarReciboDePago } from '../src/modules/pagos/recibo-cliente'
import { snapshotDeCobroConTarjeta } from '../src/modules/pagos/comprobante-tarjeta'

const base = {
  ticketNumero: 'TCK-42',
  codigo: 'TX-ABC',
  empresaNombre: 'Auto Spa Norte',
  concepto: 'Plan Oro',
  monto: 1500,
  fecha: new Date('2026-10-16T18:05:00Z'),
  timeZone: 'America/Santo_Domingo',
}

test('arma el recibo con lo que dice el comprobante del negocio', () => {
  const snapshot = snapshotDeCobroConTarjeta({
    detalle: 'Membresía Plan Oro', clienteNombre: 'Ana', monto: 1500, canal: 'APP', pagoIntentoId: 'i1',
    autorizacion: 'AB-123', tarjeta: { marca: 'visa', ultimos4: '4242' },
  })
  const r = armarReciboDePago({ ...base, snapshot })
  assert.equal(r.formaDePago, 'Tarjeta VISA ••••4242 (en la app)')
  assert.equal(r.canal, 'APP')
  assert.equal(r.autorizacion, 'AB-123')
  assert.equal(r.concepto, 'Membresía Plan Oro')
  assert.deepEqual(r.texto.split('\n'), [
    'RECIBO DE PAGO · Auto Spa Norte',
    'Nº TCK-42 · TX-ABC',
    r.texto.split('\n')[2]!,
    'Concepto: Membresía Plan Oro',
    'Monto: RD$1,500.00',
    'Pagado con: Tarjeta VISA ••••4242 (en la app)',
    'Autorización: AB-123',
  ])
  assert.match(r.texto.split('\n')[2]!, /^Fecha: .*2026/)
  assert.equal(r.fecha, '2026-10-16T18:05:00.000Z')
})

test('sin autorización no inventa la línea, y sin snapshot cae a lo que se sabe', () => {
  const r = armarReciboDePago({ ...base, snapshot: null })
  assert.equal(r.formaDePago, 'Tarjeta')
  assert.equal(r.autorizacion, null)
  assert.equal(r.concepto, 'Plan Oro', 'respaldo: el nombre del plan')
  assert.doesNotMatch(r.texto, /Autorización/)
})

test('una etiqueta con un número de tarjeta completo se limpia; una autorización rara no se imprime', () => {
  const r = armarReciboDePago({
    ...base,
    snapshot: { metodoCobroLabel: 'Tarjeta 4111111111111111 (en la web)', autorizacion: '4111 1111 1111 1111', canalDeCobro: 'WEB' },
  })
  assert.doesNotMatch(JSON.stringify(r), /\d{13,}/)
  assert.equal(r.autorizacion, null)
  assert.equal(r.canal, 'WEB')
})

test('un snapshot de otro tipo (texto, lista) no rompe nada', () => {
  for (const snapshot of ['x', 42, [], undefined]) {
    const r = armarReciboDePago({ ...base, snapshot })
    assert.equal(r.formaDePago, 'Tarjeta')
  }
})
