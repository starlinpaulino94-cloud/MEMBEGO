import 'server-only'
import { Prisma } from '@prisma/client'
import { conEmpresa } from '@/lib/tenant'
import { guardarCredencial } from '@/modules/connect/credenciales'
import { anotarConector } from '@/modules/connect/bitacora'
import {
  ERROR_META_LIMITE_REGISTRO,
  PERMISOS_META,
  configMetaDesdeEntorno,
  generarPin,
  pruebaDeSecreto,
  urlGraph,
  type ConfigMeta,
  type RespuestaAlta,
} from '@/modules/connect/metaNucleo'
import { reclamarActivo } from '@/modules/connect/meta/activos'
import { claseDeEstadoHttp, claseDeFalloDeRed, type ClaseError } from '@/modules/connect/proveedores/tipos'

/**
 * META · ALTA INCRUSTADA, lado servidor (Fase 14 · endurecido en la 14.1).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE LA AUDITORÍA CORRIGIÓ, Y POR QUÉ IMPORTA CADA COSA
 *
 * 1. NO SE CONFÍA EN LOS IDENTIFICADORES DEL NAVEGADOR. El WABA y el número
 *    llegan de una ventana ajena. Antes de tocar nada se le pregunta a META
 *    quién los tiene: `debug_token` dice qué permisos concedió de verdad y
 *    SOBRE QUÉ CUENTAS, y la lista de números de esa cuenta dice si el número
 *    es suyo. Sin esto, un identificador fabricado nos habría hecho registrar
 *    y suscribir el número de otro.
 *
 * 2. EL REGISTRO LLEVA PIN. Meta lo exige (`pin`, seis dígitos) y la Fase 14
 *    lo omitía: la llamada fallaba siempre.
 *
 * 3. LA CUENTA SE RECLAMA EN LA BASE, con UNIQUE. Así el webhook sabe de quién
 *    es lo que le llega sin buscar en un JSON.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LOS TREINTA SEGUNDOS SIGUEN MANDANDO
 *
 * El código caduca en medio minuto, así que se canjea PRIMERO. Todo lo demás
 * —validar, reclamar, registrar, suscribir— usa el token, que no caduca en
 * segundos y se puede reintentar.
 *
 * NADA DE ESTO SE HA EJECUTADO CONTRA META.
 */

const TIMEOUT_MS = 10_000

/**
 * Con `appsecret_proof` (Fase 1): cada llamada con el token del cliente lleva
 * el HMAC del token con nuestro secreto. Un token robado no sirve desde otro
 * sitio, y Meta permite exigirlo en el panel («Require App Secret»).
 */
function conPrueba(url: string, token: string, config: ConfigMeta): string {
  const secreto = process.env[config.appSecretEnv] ?? ''
  const u = new URL(url)
  u.searchParams.set('appsecret_proof', pruebaDeSecreto(token, secreto))
  return u.toString()
}

/** Las fases, en orden. Se anotan una a una para poder ver dónde se cae. */
export type FaseAlta =
  | 'config'
  | 'canje'
  | 'verificacion'
  | 'propiedad'
  | 'reclamo'
  | 'registro'
  | 'webhooks'
  | 'guardado'

export type Fallo = { ok: false; fase: FaseAlta; detalle: string; clase: ClaseError }
export type Exito = { ok: true; numeroVisible: string | null }

/** Lo que se guarda sellado. El PIN va DENTRO: es un secreto como el token. */
interface CredencialWhatsappMeta {
  token: string
  phoneNumberId: string
  wabaId: string
  /** El PIN de verificación en dos pasos, para poder volver a registrar. */
  pin: string
  numeroVisible?: string
  origen: 'embedded_signup'
}

// ─── Observabilidad ──────────────────────────────────────────────────────────

interface Respuesta {
  status: number
  /** `x-fb-trace-id`: el identificador con el que Meta puede buscar la llamada. */
  requestId: string | null
  /** Mensaje corto y SANEADO. Nunca el cuerpo entero. */
  mensaje: string
  codigo: number | null
}

