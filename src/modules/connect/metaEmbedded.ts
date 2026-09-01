import 'server-only'
import { guardarCredencial } from '@/modules/connect/credenciales'
import { anotarConector } from '@/modules/connect/bitacora'
import {
  configMetaDesdeEntorno,
  urlGraph,
  type ConfigMeta,
  type RespuestaAlta,
} from '@/modules/connect/metaNucleo'

/**
 * META · ALTA INCRUSTADA, lado servidor (Connect · Fase 14).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LOS TREINTA SEGUNDOS MANDAN
 *
 * El código que Meta devuelve al terminar el diálogo vive medio minuto. Todo
 * lo de aquí ocurre en una sola acción, disparada en cuanto el navegador
 * recibe el código — no al pulsar «siguiente», que puede no llegar nunca.
 *
 * Y por eso el orden importa: PRIMERO se canjea (lo que caduca) y solo después
 * se registra el número y se suscriben los webhooks (que no caducan y se
 * pueden reintentar).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * NADA DE ESTO SE HA EJECUTADO CONTRA META
 *
 * Se escribió contra la documentación pública vigente
 * (`docs/connect/whatsapp-embedded-signup.md`), sin app de Meta con la que
 * probarlo. Mientras las variables no existan, este camino ni se ofrece: el
 * conector enseña el guion del token manual. Que esté aquí no significa que
 * funcione; significa que está listo para probarse.
 */

const TIMEOUT_MS = 10_000

type Fallo = { ok: false; paso: string; detalle: string }
type Exito = { ok: true; numeroVisible: string | null }

/** Lo que se guarda sellado. Misma forma que el alta manual: el envío no cambia. */
interface CredencialWhatsappMeta {
  token: string
  phoneNumberId: string
  wabaId: string
  numeroVisible?: string
  /** De dónde salió el secreto. Para poder distinguirlas sin abrir el sello. */
  origen: 'embedded_signup'
}

/**
 * Del cuerpo de error de Meta se lee SOLO el mensaje corto. En el resto puede
 * viajar el número del cliente y, en un eco de autorización fallida, el propio
 * token.
 */
async function motivoDe(resp: Response): Promise<string> {
  try {
    const json = (await resp.json()) as { error?: { message?: string; type?: string } }
    const m = json.error?.message
    return typeof m === 'string' ? m.slice(0, 160) : `Meta respondió ${resp.status}`
  } catch {
    return `Meta respondió ${resp.status}`
  }
}

/**
 * PASO 1 · Canjear el código por el token de negocio del cliente.
 *
 * Es lo único que corre contra reloj. El secreto de la app se lee AQUÍ, del
 * entorno, y no viaja en ninguna estructura de datos.
 */
async function canjearCodigo(
  config: ConfigMeta,
  code: string
): Promise<{ ok: true; token: string } | Fallo> {
  const secreto = process.env[config.appSecretEnv]
  if (!secreto) {
    return { ok: false, paso: 'canje', detalle: 'Falta el secreto de la app en el servidor.' }
  }

  const url = new URL(urlGraph(config.versionGraph, '/oauth/access_token'))
  url.searchParams.set('client_id', config.appId)
  url.searchParams.set('client_secret', secreto)
  url.searchParams.set('code', code)

  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!resp.ok) return { ok: false, paso: 'canje', detalle: await motivoDe(resp) }
    const json = (await resp.json()) as { access_token?: string }
    if (!json.access_token) {
      return { ok: false, paso: 'canje', detalle: 'Meta no devolvió un token.' }
    }
    return { ok: true, token: json.access_token }
  } catch {
    // El mensaje de la excepción puede llevar la URL con el secreto dentro.
    return { ok: false, paso: 'canje', detalle: 'No se pudo contactar con Meta.' }
  }
}

/**
 * PASO 2 · Registrar el número para Cloud API.
 *
 * Sin esto el número existe en la cuenta del cliente pero no puede enviar por
 * la API, y el fallo aparecería semanas después en el primer envío real.
 */
