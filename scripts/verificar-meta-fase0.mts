/**
 * META · FASE 0 — verificación del panel, de un solo toque.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ PRUEBA ESTO, Y POR QUÉ NO BASTA CON MIRAR EL PANEL DE META
 *
 * Las siete fases de código de Meta están escritas y probadas contra cuerpos
 * de ejemplo, pero `docs/connect/meta-arquitectura.md` es explícito: **nada del
 * camino Meta se ha ejecutado nunca contra Meta**. Lo que falta no es código,
 * es configuración — y la configuración de un panel se ve verde cuando está
 * mal. Un token de verificación con un espacio de más, un campo sin suscribir,
 * un secreto de otra app: el panel enseña «Complete» en los tres casos.
 *
 * Este script no pregunta al panel cómo se ve. Hace exactamente lo que hará
 * Meta —el mismo GET del apretón de manos, el mismo POST firmado con
 * `X-Hub-Signature-256` sobre el cuerpo crudo— y comprueba lo que responde
 * nuestro servidor. Y cada comprobación trae su CONTROL: un token equivocado
 * que debe dar 403, una firma alterada que debe dar 403. Un endpoint que
 * acepta todo pasa cualquier prueba escrita solo con lo que sí debe aceptar.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * AQUÍ NO SE IMPRIME NINGÚN SECRETO
 *
 * Se leen `META_APP_SECRET` y `META_WEBHOOK_VERIFY_TOKEN` porque hay que
 * firmar y hay que saludar, pero de las variables privadas solo sale a pantalla
 * si EXISTEN. Lo único que se imprime entero es lo que ya es público: el id de
 * la app, los `config_id` y la URL del webhook.
 *
 * ────────────────────────────────────────────────────────────────────────────
 *     npm run verificar:meta-fase0
 *     npm run verificar:meta-fase0 -- --base https://xxx.trycloudflare.com
 *
 * Sin `--base` usa la URL que dejó `npm run meta:tunel` en
 * `.next-qa/meta-tunel.txt`, y si no la hay, `http://localhost:3000` — que
 * sirve para verificar el código pero NO para dar de alta el webhook: Meta
 * tiene que poder llamar desde fuera.
 *
 * Con `--sin-red` se salta el bloque que habla con Meta.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHmac, randomUUID } from 'node:crypto'
import {
  PERMISOS_META,
  PERMISOS_META_PAGINAS,
  configMetaDesdeEntorno,
  configMetaPaginasDesdeEntorno,
  firmaWebhookValida,
  pruebaDeSecreto,
  respuestaDeVerificacion,
  versionGraphDesdeEntorno,
} from '../src/modules/connect/metaNucleo'
import { desglosarNotificacion } from '../src/modules/connect/meta/webhookNucleo'

const args = process.argv.slice(2)
function opcion(nombre: string): string | null {
  const i = args.indexOf(`--${nombre}`)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null
}
const SIN_RED = args.includes('--sin-red')

const ARCHIVO_TUNEL = join(process.cwd(), '.next-qa', 'meta-tunel.txt')
const DEL_TUNEL = existsSync(ARCHIVO_TUNEL) ? readFileSync(ARCHIVO_TUNEL, 'utf8').trim() : ''
const BASE =
  (opcion('base') ?? DEL_TUNEL).replace(/\/+$/, '') || 'http://localhost:3000'

const URL_WEBHOOK = `${BASE}/api/connect/meta/webhook`
const PUBLICA = !/^https?:\/\/(localhost|127\.0\.0\.1)/i.test(BASE)

// ─── Marcador ────────────────────────────────────────────────────────────────

let pasadas = 0
let fallidas = 0
let pendientes = 0
const loQueFalta: string[] = []

function si(nombre: string, detalle?: string) {
  pasadas++
  console.log(`  ✓ ${nombre}${detalle ? ` — ${detalle}` : ''}`)
}
function no(nombre: string, detalle?: string, arreglo?: string) {
  fallidas++
  console.log(`  ✗ ${nombre}${detalle ? `\n      ${detalle}` : ''}`)
  if (arreglo) loQueFalta.push(arreglo)
}
/** Ni bien ni mal: falta un dato para poder decirlo. No cuenta como éxito. */
function pendiente(nombre: string, detalle?: string, arreglo?: string) {
  pendientes++
  console.log(`  · ${nombre}${detalle ? `\n      ${detalle}` : ''}`)
  if (arreglo) loQueFalta.push(arreglo)
}

