import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  crearRecolector,
  generarPin,
  leerMensajeMeta,
  metaConfigurado,
  pinValido,
} from '../src/modules/connect/metaNucleo'
import { proveedorDe } from '../src/modules/connect/proveedores/indice'
import {
  altaCompleta,
  altaVacia,
  conRespuesta,
  pasoActual,
  type HechosAlta,
} from '../src/modules/connect/altaNucleo'

/**
 * MEMBEGO CONNECT · F14.1 — las doce pruebas de comportamiento que pidió la
 * auditoría.
 *
 * Lo que se puede EJECUTAR se ejecuta (la carrera de eventos, el pestillo, el
 * origen, el PIN, la transición del alta). Lo que necesita red o base se
 * vigila leyendo el fuente, y va dicho en cada caso.
 */

const leer = (r: string) => readFileSync(join(__dirname, '..', r), 'utf8')
const codigo = (r: string) =>
  leer(r)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

/**
 * SQL sin sus comentarios. Hace falta por la misma razón de siempre: el
 * archivo EXPLICA por qué no se usa `CONCURRENTLY`, y esa frase hacía fallar
 * la comprobación que lo prohíbe, encontrándose a sí misma.
 */
const sql = (r: string) =>
  leer(r)
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n')

const CODE = 'AQD-codigo-canjeable'
const WABA = '102290129340398'
const NUM = '106540352242922'
const mensajeFinal = (waba = WABA, phone = NUM) => ({
  type: 'WA_EMBEDDED_SIGNUP',
  event: 'FINISH',
  data: { waba_id: waba, phone_number_id: phone },
})

// ─── 1 · code antes de message ───────────────────────────────────────────────

test('carrera: llega el CÓDIGO primero y el mensaje después', () => {
  const r = crearRecolector()
  assert.equal(r.aportar({ code: CODE }), null, 'no debe enviar con un solo valor')
  const listo = r.aportar({ wabaId: WABA, phoneNumberId: NUM })
  assert.deepEqual(listo, { code: CODE, wabaId: WABA, phoneNumberId: NUM })
})

// ─── 2 · message antes de code ───────────────────────────────────────────────

test('carrera: llega el MENSAJE primero y el código después', () => {
  // Éste es el orden que rompía la Fase 14: leía la selección desde el callback
  // de FB.login dando por hecho que el mensaje ya habría llegado.
  const r = crearRecolector()
  assert.equal(r.aportar({ wabaId: WABA, phoneNumberId: NUM }), null)
  const listo = r.aportar({ code: CODE })
  assert.deepEqual(listo, { code: CODE, wabaId: WABA, phoneNumberId: NUM })
})

// ─── 3 · doble evento ────────────────────────────────────────────────────────

test('carrera: se envía EXACTAMENTE UNA VEZ aunque Meta repita el evento', () => {
  const r = crearRecolector()
  r.aportar({ wabaId: WABA, phoneNumberId: NUM })
  assert.ok(r.aportar({ code: CODE }), 'el primero completo debe enviar')
  assert.equal(r.aportar({ code: CODE }), null, 'el segundo NO debe enviar')
  assert.equal(r.aportar(mensajeFinal() && { wabaId: WABA, phoneNumberId: NUM }), null)
})

test('carrera: tras reiniciar se puede volver a enviar', () => {
  const r = crearRecolector()
  r.aportar({ code: CODE, wabaId: WABA, phoneNumberId: NUM })
  assert.equal(r.aportar({ code: CODE }), null)
  r.reiniciar()
  assert.equal(r.aportar({ code: CODE }), null, 'tras reiniciar hay que aportar todo de nuevo')
  assert.ok(r.aportar({ wabaId: WABA, phoneNumberId: NUM }))
})

// ─── 4 · origen inválido ─────────────────────────────────────────────────────

