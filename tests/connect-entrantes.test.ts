import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ESPACIO_ENTRANTE,
  MAX_CUERPO_BYTES,
  MENSAJE_RECHAZO,
  PREFIJO_ENTRANTE,
  aceptarCuerpo,
  componerToken,
  esEventoEntrante,
  nombreDeEvento,
  partirToken,
  slugDeNombre,
} from '../src/modules/connect/entrantesNucleo'
import { suscripcionQuiere } from '../src/modules/connect/webhooksNucleo'
import { FEATURES_CONNECT } from '../src/modules/connect/nucleo'
import { FUNCIONES_POR_SECCION } from '../src/lib/auth/funciones'

/**
 * WEBHOOKS ENTRANTES · hallazgo B-1 de la auditoría.
 *
 * MembeGo solo sabía empujar. Esto abre la dirección contraria, y con ella la
 * superficie más expuesta del módulo: una URL pública, sin sesión, que escribe
 * en la base. Lo que se vigila aquí es sobre todo lo que impide que esa URL se
 * convierta en una forma de fingir hechos del negocio.
 */

const raiz = join(__dirname, '..')
const leer = (r: string) => readFileSync(join(raiz, r), 'utf8')
const codigo = (r: string) =>
  leer(r)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

const RUTA = 'src/app/api/connect/entrante/[token]/route.ts'
const SECRETO = 'x'.repeat(43)
const TOKEN = componerToken(`${PREFIJO_ENTRANTE}a1b2c3d4e5f6`, SECRETO)

// ─── Lo que entra va marcado como entrante ───────────────────────────────────

test('LA REGLA: un POST de fuera NUNCA puede fingir un hecho del negocio', () => {
  /**
   * Es la decisión que sostiene todo lo demás. Si el evento pudiera llamarse
   * `cliente.visita`, cualquiera con la URL —un secreto, sí, pero uno que viaja
   * en texto por la configuración de una herramienta ajena— podría inventar
   * visitas, disparar beneficios y meter datos falsos en los satélites de otras
   * empresas.
   */
  for (const intento of ['cliente.visita', 'purchase.completed', '../cliente.visita', '']) {
    const evento = nombreDeEvento(slugDeNombre(intento))
    assert.ok(evento.startsWith(ESPACIO_ENTRANTE), `«${intento}» produjo «${evento}»`)
  }
  // Y el nombre resultante no puede colarse como uno del bus.
  assert.equal(nombreDeEvento(slugDeNombre('cliente.visita')), 'entrante.cliente_visita')
})

test('el slug no deja pasar nada que no sean letras, números y guion bajo', () => {
  assert.equal(slugDeNombre('Pedidos de mi Tienda'), 'pedidos_de_mi_tienda')
  assert.equal(slugDeNombre('Reservas · Año Nuevo'), 'reservas_ano_nuevo')
  assert.equal(slugDeNombre('  ***  '), 'entrada')
  assert.equal(slugDeNombre(''), 'entrada')
  assert.match(slugDeNombre('a'.repeat(200)), /^a{40}$/)
  for (const raro of ['../../etc', 'a b\nc', '"; DROP TABLE']) {
    assert.match(slugDeNombre(raro), /^[a-z0-9_]+$/, raro)
  }
})

test('esEventoEntrante reconoce lo que vino de fuera', () => {
  assert.ok(esEventoEntrante('entrante.pedidos'))
  assert.ok(!esEventoEntrante('cliente.visita'))
  assert.ok(!esEventoEntrante('entranteX'))
})

// ─── El eco ──────────────────────────────────────────────────────────────────

test('lo que entra NO sale por los webhooks salientes de la empresa', () => {
  /**
   * Devolverle a la empresa lo que acaba de mandarnos es ruido en el mejor
   * caso. En el peor —dos herramientas encadenadas, la segunda apuntando otra
   * vez a nuestra URL de entrada— es un bucle que solo se nota cuando ya se ha
   * multiplicado.
   */
  const src = codigo('src/modules/connect/webhooks.ts')
  const fn = src.slice(src.indexOf('export async function repartirEventoAWebhooks'))
  assert.match(fn.slice(0, 900), /if \(esEventoEntrante\(input\.evento\)\) return/)
})

