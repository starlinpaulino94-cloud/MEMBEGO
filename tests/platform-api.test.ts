import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { SCOPES, SCOPES_POR_CAPABILITY } from '../src/modules/plataforma/conceptos'
import { camposPermitidos } from '../src/modules/plataforma/proyecciones'
import {
  hashearSecreto,
  nuevoClientId,
  nuevoClientSecret,
  scopesEfectivos,
  scopesPedidos,
  secretoValido,
} from '../src/modules/plataforma/credenciales'
import {
  TTL_TOKEN_SEGUNDOS,
  crearToken,
  tokenDeCabecera,
  verificarToken,
} from '../src/modules/plataforma/token'
import { CODIGOS_ERROR } from '../src/modules/plataforma/errores'
import { CAMPOS_DTO, customerDTO, desviacionesDelContrato } from '../src/modules/plataforma/dto'

/**
 * API DE PLATAFORMA v1 (Fase 2).
 *
 * Es la primera puerta de ENTRADA que tiene MembeGo: hasta ahora los satélites
 * recibían webhooks y podían abrir sesión, pero no podían preguntar nada. Todo
 * lo que decide si una petición pasa es puro y está aquí.
 */

const FIRMA = 'clave-de-firma-de-pruebas-con-longitud-suficiente'

// ── Secretos ────────────────────────────────────────────────────────────────

test('el secreto correcto entra y cualquier otro no', () => {
  const secreto = nuevoClientSecret()
  const hash = hashearSecreto(secreto)
  assert.equal(secretoValido(secreto, hash), true)
  assert.equal(secretoValido(secreto + 'x', hash), false)
  assert.equal(secretoValido('', hash), false)
})

test('el mismo secreto produce hashes distintos', () => {
  // Sal por credencial: sin ella, dos sistemas con el mismo secreto tendrían el
  // mismo hash y una tabla precalculada valdría para los dos a la vez.
  const secreto = nuevoClientSecret()
  assert.notEqual(hashearSecreto(secreto), hashearSecreto(secreto))
})

test('el hash almacenado no contiene el secreto', () => {
  const secreto = nuevoClientSecret()
  const hash = hashearSecreto(secreto)
  assert.ok(!hash.includes(secreto))
  assert.ok(hash.startsWith('scrypt$'), 'el formato debe declarar el algoritmo y su coste')
})

test('un hash corrupto niega el acceso en vez de reventar', () => {
  // Una fila mal escrita a mano no puede convertirse en un 500 —ni, peor, en un
  // `true` por caer en una rama de error mal escrita.
  for (const basura of ['', 'x', 'scrypt$', 'scrypt$a$b$c$d$e', 'bcrypt$1$2$3$4$5', '$$$$$']) {
    assert.equal(secretoValido('lo-que-sea', basura), false, `"${basura}"`)
  }
})

test('un coste absurdo en la fila no bloquea el proceso', () => {
  // scrypt con N enorme tarda minutos y reserva gigas. Escrito en la base, sería
  // una denegación de servicio que se dispara con una sola petición.
  const veneno = `scrypt$${1 << 25}$8$1$${Buffer.from('sal').toString('base64')}$${Buffer.from('x').toString('base64')}`
  const antes = Date.now()
  assert.equal(secretoValido('lo-que-sea', veneno), false)
  assert.ok(Date.now() - antes < 1000, 'el tope de coste no se está aplicando')
})

test('los identificadores llevan prefijo reconocible', () => {
  // Un secreto pegado por error en un chat tiene que identificarse de un
  // vistazo como algo que hay que rotar.
  assert.match(nuevoClientId(), /^mgc_[0-9a-f]{24}$/)
  assert.match(nuevoClientSecret(), /^mgs_[\w-]{20,}$/)
})

// ── Token ───────────────────────────────────────────────────────────────────

test('un token recién emitido vale y trae lo que se le puso', () => {
  const { token, expiraEn } = crearToken(FIRMA, { cid: 'mgc_1', scopes: ['customers:read'] })
  assert.equal(expiraEn, TTL_TOKEN_SEGUNDOS)
  const v = verificarToken(FIRMA, token)
  assert.ok(v.ok)
  assert.equal(v.datos.cid, 'mgc_1')
  assert.deepEqual(v.datos.scopes, ['customers:read'])
})

