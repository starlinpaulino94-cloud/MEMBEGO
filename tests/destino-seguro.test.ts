import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { destinoInterno, destinoOPorDefecto, destinoParaRol } from '../src/lib/auth/destino-seguro'
import { ROLE_HOME, type AppRole } from '../src/types'

/**
 * DESTINOS DE RETORNO (`?redirect=` del login, `?next=` del registro).
 *
 * Las tres cosas que se prueban: que NADA externo pasa, que NADA del propio flujo
 * de acceso pasa (sería un bucle), y que TODO lo que el producto usa de verdad
 * sigue pasando. La tercera importa tanto como las otras: un validador tan
 * estricto que rompe «volver a la ficha tras iniciar sesión» no protege a nadie,
 * solo rompe la compra.
 */

test('rechaza todo lo que sale del sitio', () => {
  for (const malo of [
    'https://evil.example/robo',
    'http://evil.example',
    '//evil.example/robo',
    '///evil.example',
    '/\\evil.example',
    '\\\\evil.example',
    'javascript:alert(1)',
    'data:text/html,<script>1</script>',
    'evil.example',
    '',
    ' /cliente/inicio',
    '/cliente/inicio\n',
    '/cliente/inicio\r\nLocation: https://evil.example',
    '/cliente\u0000/x',
    '/%2F%2Fevil.example',
    '/%5Cevil.example',
    '/cliente/%0d%0aSet-Cookie:x=1',
    'x'.repeat(5000),
  ]) {
    assert.equal(destinoInterno(malo), null, JSON.stringify(malo))
  }
  for (const noTexto of [null, undefined, 42, {}, ['/cliente/inicio']]) assert.equal(destinoInterno(noTexto), null)
})

test('rechaza el propio flujo de acceso: un destino que vuelve al login es un bucle', () => {
  for (const bucle of ['/login', '/login?redirect=/cliente/inicio', '/acceso', '/registro', '/registro/cuenta', '/registro/mi-empresa', '/recuperar', '/actualizar-password', '/confirmar', '/auth/callback', '/api/v1/algo', '/_next/static/x', '/sso/entrar', '/e/vendedor', '/r/codigo']) {
    assert.equal(destinoInterno(bucle), null, bucle)
  }
})

test('la normalización no deja escapar de lo autorizado por rutas disfrazadas', () => {
  assert.equal(destinoInterno('/cliente/../login'), null)
  assert.equal(destinoInterno('/cliente/%2e%2e/login'), null)
  assert.equal(destinoInterno('/empresas/../../acceso'), null)
  // Llega a otro lugar AUTORIZADO, normalizado: es válido, y lo que se devuelve es lo normalizado.
  assert.equal(destinoInterno('/empresas/../cliente/inicio'), '/cliente/inicio')
})

test('rechaza rutas que no son de nadie, aunque sean internas', () => {
  for (const ajena of ['/', '/clientes/x', '/administrador', '/cualquier-cosa', '/.env', '/robots.txt', '/offline']) {
    assert.equal(destinoInterno(ajena), null, ajena)
  }
})

test('deja pasar todo lo que el producto usa de verdad, con su consulta y su ancla', () => {
  for (const bueno of [
    '/cliente/inicio',
    '/cliente/pedidos/abc123',
    '/cliente/explorar?ver=ofertas&q=aire%20acondicionado',
    '/cliente/empresas/tech-store/catalogo/airpods-pro',
    '/cliente/carrito',
    '/cliente/carrito/pagar/tech-store',
    '/cliente/vehiculos/nuevo?next=%2Fcliente%2Fplanes',
    '/cliente/empresas/tech-store#ofertas',
    '/mis-membresias',
    '/membresia/m1',
    '/admin/dashboard',
    '/admin/catalogo/abc',
    '/superadmin/dashboard',
    '/empleado/scanner',
    '/vendedor',
    '/onboarding',
    '/empresas/tech-store',
    '/empresas/tech-store/catalogo/airpods-pro',
    '/empresas/tech-store/excursiones/buceo?e=abc',
    '/catalogo?q=cable',
    '/ofertas',
    '/promociones/membego/oferta-x',
    '/promocion/clave1',
    '/oferta/COD123',
    '/plan/p1',
    '/checkout',
    '/carrito/pagar/tech-store',
    '/invitacion/token',
    '/i/ABC',
  ]) {
    assert.equal(destinoInterno(bueno), bueno, bueno)
  }
})

