import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  desglosarNotificacion,
  fechaDeMeta,
  huella,
} from '../src/modules/connect/meta/webhookNucleo'
import {
  faltanPermisos,
  leerInspeccion,
  pideReautorizar,
} from '../src/modules/connect/meta/tokensNucleo'
import { pruebaDeSecreto, versionGraphDesdeEntorno } from '../src/modules/connect/metaNucleo'
import { TIPOS_TRABAJO } from '../src/modules/jobs/tipos'
import { EVENTOS_CONECTOR, textoTecnico } from '../src/modules/connect/bitacoraNucleo'

/**
 * META · FASE 1 — núcleo común.
 *
 * Lo que estas pruebas vigilan: que un webhook de Meta se convierta en items
 * deduplicables con su dueño candidato; que un token se inspeccione sin
 * inventar nada; que TODAS las llamadas de servidor lleven `appsecret_proof`
 * y una sola versión de Graph; que los activos sean únicos en la base; que
 * desconectar avise a Meta; y que el CRM ya no enseñe datos inventados.
 */

const raiz = join(__dirname, '..')
const leer = (r: string) => readFileSync(join(raiz, r), 'utf8')
const codigo = (r: string) =>
  leer(r).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

// ─── Desglose del webhook ────────────────────────────────────────────────────

const WHATSAPP = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: '102290129340398',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '15550783881', phone_number_id: '106540352242922' },
            contacts: [{ profile: { name: 'Ana' }, wa_id: '18095551234' }],
            messages: [
              { from: '18095551234', id: 'wamid.HBgL1', timestamp: '1725400000', type: 'text', text: { body: 'Hola' } },
              { from: '18095551234', id: 'wamid.HBgL2', timestamp: '1725400001', type: 'text', text: { body: '¿Hay turno?' } },
            ],
            statuses: [
              { id: 'wamid.OUT1', status: 'delivered', timestamp: '1725400002', recipient_id: '18095551234' },
            ],
          },
        },
      ],
    },
  ],
}

test('desglose: un lote de WhatsApp da un item por mensaje y por estado, con clave propia', () => {
  const items = desglosarNotificacion(WHATSAPP)
  assert.equal(items.length, 3)
  assert.deepEqual(
    items.map((i) => i.claveDedupe),
    ['wa:msg:wamid.HBgL1', 'wa:msg:wamid.HBgL2', 'wa:st:wamid.OUT1:delivered']
  )
  assert.deepEqual(
    items.map((i) => i.campo),
    ['messages', 'messages', 'statuses']
  )
  // El dueño se busca primero por el NÚMERO y después por la cuenta.
  assert.deepEqual(items[0].candidatos, [
    { tipo: 'PHONE_NUMBER', idExterno: '106540352242922' },
    { tipo: 'WABA', idExterno: '102290129340398' },
  ])
  // Cada item lleva SOLO lo suyo: un mensaje no arrastra los otros del lote.
  const p = items[0].payload as { message: { id: string }; contacts: unknown[] }
  assert.equal(p.message.id, 'wamid.HBgL1')
  assert.ok(!('messages' in items[0].payload))
  // WhatsApp manda segundos: se convierten a milisegundos, sin adivinar zonas.
  assert.equal(items[0].timestamp?.getTime(), 1725400000 * 1000)
})

test('desglose: el mismo cuerpo dos veces da las mismas claves (reintento inofensivo)', () => {
  const a = desglosarNotificacion(WHATSAPP).map((i) => i.claveDedupe)
  const b = desglosarNotificacion(JSON.parse(JSON.stringify(WHATSAPP))).map((i) => i.claveDedupe)
  assert.deepEqual(a, b)
})

test('desglose: un campo sin ids (account_update) se deduplica por huella del contenido', () => {
  const cuerpo = {
    object: 'whatsapp_business_account',
    entry: [{ id: '1', changes: [{ field: 'account_update', value: { event: 'PARTNER_ADDED', waba_info: { waba_id: '1' } } }] }],
  }
  const [item] = desglosarNotificacion(cuerpo)
  assert.equal(item.campo, 'account_update')
  assert.equal(item.claveDedupe, `wa:account_update:1:${huella(item.payload)}`)
  assert.deepEqual(item.candidatos, [{ tipo: 'WABA', idExterno: '1' }])
})

