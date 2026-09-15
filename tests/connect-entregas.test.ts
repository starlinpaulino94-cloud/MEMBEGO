import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  clasificarSonda,
  diagnosticarParaEmpresa,
  diagnosticarSonda,
  type CasoSonda,
  type RespuestaSonda,
} from '../src/modules/integraciones/diagnostico'
import { FUNCIONES_POR_SECCION } from '../src/lib/auth/funciones'
import { EVENTOS_CONECTOR } from '../src/modules/connect/bitacoraNucleo'

/**
 * REGISTRO DE ENTREGAS · hallazgo A-4 de la auditoría de integraciones.
 *
 * `entregas_webhook` guardaba todo lo necesario para depurar y no se enseñaba
 * en ninguna pantalla de empresa. Esto vigila las tres piezas que lo arreglan
 * —ver, probar y reenviar— y, sobre todo, que el diagnóstico siga teniendo UN
 * árbol de decisión y dos idiomas, y no dos árboles.
 */

const raiz = join(__dirname, '..')
const leer = (r: string) => readFileSync(join(raiz, r), 'utf8')
/** Sin comentarios: una guardia satisfecha por su propia documentación no vigila. */
const codigo = (r: string) =>
  leer(r)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

const R = (status: number, cuerpo = '', error?: string): RespuestaSonda => ({
  status,
  cuerpo,
  error,
})

const ENTREGAS = 'src/modules/connect/entregas.ts'
const ACCIONES = 'src/modules/connect/adminActions.ts'
const PAGINA = 'src/app/(admin)/admin/integraciones/desarrolladores/webhooks/[id]/page.tsx'

/** Un par (GET, POST) por cada caso del árbol. */
const CASOS: Array<[CasoSonda['caso'], RespuestaSonda, RespuestaSonda]> = [
  ['sin_conexion', R(0), R(0, '', 'timeout')],
  ['entregado', R(405), R(200)],
  ['dominio_sin_app', R(404, 'DEPLOYMENT_NOT_FOUND'), R(404, 'DEPLOYMENT_NOT_FOUND')],
  ['ruta_inexistente', R(404), R(404)],
  ['handler_404', R(405), R(404)],
  ['firma_rechazada', R(405), R(401)],
  ['sin_post', R(200), R(405)],
  ['error_interno', R(405), R(503)],
  ['inesperado', R(200), R(418, 'soy una tetera')],
]

// ─── Un árbol, dos vocabularios ──────────────────────────────────────────────

test('clasificar: cada situación cae en su caso, y no en el de al lado', () => {
  for (const [esperado, get, post] of CASOS) {
    assert.equal(
      clasificarSonda(get, post).caso,
      esperado,
      `(${get.status}, ${post.status}) debería ser ${esperado}`
    )
  }
})

test('los dos idiomas cubren TODOS los casos del árbol', () => {
  // Si alguien añade un caso y se olvida de una redacción, TypeScript ya avisa
  // en el switch; esto vigila lo que TypeScript no ve: que ninguna rama
  // devuelva un texto vacío o de relleno.
  for (const [caso, get, post] of CASOS) {
    for (const [quien, d] of [
      ['superadmin', diagnosticarSonda(get, post)],
      ['empresa', diagnosticarParaEmpresa(get, post)],
    ] as const) {
      assert.ok(d.titulo.length > 10, `${quien}/${caso}: título pobre`)
      assert.ok(d.detalle.length > 10, `${quien}/${caso}: detalle pobre`)
      assert.ok(d.siguiente.length > 10, `${quien}/${caso}: sin próximo paso`)
    }
  }
})

test('los dos idiomas coinciden SIEMPRE en la gravedad', () => {
  // Es el mismo hecho contado dos veces. Que uno diga «ok» y el otro «falla»
  // significaría que el árbol se duplicó por el camino.
  for (const [caso, get, post] of CASOS) {
    assert.equal(
      diagnosticarSonda(get, post).gravedad,
      diagnosticarParaEmpresa(get, post).gravedad,
      `${caso}: las dos redacciones discrepan sobre si esto está bien o mal`
    )
  }
})

