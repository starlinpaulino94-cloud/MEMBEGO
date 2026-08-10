import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CODIGOS_ERROR } from '@membego/contracts'
import { crearTokenSSO, verificarTokenSSO } from '../src/modules/integraciones/nucleo'
import { TTL_SSO_SEGUNDOS, nuevoJti, returnUrlValida } from '../src/modules/plataforma/sso-nucleo'

/**
 * SSO ENDURECIDO (Fase 5).
 *
 * Tres cosas que el SSO no tenía: uso único, el puesto del usuario dentro del
 * vertical, y una `returnUrl` que no se pueda manipular.
 */

const SECRETO = 'secreto-compartido-de-pruebas'

// ── returnUrl ───────────────────────────────────────────────────────────────

/**
 * LA PRUEBA QUE IMPIDE UN REDIRECTOR ABIERTO.
 *
 * Sin validar, `?returnUrl=https://sitio-malo/` haría que el usuario pulse un
 * enlace de MembeGo, MembeGo lo autentique y lo mande a donde diga el atacante
 * — con nuestra credibilidad detrás y un token válido en la URL.
 */
test('una returnUrl fuera del sistema se descarta', () => {
  const base = 'https://carwash.membego.com'
  assert.equal(returnUrlValida('https://sitio-malo.example/', base), null)
  assert.equal(returnUrlValida('//sitio-malo.example/', base), null)
  assert.equal(returnUrlValida('javascript:alert(1)', base), null)
  assert.equal(returnUrlValida('no-es-una-url', base), null)
})

/**
 * El fallo clásico: validar con `startsWith`.
 * `https://carwash.membego.com.malo/` empieza por la base y no tiene nada que
 * ver con ella. Por eso se compara ORIGEN, no prefijo de cadena.
 */
test('un dominio que EMPIEZA igual no es el mismo dominio', () => {
  const base = 'https://carwash.membego.com'
  assert.equal(returnUrlValida('https://carwash.membego.com.malo/x', base), null)
  assert.equal(returnUrlValida('https://carwash.membego.com.evil.io/', base), null)
  // Y un subdominio tampoco es el mismo origen.
  assert.equal(returnUrlValida('https://otro.carwash.membego.com/', base), null)
})

test('bajar de https a http se descarta', () => {
  // Un satélite en https que recibe una vuelta por http es una degradación
  // silenciosa, con el token en una URL sin cifrar.
  assert.equal(returnUrlValida('http://carwash.membego.com/x', 'https://carwash.membego.com'), null)
})

test('una returnUrl del propio sistema pasa', () => {
  const base = 'https://carwash.membego.com'
  assert.equal(returnUrlValida('https://carwash.membego.com/cola', base), 'https://carwash.membego.com/cola')
  // La base con barra final o con ruta no cambia el origen.
  assert.ok(returnUrlValida('https://carwash.membego.com/x?y=1', 'https://carwash.membego.com/'))
})

test('sin returnUrl no se inventa ninguna', () => {
  assert.equal(returnUrlValida(null, 'https://x.test'), null)
  assert.equal(returnUrlValida('', 'https://x.test'), null)
  assert.equal(returnUrlValida(undefined, 'https://x.test'), null)
})

// ── El token ────────────────────────────────────────────────────────────────

test('los campos nuevos viajan dentro de la firma', () => {
  // Si `systemRole` o `returnUrl` fueran a la query, cualquiera podría
  // cambiarlos: el rol para escalar dentro del satélite, la URL para redirigir.
  const exp = Math.floor(Date.now() / 1000) + TTL_SSO_SEGUNDOS
  const token = crearTokenSSO(SECRETO, {
    sub: 'u1', email: 'a@x.com', rol: 'EMPLEADO', companyId: 'e1', exp,
    jti: 'sso_abc', systemRole: 'MESERO', returnUrl: 'https://r.test/mesas',
  })
  const datos = verificarTokenSSO(SECRETO, token)
  assert.ok(datos)
  assert.equal(datos.jti, 'sso_abc')
  assert.equal(datos.systemRole, 'MESERO')
  assert.equal(datos.returnUrl, 'https://r.test/mesas')
})

test('manipular el rol invalida el token', () => {
  const exp = Math.floor(Date.now() / 1000) + TTL_SSO_SEGUNDOS
  const token = crearTokenSSO(SECRETO, {
    sub: 'u1', email: 'a@x.com', rol: 'EMPLEADO', companyId: 'e1', exp, systemRole: 'MESERO',
  })
  const [cuerpo, firma] = token.split('.')
  const payload = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8')) as Record<string, unknown>
  payload.systemRole = 'ADMIN'
  const falso = `${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')}.${firma}`
  assert.equal(verificarTokenSSO(SECRETO, falso), null)
})

