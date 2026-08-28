import 'server-only'
import { anotarFallo, logErrorBd } from '@/lib/prisma-errors'
import {
  urlsTokens,
  apiCandidatos,
  montoEnteroMenor,
  interpretarCompraToken,
  desenvolverRespuesta,
  extraerPerfiles,
  sinSensibles,
  esIpValida,
  marcarCustomerIdConCuenta,
  leerCustomerIdDeCuenta,
  variantesDeRuta,
  normalizarAmbiente,
  reintentarConOtraGrafia,
  referenciaCobro,
  MONEDA_DOP_TOKENS,
  type AmbienteTokens,
  type ResultadoCompraToken,
  type PerfilPagoCardnet,
} from '@/lib/payments/cardnet-tokens-core'

export {
  urlsTokens,
  montoEnteroMenor,
  interpretarCompraToken,
  sinSensibles,
  type AmbienteTokens,
  type ResultadoCompraToken,
  type PerfilPagoCardnet,
}

/**
 * Capa de servidor de la TOKENIZACIÓN HOSPEDADA de CardNET.
 *
 * Aquí viven las dos únicas cosas que no pueden salir del servidor:
 *  1. La LLAVE PRIVADA (`Authorization: Basic <privada>`), que es un secreto:
 *     quien la tenga puede cobrar. Nunca en la base, nunca en el navegador,
 *     nunca en logs.
 *  2. La llamada HTTP al Purchase.
 *
 * La llave PÚBLICA sí puede ir al navegador (se usa para abrir el iframe de
 * captura); por eso se expone aparte, en `getTokensPublicConfig`.
 */

export interface TokensConfig {
  publicKey: string
  privateKey: string
  ambiente: AmbienteTokens
}

/** Config completa (incluye el secreto). Solo servidor. */
export function getTokensConfig(): TokensConfig | null {
  const publicKey = process.env.CARDNET_TOKENS_PUBLIC_KEY?.trim()
  const privateKey = process.env.CARDNET_TOKENS_PRIVATE_KEY?.trim()
  if (!publicKey || !privateKey) return null
  return {
    publicKey,
    privateKey,
    ambiente: ambienteConfigurado().ambiente,
  }
}

/**
 * El ambiente que pide la variable, y si se entendió.
 *
 * Se separa de `getTokensConfig` para que el diagnóstico pueda enseñar el
 * `reconocido` sin tener que tocar las llaves.
 */
export function ambienteConfigurado(): { ambiente: AmbienteTokens; reconocido: boolean; valor: string | null } {
  const valor = process.env.CARDNET_TOKENS_AMBIENTE?.trim() || null
  return { ...normalizarAmbiente(valor), valor }
}

/** ¿Están las dos llaves configuradas? Gobierna si se ofrece la tarjeta. */
export function cardnetTokensConfigurado(): boolean {
  return getTokensConfig() !== null
}

/**
 * Formatos posibles del header de autenticación. Los documentos de CardNET se
 * contradicen: el Postman manda la llave CRUDA tras "Basic", el manual (§2.4)
 * dice que va como "username" de HTTP Basic (base64(key:)). El servidor prueba
 * en orden y se queda con el que el proveedor acepte (el 401 dice literalmente
 * "or is incorrectly formatted", así que el formato importa).
 */
function variantesAuth(privateKey: string): { nombre: string; valor: string }[] {
  return [
    { nombre: 'cruda', valor: `Basic ${privateKey}` },
    { nombre: 'basic-user', valor: `Basic ${Buffer.from(`${privateKey}:`).toString('base64')}` },
    { nombre: 'base64-simple', valor: `Basic ${Buffer.from(privateKey).toString('base64')}` },
  ]
}

/** Datos NO secretos que el navegador necesita para abrir el iframe. */
export interface TokensPublicConfig {
  publicKey: string
  captureUrl: string
  scriptUrl: string
  ambiente: AmbienteTokens
}

/**
 * Config pública para el componente de pago. Devuelve null si no está
 * configurado. NO incluye la llave privada — es seguro pasarla al cliente.
 */