test('el idioma de la empresa no usa jerga de quien escribió el servidor', () => {
  // Quien lee esto puso una URL en un formulario. Puede no ser programador, y
  // desde luego no es el equipo de un satélite nuestro.
  const prohibidas = /satélite|handler|enrutador|endpoint|route\.ts|export |HMAC|deploy/i
  for (const [caso, get, post] of CASOS) {
    const d = diagnosticarParaEmpresa(get, post)
    const texto = `${d.titulo} ${d.detalle} ${d.siguiente}`
    assert.doesNotMatch(texto, prohibidas, `${caso}: le habla a la empresa en jerga`)
  }
})

test('el idioma del superadmin SÍ la usa: habla con quien programa', () => {
  // La contraprueba. Si las dos redacciones dijeran lo mismo, una sobra — y la
  // que sobraría es justo la que da los pasos concretos.
  const texto = CASOS.map(([, g, p]) => {
    const d = diagnosticarSonda(g, p)
    return `${d.titulo} ${d.detalle} ${d.siguiente}`
  }).join(' ')
  assert.match(texto, /route\.ts/)
  assert.match(texto, /satélite/i)
})

test('cuando el problema es del otro lado, se dice de quién es', () => {
  // Un diagnóstico que deja a la empresa sin saber a quién llamar acaba en un
  // ticket para nosotros, que es lo que esta pantalla viene a evitar.
  for (const caso of ['handler_404', 'error_interno', 'inesperado'] as const) {
    const [, get, post] = CASOS.find(([c]) => c === caso)!
    assert.match(
      diagnosticarParaEmpresa(get, post).siguiente,
      /quien programó tu servidor/i,
      `${caso}: no dice a quién le toca`
    )
  }
})

test('y nunca se le pide a la empresa que toque nada de Membego', () => {
  for (const [caso, get, post] of CASOS) {
    assert.doesNotMatch(
      diagnosticarParaEmpresa(get, post).siguiente,
      /escríbenos|soporte|contacta con nosotros/i,
      `${caso}: manda a la empresa a soporte en vez de decirle qué hacer`
    )
  }
})

// ─── La prueba no ensucia el registro ────────────────────────────────────────