test('origen: solo los dominios EXACTOS de Meta; ni sufijos ni parecidos', () => {
  assert.equal(leerMensajeMeta('https://www.facebook.com', mensajeFinal()).tipo, 'seleccion')
  assert.equal(leerMensajeMeta('https://web.facebook.com', mensajeFinal()).tipo, 'seleccion')

  for (const impostor of [
    'https://facebook.com.atacante.net',
    'https://evil-facebook.com',
    'https://www.facebook.com.evil.io',
    'http://www.facebook.com',
    'https://wwwXfacebook.com',
    'null',
    '',
  ]) {
    assert.equal(
      leerMensajeMeta(impostor, mensajeFinal()).tipo,
      'ignorar',
      `${impostor} no debería aceptarse como origen`
    )
  }
})

test('origen: un mensaje válido pero ajeno al alta se ignora', () => {
  assert.equal(leerMensajeMeta('https://www.facebook.com', { type: 'OTRA_COSA' }).tipo, 'ignorar')
  assert.equal(leerMensajeMeta('https://www.facebook.com', 'no es json').tipo, 'ignorar')
  assert.equal(leerMensajeMeta('https://www.facebook.com', null).tipo, 'ignorar')
  assert.equal(
    leerMensajeMeta('https://www.facebook.com', { type: 'WA_EMBEDDED_SIGNUP', event: 'CANCEL' })
      .tipo,
    'cancelado'
  )
})

test('origen: el mensaje llega como texto JSON y también se entiende', () => {
  const m = leerMensajeMeta('https://www.facebook.com', JSON.stringify(mensajeFinal()))
  assert.deepEqual(m, { tipo: 'seleccion', wabaId: WABA, phoneNumberId: NUM })
})

// ─── 5 · error y reintento ───────────────────────────────────────────────────

test('reintento: con error, el botón vuelve y no hace falta recargar', () => {
  const src = codigo('src/components/connect/AltaMetaWhatsapp.tsx')
  // El «en curso» se DERIVA: con error, el botón deja de estar bloqueado.
  assert.match(src, /disabled=\{!listo \|\| \(enCurso && !hayError\)\}/)
  assert.match(src, /'Volver a intentarlo'/)
  // Y el recolector se reinicia, para que un intento fallido no contamine el
  // siguiente con valores a medias.
  assert.match(src, /recolector\.current\.reiniciar\(\)/)
})

// ─── 6 · PIN obligatorio ─────────────────────────────────────────────────────

test('PIN: se genera de seis dígitos, aleatorio de verdad y con ceros iniciales', () => {
  const pins = Array.from({ length: 3000 }, generarPin)
  assert.ok(pins.every((p) => p.length === 6 && pinValido(p)))
  // Recortar el rango a 100000..999999 tiraría 100 000 combinaciones.
  assert.ok(pins.some((p) => p.startsWith('0')), 'nunca genera PIN con cero inicial')
  // Aleatorio: 3000 tiradas no deberían repetirse casi nunca.
  assert.ok(new Set(pins).size > 2900, 'los PIN se repiten demasiado')
})

test('PIN: el registro del número lo MANDA, y se guarda sellado', () => {
  const src = codigo('src/modules/connect/metaEmbedded.ts')
  // Meta lo exige; la Fase 14 lo omitía y la llamada fallaba siempre.
  assert.match(src, /body: JSON\.stringify\(\{ messaging_product: 'whatsapp', pin \}\)/)
  // Va DENTRO del sello, junto al token: es un secreto.
  assert.match(src, /pin: string/)
  assert.match(src, /pin,/)
  // Y NO en los metadatos, que se leen sin descifrar.
  const meta = src.slice(src.indexOf('metadata: {'))
  assert.ok(!meta.slice(0, meta.indexOf('}')).includes('pin'), 'el PIN estaría legible sin abrir el sello')
})

// ─── 7 · número ajeno al WABA ────────────────────────────────────────────────

test('propiedad: el número tiene que pertenecer a la cuenta autorizada', () => {
  const src = codigo('src/modules/connect/metaEmbedded.ts')
  // No basta con que el navegador lo diga: se le pregunta a Meta.
  assert.match(src, /numeroPerteneceAlWaba/)
  assert.match(src, /if \(!pertenencia\.pertenece\)/)
  assert.match(src, /Ese número no pertenece a la cuenta de WhatsApp que autorizaste/)
})