export function getTokensPublicConfig(): TokensPublicConfig | null {
  const cfg = getTokensConfig()
  if (!cfg) return null
  const urls = urlsTokens(cfg.ambiente)
  return {
    publicKey: cfg.publicKey,
    captureUrl: urls.capture,
    scriptUrl: urls.script,
    ambiente: cfg.ambiente,
  }
}

export interface CobrarConTokenInput {
  /** El token que devolvió el iframe de CardNET (`tokenCreated`). */
  trxToken: string
  /** Monto en pesos, LEÍDO DE LA BASE. Nunca del navegador. */
  pesos: number
  /** Nuestra referencia del intento (para conciliar). */
  orden: string
  /** IP del cliente, para el antifraude de CardNET. */
  clienteIp: string
  /** Factura/impuesto opcionales (DataDo). */
  invoice?: string
  tax?: number
}

export interface CobrarConTokenSalida extends ResultadoCompraToken {
  /** Respuesta cruda, ya sin datos sensibles, para guardar como evidencia. */
  crudo: Record<string, unknown>
}

/**
 * Cobra usando el token. Un solo POST al Purchase con la llave privada. El
 * `Capture: true` liquida el cargo en el acto (no es una pre-autorización).
 */
export async function cobrarConToken(input: CobrarConTokenInput): Promise<CobrarConTokenSalida> {
  const cfg = getTokensConfig()
  if (!cfg) {
    return {
      aprobada: false,
      autorizacion: null,
      codigo: '',
      motivo: 'El pago con tarjeta no está disponible.',
      requiereActivacion: false,
      crudo: {},
    }
  }

  // Referencia CORTA para todos los campos que CardNET arrastra hasta la
  // autorización del adquirente. Ver `referenciaCobro`: nuestro cuid de 25
  // caracteres viaja bien por el Purchase, pero el tramo siguiente es otro
  // sistema — y es ese el que respondió `BadRequest`.
  const referencia = referenciaCobro(input.orden)

  const cuerpo: Record<string, unknown> = {
    TrxToken: input.trxToken,
    Order: referencia,
    Amount: montoEnteroMenor(input.pesos),
    Tip: 0,
    Currency: MONEDA_DOP_TOKENS,
    Capture: true,
    // Identificador único de la compra (manual §2.6 · §7.2).
    //
    // OJO: mandábamos el id completo (25 caracteres) y CardNET lo archivó como
    // cadena VACÍA — o sea que la idempotencia que creíamos tener no existía.
    // Ahora va la referencia corta. Si vuelve a llegar vacía en la respuesta,
    // el campo es decorativo y hay que quitarlo; si llega con valor, sirve.
    // El expediente que se guarda permite comprobar exactamente eso.
    UniqueID: referencia,
    // `getClientIdentifier` devuelve la cadena 'unknown' cuando no hay
    // `x-forwarded-for`. Mandar eso como IP al antifraude de CardNET es peor
    // que no mandar nada: un valor con formato inválido puede rechazar el
    // cobro y el rechazo llegaría disfrazado de "tarjeta declinada".
    ...(esIpValida(input.clienteIp) ? { CustomerIP: input.clienteIp } : {}),
    DataDo: {
      Tax: String(input.tax ?? 0),
      Invoice: input.invoice ? referenciaCobro(input.invoice) : referencia,
    },
  }

  const { ok, status, json } = await llamarTokensConRuta('POST', '/Purchase', cuerpo, true)
  if (status === 0) {
    return {
      aprobada: false,
      autorizacion: null,
      codigo: '',
      motivo: 'No se pudo contactar la pasarela. Intenta de nuevo.',
      requiereActivacion: false,
      crudo: evidencia(status, json),
    }
  }

  const interpretado = interpretarCompraToken(json)
  // Si el HTTP no fue 2xx, no se aprueba aunque el cuerpo diga otra cosa.
  const aprobada = ok && interpretado.aprobada
  return {
    ...interpretado,
    aprobada,
    crudo: evidencia(status, json),
  }
}