test('…y el corte va ANTES de leer las suscripciones', () => {
  // Si fuera después, un evento entrante costaría una consulta por cada aviso
  // recibido para acabar descartándolo.
  const src = codigo('src/modules/connect/webhooks.ts')
  const fn = src.slice(src.indexOf('export async function repartirEventoAWebhooks'))
  assert.ok(
    fn.indexOf('esEventoEntrante') < fn.indexOf('suscripcionWebhook.findMany'),
    'el corte ocurre después de consultar'
  )
})

test('una suscripción saliente que pidiera «todo» tampoco los recibiría', () => {
  // La lista vacía significa todos, así que sin el corte de arriba cada empresa
  // con un webhook saliente recibiría de vuelta sus propios avisos entrantes.
  assert.ok(suscripcionQuiere([], 'entrante.pedidos'), 'el filtro por evento no es quien corta')
})

// ─── El token ────────────────────────────────────────────────────────────────

test('el token se parte en prefijo público y secreto', () => {
  assert.deepEqual(partirToken(TOKEN), {
    prefijo: `${PREFIJO_ENTRANTE}a1b2c3d4e5f6`,
    secreto: SECRETO,
  })
})

test('lo que no tiene la forma exacta se rechaza antes de tocar la base', () => {
  for (const malo of [
    'cualquier-cosa',
    `${PREFIJO_ENTRANTE}a1b2c3d4e5f6`,
    `${PREFIJO_ENTRANTE}corto.${SECRETO}`,
    `${PREFIJO_ENTRANTE}a1b2c3d4e5f6.corto`,
    `${PREFIJO_ENTRANTE}A1B2C3D4E5F6.${SECRETO}`,
    null,
    '',
  ]) {
    assert.equal(partirToken(malo), null, String(malo))
  }
})

test('del token solo se guarda su hash', () => {
  /**
   * Que la URL sea el credencial es lo normal en un webhook entrante, pero no
   * obliga a guardarla en claro: con el prefijo indexado y el secreto en
   * scrypt, un volcado de la tabla no permite mandarle un evento a nadie.
   */
  const src = codigo('src/modules/connect/entrantes.ts')
  assert.match(src, /secretoHash: hashearSecreto\(secreto\)/)
  assert.match(src, /secretoValido\(partido\.secreto, fila\.secretoHash\)/)
  // Y el esquema no tiene una columna con el token en claro.
  const esquema = leer('prisma/schema/connect.prisma')
  const modelo = esquema.slice(esquema.indexOf('model WebhookEntrante'))
  assert.ok(!/^\s+token\s+String/m.test(modelo.slice(0, 2000)), 'hay un token en claro')
})

// ─── El cuerpo ───────────────────────────────────────────────────────────────

test('se acepta un objeto JSON y nada más', () => {
  assert.deepEqual(aceptarCuerpo('{"a":1}'), { ok: true, datos: { a: 1 } })
  // Un array llegaría al contexto de la automatización como índices numerados,
  // y una cadena como letras sueltas: mejor decir que no con una frase clara.
  assert.deepEqual(aceptarCuerpo('[1,2]'), { ok: false, motivo: 'no_es_objeto' })
  assert.deepEqual(aceptarCuerpo('"hola"'), { ok: false, motivo: 'no_es_objeto' })
  assert.deepEqual(aceptarCuerpo('null'), { ok: false, motivo: 'no_es_objeto' })
  assert.deepEqual(aceptarCuerpo('{no json'), { ok: false, motivo: 'json_invalido' })
  assert.deepEqual(aceptarCuerpo('   '), { ok: false, motivo: 'cuerpo_vacio' })
})

test('un cuerpo enorme se rechaza, y se mide en BYTES no en caracteres', () => {
  // Un emoji ocupa cuatro bytes y un carácter. Medir por `length` dejaría pasar
  // cuatro veces el tope con contenido no ASCII, que es justo lo que manda una
  // herramienta con nombres de producto de verdad.
  const grande = `{"a":"${'x'.repeat(MAX_CUERPO_BYTES)}"}`
  assert.deepEqual(aceptarCuerpo(grande), { ok: false, motivo: 'demasiado_grande' })

  const emojis = `{"a":"${'🙂'.repeat(MAX_CUERPO_BYTES / 4)}"}`
  assert.ok(emojis.length < MAX_CUERPO_BYTES, 'la prueba no mide lo que cree')
  assert.deepEqual(aceptarCuerpo(emojis), { ok: false, motivo: 'demasiado_grande' })
})

