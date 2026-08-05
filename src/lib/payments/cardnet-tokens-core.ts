/**
 * CardNET Tokenización (PÁGINA HOSPEDADA) — lógica pura, sin I/O.
 *
 * A diferencia de `cardnet-core.ts` (integración DIRECTA 3DS, donde la tarjeta
 * pasa por nuestro servidor), aquí el cliente digita la tarjeta en un IFRAME de
 * CardNET y solo nos llega un TOKEN. Nuestro servidor nunca ve el número de
 * tarjeta. Es el modelo de menor alcance PCI (SAQ A) — ver docs/PAGOS-CARDNET.md.
 *
 * Este archivo NO importa `server-only`: lo cargan las pruebas
 * (tests/cardnet-tokens.test.ts) y solo tiene funciones puras.
 */

export type AmbienteTokens = 'pruebas' | 'produccion'

/**
 * URLs del servicio de tokens por ambiente — MANUAL TÉCNICO v1.7 §11.
 *
 *   · Pruebas:    https://lab.cardnet.com.do/servicios/tokens/v1
 *   · Producción: https://servicios.cardnet.com.do/servicios/tokens/v1
 *
 * y bajo esa base: `/api/{objeto}`, `/Capture`, `/Scripts/PWCheckout.js`.
 *
 * ANTES apuntaban a `gtp-seglan.com`, un middleware que NO aparece en ninguna
 * página de la documentación de CardNET. El §3.1 del manual es explícito:
 * «La librería debe ser importada por el comercio a través de la URL pública
 * alojada en CARDNET. No deberá ser descargada y usada localmente desde un
 * servidor propio del comercio o desde una URL de un tercero no autorizado».
 *
 * Ese desvío partía la integración en dos: el SDK se cargaba desde un dominio
 * y la ventana de captura vivía en otro, así que el token no podía cruzar de
 * vuelta. El iframe abría, el cliente digitaba su tarjeta, y el callback
 * `tokenCreated` no llegaba nunca.
 */
export function urlsTokens(ambiente: AmbienteTokens): {
  /** Base de la API REST (Customer, Purchase, …). Lleva Authorization: Basic. */
  api: string
  /** URL del iframe de captura de tarjeta (se abre en el navegador). */
  capture: string
  /** Script del checkout hospedado (PWCheckout.js) que carga el navegador. */
  script: string
} {
  return {
    api: `${baseDe(ambiente)}/api`,
    capture: `${baseDe(ambiente)}/Capture/`,
    script: scriptDesdeCaptura(`${baseDe(ambiente)}/Capture/`),
  }
}

function baseDe(ambiente: AmbienteTokens): string {
  return ambiente === 'produccion'
    ? 'https://servicios.cardnet.com.do/servicios/tokens/v1'
    : 'https://lab.cardnet.com.do/servicios/tokens/v1'
}

/**
 * El script del widget, derivado de la MISMA base que la URL de captura.
 *
 * Es la invariante que hay que sostener: el SDK y el iframe tienen que estar
 * en el mismo origen, o el token no vuelve. Como el `CaptureURL` lo decide
 * CardNET en la respuesta (y varía entre `lab` y `labservicios` según el host
 * que se consulte), el script se calcula a partir de él en vez de fijarse
 * aparte. Así no pueden desalinearse.
 */
export function scriptDesdeCaptura(captureUrl: string): string {
  const limpia = captureUrl.trim().replace(/\/+$/, '')
  const base = limpia.replace(/\/Capture$/i, '')
  return `${base}/Scripts/PWCheckout.js`
}

/**
 * Bases CANDIDATAS de la API REST, en orden de preferencia.
 *
 * La primera es la del manual (§11); la segunda, el alias que usan el Postman
 * y el HTML de ejemplo que entregó CardNET — ambos responden. Se prueban en
 * orden y se usa el primero que conteste. `CARDNET_TOKENS_API_BASE` permite
 * fijarlo a mano si CardNET mueve el servicio.
 */
export function apiCandidatos(ambiente: AmbienteTokens): string[] {
  const fijo = process.env.CARDNET_TOKENS_API_BASE?.trim()
  if (fijo) return [fijo.replace(/\/$/, '')]
  return ambiente === 'produccion'
    ? ['https://servicios.cardnet.com.do/servicios/tokens/v1/api']
    : [
        'https://lab.cardnet.com.do/servicios/tokens/v1/api',
        'https://labservicios.cardnet.com.do/servicios/tokens/v1/api',
      ]
}

/**
 * Monto en la unidad menor (centavos) como ENTERO, que es lo que espera el
 * campo `Amount` del Purchase de CardNET (10000 = RD$100.00). Se redondea para
 * no arrastrar errores de coma flotante.
 */