/**
 * Del cuerpo de error de Meta se leen SOLO cuatro cosas: el estado, su código,
 * su mensaje recortado y el identificador de traza.
 *
 * El resto no se toca ni se registra: ahí viajan el número del cliente y, en un
 * eco de autorización fallida, el propio token.
 */
async function leerRespuesta(resp: Response): Promise<Respuesta> {
  const requestId = resp.headers.get('x-fb-trace-id')
  try {
    const json = (await resp.json()) as {
      error?: { message?: string; code?: number; error_subcode?: number }
    }
    return {
      status: resp.status,
      requestId,
      mensaje: typeof json.error?.message === 'string' ? json.error.message.slice(0, 200) : '',
      codigo: typeof json.error?.code === 'number' ? json.error.code : null,
    }
  } catch {
    return { status: resp.status, requestId, mensaje: '', codigo: null }
  }
}

/**
 * Deja constancia técnica de una fase. Es lo que se mira cuando una empresa
 * dice «no me deja conectar»: fase, estado HTTP, clase de error, traza de Meta
 * y su mensaje saneado. Nada de esto sale a pantalla.
 */
async function anotarFase(input: {
  companyId: string
  conexionId: string
  fase: FaseAlta
  ok: boolean
  respuesta?: Respuesta
  clase?: ClaseError
}): Promise<void> {
  await anotarConector({
    companyId: input.companyId,
    origen: 'CONEXION',
    origenId: input.conexionId,
    nivel: input.ok ? 'INFO' : 'WARN',
    evento: input.ok ? 'meta.alta.paso' : 'meta.alta.fallo',
    detalle: {
      fase: input.fase,
      status: input.respuesta?.status ?? null,
      codigoMeta: input.respuesta?.codigo ?? null,
      requestId: input.respuesta?.requestId ?? null,
      claseError: input.clase ?? null,
      mensaje: input.respuesta?.mensaje ?? '',
    },
  })
}

function claseDeMeta(r: Respuesta): ClaseError {
  // `status: 0` es nuestra marca de «no hubo respuesta»: se cortó la red o se
  // agotó el tiempo. No dice nada de la cuenta del cliente, así que NETWORK y
  // no UNKNOWN — la diferencia decide si se reintenta o si se le pide a
  // alguien que reconecte una cuenta que está perfectamente.
  if (r.status === 0) return claseDeFalloDeRed()
  // Meta usa 4xx para el límite de registros (10 por número en 72 horas):
  // tratarlo como error de permisos pediría reconectar sin motivo.
  if (r.codigo === ERROR_META_LIMITE_REGISTRO) return 'RATE_LIMIT'
  return claseDeEstadoHttp(r.status)
}

// ─── Fase 1 · Canjear (lo único que corre contra reloj) ──────────────────────

async function canjearCodigo(
  config: ConfigMeta,
  code: string
): Promise<{ ok: true; token: string } | { ok: false; respuesta: Respuesta }> {
  const secreto = process.env[config.appSecretEnv] ?? ''
  const url = new URL(urlGraph(config.versionGraph, '/oauth/access_token'))
  url.searchParams.set('client_id', config.appId)
  url.searchParams.set('client_secret', secreto)
  url.searchParams.set('code', code)

  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!resp.ok) return { ok: false, respuesta: await leerRespuesta(resp) }
    const json = (await resp.json()) as { access_token?: string }
    if (!json.access_token) {
      return {
        ok: false,
        respuesta: {
          status: resp.status,
          requestId: resp.headers.get('x-fb-trace-id'),
          mensaje: 'sin access_token en la respuesta',
          codigo: null,
        },
      }
    }
    return { ok: true, token: json.access_token }
  } catch {
    // El mensaje de la excepción lleva la URL, y la URL lleva el secreto.
    return { ok: false, respuesta: { status: 0, requestId: null, mensaje: 'red', codigo: null } }
  }
}

