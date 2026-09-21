import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ACTION_TYPES } from '../src/lib/rule-engine'
import {
  MAX_CABECERAS,
  MAX_CUERPO_BYTES,
  METODOS,
  cabeceraProhibida,
  explicarMotivo,
  validarLlamada,
} from '../src/modules/connect/llamadaHttpNucleo'
import { eventosDisparadores, eventosDeNegocio } from '../src/modules/connect/eventosSuscribibles'
import { EVENTOS_REENVIADOS } from '../src/modules/integraciones/nucleo'
import { FUNCIONES_POR_SECCION } from '../src/lib/auth/funciones'

/**
 * ACCIÓN HTTP A MEDIDA · hallazgo B-1, segunda mitad.
 *
 * Su razón de ser es que NUESTRO servidor haga una petición a una dirección que
 * escribe otra persona, así que casi todo lo que se prueba aquí existe para
 * acotar eso. Lo más importante es lo último de la lista: la redirección.
 */

const raiz = join(__dirname, '..')
const leer = (r: string) => readFileSync(join(raiz, r), 'utf8')
const codigo = (r: string) =>
  leer(r)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

const base = { method: 'POST', url: 'https://tu-app.com/hook' }

// ─── La guardia de la URL ────────────────────────────────────────────────────

test('una llamada normal se acepta y queda normalizada', () => {
  const r = validarLlamada({ ...base, body: { a: 1 } })
  assert.ok(r.ok)
  assert.equal(r.llamada.metodo, 'POST')
  assert.equal(r.llamada.cuerpo, '{"a":1}')
})

test('la URL pasa por la MISMA guardia que un webhook saliente', () => {
  /**
   * Escribir aquí una validación «parecida» sería la forma cómoda de que una de
   * las dos se quedara corta — y la que se quedara corta sería siempre la que
   * menos se mira.
   */
  for (const [url, motivo] of [
    ['http://tu-app.com/hook', 'url_no_https'],
    ['https://localhost/hook', 'url_host_interno'],
    ['https://169.254.169.254/latest/meta-data/', 'url_host_interno'],
    ['https://10.0.0.5/x', 'url_host_interno'],
    ['https://metadata.google.internal/x', 'url_host_interno'],
    ['no-es-una-url', 'url_malformada'],
  ] as const) {
    const r = validarLlamada({ ...base, url })
    assert.ok(!r.ok && r.motivo === motivo, `${url} → ${JSON.stringify(r)}`)
  }
  // Y el módulo no reimplementa la comprobación: la importa.
  assert.match(codigo('src/modules/connect/llamadaHttpNucleo.ts'), /validarUrlWebhook/)
})

test('sin URL no hay llamada', () => {
  assert.deepEqual(validarLlamada({ method: 'POST' }), { ok: false, motivo: 'sin_url' })
  assert.deepEqual(validarLlamada({ ...base, url: '  ' }), { ok: false, motivo: 'sin_url' })
})

// ─── Cabeceras ───────────────────────────────────────────────────────────────

test('NO se puede falsificar una cabecera nuestra', () => {
  /**
   * Es lo que más me preocupaba de esta acción. Sin bloquear el prefijo, una
   * empresa podría llamar a un tercero poniéndole `X-Membego-Signature` a mano y
   * hacerle creer que ese POST es un evento oficial firmado por MembeGo. No
   * podría falsificar la firma —no tiene el secreto—, pero sí engañar a un
   * receptor que mire la cabecera sin verificarla, que son más de los que a uno
   * le gustaría.
   */
  for (const h of [
    'X-Membego-Signature',
    'x-membego-signature-v2',
    'X-MEMBEGO-Delivery',
    '  x-membego-event  ',
  ]) {
    assert.ok(cabeceraProhibida(h), h)
    const r = validarLlamada({ ...base, headers: { [h]: 'lo-que-sea' } })
    assert.ok(!r.ok && r.motivo === 'cabecera_prohibida', h)
  }
})

