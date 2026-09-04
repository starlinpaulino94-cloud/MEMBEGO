import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  PERMISOS_META_PAGINAS,
  configMetaPaginasDesdeEntorno,
  metaPaginasConfigurado,
} from '../src/modules/connect/metaNucleo'
import { proveedorDe, problemasDelRegistro } from '../src/modules/connect/proveedores/indice'
import { METADATOS_IMPLEMENTADOS, METADATOS_PREVISTOS } from '../src/modules/connect/proveedores/metadatos'
import { leerEntranteMensajeria } from '../src/modules/mensajeria/nucleo'

/**
 * META · FASE 3 — Facebook (Páginas + Messenger) e Instagram como una sola
 * conexión. Lo que se vigila: mínimo privilegio, que la tarjeta de Instagram
 * lleve a Facebook, que el diálogo use el patrón verificado (SDK + código al
 * servidor), que los tokens de Página se sellen por activo, y que los
 * mensajes de Messenger/Instagram se lean bien.
 */

const raiz = join(__dirname, '..')
const leer = (r: string) => readFileSync(join(raiz, r), 'utf8')
const codigo = (r: string) =>
  leer(r).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

test('permisos: los cinco de Páginas e Instagram, y ni uno más', () => {
  assert.deepEqual(
    [...PERMISOS_META_PAGINAS],
    ['pages_show_list', 'pages_manage_metadata', 'pages_messaging', 'instagram_basic', 'instagram_manage_messages']
  )
  // Lo que NO se pide, por escrito.
  for (const extra of ['pages_read_engagement', 'pages_manage_posts', 'instagram_manage_comments', 'instagram_content_publish', 'business_management']) {
    assert.ok(!(PERMISOS_META_PAGINAS as readonly string[]).includes(extra), `${extra} sobra`)
  }
})

test('configuración: la de Páginas exige app, config propia, secreto y token del webhook', () => {
  const base = { NEXT_PUBLIC_META_APP_ID: '1', NEXT_PUBLIC_META_CONFIG_ID_PAGES: '2', META_APP_SECRET: 's', META_WEBHOOK_VERIFY_TOKEN: 't' }
  assert.equal(metaPaginasConfigurado(base), true)
  assert.equal(configMetaPaginasDesdeEntorno(base)?.configId, '2')
  for (const clave of Object.keys(base)) {
    assert.equal(metaPaginasConfigurado({ ...base, [clave]: '' }), false, `sin ${clave} se seguía ofreciendo`)
  }
  // La config de WhatsApp NO vale como la de Páginas: son configuraciones distintas.
  assert.equal(metaPaginasConfigurado({ ...base, NEXT_PUBLIC_META_CONFIG_ID_PAGES: undefined, NEXT_PUBLIC_META_CONFIG_ID: '9' }), false)
})

test('registro: Facebook e Instagram son una conexión; Instagram lleva a Facebook', () => {
  assert.deepEqual(problemasDelRegistro(), [])
  const fb = proveedorDe('facebook')
  const ig = proveedorDe('instagram')
  assert.ok(fb && ig)
  assert.equal(fb.clase, 'NATIVA')
  assert.equal(fb.autorizacion.patron, 'POPUP')
  assert.equal(fb.tipoCredencial, 'OAUTH_TOKENS')
  assert.equal(ig.clase, 'ADAPTADA')
  assert.equal(ig.rutaGestionExterna, '/admin/integraciones/facebook')
  assert.equal(fb.metadatos.nombre, 'Facebook e Instagram')
  assert.ok(METADATOS_IMPLEMENTADOS.some((m) => m.slug === 'facebook') && METADATOS_IMPLEMENTADOS.some((m) => m.slug === 'instagram'))
  assert.ok(!METADATOS_PREVISTOS.some((m) => m.slug === 'facebook' || m.slug === 'instagram'))
  // Los pasos: requisitos, autorizar (SDK), elegir Páginas.
  assert.deepEqual(fb.pasos().map((p) => p.id), ['requisitos', 'autorizar', 'paginas'])
  assert.equal(fb.pasos()[1].componente, 'AltaMetaPaginas')
  assert.equal(fb.pasos()[2].componente, 'ElegirPaginasMeta')
})

test('diálogo: el SDK pide un CÓDIGO con la configuración de Páginas; nada de scope ni de token', () => {
  const src = codigo('src/components/connect/AltaMetaPaginas.tsx')
  assert.match(src, /config_id: configId/)
  assert.match(src, /response_type: 'code'/)
  assert.match(src, /override_default_response_type: true/)
  assert.ok(!/scope/.test(src), 'con config_id no se manda scope')
  assert.ok(!/access_token|accessToken/.test(src), 'un token no puede pasar por el navegador')
})

