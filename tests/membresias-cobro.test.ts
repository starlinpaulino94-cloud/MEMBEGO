import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  METODOS_COBRO_MEMBRESIA,
  exigeReferencia,
  validarCobroMembresia,
} from '../src/modules/membresias/cobro'

/**
 * COBRO DE RENOVACIONES.
 *
 * Renovar escribe un INGRESO (`pagoConfirmado` + `montoPagado`), así que la
 * validación de aquí es lo único que separa un cobro real de un clic de más.
 */

test('sin declarar que se recibió el pago, no se puede renovar', () => {
  const problema = validarCobroMembresia({
    pagoRecibido: false,
    metodo: 'EFECTIVO',
    referencia: '',
  })
  assert.ok(problema, 'debe rechazar cuando no se confirmó el cobro')
})

test('el efectivo NO exige referencia; todo lo demás sí', () => {
  assert.equal(exigeReferencia('EFECTIVO'), false)
  assert.equal(exigeReferencia('efectivo'), false, 'no puede depender de mayúsculas')
  for (const m of METODOS_COBRO_MEMBRESIA.filter((x) => x !== 'EFECTIVO')) {
    assert.equal(exigeReferencia(m), true, `${m} deja rastro en un banco: necesita referencia`)
  }
})

test('una transferencia sin referencia se rechaza', () => {
  const problema = validarCobroMembresia({
    pagoRecibido: true,
    metodo: 'TRANSFERENCIA',
    referencia: '   ',
  })
  assert.match(problema ?? '', /referencia/i)
})

test('un método inventado se rechaza', () => {
  // El navegador puede mandar lo que quiera: el servidor no confía en el select.
  const problema = validarCobroMembresia({
    pagoRecibido: true,
    metodo: 'CRIPTO',
    referencia: 'x',
  })
  assert.ok(problema)
})

test('un cobro bien declarado pasa', () => {
  assert.equal(
    validarCobroMembresia({ pagoRecibido: true, metodo: 'EFECTIVO', referencia: '' }),
    null
  )
  assert.equal(
    validarCobroMembresia({ pagoRecibido: true, metodo: 'TARJETA', referencia: 'AUTH-9931' }),
    null
  )
})