/**
 * Expediente del cobro: la respuesta del proveedor SIN sensibles, más el status
 * HTTP con el que llegó.
 *
 * El status importa tanto como el cuerpo. Un 404 (ruta equivocada), un 401
 * (llave mal formateada) y un 200 con la transacción declinada producen los
 * tres el MISMO texto en pantalla —«No se pudo procesar el pago»— porque
 * ninguno trae un código de respuesta que sepamos leer. Guardando el status,
 * una consulta a `pago_intentos` distingue los tres casos en un segundo; sin
 * él, solo queda volver a reproducir el fallo a ciegas. Pasó.
 */
function evidencia(status: number, json: Record<string, unknown>): Record<string, unknown> {
  return { _http: status, ...sinSensibles(json) }
}

// ── Fase 2: tarjeta guardada (cobros recurrentes) ───────────────────────────
//
// Estas tres llamadas salen del Postman de tokenización de CardNET. El header
// de autorización es la LLAVE PRIVADA (secreto de servidor).

/** Llamada cruda contra UNA base con UN header de auth. Devuelve {ok, status, json}. */
async function llamadaBase(
  metodo: 'GET' | 'POST',
  base: string,
  path: string,
  cuerpo: Record<string, unknown> | null,
  authValor: string
): Promise<{
  ok: boolean
  status: number
  json: Record<string, unknown>
  /** Cabeceras que identifican QUIÉN respondió. Ver `CABECERAS_DE_INTERES`. */
  cabeceras: Record<string, string>
}> {
  try {
    const resp = await fetch(`${base}${path}`, {
      method: metodo,
      headers: {
        Authorization: authValor,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: metodo === 'POST' && cuerpo ? JSON.stringify(cuerpo) : undefined,
      signal: AbortSignal.timeout(20_000),
    })
    const texto = await resp.text().catch(() => '')
    let json: Record<string, unknown>
    try {
      json = JSON.parse(texto) as Record<string, unknown>
    } catch {
      // Respuesta no-JSON (HTML de error, texto plano): conservarla acotada
      // para diagnóstico — sin ella, un fallo del proveedor es invisible.
      json = texto ? { _texto: texto.slice(0, 500) } : {}
    }
    return { ok: resp.ok, status: resp.status, json, cabeceras: cabecerasDeInteres(resp.headers) }
  } catch (e) {
    return {
      ok: false,
      status: 0,
      json: { _error: e instanceof Error ? e.message : 'fetch' },
      cabeceras: {},
    }
  }
}

/**
 * QUIÉN CONTESTÓ, cuando lo que contestó no fue la API.
 *
 * Un 401 con el cuerpo `{"status":401,"error":"Acceso denegado"}` —en español,
 * y con una forma que la API de tokens no usa— no lo escribe la API: lo escribe
 * algo delante de ella. Un cortafuegos, un balanceador, una pasarela que filtra
 * por IP de origen. Y saber cuál de las dos cosas está pasando cambia por
 * completo a quién hay que llamar: si es la API, el problema son las llaves; si
 * es el filtro, las llaves pueden estar perfectas y lo que falta es que
 * autoricen desde dónde llamamos.
 *
 * Estas cabeceras lo delatan y ninguna lleva nada nuestro dentro.
 */
const CABECERAS_DE_INTERES = [
  'server',
  'via',
  'www-authenticate',
  'content-type',
  'x-cache',
  'cf-ray',
  'x-amz-cf-id',
  'x-request-id',
  'x-powered-by',
]

function cabecerasDeInteres(headers: Headers): Record<string, string> {
  const salida: Record<string, string> = {}
  for (const nombre of CABECERAS_DE_INTERES) {
    const valor = headers.get(nombre)
    if (valor) salida[nombre] = valor.slice(0, 200)
  }
  return salida
}

// Base y formato de auth que ya funcionaron en esta instancia: las llamadas
// siguientes van directo, sin re-probar candidatos.
let baseConfirmada: string | null = null
let authConfirmada: string | null = null

/**
 * POST autenticado a la API de tokens. Prueba las bases candidatas (un 404 o
 * fallo de red pasa a la siguiente) y, dentro del host vivo, los formatos de
 * auth (un 401 pasa al siguiente formato). El primero que logra 2xx queda
 * fijado para el resto de la vida de la instancia.
 */
async function llamarTokens(
  metodo: 'GET' | 'POST',
  path: string,
  cuerpo: Record<string, unknown> | null
): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const cfg = getTokensConfig()
  if (!cfg) return { ok: false, status: 0, json: {} }

  if (baseConfirmada && authConfirmada) {
    return llamadaBase(metodo, baseConfirmada, path, cuerpo, authConfirmada)
  }

  let mejor: { ok: boolean; status: number; json: Record<string, unknown> } | null = null
  for (const base of apiCandidatos(cfg.ambiente)) {
    for (const auth of variantesAuth(cfg.privateKey)) {
      const r = await llamadaBase(metodo, base, path, cuerpo, auth.valor)
      if (r.ok) {
        baseConfirmada = base
        authConfirmada = auth.valor
        return r
      }
      // Host muerto o ruta inexistente: no tiene sentido probar más formatos aquí.
      if (r.status === 0 || r.status === 404) break
      if (!mejor) mejor = r
      // Otro error que no es de auth (400, 500): el formato no es el problema.
      if (r.status !== 401 && r.status !== 403) break
    }
  }
  return mejor ?? { ok: false, status: 0, json: { _error: 'ningún host respondió' } }
}

