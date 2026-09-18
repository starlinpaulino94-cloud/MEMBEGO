import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { cardnetDisponible } from '../src/modules/pagos/cardnetTokenGate'

test('T19: CardNET falla cerrado sin llave privada aunque la capacidad este encendida', () => {
  assert.equal(
    cardnetDisponible({
      capacidadActiva: true,
      credencialesCompletas: false,
      empresaDemo: false,
    }),
    false
  )
})

test('T19: CardNET falla cerrado para una empresa demo con credenciales completas', () => {
  assert.equal(
    cardnetDisponible({
      capacidadActiva: true,
      credencialesCompletas: true,
      empresaDemo: true,
    }),
    false
  )
})

test('T19: la UI y el servidor comparten la misma compuerta fail-closed', () => {
  const metodos = readFileSync('src/modules/pagos/metodosDisponibles.ts', 'utf8')
  const cobro = readFileSync('src/modules/pagos/cardnetToken.ts', 'utf8')

  assert.match(metodos, /cardnetDisponible\(\{/)
  assert.match(cobro, /cardnetDisponible\(\{/)
})

test('T20: selector y widget aceptan membresia o compra como objetivo exclusivo', () => {
  const selector = readFileSync('src/components/membresia/OpcionesPago.tsx', 'utf8')
  const widget = readFileSync('src/components/membresia/PagoTokenCardnet.tsx', 'utf8')

  assert.match(selector, /objetivo:\s*ObjetivoPagoCliente/)
  assert.match(widget, /objetivo:\s*ObjetivoPagoCliente/)
  // NO usar flag `/s` (dotAll ES2018): target es ES2017 y el regex no tiene `.`.
  assert.match(widget, /type ObjetivoPagoCliente\s*=\s*\{\s*membershipId: string\s*\}\s*\|\s*\{\s*compraId: string\s*\}/)
})

test('T20: todas las operaciones del widget envian el objetivo seleccionado', () => {
  const widget = readFileSync('src/components/membresia/PagoTokenCardnet.tsx', 'utf8')

  for (const endpoint of ['cobrar', 'confirmar', 'activar']) {
    const inicio = widget.indexOf(`/api/pagos/cardnet-token/${endpoint}`)
    assert.ok(inicio > 0, `no se encontro la llamada a ${endpoint}`)
    assert.match(widget.slice(inicio, inicio + 900), /\.\.\.objetivo/)
  }
})