test('con respaldo: nunca devuelve null', () => {
  assert.equal(destinoOPorDefecto('https://evil.example', '/cliente/inicio'), '/cliente/inicio')
  assert.equal(destinoOPorDefecto('/cliente/pedidos', '/cliente/inicio'), '/cliente/pedidos')
})

test('por rol: cada rol solo recibe destinos de los espacios que puede abrir', () => {
  const casa = (r: AppRole) => ROLE_HOME[r]
  // Un cliente puede volver a su ficha y a las páginas públicas.
  assert.equal(destinoParaRol('/cliente/empresas/x/catalogo/y', 'CLIENTE', casa('CLIENTE')), '/cliente/empresas/x/catalogo/y')
  assert.equal(destinoParaRol('/empresas/x/catalogo/y', 'CLIENTE', casa('CLIENTE')), '/empresas/x/catalogo/y')
  // Un cliente no recibe el panel ni el superadmin.
  assert.equal(destinoParaRol('/admin/dashboard', 'CLIENTE', casa('CLIENTE')), casa('CLIENTE'))
  assert.equal(destinoParaRol('/superadmin/dashboard', 'CLIENTE', casa('CLIENTE')), casa('CLIENTE'))
  // Administradores y empleados no reciben el flujo de compra del cliente: van a su casa.
  for (const rol of ['ADMINISTRADOR', 'GERENTE', 'CAJERO', 'MARKETING', 'SUPERVISOR'] as AppRole[]) {
    assert.equal(destinoParaRol('/cliente/carrito', rol, casa(rol)), casa(rol), rol)
    assert.equal(destinoParaRol('/cliente/empresas/x/catalogo/y', rol, casa(rol)), casa(rol), rol)
    assert.equal(destinoParaRol('/admin/catalogo', rol, casa(rol)), '/admin/catalogo', rol)
  }
  for (const rol of ['RECEPCION', 'EMPLEADO'] as AppRole[]) {
    assert.equal(destinoParaRol('/cliente/inicio', rol, casa(rol)), casa(rol), rol)
    assert.equal(destinoParaRol('/empleado/caja', rol, casa(rol)), '/empleado/caja', rol)
    assert.equal(destinoParaRol('/admin/dashboard', rol, casa(rol)), casa(rol), rol)
  }
  assert.equal(destinoParaRol('/vendedor/reservas', 'VENDEDOR', casa('VENDEDOR')), '/vendedor/reservas')
  assert.equal(destinoParaRol('/cliente/inicio', 'VENDEDOR', casa('VENDEDOR')), casa('VENDEDOR'))
  // Lo externo cae a la casa de cualquier rol.
  for (const rol of Object.keys(ROLE_HOME) as AppRole[]) assert.equal(destinoParaRol('//evil.example', rol, casa(rol)), casa(rol))
})