function titulo(texto: string) {
  console.log(`\n${texto}`)
}

// ─── 1 · El entorno ──────────────────────────────────────────────────────────

titulo('1 · Variables de entorno (solo presencia; de las privadas nunca el valor)')

const VARIABLES = [
  { nombre: 'NEXT_PUBLIC_META_APP_ID', publica: true, para: 'identifica la app en el diálogo y en Graph' },
  { nombre: 'META_APP_SECRET', publica: false, para: 'firma del webhook y appsecret_proof' },
  { nombre: 'NEXT_PUBLIC_META_CONFIG_ID', publica: true, para: 'alta incrustada de WhatsApp' },
  { nombre: 'NEXT_PUBLIC_META_CONFIG_ID_PAGES', publica: true, para: 'login de Páginas e Instagram' },
  { nombre: 'META_WEBHOOK_VERIFY_TOKEN', publica: false, para: 'apretón de manos del webhook' },
  { nombre: 'META_GRAPH_VERSION', publica: true, para: 'una sola versión de Graph para todo' },
] as const

for (const v of VARIABLES) {
  const valor = process.env[v.nombre]?.trim()
  if (!valor) {
    no(
      v.nombre,
      `falta — ${v.para}`,
      v.nombre === 'NEXT_PUBLIC_META_CONFIG_ID_PAGES'
        ? 'Crear la SEGUNDA configuración de Facebook Login for Business (Páginas + Instagram) y pegar su id en NEXT_PUBLIC_META_CONFIG_ID_PAGES'
        : `Definir ${v.nombre} en .env.local`
    )
    continue
  }
  si(v.nombre, v.publica ? valor : 'presente')
}

titulo('2 · Lo que el despliegue puede ofrecer con eso')

if (configMetaDesdeEntorno()) si('WhatsApp: el botón de alta incrustada se ofrece')
else
  no(
    'WhatsApp: el alta incrustada NO se ofrece',
    'faltan variables; el código esconde el botón a propósito en vez de llevar a una pantalla rota de Meta',
    'Completar las variables de WhatsApp'
  )

if (configMetaPaginasDesdeEntorno()) si('Facebook e Instagram: la conexión se ofrece')
else
  no(
    'Facebook e Instagram: la conexión NO se ofrece',
    'falta NEXT_PUBLIC_META_CONFIG_ID_PAGES (la segunda configuración de Login for Business)',
    'Crear la configuración de Páginas + Instagram en el panel de Meta'
  )

// ─── 3 · El núcleo, sin salir de aquí ────────────────────────────────────────

titulo('3 · El núcleo criptográfico (sin red: que este script hable el idioma del servidor)')

const SECRETO = process.env.META_APP_SECRET?.trim() ?? ''
const TOKEN_VERIFICACION = process.env.META_WEBHOOK_VERIFY_TOKEN?.trim() ?? ''

{
  const reto = `fase0-${randomUUID()}`
  const buenos = new URLSearchParams({
    'hub.mode': 'subscribe',
    'hub.verify_token': TOKEN_VERIFICACION,
    'hub.challenge': reto,
  })
  const r = respuestaDeVerificacion(buenos, TOKEN_VERIFICACION)
  if (TOKEN_VERIFICACION && r.ok && r.challenge === reto) si('apretón de manos: el reto vuelve tal cual')
  else no('apretón de manos: el núcleo no devuelve el reto', 'revisa META_WEBHOOK_VERIFY_TOKEN')

  const malos = new URLSearchParams(buenos)
  malos.set('hub.verify_token', 'no-es-el-token')
  if (!respuestaDeVerificacion(malos, TOKEN_VERIFICACION).ok)
    si('control: un token equivocado no pasa')
  else no('control: un token equivocado PASA', 'el apretón de manos no protege nada')

  const cuerpo = JSON.stringify({ object: 'page', entry: [] })
  const firma = `sha256=${createHmac('sha256', SECRETO).update(cuerpo, 'utf8').digest('hex')}`
  if (SECRETO && firmaWebhookValida(cuerpo, firma, SECRETO)) si('firma: una buena se acepta')
  else no('firma: una buena NO se acepta', 'revisa META_APP_SECRET')

  if (!firmaWebhookValida(cuerpo + ' ', firma, SECRETO))
    si('control: el mismo cuerpo con un byte de más se rechaza')
  else no('control: un cuerpo alterado PASA la firma')
}