// ─── Fase 2 · Qué concedió DE VERDAD, y sobre qué cuentas ────────────────────

interface Concesion {
  permisos: string[]
  /** WABAs que concedieron permisos a nuestra app, según Meta. */
  cuentas: string[]
}

/**
 * `debug_token` con el token de la APP (no el del cliente): devuelve si el
 * token vale, qué permisos tiene y —en `granular_scopes`— los IDs de las
 * cuentas que concedieron cada uno.
 *
 * Es la única fuente fiable de «esta empresa nos autorizó sobre ESTA cuenta».
 */
async function concesionesDelToken(
  config: ConfigMeta,
  token: string
): Promise<{ ok: true; concesion: Concesion } | { ok: false; respuesta: Respuesta }> {
  const secreto = process.env[config.appSecretEnv] ?? ''
  const url = new URL(urlGraph(config.versionGraph, '/debug_token'))
  url.searchParams.set('input_token', token)
  url.searchParams.set('access_token', `${config.appId}|${secreto}`)

  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!resp.ok) return { ok: false, respuesta: await leerRespuesta(resp) }
    const json = (await resp.json()) as {
      data?: {
        is_valid?: boolean
        scopes?: string[]
        granular_scopes?: { scope?: string; target_ids?: string[] }[]
      }
    }
    const datos = json.data
    if (!datos?.is_valid) {
      return {
        ok: false,
        respuesta: {
          status: resp.status,
          requestId: resp.headers.get('x-fb-trace-id'),
          mensaje: 'token no válido según Meta',
          codigo: null,
        },
      }
    }
    const cuentas = new Set<string>()
    for (const g of datos.granular_scopes ?? []) {
      if (!g.scope || !(PERMISOS_META as readonly string[]).includes(g.scope)) continue
      for (const id of g.target_ids ?? []) cuentas.add(id)
    }
    return { ok: true, concesion: { permisos: datos.scopes ?? [], cuentas: [...cuentas] } }
  } catch {
    return { ok: false, respuesta: { status: 0, requestId: null, mensaje: 'red', codigo: null } }
  }
}

// ─── Fase 3 · ¿El número es de esa cuenta? ───────────────────────────────────

async function numeroPerteneceAlWaba(
  config: ConfigMeta,
  token: string,
  wabaId: string,
  phoneNumberId: string
): Promise<
  { ok: true; pertenece: boolean; numeroVisible: string | null } | { ok: false; respuesta: Respuesta }
> {
  try {
    const resp = await fetch(
      conPrueba(
        `${urlGraph(config.versionGraph, `/${wabaId}/phone_numbers`)}?fields=id,display_phone_number&limit=100`,
        token,
        config
      ),
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) }
    )
    if (!resp.ok) return { ok: false, respuesta: await leerRespuesta(resp) }
    const json = (await resp.json()) as {
      data?: { id?: string; display_phone_number?: string }[]
    }
    const encontrado = (json.data ?? []).find((n) => n.id === phoneNumberId)
    return {
      ok: true,
      pertenece: Boolean(encontrado),
      numeroVisible: encontrado?.display_phone_number ?? null,
    }
  } catch {
    return { ok: false, respuesta: { status: 0, requestId: null, mensaje: 'red', codigo: null } }
  }
}

// ─── Fase 5 · Registrar (con PIN) ────────────────────────────────────────────