test('el token NO lleva la empresa dentro', () => {
  // Regla §94: el `companyId` de una petición se valida contra las
  // habilitaciones, siempre. Si viajara firmado dentro del token, saltarse esa
  // comprobación parecería razonable el primer día que alguien optimice.
  const { token } = crearToken(FIRMA, { cid: 'mgc_1', scopes: [] })
  const payload = JSON.parse(
    Buffer.from(token.slice(0, token.lastIndexOf('.')), 'base64url').toString('utf8')
  ) as Record<string, unknown>
  assert.ok(!('companyId' in payload), 'el token no puede llevar la empresa')
  assert.ok(!('empresa' in payload))
})

test('otra clave de firma no abre el token', () => {
  const { token } = crearToken(FIRMA, { cid: 'mgc_1', scopes: [] })
  const v = verificarToken('otra-clave-igual-de-larga-pero-distinta', token)
  assert.deepEqual(v, { ok: false, fallo: 'BAD_SIGNATURE' })
})

test('un token manipulado no vale, aunque el JSON sea válido', () => {
  // El caso que importa: alguien reescribe el cuerpo para darse más scopes.
  const cuerpo = Buffer.from(
    JSON.stringify({ cid: 'mgc_1', scopes: ['benefits:redeem'], exp: 2_000_000_000, iat: 1 }),
    'utf8'
  ).toString('base64url')
  const { token: legitimo } = crearToken(FIRMA, { cid: 'mgc_1', scopes: [] })
  const firmaAjena = legitimo.slice(legitimo.lastIndexOf('.') + 1)
  const v = verificarToken(FIRMA, `${cuerpo}.${firmaAjena}`)
  assert.deepEqual(v, { ok: false, fallo: 'BAD_SIGNATURE' })
})

test('caducado y malformado son fallos DISTINTOS', () => {
  // El satélite tiene que ramificar: ante EXPIRED pide otro token y sigue; ante
  // MALFORMED hay algo mal configurado y reintentar en bucle solo gasta cuota.
  const ahora = 1_000_000
  const { token } = crearToken(FIRMA, { cid: 'mgc_1', scopes: [] }, ahora)
  const vencido = verificarToken(FIRMA, token, ahora + TTL_TOKEN_SEGUNDOS + 1)
  assert.deepEqual(vencido, { ok: false, fallo: 'EXPIRED' })

  assert.equal(verificarToken(FIRMA, 'sin-punto').ok, false)
  assert.equal(verificarToken(FIRMA, '').ok, false)
})

test('la cabecera Bearer se lee con tolerancia y sin inventar', () => {
  assert.equal(tokenDeCabecera('Bearer abc'), 'abc')
  assert.equal(tokenDeCabecera('bearer   abc'), 'abc')
  assert.equal(tokenDeCabecera('  Bearer abc  '), 'abc')
  assert.equal(tokenDeCabecera('Basic abc'), null)
  assert.equal(tokenDeCabecera('abc'), null)
  assert.equal(tokenDeCabecera(null), null)
})

// ── Scopes ──────────────────────────────────────────────────────────────────

test('los scopes efectivos son una intersección, nunca una suma', () => {
  // Un token no puede darse permisos que la credencial no tiene. Es la
  // diferencia entre pedir menos (legítimo) y pedir más (escalada).
  assert.deepEqual(
    scopesEfectivos(['customers:read', 'benefits:redeem'], ['customers:read']),
    ['customers:read']
  )
  assert.deepEqual(scopesEfectivos(['benefits:redeem'], ['customers:read']), [])
})

test('recortar la credencial surte efecto sin esperar a que caduque el token', () => {
  // La razón de que la intersección se recalcule en cada petición. Si los
  // scopes efectivos se fijaran al emitir, quitar `benefits:redeem` sería una
  // intención con quince minutos de retraso.
  const delToken = ['customers:read', 'benefits:redeem']
  assert.ok(scopesEfectivos(delToken, ['customers:read', 'benefits:redeem']).includes('benefits:redeem'))
  assert.ok(!scopesEfectivos(delToken, ['customers:read']).includes('benefits:redeem'))
})

