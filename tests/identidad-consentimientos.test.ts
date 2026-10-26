/**
 * Textos de consentimiento de identidad: lo que se muestra es lo que se registra,
 * y lo que se promete es lo que el sistema hace.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  RUTA_POLITICA_IDENTIDAD,
  TEXTOS_PUBLICADOS,
  TIPOS_CONSENTIMIENTO_IDENTIDAD,
  TIPOS_REQUERIDOS_PARA_CAPTURAR,
  VERSION_VIGENTE,
  esTipoConsentimientoIdentidad,
  partirTextoIdentidad,
  renderizarTextoIdentidad,
} from '../src/modules/identidad/identidadConsentimientosCore'
import { POLITICA_IDENTIDAD } from '../src/modules/identidad/identidadCore'

test('cada tipo tiene una versión vigente y su texto publicado', () => {
  assert.equal(TIPOS_CONSENTIMIENTO_IDENTIDAD.length, 3)
  for (const tipo of TIPOS_CONSENTIMIENTO_IDENTIDAD) {
    const version = VERSION_VIGENTE[tipo]
    assert.ok(version, tipo)
    assert.ok(TEXTOS_PUBLICADOS[version], `falta el texto de ${version}`)
    assert.match(version, /-v\d+$/, 'la versión lleva número')
  }
  assert.equal(new Set(Object.values(VERSION_VIGENTE)).size, 3, 'tres versiones distintas')
  assert.equal(esTipoConsentimientoIdentidad('IDENTIDAD_BIOMETRIA'), true)
  assert.equal(esTipoConsentimientoIdentidad('OTRO'), false)
  assert.equal(esTipoConsentimientoIdentidad(undefined), false)
})

test('biometría y transferencia son obligatorias para capturar; la divulgación a empresas, no', () => {
  assert.deepEqual([...TIPOS_REQUERIDOS_PARA_CAPTURAR].sort(), ['IDENTIDAD_BIOMETRIA', 'IDENTIDAD_TRANSFERENCIA_INTERNACIONAL'])
  assert.ok(!TIPOS_REQUERIDOS_PARA_CAPTURAR.includes('IDENTIDAD_DIVULGACION_EMPRESAS'))
})

test('el texto de biometría cumple las condiciones del art. 58: informa, dice el propósito y el plazo, y es retirable', () => {
  const t = renderizarTextoIdentidad(VERSION_VIGENTE.IDENTIDAD_BIOMETRIA, { proveedor: 'Didit' })
  assert.match(t, /datos biométricos/, '(1) dice que se capturan datos biométricos')
  assert.match(t, /únicamente para verificar que soy el titular/, '(2) propósito específico')
  assert.match(t, /prevenir fraude/)
  assert.match(t, /elimina las imágenes y los datos biométricos/, 'dice qué pasa con lo capturado')
  assert.match(t, /retirar este permiso cuando quiera/, 'retirable')
  assert.match(t, /Didit/)
  assert.doesNotMatch(t, /\{proveedor\}/, 'sin marcas sin rellenar')
})

test('el plazo que se promete («3 años») es el que aplica el sistema', () => {
  const t = renderizarTextoIdentidad(VERSION_VIGENTE.IDENTIDAD_BIOMETRIA)
  const años = POLITICA_IDENTIDAD.validezMeses / 12
  assert.equal(años, 3)
  assert.match(t, new RegExp(`durante ${años} años`))
})

test('el texto de la divulgación promete lo mismo que hace la proyección: «verificado» y desde cuándo, nada de documentos', () => {
  const t = renderizarTextoIdentidad(VERSION_VIGENTE.IDENTIDAD_DIVULGACION_EMPRESAS)
  assert.match(t, /únicamente que estoy verificado y desde cuándo/)
  assert.match(t, /nunca mi cédula, mi selfie ni mi número de documento/)
})

test('el texto de transferencia internacional dice dónde se procesa y bajo qué condiciones', () => {
  const t = renderizarTextoIdentidad(VERSION_VIGENTE.IDENTIDAD_TRANSFERENCIA_INTERNACIONAL, { proveedor: 'Didit' })
  assert.match(t, /Unión Europea/)
  assert.match(t, /fuera de la República Dominicana/)
  assert.match(t, /seguridad, secreto y borrado/)
})

test('sin nombre de proveedor se usa uno genérico, y una versión inexistente LANZA (nunca un texto vacío)', () => {
  const t = renderizarTextoIdentidad(VERSION_VIGENTE.IDENTIDAD_BIOMETRIA, { proveedor: '  ' })
  assert.match(t, /el proveedor de verificación/)
  assert.throws(() => renderizarTextoIdentidad('identidad-inexistente-v9'), /no existe/)
})

test('título + detalle es el texto original partido: la casilla no muestra menos de lo que se registra', () => {
  for (const tipo of TIPOS_CONSENTIMIENTO_IDENTIDAD) {
    const t = renderizarTextoIdentidad(VERSION_VIGENTE[tipo], { proveedor: 'Didit' })
    const { titulo, detalle } = partirTextoIdentidad(t)
    assert.equal(detalle ? `${titulo} ${detalle}` : titulo, t)
    assert.ok(titulo.length > 10 && titulo.length < 120, `título de ${tipo}: «${titulo}»`)
  }
  assert.deepEqual(partirTextoIdentidad('Una sola frase'), { titulo: 'Una sola frase', detalle: '' })
})

test('los textos no prometen lo que el sistema no hace', () => {
  for (const [version, texto] of Object.entries(TEXTOS_PUBLICADOS)) {
    assert.doesNotMatch(texto, /garantiz|100 ?%|nunca (se )?comparte|totalmente seguro/i, version)
    assert.doesNotMatch(texto, /conserv\w+ (mi|su|la) (foto|selfie|cédula)/i, `${version}: no se conservan imágenes`)
  }
})

test('la sección de política que los textos incorporan es una ancla de /privacy', () => {
  assert.equal(RUTA_POLITICA_IDENTIDAD, '/privacy#verificacion-identidad')
})