async function postTokens(
  path: string,
  cuerpo: Record<string, unknown> | null
): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  return llamarTokens('POST', path, cuerpo)
}

/**
 * Variantes de MAYÚSCULA/minúscula del primer segmento de la ruta.
 *
 * El servicio no es consistente: el manual y el Postman escriben `/Customer`,
 * pero el ambiente de pruebas responde 200 a `/customer` y hay evidencia de
 * que la otra grafía devuelve 404. Un 404 hace que `llamarTokens` descarte el
 * host entero y termine sin respuesta — el síntoma es un 502 nuestro con el
 * mensaje «No se pudo iniciar la ventana de pago», que no dice nada de la
 * causa real.
 *
 * En vez de apostar por una grafía, se prueban las dos.
 */
/**
 * Llama probando las grafías de la ruta. La primera que no dé 404 manda: un
 * 401 o un 500 son respuestas del servicio (la ruta existe), y reintentarlas
 * con otra grafía solo enturbiaría el diagnóstico.
 */
async function llamarTokensConRuta(
  metodo: 'GET' | 'POST',
  path: string,
  cuerpo: Record<string, unknown> | null,
  /**
   * `true` cuando la llamada MUEVE DINERO. Cambia una sola cosa: si no hubo
   * respuesta (timeout/red), no se repite con la otra grafía — el cobro pudo
   * haberse procesado allá y perdido la respuesta de vuelta. Ver
   * `reintentarConOtraGrafia`.
   */
  esCobro = false
): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  let ultima: { ok: boolean; status: number; json: Record<string, unknown> } | null = null
  for (const variante of variantesDeRuta(path)) {
    const r = await llamarTokens(metodo, variante, cuerpo)
    if (r.ok || !reintentarConOtraGrafia(r.status, esCobro)) return r
    ultima = r
  }
  return ultima ?? { ok: false, status: 0, json: { _error: 'sin respuesta' } }
}

/**
 * PERFILES DE PAGO del Customer (`GET /Customer/{id}`).
 *
 * CONFIRMADO POR CARDNET: tras la captura hospedada, el token de la tarjeta
 * queda en `PaymentProfiles` dentro de la consulta del cliente. Es el camino
 * server-to-server para cobrar sin depender del callback del navegador.
 */
export async function consultarPerfilesPago(customerId: string): Promise<PerfilPagoCardnet[]> {
  return (await consultarClienteCardnet(customerId)).perfiles
}

