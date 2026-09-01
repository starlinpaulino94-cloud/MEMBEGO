import { createHmac, timingSafeEqual } from 'node:crypto'

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
 * CUÁNTO VIVE EL CÓDIGO CANJEABLE. No es un detalle: es lo que obliga a que el
 * canje salga hacia el servidor EN CUANTO llega, sin esperar a que nadie pulse
 * «siguiente». Por eso el paso de Meta tiene su propia acción.
 */
export const TTL_CODIGO_MS = 30_000

/** Margen para no intentar canjear un código que ya casi seguro caducó. */
export const MARGEN_CANJE_MS = 3_000

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
  if (!appId || !configId || !secreto) return null
  return {
    appId,
    configId,
    versionGraph: entorno.META_GRAPH_VERSION?.trim() || VERSION_GRAPH_POR_DEFECTO,
    appSecretEnv: 'META_APP_SECRET',
  }
}

/** ¿Puede este despliegue ofrecer el alta incrustada? */
export function metaConfigurado(
  entorno: Record<string, string | undefined> = process.env
): boolean {
  return configMetaDesdeEntorno(entorno) !== null
}

export function urlGraph(version: string, ruta: string): string {
  const limpia = ruta.startsWith('/') ? ruta : `/${ruta}`
  return `https://graph.facebook.com/${version}${limpia}`
}

// ─── Lo que devuelve el diálogo ──────────────────────────────────────────────

export interface RespuestaAlta {
  code: string
  wabaId: string
  phoneNumberId: string
}

export type LecturaRespuesta =
  | { ok: true; datos: RespuestaAlta }
  | { ok: false; motivo: 'incompleta' | 'formato' }

/**
 * Lee lo que el diálogo de Meta manda al navegador. Viene de una ventana
 * ajena, así que NADA se da por bueno: ni que sea un objeto, ni que los
 * campos sean cadenas, ni que no vengan vacíos.
 *
 * No valida el CONTENIDO —eso solo lo puede decir Meta al canjear— sino la
 * forma. Un código inventado fallará en el canje, que es donde tiene que
 * fallar.
 */
export function leerRespuestaAlta(bruto: unknown): LecturaRespuesta {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return { ok: false, motivo: 'formato' }
  const o = bruto as Record<string, unknown>
  const code = typeof o.code === 'string' ? o.code.trim() : ''
  const wabaId = typeof o.wabaId === 'string' ? o.wabaId.trim() : ''
  const phoneNumberId = typeof o.phoneNumberId === 'string' ? o.phoneNumberId.trim() : ''
  if (!code || !wabaId || !phoneNumberId) return { ok: false, motivo: 'incompleta' }
  // Los identificadores de Meta son numéricos. Rechazarlos aquí evita que una
  // cadena arbitraria acabe formando parte de una URL de la Graph API.
  if (!/^\d{1,32}$/.test(wabaId) || !/^\d{1,32}$/.test(phoneNumberId)) {
    return { ok: false, motivo: 'formato' }
  }
  return { ok: true, datos: { code, wabaId, phoneNumberId } }
}

/** ¿Llegó tarde? Un código de hace más de 30 segundos ya no sirve. */
export function codigoCaducado(emitidoEnMs: number, ahoraMs = Date.now()): boolean {
  return ahoraMs - emitidoEnMs > TTL_CODIGO_MS - MARGEN_CANJE_MS
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