test('un token sin los campos nuevos sigue siendo válido', () => {
  // Compatibilidad: los tokens que Car Wash ya sabe leer no cambian.
  const exp = Math.floor(Date.now() / 1000) + TTL_SSO_SEGUNDOS
  const token = crearTokenSSO(SECRETO, {
    sub: 'u1', email: 'a@x.com', rol: 'EMPLEADO', companyId: 'e1', exp,
  })
  const datos = verificarTokenSSO(SECRETO, token)
  assert.ok(datos)
  assert.equal(datos.jti, undefined)
  assert.equal(datos.systemRole, undefined)
})

test('el jti es único y reconocible', () => {
  const a = nuevoJti()
  const b = nuevoJti()
  assert.notEqual(a, b)
  assert.match(a, /^sso_[0-9a-f]{32}$/)
})

test('la vida del token sigue siendo corta', () => {
  // Es una credencial al portador dentro de una URL: cuanto más viva, más vale
  // capturarla del historial.
  assert.ok(TTL_SSO_SEGUNDOS <= 120, `${TTL_SSO_SEGUNDOS}s es demasiado para un token en una URL`)
})

// ── Uso único ───────────────────────────────────────────────────────────────

/**
 * El uso único se consigue con un INSERT sobre la clave primaria, no leyendo y
 * escribiendo. Comprobar antes y marcar después dejaría la ventana en la que
 * dos peticiones leen «sin usar» y las dos abren sesión — que es exactamente el
 * ataque que esto viene a impedir.
 */
test('el canje se registra con un INSERT, no con leer-y-escribir', () => {
  const src = readFileSync(join('src', 'modules', 'plataforma', 'sso.ts'), 'utf8')
  const marcar = src.slice(src.indexOf('export async function marcarTokenUsado'))
  assert.ok(marcar.includes('tokenSSOUsado.create'), 'debe ser un create')
  assert.ok(!marcar.includes('findUnique'), 'una lectura previa abre la ventana que esto cierra')
  assert.match(marcar, /P2002/, 'el duplicado se distingue por el código de la base')
})

test('la returnUrl se valida en un módulo puro, probable sin base de datos', () => {
  // Lo que decide si una redirección es segura no puede necesitar una conexión
  // para poder probarse: se probaría poco y se rompería sin ruido.
  // Se busca el IMPORT, no la palabra: el comentario del propio archivo explica
  // que no depende de `server-only`, y una guardia que no distinga texto de
  // código fallaría por su propia documentación.
  const src = readFileSync(join('src', 'modules', 'plataforma', 'sso-nucleo.ts'), 'utf8')
  assert.ok(!/^import 'server-only'/m.test(src))
  assert.ok(!/from '@\/lib\/tenant'/.test(src))
  assert.ok(src.includes('export function returnUrlValida'))
})

test('la migración hace del jti la clave primaria', () => {
  // Si fuera una columna única cualquiera, seguiría funcionando; si fuera un
  // índice no único, el uso único desaparecería sin que nada fallara.
  const sql = readFileSync(
    join('prisma', 'migrations', '20260806_sso_acceso_por_usuario', 'migration.sql'),
    'utf8'
  )
  assert.match(sql, /CONSTRAINT "tokens_sso_usados_pkey" PRIMARY KEY \("jti"\)/)
})

test('los dos caminos del SSO registran el canje', () => {
  // Entrante (satélite → MembeGo) y el canje del saliente. Si uno se olvidara,
  // el uso único sería una promesa a medias.
  const entrar = readFileSync(join('src', 'app', 'sso', 'entrar', 'route.ts'), 'utf8')
  assert.ok(entrar.includes('marcarTokenUsado'))
  assert.match(entrar, /direccion: 'ENTRANTE'/)

  const redeem = readFileSync(
    join('src', 'app', 'api', 'platform', 'v1', 'sso', 'redeem', 'route.ts'),
    'utf8'
  )
  assert.ok(redeem.includes('marcarTokenUsado'))
  assert.match(redeem, /direccion: 'SALIENTE'/)
})

test('un token sin jti no se rechaza: se avisa', () => {
  // Rechazarlo rompería a los satélites que ya funcionan, por no haber
  // desplegado algo que acabamos de publicar.
  const entrar = readFileSync(join('src', 'app', 'sso', 'entrar', 'route.ts'), 'utf8')
  assert.match(entrar, /sin jti \(sin uso único\)/)
})

test('el canje verifica con el secreto de QUIEN LLAMA', () => {
  // Un sistema no puede canjear un token emitido para otro: no lo verificaría,
  // porque no es su firma. Leer el secreto del sistema que aparezca EN el token
  // sería dejar que el token elija con qué se comprueba.
  const src = readFileSync(
    join('src', 'app', 'api', 'platform', 'v1', 'sso', 'redeem', 'route.ts'),
    'utf8'
  )
  assert.match(src, /where:\s*\{\s*id:\s*ctx\.sistemaId\s*\}/)
  assert.ok(src.includes('verificarTokenSSO(secreto.secreto, token)'))
})