/**
 * Consulta COMPLETA del Customer: email + perfiles. Es un GET puro — a
 * diferencia del POST /customer, NO genera una sesión nueva, así que es
 * seguro llamarla mientras la ventana de captura está abierta (un POST con
 * el mismo email invalida el UniqueID de la ventana y la mata con
 * INTERNAL_SERVER_ERROR).
 */
export async function consultarClienteCardnet(customerId: string): Promise<{
  email: string | null
  perfiles: PerfilPagoCardnet[]
  /**
   * Datos de la ventana de captura. El manual §4.1.2.2 punto 4 es explícito:
   * «este objeto Customer informa un CaptureURL y UniqueID que debe ser
   * utilizado luego para mostrarle al usuario la interfaz de captura». O sea
   * que la sesión sale de ESTA consulta, no de un POST aparte.
   */
  captureUrl: string | null
  uniqueId: string | null
}> {
  const vacio = { email: null, perfiles: [], captureUrl: null, uniqueId: null }
  if (!customerId) return vacio
  const { ok, status, json } = await llamarTokensConRuta(
    'GET',
    `/Customer/${encodeURIComponent(customerId)}`,
    null
  )
  if (!ok) {
    anotarFalloProveedor('consultarCliente', status, json)
    return vacio
  }
  const { datos } = desenvolverRespuesta(json)
  const s = (...ks: string[]) => {
    for (const k of ks) {
      const v = datos[k]
      if (typeof v === 'string' && v.trim()) return v.trim()
    }
    return null
  }
  const captureUrl = s('CaptureURL', 'captureUrl', 'CaptureUrl')
  return {
    email: s('Email', 'email'),
    perfiles: extraerPerfiles(json),
    // El formato documentado lleva barra final; la respuesta a veces no la trae.
    captureUrl: captureUrl ? (captureUrl.endsWith('/') ? captureUrl : `${captureUrl}/`) : null,
    uniqueId: s('UniqueID', 'UniqueId', 'uniqueId'),
  }
}

/**
 * CustomerId del cliente, según el §4.1.2.1: se registra UNA vez y se guarda.
 *
 * El POST solo ocurre la primera vez. Es la diferencia que importa: cada
 * `POST /Customer` emite un `UniqueID` nuevo e INVALIDA el anterior, así que
 * hacerlo en cada pago mata la ventana de captura que el cliente tenga
 * abierta — el síntoma es un INTERNAL_SERVER_ERROR sin ninguna pista.
 *
 * `guardar` persiste el id para que la próxima vez ni siquiera haya POST.
 */
export async function obtenerCustomerId(input: {
  email: string
  guardado: string | null
  guardar: (valorAGuardar: string) => Promise<void>
}): Promise<string | null> {
  const cfg = getTokensConfig()
  if (!cfg) return null

  // El id guardado solo sirve para LA MISMA cuenta de CardNET que lo emitió.
  // Al cambiar de juego de llaves se cambia de cuenta, y un CustomerId de la
  // cuenta vieja abre la ventana con un session_id que la nueva no reconoce:
  // INTERNAL_SERVER_ERROR, sin ninguna pista de que la causa es un dato viejo.
  // Por eso se guarda etiquetado con la cuenta y se descarta si no coincide.
  const yaLoTengo = leerCustomerIdDeCuenta(input.guardado, cfg.publicKey, cfg.privateKey)
  if (yaLoTengo) return yaLoTengo

  const cliente = await crearClienteCardnet({ email: input.email })
  if (!cliente?.customerId) return null
  // Best-effort: si la escritura falla, el cobro sigue — solo se pagará un
  // POST de más la próxima vez. Pero queda anotado: si falla siempre, el
  // síntoma vuelve a ser una ventana que muere sin explicación.
  await input
    .guardar(marcarCustomerIdConCuenta(cliente.customerId, cfg.publicKey, cfg.privateKey))
    .catch(anotarFallo('pagos:cardnet:guardarCustomerId'))
  return cliente.customerId
}

/**
 * DIAGNÓSTICO: intenta crear un Customer contra cada base candidata y cada
 * formato de auth, y devuelve status + respuesta (sin datos sensibles) de cada
 * intento. No expone llaves. Si TODOS dan 401, la llave no pertenece a la
 * cuenta y hay que reclamarla a CardNET.
 */