test('propiedad: la cuenta tiene que estar entre las que nos autorizaron', () => {
  const src = codigo('src/modules/connect/metaEmbedded.ts')
  // `debug_token` + `granular_scopes`: la única fuente fiable de «esta empresa
  // nos autorizó sobre ESTA cuenta».
  assert.match(src, /granular_scopes/)
  assert.match(src, /if \(!concesiones\.concesion\.cuentas\.includes\(wabaId\)\)/)
  // Y los permisos concedidos DE VERDAD, que pueden ser menos que los pedidos.
  assert.match(src, /for \(const permiso of PERMISOS_META\)/)
})

test('propiedad: se comprueba ANTES de tocar nada en Meta', () => {
  const src = codigo('src/modules/connect/metaEmbedded.ts')
  const cuerpo = src.slice(src.indexOf('export async function completarAltaMeta'))
  const orden = ['canjearCodigo', 'concesionesDelToken', 'numeroPerteneceAlWaba', 'registrarNumero']
  let anterior = -1
  for (const fn of orden) {
    const i = cuerpo.indexOf(fn)
    assert.ok(i > anterior, `${fn} está fuera de orden: se registraría antes de validar`)
    anterior = i
  }
})

// ─── 8 · WABA duplicado entre empresas ───────────────────────────────────────

test('unicidad: la base impide que dos empresas reclamen la misma cuenta', () => {
  const esquema = leer('prisma/schema/connect.prisma')
  assert.match(esquema, /@@unique\(\[conectorId, cuentaExterna\]\)/)

  const migracion = sql('prisma/migrations/20260905_connect_identidad_externa/migration.sql')
  assert.match(migracion, /CREATE UNIQUE INDEX IF NOT EXISTS/)
  assert.match(migracion, /"conectorId", "cuentaExterna"/)
  // `CONCURRENTLY` no puede correr dentro de una transacción y el editor SQL
  // envuelve lo que se le pega en una: obligaba a partir el archivo a mano y
  // reventaba con «25001». El archivo lo explica en un comentario, por eso se
  // comprueba sobre el SQL sin comentarios.
  assert.ok(!/CONCURRENTLY/.test(migracion), 'la migración volvió a usar CONCURRENTLY')

  // Y el alta traduce el choque a algo que se puede resolver.
  const src = codigo('src/modules/connect/metaEmbedded.ts')
  assert.match(src, /e\.code === 'P2002'/)
  assert.match(src, /ya está conectada a otro negocio/)
})

test('aislamiento: el webhook resuelve por clave única, no por findFirst global', () => {
  const src = codigo('src/app/api/connect/meta/webhook/route.ts')
  // `findFirst` sobre metadata devolvía UNA CUALQUIERA de las filas que
  // coincidieran: el aviso de una empresa podía acabar atribuido a otra.
  assert.ok(!src.includes('findFirst'), 'el webhook volvió a un findFirst')
  assert.ok(!src.includes('metadata'), 'el webhook vuelve a buscar dentro de un JSON')
  assert.match(src, /findUnique/)
  assert.match(src, /conectorId_cuentaExterna/)
})

// ─── 9 · credencial reconocida por el asistente ──────────────────────────────

test('credencial: lo que el alta GUARDA es lo que el asistente BUSCA', () => {
  // El fallo de la Fase 14: el asistente deducía el tipo de `autorizacion.tipo`
  // (OAUTH2 con Meta) y buscaba OAUTH_TOKENS, mientras el alta guardaba
  // API_KEY. El paso jamás se daba por cumplido.
  const wa = proveedorDe('whatsapp')!
  assert.equal(wa.tipoCredencial, 'API_KEY')

  const alta = codigo('src/modules/connect/metaEmbedded.ts')
  assert.match(alta, /tipo: 'API_KEY'/, 'el alta de Meta guarda otro tipo')

  const asistente = codigo('src/modules/connect/alta.ts')
  assert.match(asistente, /tipo: def\.tipoCredencial/)
  assert.ok(
    !asistente.includes("'OAUTH2' ? 'OAUTH_TOKENS'"),
    'el asistente vuelve a deducir el tipo de credencial'
  )
})

