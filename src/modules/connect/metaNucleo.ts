import { createHmac, randomInt, timingSafeEqual } from 'node:crypto'

/**
 * Lo que TAMBIÉN corre en el navegador vive en `metaNavegador.ts` —importar
 * este archivo desde un componente de cliente arrastraría `node:crypto` al
 * paquete y el build se cae— y se reexporta aquí para que el servidor siga
 * importando de un solo sitio.
 */
export {
  MARGEN_CANJE_MS,
  ORIGENES_META,
  TTL_CODIGO_MS,
  codigoCaducado,
  crearRecolector,
  leerMensajeMeta,
  leerRespuestaAlta,
  origenDeMeta,
  type LecturaRespuesta,
  type MensajeMeta,
  type Recolector,
  type RespuestaAlta,
} from '@/modules/connect/metaNavegador'

/**
 * META · núcleo puro del Alta Incrustada (Connect · Fase 14).
 *
 * Sin `server-only`, sin red, sin base: todo lo que se puede decidir sin salir
 * de aquí vive aquí y se prueba de verdad.
 *
 * Los requisitos y sus fuentes están en
 * `docs/connect/whatsapp-embedded-signup.md`. Los tres datos que gobiernan
 * este archivo:
 *
 *   · el código que devuelve Meta vive TREINTA SEGUNDOS;
 *   · los permisos son exactamente dos, y pedir de más es causa habitual de
 *     rechazo en la revisión de Meta;
 *   · la versión 2 del alta se retira el 15 de octubre de 2026, así que esto
 *     se construye contra la v4.
 */

/**
 * LOS DOS PERMISOS, Y NI UNO MÁS.
 *
 *   whatsapp_business_management  la cuenta del cliente y sus plantillas
 *   whatsapp_business_messaging   el número y el envío/recepción
 *
 * Meta avisa de que pedir permisos innecesarios es una causa habitual de
 * rechazo en la revisión de la app. Añadir uno aquí sin necesitarlo cuesta
 * semanas de trámite.
 */
export const PERMISOS_META = [
  'whatsapp_business_management',
  'whatsapp_business_messaging',
] as const

/** Versión de la Graph API por defecto. Se puede fijar por entorno. */
export const VERSION_GRAPH_POR_DEFECTO = 'v25.0'

export interface ConfigMeta {
  appId: string
  configId: string
  versionGraph: string
  /** NOMBRE de la variable del secreto, nunca su valor. */
  appSecretEnv: string
}

/**
 * La configuración de la plataforma, o null si este despliegue no la tiene.
 *
 * Es la MISMA regla que gobierna Google: lo que no está configurado no se
 * ofrece. Sin estas variables, WhatsApp sigue funcionando con el token manual
 * y nadie ve un botón que lleva a una pantalla rota de Meta.
 *
 * El secreto NO viaja en esta estructura: viaja el nombre de su variable, y el
 * valor se lee en el momento de canjear. Un secreto dentro de un objeto acaba,
 * tarde o temprano, en un log.
 */
export function configMetaDesdeEntorno(
  // `Record` y no `NodeJS.ProcessEnv`: lo que hace falta es leer tres claves,
  // y exigir el tipo completo del entorno obligaría a las pruebas a fabricar
  // un `process.env` entero para comprobar una variable que falta.
  entorno: Record<string, string | undefined> = process.env
): ConfigMeta | null {
  const appId = entorno.NEXT_PUBLIC_META_APP_ID?.trim()
  const configId = entorno.NEXT_PUBLIC_META_CONFIG_ID?.trim()
  // El secreto no se devuelve, pero SÍ se comprueba que exista: sin él el alta
  // llegaría hasta el diálogo de Meta y moriría al canjear, que es el peor
  // momento posible para descubrirlo.
  const secreto = entorno.META_APP_SECRET?.trim()
  // EL TOKEN DEL WEBHOOK CUENTA COMO CONFIGURACIÓN (F14.1 · punto 8).
  //
  // Sin él, Meta no puede dar de alta nuestra URL, y sin URL dada de alta no
  // llega `account_update` — que es requisito del alta incrustada. Ofrecer el
  // botón sin esto produce conexiones que parecen buenas y nacen sordas.
  const tokenWebhook = entorno.META_WEBHOOK_VERIFY_TOKEN?.trim()
  if (!appId || !configId || !secreto || !tokenWebhook) return null
  return {
    appId,
    configId,
    versionGraph: entorno.META_GRAPH_VERSION?.trim() || VERSION_GRAPH_POR_DEFECTO,
    appSecretEnv: 'META_APP_SECRET',
  }
}

