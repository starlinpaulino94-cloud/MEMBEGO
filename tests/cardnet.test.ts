import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  firmaAutenticacion,
  firmaEstado,
  montoMenor,
  vencimientoVenta,
  vencimiento3DS,
  parseVencimiento,
  normalizarPan,
  sinTarjeta,
  esAprobada,
  mensajeParaCliente,
  urlsDe,
} from '../src/lib/payments/cardnet-core'

/**
 * Estas pruebas fijan lo que SÍ se pudo verificar sin llamar a CardNET: las
 * firmas (contra los ejemplos reales de la guía), los formatos y —lo más
 * importante para PCI— que nada de esta capa deja escapar una tarjeta a un log.
 */

// ── Firmas: los vectores de oro salen de la propia guía de CardNET ──────────

test('firma de autenticación reproduce el ejemplo de la guía 3DS', () => {
  // Guía 3DS, ejemplo de autenticación. Si esto cambia, la autenticación
  // dejará de funcionar contra CardNET.
  const firma = firmaAutenticacion(
    '349011300',
    '2212',
    '485f9d79-f672-4bfd-a65f-2f756920ad1e',
    '500',
    '66827137-4ad5-4a37-8e87-6299fe2d5b57'
  )
  assert.equal(
    firma,
    '38a492e8bc91d4a9192b77b6f4be1bd350d3edef9da9a2ab817828a1900e80dcf62b74d99b2fcfc50c76d2f616f487f4e72a3cad224739963c7ef7dd91f28291'
  )
})

test('firma de estado reproduce el ejemplo de la guía y NO usa la fecha de vencimiento', () => {
  const firma = firmaEstado(
    '349011300',
    '485f9d79-f672-4bfd-a65f-2f756920ad1e',
    '500',
    '66827137-4ad5-4a37-8e87-6299fe2d5b57'
  )
  assert.equal(
    firma,
    'c17223c0c3bfd0790f5b3a54088020f69b2ad78fee4073d80f92ca3b88a8bb91b6c284cd57e03750c58de71d33d805a1a388b961eb46e04ad4659de116142329'
  )
})

test('las dos firmas son distintas para los mismos datos base', () => {
  const auth = firmaAutenticacion('c', '2212', 'tx', '500', 'k')
  const estado = firmaEstado('c', 'tx', '500', 'k')
  assert.notEqual(auth, estado)
})

// ── Montos ──────────────────────────────────────────────────────────────────

test('montoMenor convierte pesos a centavos sin punto', () => {
  assert.equal(montoMenor(500), '50000')
  assert.equal(montoMenor(5), '500')
  assert.equal(montoMenor(1234.87), '123487')
  assert.equal(montoMenor(0.99), '99')
})

test('montoMenor redondea al centavo y no arrastra error de coma flotante', () => {
  // 19.99 * 100 = 1998.9999... en flotante; debe dar "1999", no "1998".
  assert.equal(montoMenor(19.99), '1999')
  assert.equal(montoMenor(0.1 + 0.2), '30')
})

// ── Fechas de vencimiento ───────────────────────────────────────────────────

test('vencimientoVenta da MM/YY y vencimiento3DS da AAMM', () => {
  assert.equal(vencimientoVenta(12, 22), '12/22')
  assert.equal(vencimiento3DS(12, 22), '2212')
  assert.equal(vencimientoVenta(4, 7), '04/07')
  assert.equal(vencimiento3DS(4, 7), '0704')
})

test('parseVencimiento acepta las formas que un cliente escribe', () => {
  assert.deepEqual(parseVencimiento('12/27'), { mes: 12, anio2: 27 })
  assert.deepEqual(parseVencimiento('12 / 27'), { mes: 12, anio2: 27 })
  assert.deepEqual(parseVencimiento('1227'), { mes: 12, anio2: 27 })
  assert.deepEqual(parseVencimiento('04/2027'), { mes: 4, anio2: 27 })
})

test('parseVencimiento rechaza fechas imposibles en vez de intentar cobrar', () => {
  assert.equal(parseVencimiento('13/27'), null) // mes 13
  assert.equal(parseVencimiento('00/27'), null) // mes 0
  assert.equal(parseVencimiento('12'), null) // incompleta
  assert.equal(parseVencimiento('abcd'), null)
  assert.equal(parseVencimiento(''), null)
})

// ── Número de tarjeta ───────────────────────────────────────────────────────

test('normalizarPan deja solo dígitos', () => {
  assert.equal(normalizarPan('5555 5555 5555 5557'), '5555555555555557')
  assert.equal(normalizarPan('4111-1111-1111-1111'), '4111111111111111')
})

// ── PCI: la redacción es lo que impide una fuga por logs ────────────────────

test('sinTarjeta enmascara el PAN a los últimos 4 y borra el CVV', () => {
  const limpio = sinTarjeta({
    'card-number': '5555555555555557',
    cvv: '123',
    amount: 500,
    'merchant-id': '349041263',
  })
  assert.equal(limpio['card-number'], '****5557')
  assert.equal(limpio.cvv, '***')
  // Lo que no es sensible se conserva para poder diagnosticar.
  assert.equal(limpio.amount, 500)
  assert.equal(limpio['merchant-id'], '349041263')
})

test('sinTarjeta cubre las variantes de nombre de campo (acctNumber, pan, cvc)', () => {
  const limpio = sinTarjeta({ acctNumber: '4111111111111111', pan: '5555555555555557', cvc: '999' })
  assert.equal(limpio.acctNumber, '****1111')
  assert.equal(limpio.pan, '****5557')
  assert.equal(limpio.cvc, '***')
})

test('sinTarjeta no rompe con un PAN corto o vacío', () => {
  assert.equal(sinTarjeta({ 'card-number': '12' })['card-number'], '****')
  assert.equal(sinTarjeta({ 'card-number': '' })['card-number'], '****')
})

// ── Interpretación de la respuesta ──────────────────────────────────────────

test('esAprobada exige response-code 00 e internal 0000', () => {
  assert.equal(esAprobada('00', '0000'), true)
  assert.equal(esAprobada('00', ''), true) // internal ausente se tolera
  assert.equal(esAprobada('00', '1810'), false) // 00 a medias NO es cobro
  assert.equal(esAprobada('05', '1905'), false)
  assert.equal(esAprobada('51', '1016'), false)
  assert.equal(esAprobada('', ''), false)
})

test('mensajeParaCliente traduce códigos comunes y nunca filtra el interno', () => {
  assert.equal(mensajeParaCliente('51'), 'Fondos insuficientes.')
  assert.equal(mensajeParaCliente('54'), 'La tarjeta está vencida.')
  // Un código desconocido cae en el genérico, sin exponer detalle del banco.
  assert.match(mensajeParaCliente('79'), /no se pudo completar el pago/i)
})

// ── URLs por ambiente ───────────────────────────────────────────────────────

test('urlsDe separa QA de producción y usa hosts distintos para 3DS y pagos en prod', () => {
  const qa = urlsDe('pruebas')
  assert.match(qa.tds, /lab\.cardnet\.com\.do/)
  assert.match(qa.pagos, /lab\.cardnet\.com\.do/)

  const prod = urlsDe('produccion')
  assert.match(prod.tds, /^https:\/\/servicios\.cardnet\.com\.do/)
  assert.match(prod.pagos, /^https:\/\/ecommerce\.cardnet\.com\.do/)
})
