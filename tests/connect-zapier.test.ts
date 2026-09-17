import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { INVENTARIO_API, SCOPES, TIPO_V2 } from '@membego/contracts'
import { EVENTOS_EMITIDOS } from '../src/modules/integraciones/nucleo'

/**
 * APP DE ZAPIER · hallazgo B-2 de la auditoría.
 *
 * La app vive fuera del despliegue —corre en la infraestructura de Zapier— pero
 * su contrato es el nuestro. Estas pruebas existen para que un cambio en la API
 * rompa la CI aquí y no un Zap de un cliente tres semanas después, que es el
 * modo de fallo caro de toda integración publicada.
 */

const raiz = join(__dirname, '..')
const leer = (r: string) => readFileSync(join(raiz, r), 'utf8')
const codigo = (r: string) =>
  leer(r)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

const DISPARADORES = 'integrations/zapier/src/disparadores.js'
const AUTENTICACION = 'integrations/zapier/src/autenticacion.js'
const BUSQUEDAS = 'integrations/zapier/src/busquedas.js'

/** Los `evento:` declarados en el catálogo de la app. */
function eventosDeLaApp(): string[] {
  return [...codigo(DISPARADORES).matchAll(/evento: '([^']+)'/g)].map((m) => m[1])
}

// ─── El contrato no se puede desincronizar en silencio ───────────────────────

test('todo evento que escucha la app EXISTE en el catálogo de MembeGo', () => {
  /**
   * Es el fallo caro de una app publicada: se renombra un evento, la app sigue
   * suscribiéndose al nombre viejo, el servidor acepta la suscripción —no
   * valida contra un catálogo cerrado— y el Zap no dispara nunca. Nadie se
   * entera hasta que un cliente escribe.
   */
  // La app se suscribe por WEBHOOKS DE EMPRESA, cuyo catálogo válido es todo lo
  // que el bus emite (`EVENTOS_EMITIDOS`), no el subconjunto de satélite: por eso
  // un disparador de `promotion.created` es legítimo aunque no llegue a ningún
  // satélite (B-4).
  const reales = new Set(EVENTOS_EMITIDOS.map((e) => TIPO_V2[e] ?? e))
  for (const e of eventosDeLaApp()) {
    assert.ok(reales.has(e), `la app escucha «${e}», que MembeGo no emite`)
  }
})

test('la app usa los nombres del CABLE (v2), no los internos del bus', () => {
  // Por el cable viaja `visit.completed`; por el bus, `cliente.visita`. Una
  // suscripción con el nombre interno se guardaría sin error y no recibiría
  // nada — el mismo error que las reglas de B-1, aquí con un cliente delante.
  for (const e of eventosDeLaApp()) {
    assert.ok(!(EVENTOS_EMITIDOS as readonly string[]).includes(e), `«${e}» es el nombre interno`)
    assert.match(e, /^[a-z]+\.[a-z_]+$/)
  }
})