// ─── 4 · Contra el servidor, como llamaría Meta ──────────────────────────────

titulo(`4 · Contra el servidor real — ${URL_WEBHOOK}`)

if (!PUBLICA) {
  pendiente(
    'la base es local, no pública',
    'sirve para verificar el código, pero Meta no puede dar de alta un `localhost`: para el alta real hace falta el túnel (`npm run meta:tunel`) o un despliegue',
    'Levantar el túnel y dar de alta la URL pública en el panel de Meta'
  )
}

async function pedir(
  url: string,
  init?: RequestInit
): Promise<{ status: number; texto: string } | null> {
  try {
    const resp = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) })
    return { status: resp.status, texto: await resp.text() }
  } catch {
    return null
  }
}

let servidorVivo = false

{
  const reto = `fase0-${randomUUID()}`
  const q = new URLSearchParams({
    'hub.mode': 'subscribe',
    'hub.verify_token': TOKEN_VERIFICACION,
    'hub.challenge': reto,
  })
  const r = await pedir(`${URL_WEBHOOK}?${q}`)
  if (!r) {
    no(
      'GET del apretón de manos: el servidor no respondió',
      `nada contesta en ${BASE}. Levanta la aplicación (npx next start -p 3000) o revisa el túnel`,
      'Levantar el servidor antes de dar de alta el webhook'
    )
  } else if (r.status === 200 && r.texto === reto) {
    servidorVivo = true
    si('GET del apretón de manos: 200 y el reto EXACTO, en texto plano')
  } else {
    servidorVivo = true
    no(
      'GET del apretón de manos',
      `esperaba 200 con el reto crudo; llegó ${r.status} con «${r.texto.slice(0, 120)}». ` +
        'Meta compara byte a byte: ni JSON, ni salto de línea, ni comillas',
      'Igualar META_WEBHOOK_VERIFY_TOKEN entre .env.local y el panel de Meta'
    )
  }
}

if (servidorVivo) {
  const q = new URLSearchParams({
    'hub.mode': 'subscribe',
    'hub.verify_token': 'no-es-el-token',
    'hub.challenge': 'no-deberia-volver',
  })
  const r = await pedir(`${URL_WEBHOOK}?${q}`)
  if (r?.status === 403) si('control: con el token equivocado, 403')
  else no('control: el token equivocado NO da 403', `llegó ${r ? r.status : 'nada'}`)
}

/**
 * El cuerpo de prueba lleva un nonce a propósito: la clave de deduplicación
 * sale de un hash del contenido, así que sin nonce la segunda ejecución
 * chocaría con la fila de la primera y el `skipDuplicates` la haría parecer
 * un fallo de guardado. Con nonce, cada ejecución es un evento nuevo de verdad
 * — y al final se borra.
 */
const NONCE = randomUUID()
const CUERPO_PRUEBA = JSON.stringify({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: `membego-fase0-${NONCE}`,
      time: Math.floor(Date.now() / 1000),
      changes: [
        {
          field: 'account_update',
          value: { event: 'PARTNER_ADDED', waba_info: { waba_id: `membego-fase0-${NONCE}` } },
        },
      ],
    },
  ],
})
const FIRMA_BUENA = `sha256=${createHmac('sha256', SECRETO).update(CUERPO_PRUEBA, 'utf8').digest('hex')}`