test('el canje vuelve a comprobar la habilitación de la empresa', () => {
  // El token lleva la empresa firmada por nosotros, así que no puede haber sido
  // manipulada. Pero la habilitación pudo revocarse en los 90 s que lleva vivo.
  const src = readFileSync(
    join('src', 'app', 'api', 'platform', 'v1', 'sso', 'redeem', 'route.ts'),
    'utf8'
  )
  assert.ok(src.includes('autorizarEmpresa(ctx, datos.companyId)'))
})

test('los códigos de SSO tienen el estado que le toca a cada uno', () => {
  // 401 = tu token no vale (renueva el flujo). 409 = valía y ya se usó, que es
  // una historia distinta y a veces un incidente.
  assert.equal(CODIGOS_ERROR.SSO_TOKEN_INVALID, 401)
  assert.equal(CODIGOS_ERROR.SSO_TOKEN_ALREADY_USED, 409)
})

// ── El rol del vertical ─────────────────────────────────────────────────────

/**
 * LA REGLA §50. `systemRole` es una cadena que el Core guarda y transporta.
 * Un enum obligaría a desplegar MembeGo cada vez que un vertical inventara un
 * puesto — la dependencia que esta arquitectura existe para eliminar.
 */
test('el Core no enumera los roles de ningún vertical', () => {
  const prohibidos = ['MESERO', 'COCINA', 'LAVADOR', 'BARISTA', 'RECEPCION']
  for (const archivo of [
    join('src', 'modules', 'plataforma', 'sso.ts'),
    join('src', 'modules', 'plataforma', 'sso-nucleo.ts'),
    join('src', 'modules', 'integraciones', 'sso.ts'),
    join('src', 'modules', 'integraciones', 'nucleo.ts'),
  ]) {
    const src = readFileSync(archivo, 'utf8')
    // Solo se permiten en comentarios, como ejemplo de lo que puede llegar.
    const codigo = src
      .split('\n')
      .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
      .join('\n')
    for (const rol of prohibidos) {
      assert.ok(!codigo.includes(rol), `${archivo} conoce el rol "${rol}" de un vertical`)
    }
  }
})

test('el rol del vertical y el de MembeGo viajan por separado', () => {
  // Mezclarlos haría que el satélite tuviera que adivinar cuál está mirando, y
  // que un cambio de rol en MembeGo moviera permisos dentro del vertical.
  const src = readFileSync(
    join('src', 'app', 'api', 'platform', 'v1', 'sso', 'redeem', 'route.ts'),
    'utf8'
  )
  assert.match(src, /membegoRole:\s*datos\.rol/)
  assert.match(src, /systemRole:\s*datos\.systemRole/)
})

// ── Acceso por usuario ──────────────────────────────────────────────────────

test('el acceso por usuario nace desactivado', () => {
  // Exigir de golpe una fila por persona dejaría a toda la plantilla de Car
  // Wash fuera el día del despliegue.
  const esquema = readFileSync(join('prisma', 'schema', 'integraciones.prisma'), 'utf8')
  assert.match(esquema, /accesoPorUsuario Boolean @default\(false\)/)
  const sql = readFileSync(
    join('prisma', 'migrations', '20260806_sso_acceso_por_usuario', 'migration.sql'),
    'utf8'
  )
  assert.match(sql, /"accesoPorUsuario" BOOLEAN NOT NULL DEFAULT false/)
})

/**
 * Una suspensión explícita cierra la puerta SIEMPRE, también con el sistema en
 * modo abierto. Es la misma regla que en las habilitaciones de empresa: lo
 * explícito gana a la política. Al revés, suspender a alguien no haría nada y
 * el panel diría «suspendido» con la puerta abierta.
 */
test('una suspensión gana al modo abierto', () => {
  const src = readFileSync(join('src', 'modules', 'plataforma', 'sso.ts'), 'utf8')
  const fn = src.slice(src.indexOf('export async function accesoDeUsuario'))
  const suspendido = fn.indexOf("'SUSPENDED'")
  const politica = fn.indexOf('if (accesoPorUsuario)')
  assert.ok(suspendido > 0 && suspendido < politica, 'la suspensión debe mirarse antes que la política')
})

test('el lanzador devuelve TODOS los sistemas accesibles, no el primero', () => {
  // Con dos sistemas habilitados, elegir por el usuario es esconderle uno.
  const src = readFileSync(join('src', 'modules', 'integraciones', 'sso.ts'), 'utf8')
  assert.ok(src.includes('sistemasParaLanzador'))
  assert.ok(!src.includes('const [primero]'), 'ya no se queda con el primero')
})

test('el lanzador filtra por acceso del usuario, no solo por empresa', () => {
  const src = readFileSync(join('src', 'modules', 'integraciones', 'sso.ts'), 'utf8')
  const fn = src.slice(src.indexOf('export async function sistemasParaLanzador'))
  assert.ok(fn.includes('accesoDeUsuario'), 'un sistema habilitado no basta si la persona no entra')
})