test('cada disparador tiene su clave, su nombre y su descripción', () => {
  // Cada uno es una entrada del directorio de Zapier: sin descripción, quien
  // busca «MembeGo» ve una lista de nombres sueltos y no elige ninguno.
  const src = codigo(DISPARADORES)
  const eventos = eventosDeLaApp()
  assert.ok(eventos.length >= 3, 'una app con menos de tres disparadores no cubre casi nada')
  assert.equal([...src.matchAll(/clave: '/g)].length, eventos.length)
  assert.equal([...src.matchAll(/descripcion: '/g)].length, eventos.length)
})

// ─── Las rutas que la app llama tienen que existir ───────────────────────────

test('las rutas que usa la app están en el inventario', () => {
  /**
   * La app llama a cuatro sitios. Si alguno desaparece o cambia de camino, esto
   * rompe aquí — que es donde se puede arreglar— y no en el Zap de alguien.
   */
  const rutas = new Set(INVENTARIO_API.map((r) => `${r.metodo} ${r.ruta}`))
  for (const esperada of [
    'GET /webhooks',
    'POST /webhooks',
    'DELETE /webhooks/{id}',
    'GET /customers/resolve',
  ]) {
    assert.ok(rutas.has(esperada), `la app llama a «${esperada}» y el inventario no lo tiene`)
  }
})

test('las rutas de webhooks son SOLO para claves de empresa', () => {
  /**
   * Un satélite atiende a muchas empresas y no le corresponde decidir a quién
   * avisan ellas — y desde luego no apuntar sus avisos a una dirección suya.
   */
  for (const r of INVENTARIO_API.filter((x) => x.ruta.startsWith('/webhooks'))) {
    assert.equal(r.principal, 'empresa', `${r.metodo} ${r.ruta}`)
    assert.equal(r.scope, 'webhooks:manage')
  }
})

test('el scope que la app necesita existe y se puede conceder', () => {
  // Existir en el contrato no basta: si la pantalla de claves no lo ofreciera,
  // ninguna empresa podría crear una clave que sirviera para esta app.
  assert.ok(SCOPES.includes('webhooks:manage'))
  assert.match(
    codigo('src/components/connect/ClavesApiPanel.tsx'),
    /valor: 'webhooks:manage'/,
    'la pantalla de claves no ofrece el permiso'
  )
  assert.match(
    codigo('src/modules/connect/adminActions.ts'),
    /SCOPES_DE_ADMINISTRACION = \[[^\]]*'webhooks:manage'[^\]]*\]/,
    'el servidor filtraría el permiso al crear la clave'
  )
})

// ─── Cómo se comporta la app ─────────────────────────────────────────────────

test('la prueba de conexión verifica el permiso, no solo la clave', () => {
  /**
   * Probar contra una lectura cualquiera daría una conexión «correcta» con la
   * que ningún Zap se puede encender, y el fallo aparecería más tarde, en otra
   * pantalla, diciendo otra cosa. Contra `/webhooks` falla mientras la persona
   * tiene delante el formulario donde arreglarlo.
   */
  const src = codigo(AUTENTICACION)
  const prueba = src.slice(src.indexOf('const probar ='))
  assert.match(prueba.slice(0, 400), /'\/webhooks'/)
})

test('la etiqueta de la conexión NO enseña la clave', () => {
  // Se vería en la lista de conexiones de Zapier, que no es un sitio privado.
  const src = codigo(AUTENTICACION)
  assert.ok(
    !/connectionLabel:.*authData\.apiKey/.test(src),
    'la etiqueta expondría la clave entera'
  )
  assert.match(src, /connectionLabel: '\{\{label\}\}'/)
})

test('cada Zap se suscribe a UN evento, no a todos', () => {
  /**
   * La lista vacía significa «todos» en MembeGo. Un Zap de compras que
   * recibiera también las visitas pagaría una tarea de Zapier por cada una para
   * descartarla — y eso se nota en la factura de quien integra, no en la
   * nuestra.
   */
  assert.match(codigo(DISPARADORES), /events: \[evento\]/)
})

test('apagar un Zap sin id de suscripción no revienta', () => {
  // Si `performUnsubscribe` lanzara, Zapier no dejaría apagar el Zap.
  const src = codigo(DISPARADORES)
  const fn = src.slice(src.indexOf('const desuscribir ='))
  assert.match(fn.slice(0, 400), /if \(!id\) return/)
})

test('no encontrar un cliente NO es un error', () => {
  // Zapier distingue una búsqueda vacía de una fallida: si lanzara, el Zap se
  // detendría en vez de seguir por su rama de «no encontrado».
  const src = codigo(BUSQUEDAS)
  assert.match(src, /skipThrowForStatus: true/)
  assert.match(src, /if \(resp\.status === 404\) return \[\]/)
})

test('la búsqueda lee el cliente tal como lo devuelve la ruta', () => {
  // `/customers/resolve` devuelve el recurso DIRECTAMENTE, no envuelto. Leer
  // `data.customer` daría siempre «no encontrado» sin un solo error.
  const src = codigo(BUSQUEDAS)
  assert.ok(!/data \|\| \{\}\)\.customer/.test(src), 'la búsqueda espera un envoltorio que no existe')
  assert.match(src, /const cliente = resp\.data/)
})

test('la app NO trae acciones de escritura', () => {
  /**
   * La API v1 reserva las escrituras a la credencial de un satélite: necesitan
   * saber qué sistema respalda la operación. Esa política no se cambia de paso
   * mientras se escribe una app de Zapier, y una acción `create` aquí obligaría
   * a hacerlo.
   */
  assert.match(codigo('integrations/zapier/src/index.js'), /creates: \{\}/)
})

test('la clave se pone como middleware, no disparador por disparador', () => {
  // Un disparador que se olvide de la cabecera recibe un 401 que parece un
  // problema de credenciales del usuario, y esa confusión cuesta un ticket por
  // cada uno que se añada mal.
  const src = codigo('integrations/zapier/src/index.js')
  assert.match(src, /beforeRequest: \[ponerClave\]/)
  assert.match(src, /afterResponse: \[traducirErrores\]/)
})

test('la app no forma parte del despliegue de MembeGo', () => {
  // Es un proyecto aparte con su propio `package.json`. Si sus dependencias se
  // mezclaran con las nuestras, `zapier-platform-core` acabaría en el bundle.
  const suyo = JSON.parse(leer('integrations/zapier/package.json'))
  assert.ok(suyo.private, 'debería ser privado: no se publica en npm')
  assert.ok(suyo.dependencies['zapier-platform-core'])
  const nuestro = JSON.parse(leer('package.json'))
  assert.ok(
    !nuestro.dependencies['zapier-platform-core'],
    'la dependencia de Zapier se coló en el proyecto principal'
  )
})