test('sin `scope` se piden todos los de la credencial', () => {
  const dela = ['customers:read', 'branches:read']
  assert.deepEqual(scopesPedidos(null, dela), dela)
  assert.deepEqual(scopesPedidos('   ', dela), dela)
})

test('un scope desconocido se descarta sin tumbar la petición', () => {
  // Un satélite escrito contra una versión más nueva del estándar tiene que
  // seguir funcionando con los scopes que sí existen aquí.
  const pedidos = scopesPedidos('customers:read inventado:total', ['customers:read'])
  assert.deepEqual(pedidos, ['customers:read'])
})

test('todo scope de una capability existe en el vocabulario', () => {
  // Une la Fase 1a con esta: si alguien añade una capability con un scope nuevo
  // y olvida declararlo, el token no podría pedirlo nunca y el 403 no diría por
  // qué.
  const vocabulario = new Set<string>(SCOPES)
  for (const [capability, scopes] of Object.entries(SCOPES_POR_CAPABILITY)) {
    for (const s of scopes) {
      assert.ok(vocabulario.has(s), `"${capability}" declara un scope inexistente: "${s}"`)
    }
  }
})

// ── Contrato de error ───────────────────────────────────────────────────────

test('cada código de error tiene el estado HTTP que le corresponde', () => {
  assert.equal(CODIGOS_ERROR.INVALID_TOKEN, 401)
  assert.equal(CODIGOS_ERROR.TOKEN_EXPIRED, 401)
  // 403 y no 401: sabemos quién es; lo que no puede es esto. Un satélite que
  // reciba 401 pedirá otro token en bucle y nunca resolverá un problema de
  // permisos.
  assert.equal(CODIGOS_ERROR.INSUFFICIENT_SCOPE, 403)
  assert.equal(CODIGOS_ERROR.COMPANY_NOT_ENTITLED, 403)
  assert.equal(CODIGOS_ERROR.RATE_LIMITED, 429)
  assert.equal(CODIGOS_ERROR.PLATFORM_API_UNCONFIGURED, 503)
})

test('los códigos son MAYÚSCULAS estables, no frases', () => {
  for (const code of Object.keys(CODIGOS_ERROR)) {
    assert.match(code, /^[A-Z][A-Z_]+$/, `"${code}" no tiene forma de código estable`)
  }
})

// ── DTOs y minimización ─────────────────────────────────────────────────────

/**
 * LA PRUEBA QUE ATA LAS DOS FASES.
 *
 * La Fase 1a declaró qué campos puede COPIAR un vertical de cada entidad. La
 * API tiene que emitir exactamente esos. Sin esta comprobación serían dos
 * listas escritas por separado que empiezan iguales y se separan a la tercera
 * semana — y el satélite guardaría un campo que el contrato prohíbe proyectar
 * sin saber que no debía.
 */
test('los DTOs emiten exactamente los campos del contrato de proyección', () => {
  assert.deepEqual(desviacionesDelContrato(), [])
})

test('el DTO de cliente no deja escapar nada del modelo', () => {
  // `Cliente` tiene cuarenta columnas. La forma de que no salgan es que el DTO
  // se construya campo a campo, no con un spread.
  const dto: Record<string, unknown> = { ...customerDTO({
    id: 'c1',
    nombre: 'Ana',
    email: 'ana@example.com',
    telefono: '809-555-0000',
  }) }

  assert.deepEqual(Object.keys(dto).sort(), ['email', 'id', 'nombre', 'telefono'])
  for (const prohibido of ['supabaseId', 'cardnetCustomerId', 'fechaNacimiento', 'canalOrigen']) {
    assert.ok(!(prohibido in dto), `"${prohibido}" no puede salir del Core`)
  }
})

test('ningún DTO expone identidad del proveedor ni datos de pago', () => {
  const prohibidos = ['supabaseId', 'cardnetCustomerId', 'password', 'secreto', 'token']
  for (const [entidad, campos] of Object.entries(CAMPOS_DTO)) {
    for (const c of campos) {
      assert.ok(!prohibidos.includes(c), `"${entidad}" expone "${c}"`)
    }
  }
})

