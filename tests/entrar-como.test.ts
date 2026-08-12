import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { huellaToken } from '../src/modules/superadmin/entrarComo'

/**
 * SUPLANTACIÓN: QUE QUEDE RASTRO, Y QUE EL RASTRO NO SEA UNA LLAVE.
 *
 * Dos exigencias que tiran en direcciones opuestas y por eso hay que fijar las
 * dos a la vez:
 *
 *  1. Al canjear el enlace tiene que quedar constancia, atribuida a QUIEN
 *     SUPLANTA. Antes solo se registraba que el enlace se había generado, así
 *     que todo lo que el suplantador hiciera después figuraba a nombre de la
 *     persona suplantada.
 *
 *  2. Para reconocer el enlace hay que guardar algo suyo — y ese «algo» no
 *     puede ser el token. El `hashed_token` de Supabase ES la credencial: quien
 *     lo tenga abre la sesión de esa persona. Guardarlo en `audit_logs`
 *     convertiría la bitácora, que se lee y se exporta a CSV, en un almacén de
 *     llaves vivas.
 */

const ACCIONES = readFileSync(join('src', 'modules', 'superadmin', 'accesoActions.ts'), 'utf8')
const USO = readFileSync(join('src', 'modules', 'superadmin', 'entrarComoUso.ts'), 'utf8')
const CONFIRMAR = readFileSync(join('src', 'app', '(auth)', 'confirmar', 'route.ts'), 'utf8')

test('la huella no es el token, y no se le parece', () => {
  const token = 'pkce_9f1c8a0b2d3e4f56'
  const h = huellaToken(token)
  assert.notEqual(h, token, 'la huella NO puede ser el token: sería guardar la credencial')
  assert.ok(!h.includes(token), 'la huella no puede contener el token')
  assert.match(h, /^[0-9a-f]{64}$/, 'SHA-256 en hexadecimal')
})

test('la misma entrada da siempre la misma huella', () => {
  // Si no fuera estable, el enlace nunca se reconocería al canjearse y el
  // registro de uso no se escribiría jamás — fallando en silencio.
  assert.equal(huellaToken('abc'), huellaToken('abc'))
  // El token viaja por una URL y vuelve; un espacio de más al copiar el enlace
  // a mano no puede romper la correspondencia.
  assert.equal(huellaToken(' abc\n'), huellaToken('abc'))
})

test('dos tokens distintos no comparten huella', () => {
  assert.notEqual(huellaToken('abc'), huellaToken('abd'))
})

test('al generar el enlace se guarda la huella, nunca el token', () => {
  const desde = ACCIONES.indexOf("accion: 'ENTRAR_COMO_GENERADO'")
  assert.notEqual(desde, -1)
  const bloque = ACCIONES.slice(desde, desde + 900)

  assert.match(bloque, /huella: huellaToken\(tokenHash\)/, 'el payload tiene que llevar la huella')

  // Fuera la única mención legítima; lo que quede sería el token en crudo.
  const resto = bloque.replaceAll('huellaToken(tokenHash)', '')
  assert.ok(
    !resto.includes('tokenHash'),
    'el `hashed_token` NO puede entrar en el payload de la bitácora: es la credencial'
  )
})

test('el registro de uso se atribuye a quien suplanta, no al suplantado', () => {
  assert.match(
    USO,
    /userId: generado\.userId/,
    'la línea tiene que ser del superadmin que generó el enlace; ' +
      'atribuirla al suplantado deja el mismo agujero que se venía a cerrar'
  )
  assert.match(
    USO,
    /entidadId: generado\.entidadId/,
    'y `entidadId` dice a quién se suplantó'
  )
})

test('el uso se registra DESPUÉS de canjear el token', () => {
  const verify = CONFIRMAR.indexOf('verifyOtp')
  const registro = CONFIRMAR.indexOf('registrarUsoEntrarComo(')
  assert.notEqual(registro, -1, '/confirmar tiene que registrar el uso del enlace')
  assert.ok(
    verify < registro,
    'registrar antes de verificar apuntaría también los intentos con enlaces gastados'
  )
})

test('solo se busca cuando el enlace puede serlo', () => {
  // `/confirmar` lo comparte la verificación de correo normal. Sin esta
  // condición, cada usuario que confirma su cuenta paga una consulta de más.
  assert.match(CONFIRMAR, /if \(type === 'magiclink'\) \{/)
})

/**
 * Y LA GUARDIA QUE DE VERDAD IMPORTA EN ESTE ARCHIVO.
 *
 * `/confirmar` es camino compartido: por aquí entra quien acaba de verificar su
 * correo. Escribir en la bitácora NO puede dejar a nadie fuera de su cuenta.
 * Las dos únicas salidas a `/login?error=verify` son las de siempre —faltan
 * parámetros, o el token no valió—, y las dos ocurren ANTES del registro.
 */
test('registrar en la bitácora no puede tumbar el inicio de sesión', () => {
  const salidas = [...CONFIRMAR.matchAll(/return loginError/g)].map((m) => m.index ?? -1)
  assert.equal(salidas.length, 2, 'aparecieron salidas de error nuevas en /confirmar; revísalas')

  const registro = CONFIRMAR.indexOf('registrarUsoEntrarComo(')
  for (const s of salidas) {
    assert.ok(s < registro, 'ninguna salida de error puede depender del registro de auditoría')
  }

  // Y el módulo se traga sus propios fallos en vez de propagarlos.
  assert.match(USO, /catch \(e\) \{/, 'registrarUsoEntrarComo tiene que capturar sus errores')
  assert.match(USO, /return false/, 'y devolver false en vez de lanzar')
})