/**
 * LOS PERMISOS DE «FACEBOOK E INSTAGRAM» (Meta · Fase 3), mínimo privilegio:
 *
 *   pages_show_list             listar las Páginas que administra
 *   pages_manage_metadata       suscribir la app a los avisos de la Página
 *   pages_messaging             Messenger: recibir y enviar
 *   instagram_basic             la cuenta profesional enlazada a la Página
 *   instagram_manage_messages   los mensajes directos de Instagram
 *
 * No se piden `pages_read_engagement`, `pages_manage_posts`,
 * `instagram_manage_comments` ni `instagram_content_publish`: no publicamos ni
 * leemos el muro. Para servir a empresas ajenas cada uno necesita Acceso
 * avanzado vía App Review.
 */
export const PERMISOS_META_PAGINAS = [
  'pages_show_list',
  'pages_manage_metadata',
  'pages_messaging',
  'instagram_basic',
  'instagram_manage_messages',
] as const

/**
 * La configuración de Login for Business para Páginas e Instagram: la MISMA
 * app y el mismo secreto que WhatsApp, pero otra configuración (token de
 * usuario, otros permisos). Sin las cuatro variables no se ofrece.
 */
export function configMetaPaginasDesdeEntorno(
  entorno: Record<string, string | undefined> = process.env
): ConfigMeta | null {
  const appId = entorno.NEXT_PUBLIC_META_APP_ID?.trim()
  const configId = entorno.NEXT_PUBLIC_META_CONFIG_ID_PAGES?.trim()
  const secreto = entorno.META_APP_SECRET?.trim()
  const tokenWebhook = entorno.META_WEBHOOK_VERIFY_TOKEN?.trim()
  if (!appId || !configId || !secreto || !tokenWebhook) return null
  return {
    appId,
    configId,
    versionGraph: entorno.META_GRAPH_VERSION?.trim() || VERSION_GRAPH_POR_DEFECTO,
    appSecretEnv: 'META_APP_SECRET',
  }
}

export function metaPaginasConfigurado(
  entorno: Record<string, string | undefined> = process.env
): boolean {
  return configMetaPaginasDesdeEntorno(entorno) !== null
}

/** ¿Puede este despliegue ofrecer el alta incrustada? */
export function metaConfigurado(
  entorno: Record<string, string | undefined> = process.env
): boolean {
  return configMetaDesdeEntorno(entorno) !== null
}

/**
 * LA VERSIÓN DE GRAPH, UNA PARA TODO. Antes el envío llevaba una fija (v21)
 * y el alta otra configurable (v25): dos versiones son dos comportamientos y
 * dos fechas de retirada que vigilar. Se lee aunque el alta incrustada no
 * esté configurada, porque el envío con token manual también la usa.
 */
export function versionGraphDesdeEntorno(
  entorno: Record<string, string | undefined> = process.env
): string {
  return entorno.META_GRAPH_VERSION?.trim() || VERSION_GRAPH_POR_DEFECTO
}

/**
 * `appsecret_proof`: HMAC-SHA256 del token de acceso con el secreto de la
 * app, en hexadecimal (Graph API · «Securing requests»). Va en cada llamada
 * de servidor que lleve token: con él, un token robado no sirve desde ningún
 * sitio que no tenga además el secreto, y Meta permite EXIGIRLO en el panel.
 */
export function pruebaDeSecreto(token: string, secreto: string): string {
  return createHmac('sha256', secreto).update(token, 'utf8').digest('hex')
}