export async function probarSesionTokens(): Promise<
  {
    url: string
    formato: string
    ok: boolean
    status: number
    respuesta: Record<string, unknown>
    cabeceras: Record<string, string>
  }[]
> {
  const cfg = getTokensConfig()
  if (!cfg) return []
  const resultados = []
  for (const base of apiCandidatos(cfg.ambiente)) {
    for (const auth of variantesAuth(cfg.privateKey)) {
      const r = await llamadaBase(
        'POST',
        base,
        '/customer',
        { Email: 'diagnostico@membego.com', Enable: 'true' },
        auth.valor
      )
      resultados.push({
        url: `${base}/customer`,
        formato: auth.nombre,
        ok: r.ok,
        status: r.status,
        respuesta: sinSensibles(r.json),
        // Quién contestó. Un 401 de la API y un 401 de un filtro delante de la
        // API se parecen en el cuerpo y no se parecen en nada en la solución.
        cabeceras: r.cabeceras,
      })
      // Host muerto/ruta inexistente: pasar al siguiente host.
      if (r.status === 0 || r.status === 404) break
    }
  }
  return resultados
}

/**
 * DIAGNÓSTICO de la consulta del Customer: status HTTP + respuesta cruda SIN
 * datos sensibles (los tokens quedan enmascarados pero las CLAVES se ven, que
 * es lo que hace falta para confirmar la forma real de `PaymentProfiles`).
 */
export async function consultarClienteDiagnostico(
  customerId: string
): Promise<{ ok: boolean; status: number; respuesta: Record<string, unknown> }> {
  const r = await llamarTokens('GET', `/Customer/${encodeURIComponent(customerId)}`, null)
  return { ok: r.ok, status: r.status, respuesta: sinSensibles(r.json) }
}

/**
 * NOTA HISTÓRICA · `crearSesionCaptura` se eliminó.
 *
 * Abría la ventana con el `CaptureURL`/`UniqueID` de un `POST /Customer`. Es
 * una lectura equivocada del manual: el §4.1.2.2 dice que esos datos salen del
 * **GET** al Customer (ver `consultarClienteCardnet`). Y como cada POST emite
 * una sesión nueva e invalida la anterior, llamarla al abrir la ventana era
 * una forma segura de matar la sesión de otra pestaña —o la propia, si algo
 * más tocaba al Customer— con un `INTERNAL_SERVER_ERROR` sin explicación.
 *
 * No se restaura. El registro del Customer va por `obtenerCustomerId`, que
 * hace el POST UNA vez en la vida del cliente y guarda el id.
 */

/**
 * Crea (o registra) un Customer en CardNET. Devuelve el CustomerId con el que
 * luego se asocia el perfil de pago. `POST /api/Customer`.
 */
/**
 * Deja constancia de que el proveedor rechazó una llamada, con el ambiente al
 * que se estaba llamando.
 *
 * El ambiente es la mitad del diagnóstico y la que más veces es la culpable:
 * unas llaves de producción contra la API de laboratorio dan 401 en todo, y el
 * síntoma —una ventana de pago que no abre— no apunta a la variable de entorno
 * ni de lejos. Sin llaves ni datos de tarjeta: solo el estado y el cuerpo ya
 * saneado que devuelve el proveedor.
 */
function anotarFalloProveedor(paso: string, status: number, json: Record<string, unknown>): void {
  const { ambiente, reconocido, valor } = ambienteConfigurado()
  logErrorBd(`pagos:cardnet-tokens:${paso}`, new Error(`El proveedor respondió ${status}`), {
    status,
    ambiente,
    ambienteVariable: valor ?? '(sin definir)',
    ambienteReconocido: reconocido,
    respuesta: sinSensibles(json),
  })
}