export function montoEnteroMenor(pesos: number): number {
  return Math.round(pesos * 100)
}

/**
 * Las respuestas de la API de tokens vienen ENVUELTAS: `{ Response: {...},
 * Errors: [...] }` (confirmado contra el ambiente de prueba en vivo). Este
 * helper desenvuelve los datos y normaliza los errores.
 */
export function desenvolverRespuesta(json: Record<string, unknown>): {
  datos: Record<string, unknown>
  errores: { codigo: string; mensaje: string }[]
} {
  const datos = (
    json.Response && typeof json.Response === 'object' ? json.Response : json
  ) as Record<string, unknown>
  const crudos = Array.isArray(json.Errors)
    ? json.Errors
    : Array.isArray(datos.Errors)
      ? (datos.Errors as unknown[])
      : []
  const errores = crudos.map((e) => {
    const o = (e ?? {}) as Record<string, unknown>
    return { codigo: String(o.ErrorCode ?? ''), mensaje: String(o.Message ?? '') }
  })
  return { datos, errores }
}

/** Respuesta interpretada de un cobro por token. */
export interface ResultadoCompraToken {
  aprobada: boolean
  autorizacion: string | null
  /** Código crudo del emisor/plataforma, para diagnóstico. */
  codigo: string
  /** Mensaje corto para el cliente (sin filtrar detalle del banco). */
  motivo: string | null
}

/**
 * Estados finales de una transacción — MANUAL §10.6.
 *
 * `Pending` y `Preauthorized` NO son cobros: el dinero todavía no está. Si se
 * trataran como aprobados se entregaría producto sin haber cobrado.
 */
export const TRANSACTION_STATUS = {
  APROBADA: 1,
  PENDIENTE: 2,
  PREAUTORIZADA: 3,
  RECHAZADA: 4,
} as const

/**
 * Interpreta la respuesta del Purchase (manual §7.2 · §9.2 · §10.6).
 *
 * Ante la duda NO aprueba: activar producto por una respuesta ambigua es
 * regalar mercancía, y es un error que solo se descubre cuadrando la caja.
 */
export function interpretarCompraToken(resp: unknown): ResultadoCompraToken {
  const raw = (resp ?? {}) as Record<string, unknown>
  // Las respuestas reales vienen envueltas en { Response, Errors } (confirmado
  // en vivo); las pruebas y variantes viejas pueden venir planas.
  const { datos: r, errores } = desenvolverRespuesta(raw)
  const tx = (r.Transaction && typeof r.Transaction === 'object' ? r.Transaction : {}) as Record<
    string,
    unknown
  >

  const s = (v: unknown) => (v == null ? '' : String(v)).trim()
  // Distintos nombres posibles del código de respuesta según la versión.
  const codigo =
    s(r.ResponseCode) ||
    s(tx.ResponseCode) ||
    s(r.IsoCode) ||
    s(r.IsoResponseCode) ||
    s(r['response-code'])
  const aprobadaBool = r.Approved === true || r.approved === true || r.IsApproved === true
  const codigoOk = codigo === '00' || codigo === '000'

  // El estado final de la transacción (§10.6). Es el dato más fiable de todos:
  // manda sobre cualquier otro indicio. Un 2 (Pending) o un 3 (Preauthorized)
  // NO son cobros — el dinero aún no está — y aprobar ahí entregaría producto
  // sin haber cobrado.
  const estadoTx = Number(
    tx.TransactionStatusId ?? r.TransactionStatusId ?? tx.TransactionStatus ?? NaN
  )
  const estadoConocido = Number.isFinite(estadoTx)
  const estadoAprueba = estadoTx === TRANSACTION_STATUS.APROBADA

  const autorizacion =
    s(r.AuthorizationCode) ||
    s(tx.AuthorizationCode) ||
    s(r.Authorization) ||
    s(r['approval-code']) ||
    s(r.RRN) ||
    null

  // Con errores del proveedor NUNCA se aprueba, diga lo que diga el resto.
  const aprobada =
    errores.length === 0 &&
    (estadoConocido
      ? estadoAprueba
      : aprobadaBool || codigoOk || Boolean(autorizacion))

  const motivo = aprobada
    ? null
    : errores.length > 0 && errores[0].mensaje
      ? mensajeDeError(errores[0].mensaje)
      : estadoTx === TRANSACTION_STATUS.PENDIENTE
        ? 'El pago quedó pendiente de confirmación. No cierres la app; te avisaremos.'
        : estadoTx === TRANSACTION_STATUS.PREAUTORIZADA
          ? 'El pago quedó reservado pero sin cobrar. Contacta al comercio.'
          : mensajeCompra(codigo, r)

  return {
    aprobada,
    autorizacion: autorizacion || null,
    codigo: codigo || (aprobada ? '00' : ''),
    motivo,
  }
}