export function urlGraph(version: string, ruta: string): string {
  const limpia = ruta.startsWith('/') ? ruta : `/${ruta}`
  return `https://graph.facebook.com/${version}${limpia}`
}

// ─── El PIN de verificación en dos pasos ─────────────────────────────────────

/**
 * META EXIGE UN PIN DE SEIS DÍGITOS al registrar un número
 * (`POST /{phoneNumberId}/register`, campo `pin`). Es el de la verificación en
 * dos pasos de esa cuenta, y sin él la llamada falla — la Fase 14 lo omitía.
 *
 * Se GENERA aquí, no se le pide a nadie: es un secreto operativo entre Membego
 * y Meta, no algo que la empresa tenga que inventar y recordar. Se guarda
 * dentro de la credencial sellada (AES-256-GCM) junto al token, y de ahí se
 * recupera si hay que volver a registrar el número.
 *
 * `randomInt` del módulo criptográfico y no `Math.random()`: un PIN predecible
 * es un PIN que no protege nada.
 *
 * ⚠ CUIDADO CON LOS REINTENTOS: Meta limita el registro a 10 llamadas por
 * número en una ventana móvil de 72 horas (error 133016). Reintentarlo en
 * bucle deja el número bloqueado tres días.
 */
export const LONGITUD_PIN = 6
export const MAX_REGISTROS_72H = 10
export const ERROR_META_LIMITE_REGISTRO = 133016

export function generarPin(): string {
  // Rango completo de seis dígitos, incluidos los que empiezan por cero: se
  // formatea con relleno en vez de recortar el espacio a 900 000 valores.
  return String(randomInt(0, 10 ** LONGITUD_PIN)).padStart(LONGITUD_PIN, '0')
}

export function pinValido(pin: string): boolean {
  return new RegExp(`^\\d{${LONGITUD_PIN}}$`).test(pin)
}

// ─── Webhooks entrantes ──────────────────────────────────────────────────────

/**
 * FIRMA DEL WEBHOOK de Meta (`X-Hub-Signature-256`).
 *
 * Sin esta comprobación, cualquiera que conozca nuestra URL puede decirnos que
 * una empresa completó el alta. Se compara en TIEMPO CONSTANTE: una comparación
 * normal filtra, por lo que tarda, cuántos bytes iniciales acertó quien lo
 * intenta, y eso permite adivinar una firma byte a byte.
 *
 * El cuerpo tiene que ser el CRUDO, tal cual llegó. Si se parsea y se vuelve a
 * serializar, cualquier diferencia de formato rompe la firma de un aviso
 * legítimo.
 */
export function firmaWebhookValida(
  cuerpoCrudo: string,
  cabecera: string | null,
  secreto: string
): boolean {
  if (!cabecera || !secreto) return false
  const [algoritmo, recibidaHex] = cabecera.split('=')
  if (algoritmo !== 'sha256' || !recibidaHex) return false

  let recibida: Buffer
  try {
    recibida = Buffer.from(recibidaHex, 'hex')
  } catch {
    return false
  }
  const esperada = createHmac('sha256', secreto).update(cuerpoCrudo, 'utf8').digest()
  // `timingSafeEqual` EXIGE longitudes iguales: comparar antes evita que lance
  // y, de paso, descarta una firma de otro algoritmo sin filtrar nada.
  if (recibida.length !== esperada.length) return false
  return timingSafeEqual(recibida, esperada)
}

/**
 * El apretón de manos que Meta hace al dar de alta la URL: llega por GET con un
 * `hub.verify_token` que tiene que coincidir con el nuestro, y hay que
 * devolver el `hub.challenge` tal cual.
 */
export function respuestaDeVerificacion(
  params: URLSearchParams,
  tokenEsperado: string
): { ok: true; challenge: string } | { ok: false } {
  if (!tokenEsperado) return { ok: false }
  if (params.get('hub.mode') !== 'subscribe') return { ok: false }
  if (params.get('hub.verify_token') !== tokenEsperado) return { ok: false }
  const challenge = params.get('hub.challenge')
  if (!challenge) return { ok: false }
  return { ok: true, challenge }
}