test('la elegibilidad de beneficios sigue sin poder proyectarse', () => {
  // Sigue siendo cierto después de abrir la API: no hay DTO de elegibilidad
  // porque no se copia, se pregunta.
  assert.deepEqual([...camposPermitidos('BenefitEligibility')], [])
  assert.ok(!('BenefitEligibility' in CAMPOS_DTO))
})

// ── Guardias sobre las rutas ────────────────────────────────────────────────

function rutasPlataforma(): string[] {
  const raiz = join('src', 'app', 'api', 'platform')
  const acc: string[] = []
  const recorrer = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e)
      if (statSync(p).isDirectory()) recorrer(p)
      else if (e === 'route.ts') acc.push(p)
    }
  }
  recorrer(raiz)
  return acc
}

/**
 * LA GUARDIA QUE IMPORTA.
 *
 * Toda ruta de la API v1 pasa por la guardia. La forma más fácil de escribir
 * una fuga entre empresas es leer `searchParams.get('companyId')` y usarlo
 * directamente en un `where`: funciona, no da error, y devuelve los clientes de
 * otro negocio como si fueran propios.
 *
 * Aquí se exige que el `companyId` de la red pase SIEMPRE por
 * `autenticarSobreEmpresa`, que es quien lo contrasta con las habilitaciones.
 */
