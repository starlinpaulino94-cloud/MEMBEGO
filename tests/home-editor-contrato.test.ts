import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ComposicionInput } from '../src/modules/home/esquema'
import { leerSlidesEditor, fechaEditorialIso } from '../src/modules/home/editor-contrato'

test('un banner guardado conserva el tipo y el ID del destino al volver al editor', () => {
  const config = { slides: [{
    titulo: 'Plan mensual', subtitulo: '', empresaId: 'empresa-a', imagenUrl: null,
    ctaTexto: 'Ver plan', ctaDestino: { tipo: 'plan', id: 'plan-a' },
  }] }
  const slides = leerSlidesEditor(config)
  assert.equal(slides.length, 1)
  assert.equal(slides[0]?.ctaTipo, 'plan')
  assert.equal(slides[0]?.ctaId, 'plan-a')
})

test('un destino desconocido no se convierte silenciosamente en una empresa', () => {
  assert.throws(() => leerSlidesEditor({ slides: [{
    titulo: 'Oferta', empresaId: 'empresa-a', ctaTexto: 'Abrir',
    ctaDestino: { tipo: 'inventado', id: 'otro-id' },
  }] }))
})

test('la fecha del control local se convierte al instante ISO aceptado por el servidor', () => {
  const local = '2099-04-03T12:30'
  const hasta = fechaEditorialIso(local)
  const input = {
    territorio: 'Sucursal A',
    bloques: [
      { tipo: 'CABECERA', config: {} },
      { tipo: 'HERO', config: { slides: [{
        titulo: 'Oferta', empresaId: 'empresa-a', ctaTexto: 'Ver plan',
        ctaDestino: { tipo: 'plan', id: 'plan-a' },
      }] } },
    ],
    segmentacion: { membresia: 'CUALQUIERA', radioKm: 15, hasta },
  }
  assert.equal(ComposicionInput.safeParse(input).success, true)
  assert.equal(hasta, new Date(local).toISOString())
})

test('la ausencia de fecha sigue siendo null y una fecha inválida se rechaza', () => {
  assert.equal(fechaEditorialIso(''), null)
  assert.throws(() => fechaEditorialIso('no-es-fecha'))
})
