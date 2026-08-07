import { test } from 'node:test'
import assert from 'node:assert/strict'
import { safeInternalPath } from '../src/lib/utils'

// Fase 4 · el parámetro `?retorno=` de la conversión desde el mapa viaja por
// varias pantallas; todas lo pasan por safeInternalPath (misma regla anti-open
// redirect que el `next` del login). Aquí se fija el contrato.

test('ruta interna válida se conserva', () => {
  assert.equal(
    safeInternalPath('/cliente/empresas/lava-x?sucursal=s1&origen=cerca', '/cliente/planes'),
    '/cliente/empresas/lava-x?sucursal=s1&origen=cerca'
  )
})

test('ruta raíz se conserva', () => {
  assert.equal(safeInternalPath('/', '/cliente/planes'), '/')
})

test('rutas externas caen al fallback', () => {
  assert.equal(safeInternalPath('https://evil.com', '/cliente/planes'), '/cliente/planes')
  assert.equal(safeInternalPath('//evil.com', '/cliente/planes'), '/cliente/planes')
  assert.equal(safeInternalPath('javascript:alert(1)', '/cliente/planes'), '/cliente/planes')
})

test('trucos protocol-relative con backslash también caen al fallback', () => {
  assert.equal(safeInternalPath('/\\evil.com', '/cliente/planes'), '/cliente/planes')
})

test('valores vacíos o ausentes caen al fallback', () => {
  assert.equal(safeInternalPath(null, '/cliente/planes'), '/cliente/planes')
  assert.equal(safeInternalPath(undefined, '/cliente/planes'), '/cliente/planes')
  assert.equal(safeInternalPath('', '/cliente/planes'), '/cliente/planes')
})

test('fallback propio se respeta', () => {
  assert.equal(safeInternalPath('http://x', '/cliente/cerca'), '/cliente/cerca')
})
