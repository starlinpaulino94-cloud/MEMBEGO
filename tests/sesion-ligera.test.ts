import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { interpretarSesion, respuestaDeSesion } from '../src/lib/auth/sesion-ligera'
import { ROLE_HOME, type AppRole } from '../src/types'

/**
 * EL ESTADO DE SESIÓN QUE USA LA LANDING PARA ELEGIR SU ENLACE DE TRASPASO.
 *
 * No es autorización: decide qué enlace se muestra. Lo que sí importa aquí es (1) que
 * ni el endpoint ni su respuesta filtren nada de la persona, y (2) que ante cualquier
 * respuesta rara el estado sea «visitante», que es el estado cuyos enlaces funcionan
 * para todos.
 */

test('sin rol no hay sesión', () => {
  assert.deepEqual(respuestaDeSesion(undefined), { autenticado: false })
  assert.deepEqual(respuestaDeSesion(null), { autenticado: false })
})

test('con rol responde el rol y su casa, y nada más', () => {
  for (const rol of Object.keys(ROLE_HOME) as AppRole[]) {
    const r = respuestaDeSesion(rol)
    assert.deepEqual(Object.keys(r).sort(), ['autenticado', 'casa', 'rol'])
    assert.equal(r.autenticado && r.casa, ROLE_HOME[rol])
  }
})

test('un cliente es «cliente»; cualquier otro rol es «equipo» y trae su casa', () => {
  assert.deepEqual(interpretarSesion({ autenticado: true, rol: 'CLIENTE', casa: '/cliente/inicio' }), { estado: 'cliente', casa: '/cliente/inicio' })
  for (const rol of ['ADMINISTRADOR', 'GERENTE', 'CAJERO', 'MARKETING', 'SUPERVISOR', 'RECEPCION', 'EMPLEADO', 'VENDEDOR', 'SUPERADMIN'] as AppRole[]) {
    const s = interpretarSesion(respuestaDeSesion(rol))
    assert.equal(s.estado, 'equipo', rol)
    assert.equal(s.estado === 'equipo' && s.casa, ROLE_HOME[rol])
  }
})

test('la casa sale de la tabla del sistema, no de lo que diga la respuesta', () => {
  // Una respuesta manipulada no puede mandar a nadie a otra parte: la casa se recalcula.
  const s = interpretarSesion({ autenticado: true, rol: 'CLIENTE', casa: 'https://evil.example' })
  assert.deepEqual(s, { estado: 'cliente', casa: ROLE_HOME.CLIENTE })
})

test('ante cualquier respuesta rara, visitante', () => {
  for (const rara of [null, undefined, 42, 'x', [], {}, { autenticado: false }, { autenticado: 'true', rol: 'CLIENTE' }, { autenticado: true }, { autenticado: true, rol: 'SUPERHEROE' }, { autenticado: true, rol: 7 }]) {
    assert.deepEqual(interpretarSesion(rara), { estado: 'visitante' }, JSON.stringify(rara))
  }
})

test('el endpoint no se guarda en caché, no devuelve datos personales y sale de la misma función pura', () => {
  const ruta = readFileSync('src/app/api/v1/auth/sesion/route.ts', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.match(ruta, /no-store/)
  assert.match(ruta, /respuestaDeSesion\(user\?\.metadata\.role\)/)
  assert.doesNotMatch(ruta, /email|nombre|dbUserId|supabaseId|companyId/, 'la respuesta no puede incluir identidad')
  assert.match(ruta, /export async function GET\(/)
  assert.doesNotMatch(ruta, /export async function (POST|PUT|PATCH|DELETE)\(/, 'solo lectura')
})

test('el hook consulta una vez por página (caché corta) y sin credenciales ajenas', () => {
  const hook = readFileSync('src/components/public/useSesionLigera.ts', 'utf8')
  assert.match(hook, /VIGENCIA_MS/)
  assert.match(hook, /credentials: 'same-origin'/)
  assert.match(hook, /\/api\/v1\/auth\/sesion/)
  assert.match(hook, /catch\(\(\): SesionLigera => \(\{ estado: 'visitante' \}\)\)/, 'si falla la red, visitante')
})

test('el traspaso: el visitante va a login y registro con el destino; el cliente directo; el equipo, nunca a un flujo de compra', () => {
  const t = readFileSync('src/components/public/TraspasoALaApp.tsx', 'utf8')
  assert.match(t, /rutaDeLogin\(destino\)/)
  assert.match(t, /rutaDeRegistro\(destino\)/)
  // Equipo: solo su panel.
  const equipo = t.slice(t.indexOf("sesion.estado === 'equipo'"), t.indexOf("sesion.estado === 'cliente'"))
  assert.match(equipo, /Ir a mi panel/)
  assert.doesNotMatch(equipo, /destino|rutaDeLogin|rutaDeRegistro/, 'el equipo no recibe ningún enlace de compra')
  // `cargando` se pinta como visitante (los enlaces funcionan para cualquiera).
  assert.doesNotMatch(t, /estado === 'cargando'/)
})