export async function crearClienteCardnet(input: {
  email: string
  nombre?: string
  apellido?: string
}): Promise<{ customerId: string } | null> {
  const { ok, status, json } = await llamarTokensConRuta('POST', '/Customer', {
    Email: input.email,
    ...(input.nombre ? { FirstName: input.nombre } : {}),
    ...(input.apellido ? { LastName: input.apellido } : {}),
    Enable: 'true',
  })
  if (!ok) {
    // ANTES ESTE FALLO ERA MUDO. Devolvía `null`, la ruta de sesión respondía
    // «No se pudo iniciar la ventana de pago» y no quedaba ni una línea en
    // ningún sitio diciendo qué había contestado el proveedor. Con llaves
    // recién cambiadas, ese mensaje puede significar cinco cosas distintas y
    // no había forma de saber cuál sin repetir el fallo a mano.
    anotarFalloProveedor('crearCliente', status, json)
    return null
  }
  const { datos } = desenvolverRespuesta(json)
  const id = (datos.CustomerId ?? datos.customerId ?? datos.Id ?? datos.id ?? '') as
    | string
    | number
  const customerId = String(id).trim()
  return customerId ? { customerId } : null
}

/**
 * DIAGNÓSTICO del registro de Customer: hace exactamente lo mismo que
 * `crearClienteCardnet` pero devuelve el status y la respuesta CRUDA de cada
 * grafía de ruta probada.
 *
 * Existe porque un fallo aquí se veía como un 502 mudo («No se pudo iniciar la
 * ventana de pago») que obligaba a adivinar. Con esto, el fallo se lee.
 */
export async function registrarClienteDiagnostico(email: string): Promise<
  {
    ruta: string
    /** La URL COMPLETA contra la que se llamó. */
    url: string
    ok: boolean
    status: number
    respuesta: Record<string, unknown>
  }[]
> {
  const cfg = getTokensConfig()
  if (!cfg) return []
  // Antes esto decía solo `/Customer`, y esa mitad del dato no sirve para
  // preguntarle nada a nadie: la pregunta que hay que poder hacerle al
  // proveedor es «¿es ESTA la URL de producción?», y para eso hace falta el
  // host entero.
  const base = apiCandidatos(cfg.ambiente)[0] ?? '(sin base)'
  const salida: {
    ruta: string
    url: string
    ok: boolean
    status: number
    respuesta: Record<string, unknown>
  }[] = []
  for (const ruta of variantesDeRuta('/Customer')) {
    const r = await llamarTokens('POST', ruta, { Email: email, Enable: 'true' })
    salida.push({
      ruta,
      url: `${base}${ruta}`,
      ok: r.ok,
      status: r.status,
      respuesta: sinSensibles(r.json),
    })
    if (r.ok) break
  }
  return salida
}

/**
 * Cobra una CREDENCIAL GUARDADA (renovación recurrente). Reutiliza el mismo
 * Purchase, pero con las referencias almacenadas en vez de un token de un solo
 * uso.
 *
 * VERIFICAR-QA (importante): la forma exacta de referenciar la tarjeta
 * archivada en el Purchase solo se confirma con CardNET. Se envían todas las
 * referencias que tengamos (token/CustomerId/PaymentProfileId) y se marca la
 * transacción como recurrente. Cuando QA revele el contrato real, se ajusta
 * SOLO este cuerpo — el resto del flujo (activación, idempotencia) no cambia.
 */
export async function cobrarConCredencialGuardada(input: {
  customerId: string
  paymentProfileId?: string | null
  token?: string | null
  pesos: number
  orden: string
  clienteIp: string
}): Promise<CobrarConTokenSalida> {
  const referencia = referenciaCobro(input.orden)
  const cuerpo: Record<string, unknown> = {
    ...(input.token ? { TrxToken: input.token } : {}),
    CustomerId: input.customerId,
    ...(input.paymentProfileId ? { PaymentProfileId: input.paymentProfileId } : {}),
    Order: referencia,
    Amount: montoEnteroMenor(input.pesos),
    Tip: 0,
    Currency: MONEDA_DOP_TOKENS,
    Capture: true,
    // Mismo criterio que en el cobro con token: una IP con formato inválido
    // puede tumbar la autorización y el fallo llega disfrazado de rechazo.
    ...(esIpValida(input.clienteIp) ? { CustomerIP: input.clienteIp } : {}),
    // Marca de credencial archivada / recurrente (nombres del ZTRANS).
    Environment: 'Ecommerce_COF',
    DataDo: { Tax: '0', Invoice: referencia },
  }
  const { ok, status, json } = await llamarTokensConRuta('POST', '/Purchase', cuerpo, true)
  const interpretado = interpretarCompraToken(json)
  return { ...interpretado, aprobada: ok && interpretado.aprobada, crudo: evidencia(status, json) }
}