/**
 * Texto de la tarjeta que espera su código de activación (§3.1.1 operativo).
 *
 * Se comparte con `cardnetToken.ts`: al cliente le tiene que llegar lo mismo
 * llegue por donde llegue el fallo — cobrando con el token del widget, o
 * cobrando con el perfil que se consulta después.
 */
export const MENSAJE_ACTIVACION_PENDIENTE =
  'Tu tarjeta quedó registrada pero falta activarla. Tu banco te cobró RD$1.00 y en ese cargo aparece un código de 6 dígitos (algo como «Cardnet:Z2R78V»). Búscalo en tu app del banco e ingrésalo para completar el pago.'

/**
 * Traduce el error del proveedor a algo que el cliente pueda ACCIONAR.
 *
 * «El token no está activo» es técnicamente exacto e inútil para quien acaba
 * de digitar su tarjeta: no dice qué es un token, ni qué hacer. Detrás de esa
 * frase está el flujo de activación del §4.1.2.3, que sí se puede explicar.
 */
function mensajeDeError(mensaje: string): string {
  if (/token.*(no|sin).*activ|activ.*pendiente|not.*activ/i.test(mensaje)) {
    return MENSAJE_ACTIVACION_PENDIENTE
  }
  return mensaje
}

/**
 * Mensaje para el cliente cuando el cobro no pasa. Se apoya en el código si es
 * conocido; si no, un genérico que no expone detalle del emisor.
 */
function mensajeCompra(codigo: string, r: Record<string, unknown>): string {
  // Códigos de respuesta de la transacción — MANUAL §9.2. Se traducen a algo
  // que el cliente pueda ACCIONAR; el texto técnico del emisor no se muestra.
  const conocidos: Record<string, string> = {
    '05': 'Tu banco rechazó la tarjeta.',
    '14': 'El número de tarjeta no es válido.',
    '41': 'Tarjeta reportada. Contacta a tu banco.',
    '42': 'Cuenta inválida. Contacta a tu banco.',
    '43': 'Tarjeta reportada. Contacta a tu banco.',
    '51': 'Fondos insuficientes.',
    '52': 'Cuenta inválida. Contacta a tu banco.',
    '53': 'Cuenta inválida. Contacta a tu banco.',
    '54': 'La tarjeta está vencida.',
    '56': 'Cuenta inválida. Contacta a tu banco.',
    '57': 'Tu banco no permite este tipo de transacción.',
    '58': 'Tu banco no permite esta transacción.',
    '60': 'Contacta a tu banco para autorizar el pago.',
    '61': 'Superaste el límite de tu tarjeta.',
    '62': 'Tarjeta restringida por tu banco.',
    '65': 'Superaste el límite de intentos. Intenta más tarde.',
    '66': 'Contacta a tu banco para autorizar el pago.',
    '75': 'Superaste los intentos de PIN. Contacta a tu banco.',
    '78': 'Tu banco necesita activar la tarjeta primero.',
    '79': 'Tu banco rechazó el pago.',
    '81': 'PIN inválido.',
    '82': 'Tu tarjeta requiere PIN para esta compra.',
    '91': 'Tu banco no está disponible ahora. Intenta en unos minutos.',
    '94': 'Este pago ya se procesó. Revisa tus movimientos antes de reintentar.',
    '96': 'Error del sistema. Intenta de nuevo en un momento.',
    '97': 'Tu banco no está disponible ahora. Intenta más tarde.',
    '98': 'Excediste el límite de la tarjeta.',
    '99': 'El código de seguridad (CVV) no es correcto.',
  }
  if (codigo && conocidos[codigo]) return conocidos[codigo]
  const msg = (r.ResponseMessage ?? r.Message ?? '') as string
  // Solo se usa el mensaje de la plataforma si es corto y no técnico.
  if (typeof msg === 'string' && msg.length > 0 && msg.length <= 60) return msg
  return 'No se pudo procesar el pago. Verifica los datos o intenta con otra tarjeta.'
}

/**
 * Quita datos sensibles antes de loguear la respuesta como evidencia. Un token
 * de CardNET no es un número de tarjeta, pero sí permite cobrar: no debe quedar
 * en logs en claro. Enmascara cualquier clave que parezca token/tarjeta.
 */
