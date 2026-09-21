import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { MOTIVOS_DENEGADO, mensajeDenegado } from '../src/modules/plataforma/acceso'

/**
 * La sección «Tus aplicaciones» de /admin/integraciones.
 *
 * Lo que se vigila aquí es el fallo que hizo falta esta pantalla: un sistema
 * registrado que no aparece y NADIE dice por qué. El diagnóstico acabó siendo
 * abrir la base de datos a mano, y eso no escala a la segunda empresa.
 *
 * La tarjeta apagada traduce el motivo a una frase. Si alguien añade un motivo
 * de denegación nuevo en `acceso.ts` y no lo traduce, la tarjeta pintaría
 * `undefined` —volviendo al silencio— y esta prueba falla antes.
 */

const FUENTE = readFileSync(
  new URL('../src/components/integraciones/AplicacionesConectadas.tsx', import.meta.url),
  'utf8'
)

test('cada motivo de denegación tiene una frase en la tarjeta', () => {
  for (const motivo of MOTIVOS_DENEGADO) {
    assert.ok(
      new RegExp(`^\\s*${motivo}:`, 'm').test(FUENTE),
      `el motivo ${motivo} no tiene frase en AplicacionesConectadas`
    )
  }
})

test('el motivo de nivel de usuario también se traduce', () => {
  // `USUARIO_SIN_ACCESO` no es un motivo de empresa: sale de `UsuarioSistema`
  // y solo existe en esta pantalla, así que no lo cubre el recorrido anterior.
  assert.ok(/^\s*USUARIO_SIN_ACCESO:/m.test(FUENTE))
})

test('el mensaje de empresa sigue siendo grueso para cada motivo', () => {
  // Lo que ve quien pulsa el botón no puede convertirse en un oráculo de la
  // configuración de la plataforma; el detalle vive en la tarjeta, que solo se
  // le enseña a quien administra.
  for (const motivo of MOTIVOS_DENEGADO) {
    assert.equal(typeof mensajeDenegado(motivo), 'string')
    assert.ok(mensajeDenegado(motivo).length > 0)
  }
})

test('el detalle del motivo solo se pinta con diagnóstico', () => {
  // Sin esta condición, cualquier miembro del equipo leería cómo está
  // configurada la plataforma en una tarjeta que no puede accionar.
  assert.ok(
    /diagnostico && app\.motivo/.test(FUENTE),
    'la tarjeta debe exigir `diagnostico` para enseñar el motivo'
  )
  assert.ok(
    /aplicaciones\.filter\(\(a\) => a\.disponible\)/.test(FUENTE),
    'sin diagnóstico solo se listan las aplicaciones disponibles'
  )
})

test('abrir pasa por el endpoint que firma, nunca por la urlBase directa', () => {
  // Enlazar a `urlBase` a secas llevaría al satélite SIN token: el usuario
  // aterrizaría en su login, que es justo lo que el SSO existe para evitar.
  assert.ok(/\/api\/integraciones\/abrir\//.test(FUENTE))
  assert.ok(
    !/href=\{`\$\{app\.urlBase\}/.test(FUENTE),
    'la tarjeta no puede enlazar directo a la urlBase del satélite'
  )
})