test('la puerta del panel tiene dos llaves: un empleado con una sección concedida conserva su destino de /admin', () => {
  const casa = ROLE_HOME.EMPLEADO
  // Sin la concesión, el panel le queda cerrado y vuelve a su casa.
  assert.equal(destinoParaRol('/admin/clientes', 'EMPLEADO', casa), casa)
  assert.equal(destinoParaRol('/admin/clientes', 'EMPLEADO', casa, { puedeEntrarAlPanel: false }), casa)
  // Con ella (la calcula el proxy con `puedeEntrarAlPanel`), conserva el destino.
  assert.equal(destinoParaRol('/admin/clientes', 'EMPLEADO', casa, { puedeEntrarAlPanel: true }), '/admin/clientes')
  // La concesión abre /admin y NADA más: no abre el espacio del cliente ni el del superadmin.
  assert.equal(destinoParaRol('/cliente/carrito', 'EMPLEADO', casa, { puedeEntrarAlPanel: true }), casa)
  assert.equal(destinoParaRol('/superadmin/dashboard', 'EMPLEADO', casa, { puedeEntrarAlPanel: true }), casa)
  // Y un destino externo no se salva por tener la concesión.
  assert.equal(destinoParaRol('//evil.example', 'EMPLEADO', casa, { puedeEntrarAlPanel: true }), casa)
})

test('el proxy y el login calculan la llave del panel con los permisos del usuario', () => {
  for (const f of ['src/proxy.ts', 'src/modules/auth/loginActions.ts']) {
    const src = readFileSync(f, 'utf8')
    assert.match(src, /puedeEntrarAlPanel: puedeEntrarAlPanel\(role, resolverPermisosUsuario\(/, f)
  }
})

test('el destino de la casa de cada rol es siempre un destino válido y nunca el login (sin bucles)', () => {
  for (const [rol, casa] of Object.entries(ROLE_HOME)) {
    assert.equal(destinoInterno(casa), casa, `${rol}: su casa ${casa} debe ser un destino autorizado`)
  }
})

// ── Quién lo usa ───────────────────────────────────────────────────────────

test('todos los sitios que obedecen redirect/next pasan por el validador, sin comprobaciones propias', () => {
  const usan = [
    'src/proxy.ts',
    'src/modules/auth/loginActions.ts',
    'src/components/auth/LoginForm.tsx',
    'src/components/auth/RegisterForm.tsx',
    'src/components/auth/RegisterGeneralForm.tsx',
    'src/components/auth/AsistenteRegistro.tsx',
  ]
  for (const f of usan) {
    const src = readFileSync(f, 'utf8')
    assert.match(src, /destino-seguro/, `${f} debe usar el validador`)
    assert.doesNotMatch(src, /startsWith\('\/\/'\)/, `${f} no debe llevar su propia comprobación de «//»`)
  }
})

test('el registro clásico respeta ?next= igual que el asistente (también al confirmar el correo)', () => {
  const general = readFileSync('src/components/auth/RegisterGeneralForm.tsx', 'utf8')
  assert.match(general, /searchParams\.get\('next'\)/)
  assert.match(general, /nextSeguro \?\? '\/cliente\/celebracion'/)
  assert.match(general, /\/login\?verifica=1&redirect=\$\{encodeURIComponent\(nextSeguro\)\}/)
  const porEmpresa = readFileSync('src/components/auth/RegisterForm.tsx', 'utf8')
  assert.match(porEmpresa, /searchParams\.get\('next'\)/)
})

test('el login conserva el destino al pasar a «Regístrate»', () => {
  const login = readFileSync('src/components/auth/LoginForm.tsx', 'utf8')
  assert.match(login, /registro\/cuenta\?next=\$\{encodeURIComponent\(destinoRetorno\)\}/)
})

test('el proxy recuerda ruta Y consulta al mandar al login, y no duplica la consulta propia', () => {
  const proxy = readFileSync('src/proxy.ts', 'utf8')
  assert.match(proxy, /function haciaElLogin\(request: NextRequest, path: string\): URL/)
  assert.match(proxy, /const destino = path \+ request\.nextUrl\.search/)
  assert.match(proxy, /url\.search = ''/)
  // Los dos sitios que mandan al login pasan por el helper; ninguno arma el redirect a mano.
  assert.equal((proxy.match(/haciaElLogin\(request, path\)/g) ?? []).length, 2)
  assert.doesNotMatch(proxy, /url\.searchParams\.set\('redirect', path\)/)
})
