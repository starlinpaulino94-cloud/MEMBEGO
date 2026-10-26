import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  COLOR_MARCA_POR_DEFECTO,
  PALETA_MARCA_EMPRESA,
  brandDisplayForeground,
  contrasteDeMarca,
  normalizeCompanyBrandColor,
  paletaDeMarca,
} from '../src/lib/company-branding'
import { CONTRASTE_AA } from '../packages/ui/src/ui/selector-color'

/**
 * LA PALETA CERRADA DEL COLOR DE EMPRESA (docs/auditoria-admin/04 · F-07, fase 4 · 4.6).
 *
 * El color de una empresa colorea SUS objetos (tarjetas, QR, comprobantes), nunca la interfaz del panel. Si la paleta tuviera
 * un color que no se lee con ninguna tinta, la empresa que lo eligiera tendría comprobantes ilegibles y nadie se lo diría.
 */

test('toda la paleta pasa por la normalización que guarda el color (nada que se rechace al guardar)', () => {
  for (const c of PALETA_MARCA_EMPRESA) {
    assert.equal(normalizeCompanyBrandColor(c.valor), c.valor, `${c.nombre} (${c.valor}) no es un hex normalizado`)
  }
})

test('el color por defecto es el primero de la paleta, y no hay repetidos', () => {
  assert.equal(PALETA_MARCA_EMPRESA[0].valor, COLOR_MARCA_POR_DEFECTO)
  assert.equal(new Set(PALETA_MARCA_EMPRESA.map((c) => c.valor)).size, PALETA_MARCA_EMPRESA.length)
  assert.equal(new Set(PALETA_MARCA_EMPRESA.map((c) => c.nombre)).size, PALETA_MARCA_EMPRESA.length)
})

test('cada color de la paleta se lee con su tinta: contraste AA (4,5:1) como mínimo', () => {
  for (const c of paletaDeMarca()) {
    assert.ok(c.razon >= CONTRASTE_AA, `${c.nombre} (${c.valor}) solo da ${c.razon.toFixed(2)}:1 con tinta ${c.tinta}`)
  }
})

test('la tinta que anuncia el selector es la que `brandDisplayForeground` pinta de verdad', () => {
  for (const c of PALETA_MARCA_EMPRESA) {
    const pintada = brandDisplayForeground(c.valor, COLOR_MARCA_POR_DEFECTO)
    assert.equal(contrasteDeMarca(c.valor).tinta, pintada === '#ffffff' ? 'claro' : 'oscuro', `${c.nombre}: el aviso contradice lo que se pinta`)
  }
})

test('el contraste calculado coincide con valores conocidos (blanco sobre negro = 21:1)', () => {
  const negro = contrasteDeMarca('#000000')
  assert.equal(negro.tinta, 'claro')
  assert.ok(Math.abs(negro.razon - 21) < 0.01, `blanco sobre negro debe dar 21:1, dio ${negro.razon}`)
  // Un color claro recibe tinta oscura y su razón es la de esa tinta, no la del blanco.
  const claro = contrasteDeMarca('#fde68a')
  assert.equal(claro.tinta, 'oscuro')
  assert.ok(claro.razon > 7, `ámbar claro con tinta oscura: ${claro.razon.toFixed(2)}`)
  // Entrada inválida: cae en el color por defecto, como el resto del producto.
  assert.deepEqual(contrasteDeMarca('no es un color'), contrasteDeMarca(COLOR_MARCA_POR_DEFECTO))
})