if (servidorVivo) {
  const r = await pedir(URL_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': FIRMA_BUENA },
    body: CUERPO_PRUEBA,
  })
  if (r?.status === 200) si('POST firmado: 200', 'la ruta acepta lo que Meta firmaría')
  else if (r?.status === 404)
    no(
      'POST firmado: 404',
      'la ruta responde 404 cuando falta META_APP_SECRET en el proceso del SERVIDOR (no en este script)',
      'Reiniciar el servidor con .env.local cargado'
    )
  else no('POST firmado', `esperaba 200; llegó ${r ? r.status : 'nada'}`)

  const sinFirma = await pedir(URL_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: CUERPO_PRUEBA,
  })
  if (sinFirma?.status === 403) si('control: sin firma, 403')
  else no('control: sin firma NO da 403', `llegó ${sinFirma ? sinFirma.status : 'nada'}`)

  // Un solo byte del cuerpo cambiado: la firma sigue siendo criptográficamente
  // válida para OTRO contenido, que es exactamente el ataque que importa.
  const alterado = await pedir(URL_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': FIRMA_BUENA },
    body: CUERPO_PRUEBA.replace('PARTNER_ADDED', 'PARTNER_REMOVED'),
  })
  if (alterado?.status === 403) si('control: cuerpo alterado con firma buena, 403')
  else no('control: un cuerpo alterado PASA', `llegó ${alterado ? alterado.status : 'nada'}`)
}

// ─── 5 · ¿Llegó a la base? ───────────────────────────────────────────────────

titulo('5 · El evento firmado, ¿quedó guardado?')

if (!servidorVivo) {
  pendiente('sin servidor no hay nada que buscar en la base')
} else {
  const items = desglosarNotificacion(JSON.parse(CUERPO_PRUEBA))
  const clave = items[0]?.claveDedupe ?? ''
  try {
    const { prisma } = await import('../src/lib/prisma')
    const fila = await prisma.eventoMeta.findUnique({
      where: { claveDedupe: clave },
      select: { id: true, objeto: true, campo: true, companyId: true, error: true },
    })
    if (!fila) {
      no(
        'EventoMeta: el evento NO llegó a la base',
        'la ruta devolvió 200 igualmente (es lo correcto: un 5xx haría que Meta reintentara 36 horas). ' +
          'Mira la bitácora de fallos con origen `connect:webhook-meta` / `meta:webhook-guardar`',
        'Revisar por qué el despachador no persiste'
      )
    } else {
      si('EventoMeta: guardado', `objeto ${fila.objeto}, campo ${fila.campo}`)
      if (fila.companyId === null)
        si(
          'sin dueño, y así debe ser',
          'ninguna empresa ha dado de alta todavía ese WABA inventado; el evento se guarda igual para poder atribuirlo después'
        )
      await prisma.eventoMeta.deleteMany({ where: { claveDedupe: clave } })
      si('limpieza: la fila de prueba se borró')
    }
    await prisma.$disconnect()
  } catch (e) {
    pendiente(
      'no se pudo consultar la base',
      e instanceof Error ? e.message.slice(0, 160) : 'fallo al conectar'
    )
  }
}

// ─── 6 · Contra Meta ─────────────────────────────────────────────────────────

titulo('6 · Contra Meta (Graph API)')

const APP_ID = process.env.NEXT_PUBLIC_META_APP_ID?.trim() ?? ''
const VERSION = versionGraphDesdeEntorno()

/**
 * Los campos que la arquitectura (§10) exige suscribir por objeto. Suscribir
 * de menos es el fallo silencioso por excelencia: el webhook queda «verde» en
 * el panel y los mensajes de los clientes simplemente no llegan nunca.
 */
const CAMPOS_EXIGIDOS: Record<string, readonly string[]> = {
  whatsapp_business_account: ['messages', 'account_update'],
  page: ['messages', 'messaging_postbacks', 'message_deliveries', 'message_reads'],
  instagram: ['messages'],
}

async function graph<T>(ruta: string, query: Record<string, string>): Promise<T | null> {
  const url = new URL(`https://graph.facebook.com/${VERSION}${ruta}`)
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(15_000) })
    const json = (await resp.json()) as T & { error?: { message?: string; code?: number } }
    if (!resp.ok || json.error) {
      // El mensaje de Meta se imprime recortado; la URL NUNCA, porque lleva el
      // token de app y el token de app lleva el secreto dentro.
      ultimoErrorGraph = `${json.error?.message?.slice(0, 160) ?? `HTTP ${resp.status}`}${
        json.error?.code ? ` (código ${json.error.code})` : ''
      }`
      return null
    }
    return json
  } catch {
    ultimoErrorGraph = 'sin respuesta (red o tiempo agotado)'
    return null
  }
}
let ultimoErrorGraph = ''