test('desglose: Messenger e Instagram usan `messaging` y se distinguen por prefijo', () => {
  const pagina = {
    object: 'page',
    entry: [
      {
        id: '555',
        time: 1725400000000,
        messaging: [
          { sender: { id: 'PSID1' }, recipient: { id: '555' }, timestamp: 1725400000000, message: { mid: 'm_abc', text: 'Hola' } },
          { sender: { id: 'PSID1' }, recipient: { id: '555' }, timestamp: 1725400001000, delivery: { mids: ['m_out'], watermark: 1725400001000 } },
          { sender: { id: 'PSID1' }, recipient: { id: '555' }, timestamp: 1725400002000, postback: { payload: 'SI' } },
        ],
      },
    ],
  }
  const items = desglosarNotificacion(pagina)
  assert.deepEqual(items.map((i) => i.campo), ['messages', 'message_deliveries', 'messaging_postbacks'])
  assert.equal(items[0].claveDedupe, 'fb:msg:m_abc')
  assert.deepEqual(items[0].candidatos, [{ tipo: 'PAGE', idExterno: '555' }])
  assert.equal(items[0].timestamp?.getTime(), 1725400000000)

  const ig = { object: 'instagram', entry: [{ id: '777', messaging: [{ sender: { id: 'IGSID' }, recipient: { id: '777' }, message: { mid: 'ig_1', text: 'hey' } }] }] }
  const [dm] = desglosarNotificacion(ig)
  assert.equal(dm.claveDedupe, 'ig:msg:ig_1')
  assert.deepEqual(dm.candidatos, [{ tipo: 'IG_ACCOUNT', idExterno: '777' }])
})

test('desglose: lo que no es de Meta, o no trae entradas, da cero items sin romper', () => {
  assert.deepEqual(desglosarNotificacion(null), [])
  assert.deepEqual(desglosarNotificacion({ object: 'user', entry: [{ id: '1' }] }), [])
  assert.deepEqual(desglosarNotificacion({ object: 'page' }), [])
  assert.deepEqual(desglosarNotificacion({ object: 'page', entry: [{ id: '' }] }), [])
})

test('fechas de Meta: segundos en WhatsApp, milisegundos en Messenger', () => {
  assert.equal(fechaDeMeta('1725400000')?.getTime(), 1725400000000)
  assert.equal(fechaDeMeta(1725400000000)?.getTime(), 1725400000000)
  assert.equal(fechaDeMeta('x'), null)
  assert.equal(fechaDeMeta(0), null)
})

// ─── Tokens ──────────────────────────────────────────────────────────────────

test('inspección: se lee lo que debug_token da y no se inventa lo que no da', () => {
  const i = leerInspeccion({
    data: {
      app_id: '123',
      is_valid: true,
      expires_at: 0,
      data_access_expires_at: 1730000000,
      scopes: ['pages_show_list', 'pages_messaging'],
      granular_scopes: [{ scope: 'pages_messaging', target_ids: ['555', '556'] }, { scope: 'pages_show_list' }],
    },
  })
  assert.equal(i.valido, true)
  assert.equal(i.appId, '123')
  assert.equal(i.caducaAt, null, 'expires_at 0 = no caduca')
  assert.equal(i.accesoDatosCaducaAt?.getTime(), 1730000000000)
  assert.deepEqual(i.concesiones, [
    { permiso: 'pages_messaging', ids: ['555', '556'] },
    { permiso: 'pages_show_list', ids: [] },
  ])
  assert.deepEqual(faltanPermisos(i, ['pages_messaging', 'instagram_basic']), ['instagram_basic'])

  const vacio = leerInspeccion({})
  assert.equal(vacio.valido, false)
  assert.deepEqual(vacio.permisos, [])
})