test('probar NO crea una entrega: el registro es de eventos del negocio', () => {
  /**
   * Si la prueba dejara fila, el contador de «se agotaron» subiría por pruebas
   * y el registro mezclaría dos cosas que se miran por motivos opuestos: una
   * para depurar hoy, la otra para saber si un cobro se avisó.
   */
  const src = codigo(ENTREGAS)
  assert.ok(!/entregaWebhook\.create/.test(src), 'la sonda crea una entrega')
  // Pero sí deja rastro donde vive lo que hizo una persona.
  assert.match(src, /anotarConector\(/)
})

test('la prueba manda la forma EXACTA de un aviso real', () => {
  /**
   * Una prueba con forma simplificada puede pasar en un servidor que rechaza
   * los avisos de verdad — la peor respuesta posible de un botón de probar:
   * «funciona» cuando no funciona. Mismo sobre, mismas cabeceras, misma firma.
   */
  const src = codigo(ENTREGAS)
  assert.match(src, /SobreWebhook/)
  assert.match(src, /firmarHmac\(/)
  for (const cabecera of [
    'X-Membego-Event',
    'X-Membego-Delivery',
    'X-Membego-Timestamp',
    'X-Membego-Signature',
  ]) {
    assert.ok(src.includes(cabecera), `a la prueba le falta la cabecera ${cabecera}`)
  }
})

test('la prueba se llama membego.test y no suplanta a un evento real', () => {
  // Mandar un `customer.created` de mentira haría que un servidor bien escrito
  // diera de alta un cliente que no existe.
  assert.match(codigo(ENTREGAS), /event: 'membego\.test'/)
})

test('el cuerpo del servidor ajeno NO entra en la bitácora', () => {
  // Puede traer cualquier cosa (una traza con datos de sesión, una página de
  // error con correos). La bitácora la lee más gente que esta pantalla.
  const src = codigo(ENTREGAS)
  const bloque = src.slice(src.indexOf('anotarConector({'))
  const detalle = bloque.slice(bloque.indexOf('detalle:'), bloque.indexOf('})'))
  assert.ok(!/cuerpo/.test(detalle), 'la bitácora estaría guardando el cuerpo ajeno')
})

// ─── Aislamiento ─────────────────────────────────────────────────────────────

test('toda lectura de entregas va acotada por empresa, nunca por id suelto', () => {
  /**
   * El id viaja en la URL y en el formulario: lo escribe quien quiera. Sin la
   * condición de empresa, pegar el id de otra enseñaría SUS entregas con los
   * datos de SUS clientes dentro. Es la primera cosa que alguien prueba.
   */
  const src = codigo(ENTREGAS)
  assert.ok(!/findUnique/.test(src), 'hay un findUnique por id suelto en las entregas')
  for (const trozo of ['where: { id: entregaId, companyId }', 'where: { id: suscripcionId, companyId }']) {
    assert.ok(src.includes(trozo), `falta el acotado por empresa: ${trozo}`)
  }
  assert.ok(
    codigo(PAGINA).includes('where: { id, companyId }'),
    'la página busca la suscripción sin acotar por empresa'
  )
})

test('el reenvío también se acota por empresa', () => {
  const src = codigo('src/modules/connect/webhooks.ts')
  const fn = src.slice(src.indexOf('export async function reenviarEntregaAhora'))
  assert.match(fn.slice(0, 900), /where: \{ id: entregaId, companyId \}/)
})

test('la página esconde lo que no existe, no dice que no está autorizado', () => {
  // Que la suscripción de otra empresa EXISTA tampoco es asunto de quien mira.
  assert.match(codigo(PAGINA), /notFound\(\)/)
})

// ─── Permisos: la regla de honestidad ────────────────────────────────────────

test('las dos funciones nuevas están en el catálogo de permisos', () => {
  const integraciones = FUNCIONES_POR_SECCION.integraciones ?? []
  for (const cod of ['webhook_probar', 'webhook_reenviar']) {
    assert.ok(integraciones.some((f) => f.codigo === cod), `falta ${cod} en el catálogo`)
  }
})

test('…y sus guardias existen de verdad: nada de interruptores pintados', () => {
  const src = codigo(ACCIONES)
  assert.match(src, /requireSection\(\s*'integraciones'\s*,\s*'webhook_probar'\s*\)/)
  assert.match(src, /requireSection\(\s*'integraciones'\s*,\s*'webhook_reenviar'\s*\)/)
})

test('cada función del catálogo de integraciones tiene guardia cableada', () => {
  // La regla de honestidad del módulo de Permisos, comprobada y no prometida.
  const src = codigo(ACCIONES)
  for (const f of FUNCIONES_POR_SECCION.integraciones ?? []) {
    assert.ok(
      new RegExp(`'integraciones'\\s*,\\s*'${f.codigo}'`).test(src),
      `«${f.label}» se lista sin guardia: sería un interruptor pintado`
    )
  }
})

test('la pantalla no pinta botones que la acción va a rechazar', () => {
  const src = codigo(PAGINA)
  assert.match(src, /puedeFuncion\('integraciones', 'webhook_probar'\)/)
  assert.match(src, /puedeFuncion\('integraciones', 'webhook_reenviar'\)/)
})

// ─── Vocabulario de la bitácora ──────────────────────────────────────────────

test('los eventos nuevos están en el vocabulario, con sus dos traducciones', () => {
  // `anotarConector` acepta cualquier cadena; el vocabulario es lo que impide
  // que un apunte aparezca sin texto en las pantallas que lo leen.
  for (const ev of ['webhook.probado', 'webhook.reenvio_manual']) {
    assert.ok((EVENTOS_CONECTOR as readonly string[]).includes(ev), `falta ${ev}`)
  }
})