if (SIN_RED) {
  pendiente('bloque omitido por --sin-red')
} else if (!APP_ID || !SECRETO) {
  pendiente('sin APP_ID y secreto no se puede preguntar a Meta')
} else {
  // `{appId}|{secreto}` es el token de APP. No se imprime jamás.
  const tokenApp = `${APP_ID}|${SECRETO}`

  const depuracion = await graph<{
    data?: { app_id?: string; type?: string; is_valid?: boolean; application?: string }
  }>('/debug_token', { input_token: tokenApp, access_token: tokenApp })

  if (!depuracion?.data?.is_valid) {
    no(
      'el par APP_ID + META_APP_SECRET no lo reconoce Meta',
      ultimoErrorGraph || 'token de app inválido',
      'Copiar de nuevo el id y el secreto desde Configuración · Básica del panel'
    )
  } else if (depuracion.data.app_id !== APP_ID) {
    no(
      'el secreto pertenece a OTRA app',
      `Meta dice que ese secreto es de la app ${depuracion.data.app_id}, no de ${APP_ID}`,
      'Alinear NEXT_PUBLIC_META_APP_ID y META_APP_SECRET a la misma app'
    )
  } else {
    si(
      'el par APP_ID + META_APP_SECRET casa en Meta',
      depuracion.data.application ? `app «${depuracion.data.application}»` : `app ${APP_ID}`
    )
    si('appsecret_proof: el secreto es el bueno', `huella ${pruebaDeSecreto(tokenApp, SECRETO).slice(0, 8)}…`)
  }

  // Las suscripciones del webhook, que es el corazón de la Fase 0.
  const subs = await graph<{
    data?: { object?: string; callback_url?: string; active?: boolean; fields?: { name?: string }[] }[]
  }>(`/${APP_ID}/subscriptions`, { access_token: tokenApp })

  if (!subs) {
    pendiente(
      'no se pudieron leer las suscripciones del webhook',
      ultimoErrorGraph,
      'Comprobar el webhook en el panel de Meta'
    )
  } else {
    const porObjeto = new Map((subs.data ?? []).map((s) => [s.object ?? '', s]))
    if (porObjeto.size === 0) {
      no(
        'la app no tiene NINGÚN webhook dado de alta',
        'sin esto no llega `account_update`, y sin `account_update` el alta incrustada de WhatsApp no se completa',
        `Dar de alta el webhook en el panel: URL ${PUBLICA ? URL_WEBHOOK : '<url pública>/api/connect/meta/webhook'} y el token de META_WEBHOOK_VERIFY_TOKEN`
      )
    }
    for (const [objeto, exigidos] of Object.entries(CAMPOS_EXIGIDOS)) {
      const s = porObjeto.get(objeto)
      if (!s) {
        no(
          `webhook · ${objeto}: sin suscribir`,
          `faltan los campos ${exigidos.join(', ')}`,
          `Suscribir el objeto ${objeto} con los campos: ${exigidos.join(', ')}`
        )
        continue
      }
      const tiene = new Set((s.fields ?? []).map((f) => f.name).filter(Boolean) as string[])
      const faltan = exigidos.filter((f) => !tiene.has(f))
      if (faltan.length) {
        no(
          `webhook · ${objeto}: campos incompletos`,
          `faltan ${faltan.join(', ')}`,
          `Añadir al objeto ${objeto} los campos: ${faltan.join(', ')}`
        )
      } else if (s.active === false) {
        no(`webhook · ${objeto}: suscrito pero INACTIVO`, undefined, `Reactivar el webhook de ${objeto}`)
      } else {
        si(`webhook · ${objeto}`, `${exigidos.length} campos exigidos, todos presentes`)
      }
      if (s.callback_url && PUBLICA && s.callback_url !== URL_WEBHOOK) {
        pendiente(
          `webhook · ${objeto}: apunta a otra URL`,
          `Meta llama a ${s.callback_url}, y esta verificación probó ${URL_WEBHOOK}`,
          `Actualizar la URL del webhook de ${objeto} a ${URL_WEBHOOK}`
        )
      }
    }
  }

  /**
   * Si hay un token de usuario de prueba a mano (`META_TOKEN_PRUEBA`, sacado
   * del Explorador de la Graph API), se mira lo único que de verdad decide si
   * Facebook e Instagram van a funcionar: los permisos concedidos y las dos
   * caducidades que el código vigila.
   */
  const tokenPrueba = process.env.META_TOKEN_PRUEBA?.trim()
  if (!tokenPrueba) {
    pendiente(
      'permisos concedidos: no comprobados',
      'para verlos, genera un token en el Explorador de la Graph API y relanza con META_TOKEN_PRUEBA=… (no se imprime)'
    )
  } else {
    const d = await graph<{
      data?: {
        is_valid?: boolean
        scopes?: string[]
        expires_at?: number
        data_access_expires_at?: number
      }
    }>('/debug_token', {
      input_token: tokenPrueba,
      access_token: tokenApp,
      appsecret_proof: pruebaDeSecreto(tokenApp, SECRETO),
    })
    if (!d?.data?.is_valid) {
      no('el token de prueba no es válido', ultimoErrorGraph)
    } else {
      const concedidos = new Set(d.data.scopes ?? [])
      for (const [nombre, lista] of [
        ['WhatsApp', PERMISOS_META],
        ['Páginas e Instagram', PERMISOS_META_PAGINAS],
      ] as const) {
        const faltan = lista.filter((p) => !concedidos.has(p))
        if (faltan.length) pendiente(`permisos de ${nombre}: faltan ${faltan.join(', ')}`)
        else si(`permisos de ${nombre}: los ${lista.length} concedidos`)
      }
      const sobran = [...concedidos].filter(
        (p) =>
          !([...PERMISOS_META, ...PERMISOS_META_PAGINAS] as readonly string[]).includes(p) &&
          p !== 'public_profile'
      )
      if (sobran.length)
        pendiente(
          `permisos de más: ${sobran.join(', ')}`,
          'pedir de más es causa habitual de rechazo en la revisión de Meta'
        )

      const dias = (s?: number) => (s ? Math.round((s * 1000 - Date.now()) / 86_400_000) : null)
      const caduca = dias(d.data.expires_at)
      const datos = dias(d.data.data_access_expires_at)
      si(
        'caducidades',
        `${caduca === null || d.data.expires_at === 0 ? 'el token no caduca' : `el token caduca en ${caduca} días`}` +
          `${datos !== null ? `; el acceso a datos, en ${datos} días` : ''}`
      )
    }
  }
}