test('las cabeceras de transporte también se bloquean', () => {
  // Dejarlas pasar produce peticiones malformadas, o permite confundir a un
  // proxy intermedio sobre dónde acaba una petición y empieza la siguiente.
  for (const h of ['Host', 'content-length', 'Transfer-Encoding', 'connection']) {
    assert.ok(cabeceraProhibida(h), h)
  }
})

test('las cabeceras legítimas SÍ pasan: son el motivo de que existan', () => {
  const r = validarLlamada({
    ...base,
    headers: { Authorization: 'Bearer abc', 'X-Api-Key': 'k', 'Content-Type': 'text/plain' },
  })
  assert.ok(r.ok)
  assert.deepEqual(r.llamada.cabeceras, {
    Authorization: 'Bearer abc',
    'X-Api-Key': 'k',
    'Content-Type': 'text/plain',
  })
})

test('una cabecera vacía se ignora, no tumba la llamada', () => {
  // Una plantilla que interpola `{{token}}` sin valor produce una cadena vacía.
  // Fallar la llamada entera por una cabecera que no aporta sería desmedido.
  const r = validarLlamada({ ...base, headers: { Authorization: '', 'X-Api-Key': 'k' } })
  assert.ok(r.ok)
  assert.deepEqual(r.llamada.cabeceras, { 'X-Api-Key': 'k' })
})

test('hay un tope de cabeceras', () => {
  const muchas = Object.fromEntries(
    Array.from({ length: MAX_CABECERAS + 1 }, (_, i) => [`X-${i}`, 'v'])
  )
  const r = validarLlamada({ ...base, headers: muchas })
  assert.ok(!r.ok && r.motivo === 'demasiadas_cabeceras')
})

// ─── Método y cuerpo ─────────────────────────────────────────────────────────

test('solo los métodos del catálogo, y sin distinguir mayúsculas', () => {
  for (const m of METODOS) {
    assert.ok(validarLlamada({ ...base, method: m.toLowerCase() }).ok, m)
  }
  for (const m of ['TRACE', 'CONNECT', 'OPTIONS', 'lo-que-sea']) {
    const r = validarLlamada({ ...base, method: m })
    assert.ok(!r.ok && r.motivo === 'metodo_invalido', m)
  }
})

test('GET y DELETE salen sin cuerpo aunque se les ponga uno', () => {
  // Mandarlo es legal en el estándar y muchos servidores lo descartan en
  // silencio: una llamada que «funciona» sin hacer nada es peor que una que
  // falla.
  for (const m of ['GET', 'DELETE']) {
    const r = validarLlamada({ ...base, method: m, body: { a: 1 } })
    assert.ok(r.ok && r.llamada.cuerpo === null, m)
  }
})

test('un cuerpo enorme se rechaza, medido en bytes', () => {
  const r = validarLlamada({ ...base, body: 'x'.repeat(MAX_CUERPO_BYTES + 1) })
  assert.ok(!r.ok && r.motivo === 'cuerpo_demasiado_grande')
})

test('un cuerpo que ya es texto se manda tal cual', () => {
  // Quien manda `application/x-www-form-urlencoded` sabe lo que hace.
  const r = validarLlamada({ ...base, body: 'a=1&b=2' })
  assert.ok(r.ok && r.llamada.cuerpo === 'a=1&b=2')
})

test('cada rechazo se explica en lenguaje de quien configuró la regla', () => {
  // Acaba en la auditoría de la ejecución, que es donde se mira cuando una
  // regla «no hace nada». Un código a secas obliga a buscarlo en el código.
  const motivos = [
    'sin_url', 'metodo_invalido', 'cabecera_prohibida', 'demasiadas_cabeceras',
    'cuerpo_demasiado_grande', 'url_no_https', 'url_host_interno', 'url_malformada',
    'url_vacia', 'url_demasiado_larga',
  ] as const
  for (const m of motivos) {
    const texto = explicarMotivo(m)
    assert.ok(texto.length > 15, `${m}: mensaje pobre`)
    assert.doesNotMatch(texto, /undefined/, m)
  }
})

// ─── SSRF por redirección: lo más importante de este archivo ─────────────────