async function registrarNumero(
  config: ConfigMeta,
  token: string,
  phoneNumberId: string,
  pin: string
): Promise<{ ok: true } | { ok: false; respuesta: Respuesta }> {
  try {
    const resp = await fetch(conPrueba(urlGraph(config.versionGraph, `/${phoneNumberId}/register`), token, config), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      // `pin` es OBLIGATORIO: es el de la verificación en dos pasos del número.
      body: JSON.stringify({ messaging_product: 'whatsapp', pin }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!resp.ok) {
      const r = await leerRespuesta(resp)
      // Un número YA registrado no es un fallo del alta: es quien reconecta.
      if (/already registered|already exists/i.test(r.mensaje)) return { ok: true }
      return { ok: false, respuesta: r }
    }
    return { ok: true }
  } catch {
    return { ok: false, respuesta: { status: 0, requestId: null, mensaje: 'red', codigo: null } }
  }
}

// ─── Fase 6 · Suscribir los webhooks de la cuenta del cliente ────────────────

async function suscribirWebhooks(
  config: ConfigMeta,
  token: string,
  wabaId: string
): Promise<{ ok: true } | { ok: false; respuesta: Respuesta }> {
  try {
    const resp = await fetch(conPrueba(urlGraph(config.versionGraph, `/${wabaId}/subscribed_apps`), token, config), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!resp.ok) return { ok: false, respuesta: await leerRespuesta(resp) }
    return { ok: true }
  } catch {
    return { ok: false, respuesta: { status: 0, requestId: null, mensaje: 'red', codigo: null } }
  }
}

// ─── El alta completa ────────────────────────────────────────────────────────

export async function completarAltaMeta(input: {
  companyId: string
  conexionId: string
  respuesta: RespuestaAlta
}): Promise<Exito | Fallo> {
  const { companyId, conexionId } = input
  const { code, wabaId, phoneNumberId } = input.respuesta

  const fallo = async (
    fase: FaseAlta,
    detalle: string,
    clase: ClaseError,
    respuesta?: Respuesta
  ): Promise<Fallo> => {
    await anotarFase({ companyId, conexionId, fase, ok: false, respuesta, clase })
    return { ok: false, fase, detalle, clase }
  }

  const config = configMetaDesdeEntorno()
  if (!config) {
    return fallo('config', 'El alta con Meta no está configurada aquí.', 'CONFIGURATION')
  }

  // 1 · CANJE (contra reloj)
  const canje = await canjearCodigo(config, code)
  if (!canje.ok) {
    return fallo('canje', 'La autorización no se pudo canjear.', claseDeMeta(canje.respuesta), canje.respuesta)
  }
  const token = canje.token

  // 2 · QUÉ CONCEDIÓ DE VERDAD, y sobre qué cuentas
  const concesiones = await concesionesDelToken(config, token)
  if (!concesiones.ok) {
    return fallo('verificacion', 'No pudimos verificar la autorización con Meta.', claseDeMeta(concesiones.respuesta), concesiones.respuesta)
  }
  for (const permiso of PERMISOS_META) {
    if (!concesiones.concesion.permisos.includes(permiso)) {
      return fallo('verificacion', 'Faltan permisos por conceder. Vuelve a intentarlo y acepta todas las casillas.', 'PERMISSIONS')
    }
  }
  // LA CUENTA TIENE QUE ESTAR ENTRE LAS QUE NOS AUTORIZARON. Sin esto, un
  // identificador fabricado en el navegador nos haría operar sobre la cuenta
  // de otro.
  if (!concesiones.concesion.cuentas.includes(wabaId)) {
    return fallo('propiedad', 'Esa cuenta de WhatsApp no coincide con la que autorizaste.', 'PERMISSIONS')
  }

  // 3 · Y EL NÚMERO TIENE QUE SER DE ESA CUENTA
  const pertenencia = await numeroPerteneceAlWaba(config, token, wabaId, phoneNumberId)
  if (!pertenencia.ok) {
    return fallo('propiedad', 'No pudimos comprobar el número con Meta.', claseDeMeta(pertenencia.respuesta), pertenencia.respuesta)
  }
  if (!pertenencia.pertenece) {
    return fallo('propiedad', 'Ese número no pertenece a la cuenta de WhatsApp que autorizaste.', 'PERMISSIONS')
  }

  // 4 · RECLAMAR LA CUENTA EN LA BASE, antes de tocar nada en Meta.
  //     El UNIQUE es lo que impide que dos empresas se queden con el mismo
  //     WABA y que el webhook atribuya mal lo que llegue.
  try {
    await conEmpresa(companyId, (tx) =>
      tx.conexionEmpresa.update({
        where: { id: conexionId },
        data: { cuentaExterna: wabaId, recursoExterno: phoneNumberId },
      })
    )
  } catch (e) {
    const duplicado = e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
    return fallo(
      'reclamo',
      duplicado
        ? 'Esa cuenta de WhatsApp ya está conectada a otro negocio en Membego. Desconéctala allí primero.'
        : 'No se pudo preparar la conexión.',
      duplicado ? 'CONFIGURATION' : 'UNKNOWN'
    )
  }

  // 4b · Y EN ACTIVOS (Fase 1): el WABA y el número, con el mismo UNIQUE. Es
  //      por donde resuelve el webhook a partir de ahora; la columna de la
  //      conexión se conserva por compatibilidad con lo ya conectado.
  const activoWaba = await reclamarActivo({ companyId, conexionId, tipo: 'WABA', idExterno: wabaId })
  if (!activoWaba.ok) {
    return fallo(
      'reclamo',
      activoWaba.motivo === 'otra_empresa'
        ? 'Esa cuenta de WhatsApp ya está conectada a otro negocio en Membego. Desconéctala allí primero.'
        : 'No se pudo preparar la conexión.',
      'CONFIGURATION'
    )
  }
  const activoNumero = await reclamarActivo({
    companyId,
    conexionId,
    tipo: 'PHONE_NUMBER',
    idExterno: phoneNumberId,
    nombre: pertenencia.numeroVisible,
    padreId: activoWaba.id,
  })
  if (!activoNumero.ok) {
    return fallo(
      'reclamo',
      activoNumero.motivo === 'otra_empresa'
        ? 'Ese número ya está conectado a otro negocio en Membego. Desconéctalo allí primero.'
        : 'No se pudo preparar la conexión.',
      'CONFIGURATION'
    )
  }

  // 5 · REGISTRAR EL NÚMERO, con su PIN.
  const pin = generarPin()
  const registro = await registrarNumero(config, token, phoneNumberId, pin)
  if (!registro.ok) {
    const clase = claseDeMeta(registro.respuesta)
    return fallo(
      'registro',
      clase === 'RATE_LIMIT'
        ? 'Meta bloqueó temporalmente el alta de este número por demasiados intentos. Vuelve a probar en unas horas.'
        : 'Meta no pudo dar de alta tu número para enviar mensajes.',
      clase,
      registro.respuesta
    )
  }

  // 6 · SUSCRIBIR LOS WEBHOOKS de su cuenta.
  const suscripcion = await suscribirWebhooks(config, token, wabaId)
  if (!suscripcion.ok) {
    return fallo('webhooks', 'Tu cuenta se autorizó, pero no pudimos activar los avisos.', claseDeMeta(suscripcion.respuesta), suscripcion.respuesta)
  }

  // 7 · GUARDAR. El PIN va sellado junto al token: hace falta para volver a
  //     registrar el número si algún día se cae.
  const credencial: CredencialWhatsappMeta = {
    token,
    phoneNumberId,
    wabaId,
    pin,
    numeroVisible: pertenencia.numeroVisible ?? undefined,
    origen: 'embedded_signup',
  }
  const guardada = await guardarCredencial({
    companyId,
    conexionId,
    tipo: 'API_KEY',
    secreto: JSON.stringify(credencial),
    // En metadata solo lo que se puede enseñar sin abrir el sello. El PIN NO.
    metadata: {
      numero: pertenencia.numeroVisible,
      wabaId,
      origen: 'embedded_signup',
    },
  })
  if (!guardada.ok) {
    return fallo(
      'guardado',
      guardada.motivo === 'sin_clave_maestra'
        ? 'El almacén de credenciales no está configurado en este despliegue.'
        : 'No se encontró la conexión.',
      'CONFIGURATION'
    )
  }

  await anotarFase({ companyId, conexionId, fase: 'guardado', ok: true })
  return { ok: true, numeroVisible: pertenencia.numeroVisible }
}