/**
 * ACTIVA el perfil de pago con el código de 6 caracteres del banco.
 *
 * Con las llaves CON autenticación, la tarjeta recién capturada nace
 * `Enabled: false`: CardNET cobra RD$1.00 y el banco le muestra al cliente un
 * código («Cardnet:Z2R78V») que debe ingresar aquí.
 *
 * EL CONTRATO, FIJADO CONTRA LA DOCUMENTACIÓN OFICIAL (18-08-2026)
 *
 * El cuerpo es el objeto `CustomerActivation` del manual §7.5 y tiene DOS
 * campos, ambos MANDATORIOS:
 *
 *     { "Token": "CT__…", "ActivationCode": "Z2R78V" }
 *
 * Lo dicen dos fuentes independientes: la tabla del §7.5 («Token · Identificador
 * del Token asociado al perfil que se desea activar · Mandatorio») y la petición
 * `ActivacionPayment` de la colección Postman de CardNET, que envía exactamente
 * esos dos campos.
 *
 * ANTES se enviaban tres grafías del código a la vez y el `PaymentProfileId` en
 * lugar del `Token`. Eso nunca se probó contra el proveedor; de haberse probado
 * habría fallado SIEMPRE, porque faltaba el único identificador que el servicio
 * exige. Los campos que sobraban no eran el problema: el que faltaba, sí.
 *
 * El código de activación NO es un dato sensible de tarjeta (no es PAN ni CVV):
 * es un reto de un solo uso que ya viajó por el estado de cuenta del cliente.
 */
export async function activarPerfilCardnet(input: {
  customerId: string
  /** Token del perfil que se desea activar. Mandatorio (§7.5). */
  token: string
  codigo: string
}): Promise<{
  ok: boolean
  status: number
  errores: { codigo: string; mensaje: string }[]
  crudo: Record<string, unknown>
}> {
  const { ok, status, json } = await llamarTokensConRuta(
    'POST',
    `/Customer/${encodeURIComponent(input.customerId)}/activate`,
    { Token: input.token, ActivationCode: input.codigo }
  )
  /**
   * UN 200 NO SIGNIFICA QUE ACTIVÓ.
   *
   * CardNET devuelve sus fallos DENTRO del cuerpo, en `Errors[]`, y puede
   * hacerlo con un estado HTTP perfectamente correcto. El cobro ya se defendía
   * de eso —«con errores del proveedor NUNCA se aprueba, diga lo que diga el
   * resto»— pero esa defensa nunca se aplicó aquí.
   *
   * El resultado era el peor posible: un código rechazado se leía como
   * activación exitosa, se pasaba a cobrar, el Purchase respondía CS012 y al
   * cliente le salía «tu tarjeta quedó registrada pero falta activarla»
   * —justo lo que acababa de intentar hacer— sin que nadie le dijera que su
   * código no había sido aceptado.
   */
  const { errores } = desenvolverRespuesta(json)
  return { ok: ok && errores.length === 0, status, errores, crudo: evidencia(status, json) }
}

/**
 * Borra un perfil de pago guardado (el cliente quita su tarjeta).
 * `POST /api/Customer/{id}/PaymentProfileDelete`.
 */
export async function borrarPerfilCardnet(input: {
  customerId: string
  paymentProfileId: string
}): Promise<boolean> {
  const { ok } = await postTokens(`/Customer/${encodeURIComponent(input.customerId)}/PaymentProfileDelete`, {
    PaymentProfileId: input.paymentProfileId,
  })
  return ok
}