test('NINGÚN camino de salida sigue redirecciones', () => {
  /**
   * `fetch` las sigue por defecto, y eso deja sin efecto toda la validación de
   * la URL en un solo paso: basta con que la dirección configurada sea un
   * dominio público perfectamente válido que responda 302 hacia
   * `http://169.254.169.254/` —el servicio de metadatos de la nube— para que
   * nuestro servidor vaya, desde dentro, a leer credenciales de infraestructura
   * y las devuelva en el cuerpo que guardamos.
   *
   * La guardia de la URL no lo cubre porque solo ve la PRIMERA dirección. Se
   * comprueban los CUATRO caminos, no solo el nuevo: el agujero ya existía en
   * las entregas de webhook y en las dos sondas.
   */
  const caminos = [
    'src/modules/connect/llamadaHttp.ts',
    'src/modules/connect/webhooks.ts',
    'src/modules/integraciones/despacho.ts',
    'src/modules/connect/entregas.ts',
    'src/modules/integraciones/panel.ts',
  ]
  for (const ruta of caminos) {
    const src = codigo(ruta)
    const llamadas = [...src.matchAll(/await fetch\(/g)].length
    const manuales = [...src.matchAll(/redirect: 'manual'/g)].length
    assert.ok(llamadas > 0, `${ruta}: no se encontró ninguna llamada de salida`)
    assert.equal(manuales, llamadas, `${ruta}: ${llamadas} salidas y solo ${manuales} sin seguir redirecciones`)
  }
})

test('un 3xx se cuenta como fallo y se DICE que fue una redirección', () => {
  // Contarlo como éxito dejaría a quien configuró creyendo que su aviso llegó a
  // alguna parte.
  const src = codigo('src/modules/connect/llamadaHttp.ts')
  assert.match(src, /status >= 300 && resp\.status < 400/)
  assert.match(src, /ok: false/)
  assert.match(leer('src/modules/connect/llamadaHttp.ts'), /pon la dirección final/)
})

// ─── El sink ─────────────────────────────────────────────────────────────────

test('la acción está en el catálogo con su tipo y su descripción', () => {
  assert.equal(ACTION_TYPES.CALL_HTTP, 'call_http')
  assert.match(codigo('src/lib/rule-engine/domain/action-catalog.ts'), /ACTION_TYPES\.CALL_HTTP/)
})

test('un fallo de la llamada NO se disfraza de éxito simulado', () => {
  /**
   * Los canales sin conectar degradan a `simulated: true` porque les falta algo
   * que la empresa no puso. Aquí no falta nada: la regla dijo «llama a esta
   * dirección» y la dirección contestó mal. Marcarlo correcto escondería el
   * fallo justo a quien lo configuró — y el paso puede estar `required` para
   * detener la cadena, cosa que no puede hacer si siempre decimos que sí.
   */
  const src = codigo('src/modules/estrategias/actionSink.ts')
  const fn = src.slice(src.indexOf('private async llamarHttp'))
  const cuerpo = fn.slice(0, 900)
  assert.match(cuerpo, /ok: r\.ok/)
  assert.ok(!/simulated/.test(cuerpo), 'la acción HTTP degrada a simulada')
})

test('el detalle lleva el código y la respuesta, para poder depurar', () => {
  const fn = codigo('src/modules/estrategias/actionSink.ts')
  const cuerpo = fn.slice(fn.indexOf('private async llamarHttp'), fn.indexOf('private async llamarHttp') + 900)
  assert.match(cuerpo, /status: r\.status/)
  assert.match(cuerpo, /respuesta/)
})

// ─── La regla que une las dos mitades ────────────────────────────────────────

test('el disparador usa el nombre INTERNO, no el del cable', () => {
  /**
   * Por el cable viaja `visit.completed`; por el bus, `cliente.visita`. Quien
   * despacha compara contra `DomainEvent.type`, que es el interno. Una lista de
   * disparadores con nombres v2 se guardaría sin error, se vería bien y no se
   * dispararía nunca.
   */
  const disparadores = eventosDisparadores().map((e) => e.valor)
  assert.deepEqual(disparadores, [...EVENTOS_REENVIADOS])
  // Y NO coinciden con los de la suscripción saliente, que son los v2.
  const suscribibles = eventosDeNegocio().map((e) => e.valor)
  assert.notDeepEqual(disparadores.slice().sort(), suscribibles.slice().sort())
})

test('las etiquetas salen del mismo sitio en las dos listas', () => {
  // Dos listas de frases para los mismos siete eventos acabarían diciendo cosas
  // distintas del mismo hecho.
  for (const d of eventosDisparadores()) {
    assert.notEqual(d.label, d.valor, `${d.valor} sin etiqueta`)
    assert.ok(
      eventosDeNegocio().some((s) => s.label === d.label),
      `«${d.label}» no existe en la lista de suscripción`
    )
  }
})

test('la regla nace ACTIVA: una creada y apagada sería una trampa', () => {
  const src = codigo('src/modules/connect/reglasHttp.ts')
  assert.match(src, /const PUBLICADA = 'PUBLISHED'/)
  assert.match(src, /status: PUBLICADA/)
})

test('la llamada se valida AL GUARDAR, no solo al ejecutar', () => {
  // Descubrir que la dirección es inválida en la primera ejecución significa
  // enterarse cuando el evento ya pasó y no vuelve.
  const src = codigo('src/modules/connect/reglasHttp.ts')
  const fn = src.slice(src.indexOf('export async function crearReglaHttp'))
  assert.ok(fn.indexOf('validarLlamada(params)') < fn.indexOf('tx.automation.create'))
})

test('archivar NO borra: el historial de ejecuciones sobrevive', () => {
  /**
   * `AutomationRun.automationId` tiene `onDelete: Cascade`, así que un `delete`
   * se llevaría por delante el registro de qué se llamó, cuándo y con qué
   * resultado. Quien archiva quiere que deje de correr, no perder la prueba de
   * lo que hizo mientras corría.
   */
  const src = codigo('src/modules/connect/reglasHttp.ts')
  assert.ok(!/automation\.deleteMany/.test(src), 'la regla se borra en cascada')
  assert.match(src, /data: \{ status: 'ARCHIVED' \}/)
})

test('esta pantalla no puede tocar una automatización de plantilla', () => {
  // Un id del formulario no debería alcanzar una regla con otra forma y otro
  // dueño. Los `where` van acotados también por `templateKey`.
  const src = codigo('src/modules/connect/reglasHttp.ts')
  for (const fn of ['cambiarEstadoRegla', 'archivarRegla', 'reglasHttpDeEmpresa']) {
    const cuerpo = src.slice(src.indexOf(`export async function ${fn}`))
    assert.match(cuerpo.slice(0, 800), /templateKey: CLAVE_REGLA_HTTP/, fn)
  }
})

test('la lista enseña el host, nunca la URL entera', () => {
  // Una dirección de webhook lleva a menudo un token en la ruta o en la query,
  // y esta lista la ve todo el equipo.
  const src = codigo('src/modules/connect/reglasHttp.ts')
  assert.match(src, /new URL\(url\)\.hostname/)
  const panel = codigo('src/components/connect/ReglasHttpPanel.tsx')
  assert.ok(!/r\.url/.test(panel), 'el panel pinta la URL completa')
})

test('la bitácora no guarda las cabeceras: ahí viaja el Authorization', () => {
  const src = codigo('src/modules/connect/reglasHttp.ts')
  const bloque = src.slice(src.indexOf('anotarConector({'))
  const detalle = bloque.slice(bloque.indexOf('detalle:'), bloque.indexOf('})'))
  assert.ok(!/cabecera|header/i.test(detalle), 'la bitácora guardaría las cabeceras')
})

test('crear y gestionar reglas tiene su permiso, y está cableado', () => {
  const funciones = FUNCIONES_POR_SECCION.integraciones ?? []
  assert.ok(funciones.some((f) => f.codigo === 'regla_http'))
  const acciones = codigo('src/modules/connect/adminActions.ts')
  assert.equal(
    [...acciones.matchAll(/'integraciones',\s*'regla_http'/g)].length,
    3,
    'las tres acciones (crear, pausar, archivar) tienen que exigirlo'
  )
})