test('reautorizar: token inválido, o caducidad —del token o del acceso a datos— a menos de una semana', () => {
  const ahora = Date.UTC(2026, 8, 4)
  const dia = 24 * 60 * 60 * 1000
  const base = { valido: true, appId: '1', caducaAt: null, accesoDatosCaducaAt: null, permisos: [], concesiones: [] }
  assert.equal(pideReautorizar(base, ahora), false)
  assert.equal(pideReautorizar({ ...base, valido: false }, ahora), true)
  assert.equal(pideReautorizar({ ...base, caducaAt: new Date(ahora + 3 * dia) }, ahora), true)
  assert.equal(pideReautorizar({ ...base, caducaAt: new Date(ahora + 30 * dia) }, ahora), false)
  assert.equal(pideReautorizar({ ...base, accesoDatosCaducaAt: new Date(ahora + 2 * dia) }, ahora), true)
})

test('appsecret_proof: HMAC-SHA256 del token con el secreto, en hexadecimal', () => {
  const esperado = createHmac('sha256', 'secreto').update('token', 'utf8').digest('hex')
  assert.equal(pruebaDeSecreto('token', 'secreto'), esperado)
  assert.equal(pruebaDeSecreto('token', 'secreto').length, 64)
})

test('versión de Graph: una para todo, configurable, con defecto', () => {
  assert.equal(versionGraphDesdeEntorno({}), 'v25.0')
  assert.equal(versionGraphDesdeEntorno({ META_GRAPH_VERSION: ' v26.0 ' }), 'v26.0')
  // El envío ya no lleva su versión fija.
  assert.ok(!/v2\d\.0/.test(codigo('src/modules/connect/whatsapp.ts')), 'whatsapp.ts vuelve a fijar una versión')
})

// ─── El cliente único ────────────────────────────────────────────────────────

test('graph: cada llamada con token lleva appsecret_proof y no filtra el cuerpo del error', () => {
  const src = codigo('src/modules/connect/meta/graph.ts')
  assert.match(src, /appsecret_proof/)
  assert.match(src, /\.slice\(0, 200\)/)
  // El catch NO recibe la excepción: su mensaje lleva la URL, y la URL el token.
  assert.ok(!/catch \(e\)/.test(src))
  assert.match(src, /mensaje: 'red'/)
  // Solo códigos documentados en la guía de errores de Graph.
  assert.ok(!/613|=== 32\b/.test(src), 'se coló un código de error no documentado')
})

test('graph: el envío de WhatsApp y el alta incrustada llevan la prueba de secreto', () => {
  assert.match(codigo('src/modules/connect/whatsapp.ts'), /llamarGraph/)
  const alta = codigo('src/modules/connect/metaEmbedded.ts')
  for (const llamada of ['/phone_numbers', '/register', '/subscribed_apps']) {
    const idx = alta.indexOf(llamada)
    assert.ok(idx > 0)
    assert.ok(alta.slice(idx - 200, idx).includes('conPrueba('), `${llamada} sin appsecret_proof`)
  }
})

// ─── Activos y eventos ───────────────────────────────────────────────────────

test('esquema: un activo de Meta pertenece a UNA empresa, y un evento se guarda UNA vez', () => {
  const esquema = leer('prisma/schema/connect.prisma')
  assert.match(esquema, /model ActivoMeta[\s\S]*@@unique\(\[tipo, idExterno\]\)/)
  assert.match(esquema, /model EventoMeta[\s\S]*claveDedupe String @unique/)
  const m = leer('prisma/migrations/20260909_meta_activos_eventos/migration.sql')
  assert.match(m, /CREATE UNIQUE INDEX IF NOT EXISTS "activos_meta_tipo_idExterno_key"/)
  assert.match(m, /CREATE UNIQUE INDEX IF NOT EXISTS "eventos_meta_claveDedupe_key"/)
  assert.match(m, /ENABLE ROW LEVEL SECURITY/)
  // Ninguna sentencia destructiva al inicio de línea (`ON UPDATE CASCADE` de
  // la clave foránea no cuenta: es una cláusula, no un UPDATE).
  assert.ok(!/^\s*(DROP|DELETE|UPDATE|TRUNCATE)\b/im.test(m), 'la migración tiene que ser aditiva')
  assert.ok(!/CONCURRENTLY/.test(m))
})