test('cada rechazo tiene una frase que dice qué arreglar', () => {
  // Quien lo lee es una herramienta ajena o quien la configura: un «400» sin
  // texto convierte un error de formato en una tarde de prueba y error.
  for (const [motivo, texto] of Object.entries(MENSAJE_RECHAZO)) {
    assert.ok(texto.length > 15, `${motivo}: mensaje pobre`)
  }
})

// ─── La ruta pública ─────────────────────────────────────────────────────────

test('el freno se aplica ANTES de verificar el secreto', () => {
  /**
   * Verificar el hash cuesta a propósito (scrypt). Si el freno fuera después,
   * probar tokens al azar saldría gratis para quien prueba y nos costaría CPU a
   * nosotros. Es el mismo orden que la guardia de la API v1.
   */
  const src = codigo(RUTA)
  assert.ok(
    src.indexOf('limite(`entrante:') < src.indexOf('resolverEntrante(token)'),
    'se resuelve el token antes de frenar'
  )
})

test('el mismo 404 para «no existe» y para «el secreto no cuadra»', () => {
  // Distinguirlos le confirmaría a quien prueba que ese prefijo existe.
  const src = codigo(RUTA)
  assert.match(src, /if \(!entrante\) return NextResponse\.json\(\{ error: 'Not found\.' \}/)
  assert.equal([...src.matchAll(/status: 404/g)].length, 1)
})

test('la empresa se DESCUBRE al resolver, no viaja en la petición', () => {
  /**
   * No hay ningún `companyId` que manipular: sale del token. Es la misma
   * propiedad que hace seguras las claves de API de empresa, y la razón por la
   * que este endpoint no necesita una comprobación de aislamiento aparte.
   */
  const src = codigo(RUTA)
  assert.ok(!/companyId.*(searchParams|body|params)/.test(src))
  assert.match(src, /companyId: entrante\.companyId/)
})

test('un pausado responde 200, un token inexistente no', () => {
  /**
   * Una herramienta que recibe un error se pone a reintentar y a llenar de
   * avisos de fallo el panel de su dueño — por algo que la empresa apagó a
   * propósito. Con un token que no existe no hay nada que respetar.
   */
  const src = codigo(RUTA)
  assert.match(src, /accepted: false, reason: 'paused'/)
  const iPausa = src.indexOf("reason: 'paused'")
  assert.ok(!/status:/.test(src.slice(iPausa - 200, iPausa + 60)), 'el pausado devuelve un error')
})

test('el pausado se comprueba DESPUÉS de validar el cuerpo', () => {
  // Así, quien está configurando su herramienta con el webhook pausado recibe
  // igualmente el error de formato si lo hay, en vez de un «aceptado» que le
  // esconde que su JSON está mal.
  const src = codigo(RUTA)
  assert.ok(src.indexOf('aceptarCuerpo(crudo)') < src.indexOf("estado !== 'ACTIVE'"))
})

test('el tope de tamaño se mira por la cabecera Y al medir el cuerpo', () => {
  // `Content-Length` lo manda quien llama y puede mentir: ahorra descargar
  // cincuenta megas cuando dice la verdad, y no protege nada cuando no.
  const src = codigo(RUTA)
  assert.match(src, /content-length/)
  assert.match(src, /aceptarCuerpo\(crudo\)/)
})

test('un GET explica qué es esto sin tocar la base', () => {
  // Es lo primero que hace cualquiera al pegar una URL: abrirla en el
  // navegador. Un 404 seco ahí manda a soporte a alguien que lo hacía bien.
  const src = codigo(RUTA)
  const get = src.slice(src.indexOf('export function GET'))
  assert.match(get, /status: 405/)
  assert.ok(!/resolverEntrante|prisma|tx\./.test(get), 'el GET toca la base')
})

test('emitir nunca puede romperle la petición a quien nos avisó', () => {
  // `emitirEventoEstrategia` es fire-and-safe por contrato. Que la
  // automatización de destino falle no es problema de quien mandó el aviso: él
  // ya hizo su parte.
  const src = codigo(RUTA)
  assert.match(src, /await emitirEventoEstrategia\(/)
  assert.match(src, /accepted: true, event: evento/)
})

// ─── Plan y permisos ─────────────────────────────────────────────────────────

test('nacen cerrados: cero por defecto', () => {
  // Cada uno es una URL pública que ESCRIBE en la base de esa empresa. Se
  // conceden empresa a empresa, no se reparten con el alta.
  assert.equal(FEATURES_CONNECT['entrantes.max'].default, 0)
})

test('crear tiene permiso propio, separado de los webhooks salientes', () => {
  /**
   * Crear uno abre una URL pública que escribe; los salientes solo mandan hacia
   * fuera. Son facultades distintas y la pantalla de permisos tiene que poder
   * distinguirlas.
   */
  const funciones = FUNCIONES_POR_SECCION.integraciones ?? []
  for (const cod of ['entrante_crear', 'entrante_gestionar']) {
    assert.ok(funciones.some((f) => f.codigo === cod), `falta ${cod}`)
  }
  const acciones = codigo('src/modules/connect/adminActions.ts')
  assert.match(acciones, /requireSection\(\s*'integraciones'\s*,\s*'entrante_crear'\s*\)/)
  assert.match(acciones, /requireSection\(\s*'integraciones'\s*,\s*'entrante_gestionar'\s*\)/)
})

test('la pantalla no pinta botones que la acción va a rechazar', () => {
  const pagina = codigo('src/app/(admin)/admin/integraciones/desarrolladores/entrantes/page.tsx')
  assert.match(pagina, /puedeFuncion\('integraciones', 'entrante_crear'\)/)
  assert.match(pagina, /puedeFuncion\('integraciones', 'entrante_gestionar'\)/)
})

// ─── Lo recibido ─────────────────────────────────────────────────────────────

test('lo recibido se lee del bus, no de una tabla propia', () => {
  /**
   * El evento YA guarda el payload, la empresa y la hora. Una segunda tabla con
   * los mismos datos sería un sitio más que purgar y aislar, y dos respuestas
   * posibles a «qué nos mandaron el martes».
   */
  const src = codigo('src/modules/connect/entrantes.ts')
  const fn = src.slice(src.indexOf('export async function recepcionesDe'))
  assert.match(fn.slice(0, 700), /tx\.domainEvent\.findMany/)
  assert.match(fn.slice(0, 700), /type: nombreDeEvento\(slug\)/)
  const esquema = leer('prisma/schema/connect.prisma')
  assert.ok(!/model RecepcionEntrante/.test(esquema), 'apareció una tabla de recepciones')
})

test('el detalle se busca por (id, empresa), nunca por id suelto', () => {
  const p = codigo('src/app/(admin)/admin/integraciones/desarrolladores/entrantes/[id]/page.tsx')
  assert.match(p, /where: \{ id, companyId \}/)
  assert.match(p, /notFound\(\)/)
})

test('el nombre del evento se compone, no se guarda dos veces', () => {
  /**
   * Guardarlo como columna sería el mismo dato en dos sitios. El día que uno
   * cambiara sin el otro, la pantalla diría un evento y el endpoint emitiría
   * otro — un desajuste que no da error en ninguna parte y que solo se nota
   * porque «la automatización no salta».
   */
  const esquema = leer('prisma/schema/connect.prisma')
  const modelo = esquema.slice(esquema.indexOf('model WebhookEntrante'))
  assert.ok(!/^\s+evento\s+String/m.test(modelo.slice(0, 2000)), 'el evento se guarda duplicado')
  assert.match(codigo(RUTA), /nombreDeEvento\(entrante\.slug\)/)
})

test('el gestor y el endpoint emiten EXACTAMENTE el mismo nombre de evento', () => {
  // Si la pantalla enseñara un nombre y el endpoint emitiera otro, quien
  // configure la automatización con lo que leyó no recibiría nada nunca.
  const pagina = codigo('src/app/(admin)/admin/integraciones/desarrolladores/entrantes/page.tsx')
  assert.match(pagina, /nombreDeEvento\(e\.slug\)/)
})