async function registrarNumero(
  config: ConfigMeta,
  token: string,
  phoneNumberId: string
): Promise<{ ok: true } | Fallo> {
  try {
    const resp = await fetch(urlGraph(config.versionGraph, `/${phoneNumberId}/register`), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp' }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    // Un número YA registrado responde error, y no es un fallo del alta: es el
    // caso de quien reconecta. Se acepta y se sigue.
    if (!resp.ok) {
      const motivo = await motivoDe(resp)
      if (/already registered|already exists/i.test(motivo)) return { ok: true }
      return { ok: false, paso: 'registro', detalle: motivo }
    }
    return { ok: true }
  } catch {
    return { ok: false, paso: 'registro', detalle: 'No se pudo contactar con Meta.' }
  }
}

/**
 * PASO 3 · Suscribir nuestra app a los webhooks de la cuenta del cliente.
 *
 * Sin esto no llegan ni los estados de entrega ni las respuestas de sus
 * clientes. Es requisito del alta según la documentación de Meta.
 */
async function suscribirWebhooks(
  config: ConfigMeta,
  token: string,
  wabaId: string
): Promise<{ ok: true } | Fallo> {
  try {
    const resp = await fetch(urlGraph(config.versionGraph, `/${wabaId}/subscribed_apps`), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!resp.ok) return { ok: false, paso: 'webhooks', detalle: await motivoDe(resp) }
    return { ok: true }
  } catch {
    return { ok: false, paso: 'webhooks', detalle: 'No se pudo contactar con Meta.' }
  }
}

/** El número que se enseña, para que la empresa reconozca el suyo. */
async function numeroVisible(
  config: ConfigMeta,
  token: string,
  phoneNumberId: string
): Promise<string | null> {
  try {
    const resp = await fetch(
      `${urlGraph(config.versionGraph, `/${phoneNumberId}`)}?fields=display_phone_number`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) }
    )
    if (!resp.ok) return null
    const json = (await resp.json()) as { display_phone_number?: string }
    return json.display_phone_number ?? null
  } catch {
    return null
  }
}

/**
 * EL ALTA COMPLETA.
 *
 * Si algo falla DESPUÉS del canje, no se guarda la credencial: una conexión a
 * medias —con token pero sin número registrado— parecería sana y fallaría en
 * el primer envío. Es preferible que la empresa repita el diálogo.
 */
export async function completarAltaMeta(input: {
  companyId: string
  conexionId: string
  respuesta: RespuestaAlta
}): Promise<Exito | Fallo> {
  const config = configMetaDesdeEntorno()
  if (!config) {
    return { ok: false, paso: 'config', detalle: 'El alta con Meta no está configurada aquí.' }
  }

  const canje = await canjearCodigo(config, input.respuesta.code)
  if (!canje.ok) return canje

  const registro = await registrarNumero(config, canje.token, input.respuesta.phoneNumberId)
  if (!registro.ok) return registro

  const suscripcion = await suscribirWebhooks(config, canje.token, input.respuesta.wabaId)
  if (!suscripcion.ok) return suscripcion

  const visible = await numeroVisible(config, canje.token, input.respuesta.phoneNumberId)

  const credencial: CredencialWhatsappMeta = {
    token: canje.token,
    phoneNumberId: input.respuesta.phoneNumberId,
    wabaId: input.respuesta.wabaId,
    numeroVisible: visible ?? undefined,
    origen: 'embedded_signup',
  }

  const guardada = await guardarCredencial({
    companyId: input.companyId,
    conexionId: input.conexionId,
    tipo: 'API_KEY',
    secreto: JSON.stringify(credencial),
    // En metadata solo lo que se puede enseñar sin abrir el sello.
    metadata: { numero: visible, wabaId: input.respuesta.wabaId, origen: 'embedded_signup' },
  })
  if (!guardada.ok) {
    return {
      ok: false,
      paso: 'guardado',
      detalle:
        guardada.motivo === 'sin_clave_maestra'
          ? 'El almacén de credenciales no está configurado en este despliegue.'
          : 'No se encontró la conexión.',
    }
  }

  await anotarConector({
    companyId: input.companyId,
    origen: 'CONEXION',
    origenId: input.conexionId,
    evento: 'credencial.guardada',
    // Ni el token ni el código: solo de dónde vino y a qué cuenta apunta.
    detalle: { origen: 'embedded_signup', wabaId: input.respuesta.wabaId },
  })

  return { ok: true, numeroVisible: visible }
}