test('credencial: cada proveedor declara la suya, y Google sigue con OAuth', () => {
  assert.equal(proveedorDe('google-calendar')!.tipoCredencial, 'OAUTH_TOKENS')
  assert.equal(proveedorDe('cardnet')!.tipoCredencial, 'API_KEY')
})

// ─── 10 · transición PENDING → CONNECTED ─────────────────────────────────────

test('alta: con la credencial guardada, WhatsApp llega hasta el final', () => {
  // Se recorre el guion REAL del proveedor con Meta configurado, con el hecho
  // que produce el alta: la credencial existe.
  const previo = { ...process.env }
  Object.assign(process.env, {
    NEXT_PUBLIC_META_APP_ID: '1',
    NEXT_PUBLIC_META_CONFIG_ID: '2',
    META_APP_SECRET: '3',
    META_WEBHOOK_VERIFY_TOKEN: '4',
  })
  try {
    const wa = proveedorDe('whatsapp')!
    let estado = altaVacia(wa.versionAlta)
    const sinNada: HechosAlta = { autorizado: false, validado: false }

    assert.equal(pasoActual(wa, estado, sinNada)?.id, 'requisitos')
    estado = conRespuesta(estado, 'requisitos', true)
    assert.equal(pasoActual(wa, estado, sinNada)?.id, 'credencial')
    assert.equal(altaCompleta(wa, estado, sinNada), false)

    // El alta guarda la credencial → el hecho cambia → no queda nada.
    const conCredencial: HechosAlta = { autorizado: true, validado: false }
    assert.equal(pasoActual(wa, estado, conCredencial), null)
    assert.equal(altaCompleta(wa, estado, conCredencial), true)
  } finally {
    for (const k of ['NEXT_PUBLIC_META_APP_ID', 'NEXT_PUBLIC_META_CONFIG_ID', 'META_APP_SECRET', 'META_WEBHOOK_VERIFY_TOKEN']) {
      delete process.env[k]
    }
    Object.assign(process.env, previo)
  }
})

test('alta: cerrar el alta pone CONNECTED y borra el progreso', () => {
  const src = codigo('src/modules/connect/alta.ts')
  const terminar = src.slice(src.indexOf('export async function terminarAlta'))
  assert.match(terminar, /estado: 'CONNECTED'/)
  assert.match(terminar, /setupState: Prisma\.DbNull/)
  assert.match(terminar, /claseError: null/)
  // Y no se cierra un alta incompleta, lo diga quien lo diga.
  assert.match(terminar, /if \(!vista\.completa\) return \{ ok: false, motivo: 'incompleta' \}/)
})

// ─── 11 · CSP activa ─────────────────────────────────────────────────────────