test('ninguna ruta usa el companyId de la red sin validarlo', () => {
  const infractores: string[] = []

  for (const ruta of rutasPlataforma()) {
    const src = readFileSync(ruta, 'utf8')
    if (!src.includes("companyId")) continue
    // El endpoint de token no habla de empresas; el resto sí.
    if (src.includes('autenticarSobreEmpresa') || src.includes('autorizarEmpresa')) continue
    if (/searchParams\.get\(\s*['"]companyId['"]\s*\)/.test(src) || /params.*companyId/.test(src)) {
      infractores.push(ruta)
    }
  }

  assert.deepEqual(
    infractores,
    [],
    'Estas rutas leen un companyId de la petición sin contrastarlo con las ' +
      'habilitaciones del sistema. Usa autenticarSobreEmpresa:\n' + infractores.join('\n')
  )
})

/**
 * Solo dos rutas pueden ser públicas, y las dos por el mismo motivo: son las
 * que hacen falta ANTES de tener credenciales.
 *
 *   · `oauth/token` reparte credenciales; no puede exigirlas.
 *   · `.well-known/keys` publica la clave pública con la que se verifican los
 *     webhooks — que llegan antes de que nadie configure nada, y pedir un token
 *     para obtenerla sería un círculo.
 *   · `openapi` describe la FORMA de la API, no sus datos. Quien integra tiene
 *     que poder importarla en Postman o Zapier ANTES de tener credenciales, y
 *     pedir un token para leer la documentación es el mismo círculo. No revela
 *     nada que no se averigüe probando rutas: qué recursos existen y qué
 *     permiso pide cada uno.
 *
 * La prueba de abajo impide que la exención sea una puerta: ninguna de las
 * tres puede tocar la base.
 */
const PUBLICAS = [join('oauth', 'token'), join('.well-known', 'keys'), join('v1', 'openapi')]

const esPublica = (ruta: string) => PUBLICAS.some((p) => ruta.includes(p))

/**
 * Autenticarse no es solo `autenticar()`.
 *
 * `diag` es una herramienta de operación (huella del secreto de firma, prueba
 * de ida y vuelta) que no la usa un satélite sino una persona: pide sesión de
 * SUPERADMIN, igual que el diagnóstico de CardNET. Eso es autenticación, y
 * más estricta que la de la API — pero no pasa por la guardia de satélites.
 *
 * Nació PÚBLICA, que es lo que esta prueba destapó: cualquiera en internet
 * podía leer la longitud del secreto y su huella. Se cerró en la Fase 6 de
 * Connect. Se acepta la forma, no la ruta: cualquier otra que se autentique
 * así también pasa, y la que no se autentique de ninguna manera sigue sin
 * pasar.
 */
const seAutentica = (src: string) =>
  src.includes('autenticar') || (src.includes('getUser()') && src.includes('SUPERADMIN'))

test('toda ruta de la API v1 se autentica', () => {
  const sinGuardia = rutasPlataforma().filter((r) => {
    if (esPublica(r)) return false
    return !seAutentica(readFileSync(r, 'utf8'))
  })
  assert.deepEqual(sinGuardia, [], `rutas sin autenticación:\n${sinGuardia.join('\n')}`)
})

/**
 * La exención anterior sería una puerta abierta si bastara con declararla. Aquí
 * se comprueba: una ruta pública NO puede tocar la base. Si algún día alguien
 * añade una consulta a `.well-known`, esto lo para — y no porque la lista diga
 * que es pública, sino porque leer datos y no pedir credenciales no pueden ser
 * ciertas a la vez.
 */
test('una ruta pública no puede leer datos', () => {
  const infractoras = rutasPlataforma().filter((r) => {
    if (!esPublica(r) || r.includes(join('oauth', 'token'))) return false
    const src = readFileSync(r, 'utf8')
    return src.includes('conEmpresa') || src.includes('sinEmpresa') || src.includes('prisma')
  })
  assert.deepEqual(
    infractoras,
    [],
    `estas rutas son públicas Y consultan la base:\n${infractoras.join('\n')}`
  )
})

test('ninguna respuesta de la API v1 se puede cachear', () => {
  // Toda respuesta va acotada a UNA empresa. Un intermediario que la guarde se
  // la sirve al siguiente que pregunte, que puede ser otro sistema.
  //
  // Se comprueba en los DOS sitios donde se decide: los envoltorios —que es de
  // donde sale casi todo— y cada ruta que construya su respuesta a mano. Mirar
  // solo las rutas dejaría pasar el día que alguien quite el `no-store` del
  // envoltorio y las treinta respuestas se vuelvan cacheables a la vez.
  const envoltorios = readFileSync(join('src', 'modules', 'plataforma', 'errores.ts'), 'utf8')
  const conNoStore = [...envoltorios.matchAll(/'Cache-Control':\s*'no-store'/g)]
  assert.equal(conNoStore.length, 2, 'errorApi y respuestaApi deben poner no-store cada uno')

  const sinNoStore = rutasPlataforma().filter((r) => {
    // La clave pública es pública y no cambia: cachearla es lo correcto, y
    // además es lo que hace que una rotación se propague sola a los satélites
    // que la leen de aquí en vez de copiarla a su `.env`. La prueba anterior
    // garantiza que esta ruta no puede leer datos, así que no hay nada de
    // ninguna empresa que un intermediario pueda guardar.
    if (r.includes(join('.well-known', 'keys'))) return false
    const src = readFileSync(r, 'utf8')
    if (!/NextResponse\.json\(/.test(src)) return false // solo usa los envoltorios
    return !src.includes("'no-store'")
  })
  assert.deepEqual(sinNoStore, [], `rutas que responden a mano sin no-store:\n${sinNoStore.join('\n')}`)
})

test('el endpoint de token no filtra por qué falló', () => {
  // Cliente inexistente, secreto incorrecto, credencial revocada y credencial
  // caducada tienen que ser el MISMO error, o este endpoint se convierte en una
  // forma de averiguar qué client_id existen.
  const src = readFileSync(
    join('src', 'app', 'api', 'platform', 'v1', 'oauth', 'token', 'route.ts'),
    'utf8'
  )
  const codigosDeFallo = [...src.matchAll(/errorApi\('([A-Z_]+)'/g)].map((m) => m[1])
  const deCredencial = codigosDeFallo.filter((c) => c === 'INVALID_CLIENT')
  assert.equal(deCredencial.length, 1, 'debe haber UNA sola salida para todos los fallos de credencial')
  assert.ok(
    !/errorApi\('NOT_FOUND'/.test(src),
    'un 404 aquí confirmaría que el client_id no existe'
  )
  assert.ok(src.includes('HASH_SENUELO'), 'sin señuelo, el tiempo de respuesta es el oráculo')
})
