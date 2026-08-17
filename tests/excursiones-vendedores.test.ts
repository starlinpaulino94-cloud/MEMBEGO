import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  prefijoDeEmpresa,
  codigoVendedor,
  validarVendedor,
  urlDeEnlace,
} from '../src/modules/excursiones/vendedores/nucleo'

/**
 * Excursiones · Fase 3 — la identidad del vendedor (código, enlace, QR) es
 * estable y nunca depende de datos que cambian. Estas pruebas fijan las
 * reglas del núcleo puro.
 */

test('el prefijo sale del nombre de la empresa, sin acentos ni símbolos', () => {
  assert.equal(prefijoDeEmpresa('Rafael IslandQuest'), 'RAF')
  assert.equal(prefijoDeEmpresa('Ébano Tours'), 'EBA')
  assert.equal(prefijoDeEmpresa('4x4 Aventura'), 'XAV')
  assert.equal(prefijoDeEmpresa('AB'), 'ABX') // corto: se rellena, no se rompe
  assert.equal(prefijoDeEmpresa('123 !!!'), 'VND') // sin letras: cae al defecto
})

test('el código es prefijo + correlativo de 5 dígitos y tolera entradas raras', () => {
  assert.equal(codigoVendedor('RAF', 125), 'RAF-00125')
  assert.equal(codigoVendedor('VND', 1), 'VND-00001')
  assert.equal(codigoVendedor('VND', 0), 'VND-00001') // nunca baja de 1
  assert.equal(codigoVendedor('VND', 99999), 'VND-99999')
})

test('el vendedor exige nombre y teléfono; el correo solo si viene, válido', () => {
  assert.equal(validarVendedor({ nombre: 'J' }).ok, false)
  assert.equal(validarVendedor({ nombre: 'Juan' }).ok, false) // sin teléfono no hay vendedor
  assert.equal(validarVendedor({ nombre: 'Juan', telefono: '809-555-0000', email: 'no-es-correo' }).ok, false)
  const r = validarVendedor({
    nombre: '  Juan  ',
    apellido: 'Pérez',
    telefono: '809-555-0000',
    email: 'JUAN@EJEMPLO.COM',
    tipo: 'Hotel',
  })
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal(r.datos.nombre, 'Juan')
    assert.equal(r.datos.email, 'juan@ejemplo.com') // normalizado a minúsculas
    assert.equal(r.datos.whatsapp, null) // opcional vacío = null, no ''
    assert.equal(r.datos.tipo, 'Hotel')
  }
})

test('la URL del enlace apunta a /e/[slug] sobre la base pública', () => {
  const url = urlDeEnlace('abc123xyz0')
  assert.ok(url.endsWith('/e/abc123xyz0'))
  assert.ok(url.startsWith('http'))
})