// ─── 7 · Lo que queda ────────────────────────────────────────────────────────

titulo('───────────────────────────────────────────────────────────────────')
console.log(
  `${pasadas} comprobaciones pasadas, ${fallidas} fallidas, ${pendientes} sin poder decidir.`
)

if (pasadas === 0) {
  console.log('\nNinguna comprobación llegó a ejecutarse: eso NO es un éxito.')
}

if (loQueFalta.length) {
  console.log('\nPara cerrar la Fase 0:\n')
  for (const [i, tarea] of loQueFalta.entries()) console.log(`  ${i + 1}. ${tarea}`)
}

console.log(
  [
    '',
    'Lo que este script NO puede comprobar por ti, porque son trámites de Meta:',
    '  · Verificación del Negocio (sin ella, límite de 10 altas de WhatsApp por 7 días)',
    '  · App Review de pages_messaging e instagram_manage_messages (vídeo por permiso)',
    '  · Onboarding como Proveedor de Tecnología',
    '  · «Require App Secret» activado en Configuración · Avanzada',
    '',
    'Y las tres dudas marcadas ⚠ en docs/connect/meta-arquitectura.md solo se',
    'resuelven con la primera prueba real: los `extras` del alta incrustada v4,',
    'el cuerpo del envío de plantilla y la forma de delivery/read de Messenger.',
  ].join('\n')
)

process.exitCode = fallidas > 0 ? 1 : 0