test('CSP: los dominios de Meta están, EXACTOS y en su directiva', () => {
  const src = leer('next.config.ts')
  const directiva = (nombre: string) => {
    const i = src.indexOf(`"${nombre} `)
    const j = src.indexOf('"', i + 1)
    return src.slice(i, j)
  }
  assert.match(directiva('script-src'), /https:\/\/connect\.facebook\.net/)
  assert.match(directiva('frame-src'), /https:\/\/www\.facebook\.com/)
  assert.match(directiva('frame-src'), /https:\/\/web\.facebook\.com/)
  // connect-src se arma con plantilla; se busca en el fuente completo.
  assert.match(src, /connect-src[^`]*https:\/\/graph\.facebook\.com/)
})

test('CSP: no se abrió ningún comodín nuevo', () => {
  // SIN COMENTARIOS: el propio archivo explica «y no `*.facebook.net`», y esa
  // frase haría fallar la comprobación encontrándose a sí misma.
  const src = codigo('next.config.ts')
  const comodines = [...src.matchAll(/https:\/\/\*\.[a-z.-]+/g)].map((m) => m[0])
  // Los de siempre y ni uno más: un `*.facebook.com` abriría cualquier
  // subdominio presente y futuro de Meta.
  const permitidos = new Set([
    'https://*.cardnet.com.do',
    'https://*.gtp-seglan.com',
    'https://*.supabase.co',
    'https://*.ingest.sentry.io',
    'https://*.sentry.io',
  ])
  for (const c of comodines) {
    assert.ok(permitidos.has(c), `comodín nuevo en la CSP: ${c}`)
  }
  assert.ok(!src.includes('*.facebook'), 'comodín sobre el dominio de Meta')
})

test('CSP: la lista de orígenes de la CSP y la del componente no se separan', () => {
  // Si un día se abre un origen en la CSP y no en el componente, el mensaje
  // llegaría y se descartaría sin explicación. Y al revés, peor.
  // ORIGENES_META vive en el módulo del navegador desde que se partió el
  // núcleo (el núcleo usa `node:crypto` y no puede bajar al cliente).
  const nucleo = leer('src/modules/connect/metaNavegador.ts')
  const config = leer('next.config.ts')
  for (const origen of ['https://www.facebook.com', 'https://web.facebook.com']) {
    assert.ok(nucleo.includes(origen), `${origen} falta en ORIGENES_META`)
    assert.ok(config.includes(origen), `${origen} falta en la CSP`)
  }
})

// ─── 12 · remontaje con el SDK ya cargado ────────────────────────────────────

test('remontaje: si el SDK ya está cargado, el botón NO se queda en «Cargando…»', () => {
  const src = codigo('src/components/connect/AltaMetaWhatsapp.tsx')
  // `next/script` no vuelve a disparar `onLoad` para un script que ya está en
  // la página: al volver a este paso, el botón quedaba muerto para siempre.
  assert.match(src, /setInterval\(/)
  assert.match(src, /if \(!window\.FB\) return/)
  assert.match(src, /clearInterval\(t\)/)
  // Y se limpia al desmontar.
  assert.match(src, /return \(\) => clearInterval\(t\)/)
})

// ─── Disponibilidad completa ─────────────────────────────────────────────────

test('disponibilidad: sin el token del webhook, el alta NO se ofrece', () => {
  // Sin él Meta no puede dar de alta nuestra URL, y sin URL no llega
  // `account_update`. Ofrecer el botón produce conexiones que nacen sordas.
  const casi = {
    NEXT_PUBLIC_META_APP_ID: '1',
    NEXT_PUBLIC_META_CONFIG_ID: '2',
    META_APP_SECRET: '3',
  }
  assert.equal(metaConfigurado(casi), false)
  assert.equal(metaConfigurado({ ...casi, META_WEBHOOK_VERIFY_TOKEN: '4' }), true)
})

// ─── Observabilidad ──────────────────────────────────────────────────────────

test('observabilidad: se anota fase, estado, código, traza y clase de error', () => {
  const src = codigo('src/modules/connect/metaEmbedded.ts')
  for (const campo of ['fase:', 'status:', 'codigoMeta:', 'requestId:', 'claseError:']) {
    assert.ok(src.includes(campo), `no se registra ${campo}`)
  }
  // La traza de Meta, que es con lo que ellos pueden buscar la llamada.
  assert.match(src, /x-fb-trace-id/)
})

test('observabilidad: al usuario NO le llega ningún detalle interno', () => {
  const src = codigo('src/modules/connect/altaActions.ts')
  const accion = src.slice(src.indexOf('export async function altaMetaAction'))
  // El mensaje ya viene redactado; ni fase, ni status, ni traza salen a pantalla.
  assert.match(accion, /return \{ error: res\.detalle \}/)
  for (const filtrado of ['res.fase', 'res.clase', 'requestId', 'status']) {
    assert.ok(!accion.includes(filtrado), `${filtrado} se estaría enseñando al usuario`)
  }
})