test('activos: reclamar mira primero quién lo tiene; nunca un upsert ciego', () => {
  const src = codigo('src/modules/connect/meta/activos.ts')
  assert.ok(!src.includes('upsert'), 'un upsert con RLS apagado reasignaría el activo de otra empresa')
  assert.match(src, /motivo: 'otra_empresa'/)
  assert.match(src, /e\.code === 'P2002'/)
  // Solo un activo ACTIVO resuelve un webhook.
  assert.match(src, /fila\.estado !== 'ACTIVE'/)
})

test('alta incrustada: el WABA y el número quedan reclamados como activos', () => {
  const src = codigo('src/modules/connect/metaEmbedded.ts')
  assert.match(src, /reclamarActivo\(\{ companyId, conexionId, tipo: 'WABA'/)
  assert.match(src, /tipo: 'PHONE_NUMBER'/)
  // Y el alta manual también.
  assert.match(codigo('src/modules/connect/whatsapp.ts'), /tipo: 'PHONE_NUMBER'/)
})

test('webhook: la ruta firma, guarda y encola; el proceso es un trabajo de la cola', () => {
  const ruta = codigo('src/app/api/connect/meta/webhook/route.ts')
  const post = ruta.slice(ruta.indexOf('export async function POST'))
  assert.ok(post.indexOf('firmaWebhookValida') < post.indexOf('JSON.parse'))
  assert.match(post, /recibirNotificacion\(cuerpo\)/)
  assert.ok((TIPOS_TRABAJO as readonly string[]).includes('meta-evento'))
  assert.match(codigo('src/modules/jobs/cola.ts'), /case 'meta-evento':/)
  assert.match(codigo('src/modules/jobs/ejecutor.ts'), /procesarEventoMeta\(carga\.eventoId\)/)
  const despacho = codigo('src/modules/connect/meta/webhookDispatcher.ts')
  assert.match(despacho, /skipDuplicates: true/)
  assert.match(despacho, /if \(ev\.procesadoAt\) return/)
})

test('desconectar: se avisa a Meta antes de borrar la credencial y los activos se retiran', () => {
  const src = codigo('src/modules/connect/registro.ts')
  const desconectar = src.slice(src.indexOf('export async function desconectarConexion'))
  const avisar = desconectar.indexOf('desconectarWhatsappEnMeta(')
  const borrar = desconectar.indexOf('eliminarCredencial(')
  assert.ok(avisar >= 0 && avisar < borrar, 'hay que anular la suscripción mientras aún tenemos el token')
  assert.match(desconectar, /retirarActivosDeConexion\(/)
  const anulacion = codigo('src/modules/connect/meta/whatsappDesconexion.ts')
  assert.match(anulacion, /metodo: 'DELETE'/)
  assert.match(anulacion, /subscribed_apps/)
  for (const e of ['meta.suscripcion_anulada', 'meta.suscripcion_no_anulada', 'meta.activo_reasignado']) {
    assert.ok((EVENTOS_CONECTOR as readonly string[]).includes(e), `${e} no está en la bitácora`)
    assert.notEqual(textoTecnico(e), e)
  }
})

// ─── El CRM ya no miente ─────────────────────────────────────────────────────

test('crm: ninguna pantalla enseña datos inventados ni corre en el navegador', () => {
  const CRM = 'src/app/(admin)/admin/crm'
  for (const p of ['page.tsx', 'conversaciones/page.tsx', 'seguimientos/page.tsx', 'metricas/page.tsx', 'configuracion/page.tsx']) {
    const ruta = `${CRM}/${p}`
    assert.ok(existsSync(join(raiz, ruta)), `${ruta} no existe`)
    const src = leer(ruta)
    assert.ok(!/INITIAL_|MOCK_|const STATS|const FUENTES/.test(src), `${ruta} vuelve a llevar datos inventados`)
    assert.ok(!src.startsWith("'use client'"), `${ruta} vuelve a ser un componente de cliente con estado`)
    assert.match(src, /<EmptyState/)
  }
})