export function sinSensibles(obj: Record<string, unknown>): Record<string, unknown> {
  const salida: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    const kl = k.toLowerCase()
    if (
      kl.includes('token') ||
      kl.includes('card') ||
      kl.includes('pan') ||
      kl.includes('cvv') ||
      kl === 'acctnumber'
    ) {
      salida[k] = typeof v === 'string' && v.length > 4 ? `***${v.slice(-4)}` : '***'
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      salida[k] = sinSensibles(v as Record<string, unknown>)
    } else {
      salida[k] = v
    }
  }
  return salida
}

/** Código de moneda de la República Dominicana para el Purchase. */
export const MONEDA_DOP_TOKENS = 'DOP'

/**
 * ¿Esto es una IP que se pueda mandar al antifraude?
 *
 * Importa porque el identificador del cliente vale la cadena `'unknown'`
 * cuando la petición no trae `x-forwarded-for`. Mandar `CustomerIP: "unknown"`
 * es un dato con formato inválido, y un rechazo por validación llega al
 * cliente con la misma cara que una tarjeta sin fondos: "declinada". Mejor
 * omitir el campo que mentir en él.
 */
export function esIpValida(valor: string): boolean {
  const v = (valor ?? '').trim()
  if (!v || v === 'unknown') return false
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(v)
  if (ipv4) return ipv4.slice(1).every((n) => Number(n) <= 255)
  // IPv6: basta con que sea plausible (hex y dos puntos); CardNET valida el resto.
  return v.includes(':') && /^[0-9a-f:.]+$/i.test(v)
}

/**
 * PERFIL DE PAGO (tarjeta registrada) dentro de la consulta del Customer.
 *
 * CONFIRMADO POR CARDNET: "al consultar el cliente hay un objeto en el JSON
 * llamado PaymentProfiles donde puede encontrar el token". Este es el camino
 * OFICIAL para obtener el token tras la captura hospedada — el servidor
 * consulta al proveedor, sin depender de que el navegador reciba nada.
 */
export interface PerfilPagoCardnet {
  paymentProfileId: string | null
  token: string | null
  marca: string | null
  ultimos4: string | null
  /**
   * ¿El medio de pago está habilitado para cobrar?
   *
   * MANUAL §4.1.2.2 punto 12: «deberá verificar que el objeto PaymentProfile
   * podrá estar marcado como **deshabilitado (Enabled=false)**, por lo que
   * para que dicho perfil (Token) pueda ser utilizado, deberá ser activado».
   *
   * Con las llaves CON autenticación 3DS, la tarjeta recién capturada nace
   * `Enabled: false`: CardNET hace un microcargo de RD$1.00 y el cliente debe
   * ingresar el código de 6 dígitos que le muestra su banco (§4.1.2.3). Cobrar
   * con un perfil deshabilitado no funciona, y el fallo no dice por qué.
   *
   * Si el campo no viene, se asume habilitado: es lo que ocurre con las llaves
   * SIN autenticación, donde el token queda activo solo.
   */
  habilitado: boolean
}

/** Saca los perfiles de pago de la respuesta de `GET /Customer/{id}`. */
export function extraerPerfiles(json: Record<string, unknown>): PerfilPagoCardnet[] {
  const { datos } = desenvolverRespuesta(json)
  const crudos = datos.PaymentProfiles ?? datos.paymentProfiles ?? datos.Profiles
  if (!Array.isArray(crudos)) return []
  return crudos
    .filter((p): p is Record<string, unknown> => Boolean(p) && typeof p === 'object')
    .map((p) => {
      const s = (...ks: string[]) => {
        for (const k of ks) {
          const v = p[k]
          if (typeof v === 'string' && v.trim()) return v.trim()
          if (typeof v === 'number') return String(v)
        }
        return null
      }
      // Los últimos 4 pueden venir como campo propio o dentro del número
      // enmascarado (p. ej. "411111******1111").
      const enmascarado = s('CardNumber', 'MaskedNumber', 'Number', 'CardMasked')
      const ultimos4 =
        s('LastFour', 'Last4', 'last4') ??
        (enmascarado ? enmascarado.replace(/[^0-9]/g, '').slice(-4) || null : null)
      // Solo un `false` explícito deshabilita. Un campo ausente no puede
      // bloquear un cobro que sí habría pasado.
      const enabled = p.Enabled ?? p.enabled ?? p.IsEnabled
      return {
        paymentProfileId: s('PaymentProfileId', 'ProfileId', 'Id', 'id'),
        token: s('Token', 'TrxToken', 'PWToken', 'token'),
        marca: s('Brand', 'CardBrand', 'CardType', 'Franchise'),
        ultimos4,
        habilitado: enabled !== false && enabled !== 'false',
      }
    })
    .filter((p) => Boolean(p.token || p.paymentProfileId))
}
