/**
 * VERIFICACIÓN DE IDENTIDAD · Fase 4 · las piezas del equipo y de la ficha del negocio se PINTAN (render del servidor).
 *
 * Sin base de datos ni navegador (el shim sustituye lo que solo existe dentro de Next). Comprueba lo que se ve:
 * la insignia del negocio dice «verificada» y nada más, y la acción con texto no permite confirmar en blanco.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
// El shim va PRIMERO: sustituye next/navigation, next/headers y server-only, que los componentes arrastran.
import '../scripts/supply-db/shim-next.mjs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { IdentidadVerificadaBadge } from '../src/components/admin/IdentidadVerificadaBadge'
import { AccionConTexto } from '../src/components/superadmin/identidad/AccionConTexto'

const texto = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ')
const accion = async () => ({})

test('LA INSIGNIA DEL NEGOCIO dice «Identidad verificada» y la fecha en el título; nada más', () => {
  const h = renderToStaticMarkup(React.createElement(IdentidadVerificadaBadge, { desde: '22 de octubre de 2026' }))
  const t = texto(h)
  assert.match(t, /Identidad verificada/)
  assert.match(h, /Identidad verificada por Membego el 22 de octubre de 2026/)
  assert.doesNotMatch(t, /rechaz|revisi|duplic|nivel|c[eé]dula|selfie|pasaporte|n[uú]mero/i)
  assert.doesNotMatch(h, /<img/)
})

test('LA INSIGNIA sin fecha no inventa una', () => {
  const h = renderToStaticMarkup(React.createElement(IdentidadVerificadaBadge, { desde: null }))
  assert.match(h, /title="Identidad verificada por Membego"/)
  assert.doesNotMatch(h, /undefined|null|Invalid/)
})

test('ACCIÓN CON TEXTO: en reposo es un solo botón, sin formulario ni campo; el motivo no se pide hasta pulsarlo', () => {
  const h = renderToStaticMarkup(React.createElement(AccionConTexto, { accion, campos: { intentoId: 'i1' }, boton: 'Rechazar el caso', etiquetaTexto: 'Motivo' }))
  const t = texto(h)
  assert.match(t, /Rechazar el caso/)
  assert.doesNotMatch(h, /<form|<textarea|<input/)
})

test('ACCIÓN SIN TEXTO (tomar una incidencia): un botón que envía el id oculto y no pide nada más', () => {
  const h = renderToStaticMarkup(React.createElement(AccionConTexto, { accion, campos: { incidenciaId: 'inc1', accion: 'tomar' }, boton: 'Tomar', etiquetaTexto: '', sinTexto: true }))
  assert.match(h, /<form/)
  assert.match(h, /type="hidden" name="incidenciaId" value="inc1"/)
  assert.match(h, /type="hidden" name="accion" value="tomar"/)
  assert.match(texto(h), /Tomar/)
  assert.doesNotMatch(h, /<textarea|type="text"|type="checkbox"/)
})

test('LA ACCIÓN PELIGROSA se marca como tal desde el primer botón (no se confunde con una acción normal)', () => {
  const normal = renderToStaticMarkup(React.createElement(AccionConTexto, { accion, campos: {}, boton: 'Pedir revalidación', etiquetaTexto: 'Motivo' }))
  const peligrosa = renderToStaticMarkup(React.createElement(AccionConTexto, { accion, campos: {}, boton: 'Borrar su identidad', etiquetaTexto: 'Motivo', peligrosa: true }))
  assert.doesNotMatch(normal, /text-destructive/)
  assert.match(peligrosa, /text-destructive/)
})
