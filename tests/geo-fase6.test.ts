import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lineaDeEvento, saneaExtra } from '../src/modules/observabilidad/eventos'
import { redondearCoordenada } from '../src/modules/geo/eventos/core'

test('las coordenadas de analítica geo se redondean a precisión aproximada', () => {
  assert.equal(redondearCoordenada(18.486057), 18.49)
  assert.equal(redondearCoordenada(-69.931212), -69.93)
})

test('los eventos de latencia no incluyen parámetros personales', () => {
  const linea = lineaDeEvento({
    dominio: 'sistema',
    accion: 'geo_cercanos',
    ok: true,
    ms: 42,
    extra: {
      resultados: 8,
      correo: 'cliente@example.com',
      coordenada: '18.486,-69.931',
    },
  })

  assert.match(linea, /"ms":42/)
  assert.match(linea, /"resultados":8/)
  assert.doesNotMatch(linea, /cliente@example\.com/)
  assert.doesNotMatch(linea, /coordenada/)
})

test('saneaExtra conserva métricas simples y descarta identificadores', () => {
  assert.deepEqual(
    saneaExtra({ total: 12, cache_hit: true, correo: 'a@b.com', telefono: '8095551234' }),
    { total: 12, cache_hit: true }
  )
})