test('servidor: canje → larga duración → debug_token → sellado, en ese orden', () => {
  const src = codigo('src/modules/connect/meta/paginas.ts')
  const completar = src.slice(src.indexOf('export async function completarLoginPaginas'))
  const i = (s: string) => completar.indexOf(s)
  assert.ok(i("code: input.code") < i('fb_exchange_token'), 'la larga duración va después del canje')
  assert.ok(i('fb_exchange_token') < i('inspeccionarToken('), 'debug_token va después de la larga duración')
  assert.ok(i('inspeccionarToken(') < i("tipo: 'OAUTH_TOKENS'"), 'se sella después de verificar')
  assert.match(completar, /faltanPermisos\(inspeccion\.datos, PERMISOS_META_PAGINAS\)/)
  // Facebook no tiene refresco: el `expiresAt` guardado es la caducidad más cercana.
  assert.match(completar, /refreshToken: null/)
  assert.match(completar, /Math\.min\(/)
})

test('páginas: lo que ve la pantalla no lleva tokens; el token de Página se sella por activo', () => {
  const acciones = codigo('src/modules/connect/altaActions.ts')
  const disponibles = acciones.slice(acciones.indexOf('export async function paginasDisponiblesAction'), acciones.indexOf('export async function elegirPaginasAction'))
  assert.ok(!/access_token|token/.test(disponibles), 'la acción de listar Páginas filtra tokens')
  const paginas = codigo('src/modules/connect/meta/paginas.ts')
  assert.match(paginas, /sellarParaActivo\(activo\.id, p\.access_token\)/)
  assert.match(paginas, /instagram_business_account\{id,username\}/)
  assert.match(paginas, /subscribed_fields: CAMPOS_SUSCRIPCION/)
  assert.match(paginas, /'messages,messaging_postbacks,message_deliveries,message_reads'/)
  // Y los ids del formulario se validan antes de tocar nada.
  assert.match(acciones, /\/\^\\d\{1,32\}\$\/\.test\(v\)/)
})

test('desconectar Facebook revoca los permisos concedidos', () => {
  const src = codigo('src/modules/connect/registro.ts')
  const desconectar = src.slice(src.indexOf('export async function desconectarConexion'))
  assert.ok(desconectar.indexOf('revocarPermisosPaginas(') < desconectar.indexOf('eliminarCredencial('))
  assert.match(codigo('src/modules/connect/meta/paginas.ts'), /\/me\/permissions\/\$\{permiso\}/)
})

test('messenger: un mensaje se lee con PSID, mid y texto; un eco no es un entrante', () => {
  const m = leerEntranteMensajeria({
    sender: { id: 'PSID1' },
    recipient: { id: '555' },
    timestamp: 1725400000000,
    message: { mid: 'm_abc', text: 'Hola, ¿tienen turno?' },
  })
  assert.ok(m)
  assert.equal(m.de, 'PSID1')
  assert.equal(m.idExterno, 'm_abc')
  assert.equal(m.texto, 'Hola, ¿tienen turno?')
  assert.equal(m.tipo, 'text')
  assert.equal(m.eco, false)
  assert.equal(m.timestamp.getTime(), 1725400000000)

  const adj = leerEntranteMensajeria({ sender: { id: 'P' }, recipient: { id: '5' }, timestamp: 1, message: { mid: 'm2', attachments: [{ type: 'image', payload: { url: 'https://…' } }] } })
  assert.equal(adj?.tipo, 'image')
  assert.deepEqual(adj?.adjuntos, { attachments: [{ type: 'image', payload: { url: 'https://…' } }] })

  const eco = leerEntranteMensajeria({ sender: { id: '555' }, recipient: { id: 'PSID1' }, timestamp: 1, message: { mid: 'm3', text: 'x', is_echo: true } })
  assert.equal(eco?.eco, true)
  assert.equal(leerEntranteMensajeria({ sender: { id: 'P' }, message: { text: 'sin mid' } }), null)
})

test('despacho: Messenger e Instagram tienen manejador y se envían con el token de Página', () => {
  const d = codigo('src/modules/connect/meta/webhookDispatcher.ts')
  assert.match(d, /objeto === 'page' \|\| objeto === 'instagram'/)
  const ms = codigo('src/modules/mensajeria/messenger.ts')
  assert.match(ms, /tokenDePagina\(input\.companyId, c\.activoId\)/)
  assert.match(ms, /messaging_type: 'RESPONSE'/)
  assert.match(ms, /ventanaAbierta\(c\.ultimoEntranteAt\)/)
  // Entregas y lecturas: solo con ids; nunca se inventa.
  assert.match(ms, /sin ids: no se aplica/)
})
