import {
  esReintentable,
  exigeTokenNuevo,
  type BranchesResponse,
  type ClientePlataforma,
  type CodigoError,
  type CompanyDTO,
  type CuerpoError,
  type CustomerDTO,
  type EntitlementsResponse,
  type EvaluateRequest,
  type EvaluateResponse,
  type MembershipsActiveResponse,
  type RedemptionRequest,
  type RedemptionResponse,
  type SsoRedeemResponse,
  type SystemMeResponse,
  type TokenResponse,
  type TransactionRequest,
  type TransactionResponse,
  type VehicleDTO,
  type VehiclesResponse,
} from '@membego/contracts'

/**
 * SDK · el cliente de la API de plataforma.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ RESUELVE, Y POR QUÉ NO ES «SOLO UN WRAPPER DE FETCH»
 *
 * Un satélite que hable con MembeGo a pelo tiene que acordarse de cuatro cosas.
 * Las cuatro se olvidan, y las cuatro fallan de formas que no se notan:
 *
 *  1. Renovar el token ANTES de que caduque, no cuando ya caducó.
 *  2. No pedir veinte tokens a la vez al arrancar.
 *  3. Reintentar solo lo que se puede reintentar.
 *  4. **Reintentar una escritura con la MISMA clave de idempotencia.**
 *
 * El cuarto es el que importa. Un cliente que reintenta generando una clave
 * nueva en cada intento tiene idempotencia en el papel y consume el beneficio
 * dos veces en la práctica — y desde fuera todo parece correcto: el servidor
 * cumplió su contrato, el cliente reintentó como debía, y el cliente final se
 * llevó dos postres.
 */

export interface OpcionesCliente {
  /** Raíz de MembeGo, sin `/api/platform/v1`. */
  baseUrl: string
  clientId: string
  clientSecret: string
  /** Scopes a pedir. Omitir = todos los de la credencial. */
  scope?: string[]
  /** Máximo de reintentos por llamada. 0 los desactiva. */
  reintentos?: number
  /** Inyectable para pruebas y para entornos con proxy propio. */
  fetch?: typeof fetch
  /** Inyectable para poder probar los tiempos sin esperarlos. */
  dormir?: (ms: number) => Promise<void>
  ahora?: () => number
}

export class MembegoError extends Error {
  constructor(
    readonly code: CodigoError | 'NETWORK_ERROR' | 'UNEXPECTED_RESPONSE',
    message: string,
    readonly status: number,
    readonly requestId: string | null,
    /** Solo en BENEFIT_NOT_ELIGIBLE: por qué no se puede consumir. */
    readonly reason?: string,
    /** Solo en INSUFFICIENT_SCOPE: qué scope hay que pedir en el manifest. */
    readonly requiredScope?: string
  ) {
    super(message)
    this.name = 'MembegoError'
  }
}

/**
 * Margen de renovación: se pide un token nuevo 60 segundos ANTES de que caduque.
 *
 * Sin margen, una petición que sale con el token en su último segundo llega
 * caducada y el satélite ve un 401 que no entiende. El margen convierte una
 * carrera contra el reloj en una renovación tranquila.
 */
const MARGEN_RENOVACION_MS = 60_000

const dormirPorDefecto = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export class MembegoClient implements ClientePlataforma {
  private readonly base: string
  private readonly hacerFetch: typeof fetch
  private readonly dormir: (ms: number) => Promise<void>
  private readonly ahora: () => number
  private readonly maxReintentos: number

  private token: string | null = null
  private expiraEn = 0
  /**
   * Petición de token EN CURSO. Veinte llamadas simultáneas al arrancar
   * comparten esta promesa en vez de pedir veinte tokens — que además gastarían
   * el límite del endpoint de token, que es estrecho a propósito.
   */
  private pidiendoToken: Promise<string> | null = null

  constructor(private readonly opciones: OpcionesCliente) {
    this.base = opciones.baseUrl.replace(/\/$/, '')
    this.hacerFetch = opciones.fetch ?? globalThis.fetch
    this.dormir = opciones.dormir ?? dormirPorDefecto
    this.ahora = opciones.ahora ?? (() => Date.now())
    this.maxReintentos = opciones.reintentos ?? 3
  }

  // ── Token ─────────────────────────────────────────────────────────────────

  private async obtenerToken(forzar = false): Promise<string> {
    if (!forzar && this.token && this.ahora() < this.expiraEn - MARGEN_RENOVACION_MS) {
      return this.token
    }
    if (this.pidiendoToken) return this.pidiendoToken

    this.pidiendoToken = (async () => {
      const resp = await this.hacerFetch(`${this.base}/api/platform/v1/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'client_credentials',
          client_id: this.opciones.clientId,
          client_secret: this.opciones.clientSecret,
          ...(this.opciones.scope?.length ? { scope: this.opciones.scope.join(' ') } : {}),
        }),
      })

      if (!resp.ok) throw await this.errorDe(resp)

      const datos = (await resp.json()) as TokenResponse
      this.token = datos.access_token
      this.expiraEn = this.ahora() + datos.expires_in * 1000
      return datos.access_token
    })()

    try {
      return await this.pidiendoToken
    } finally {
      // Se limpia SIEMPRE, también si falló: dejarla puesta convertiría un
      // fallo momentáneo en un cliente que nunca vuelve a pedir token.
      this.pidiendoToken = null
    }
  }

  private async errorDe(resp: Response): Promise<MembegoError> {
    const requestId = resp.headers.get('X-Request-Id')
    try {
      const cuerpo = (await resp.json()) as CuerpoError
      return new MembegoError(
        cuerpo.error.code,
        cuerpo.error.message,
        resp.status,
        cuerpo.error.requestId ?? requestId,
        cuerpo.error.reason,
        cuerpo.error.requiredScope
      )
    } catch {
      // Un 502 de un balanceador no trae nuestro JSON. Se distingue con un
      // código propio para que nadie lo confunda con una respuesta de MembeGo.
      return new MembegoError(
        'UNEXPECTED_RESPONSE',
        `HTTP ${resp.status} sin cuerpo de error de MembeGo`,
        resp.status,
        requestId
      )
    }
  }

  // ── Petición ──────────────────────────────────────────────────────────────

  private async pedir<T>(
    metodo: 'GET' | 'POST',
    ruta: string,
    opciones: { cuerpo?: unknown; idempotencyKey?: string } = {}
  ): Promise<T> {
    let ultimoError: MembegoError | null = null

    for (let intento = 0; intento <= this.maxReintentos; intento++) {
      // La clave NO se regenera entre intentos. Es lo único que convierte un
      // reintento en un reintento y no en una segunda operación.
      const cabeceras: Record<string, string> = {
        Authorization: `Bearer ${await this.obtenerToken(intento > 0 && ultimoError !== null && exigeTokenNuevo(ultimoError.code as CodigoError))}`,
      }
      if (opciones.cuerpo !== undefined) cabeceras['Content-Type'] = 'application/json'
      if (opciones.idempotencyKey) cabeceras['Idempotency-Key'] = opciones.idempotencyKey

      let resp: Response
      try {
        resp = await this.hacerFetch(`${this.base}${ruta}`, {
          method: metodo,
          headers: cabeceras,
          ...(opciones.cuerpo !== undefined ? { body: JSON.stringify(opciones.cuerpo) } : {}),
        })
      } catch (e) {
        // Un fallo de red es justo el caso en que no se sabe si llegó. Con la
        // clave puesta, reintentar es seguro; sin ella sería una lotería.
        ultimoError = new MembegoError(
          'NETWORK_ERROR',
          e instanceof Error ? e.message : 'fallo de red',
          0,
          null
        )
        if (intento < this.maxReintentos) {
          await this.dormir(this.espera(intento))
          continue
        }
        throw ultimoError
      }

      if (resp.ok) return (await resp.json()) as T

      const error = await this.errorDe(resp)
      ultimoError = error

      const codigo = error.code as CodigoError
      const puedeReintentar =
        intento < this.maxReintentos &&
        (error.code === 'NETWORK_ERROR' ||
          error.code === 'UNEXPECTED_RESPONSE' ||
          esReintentable(codigo) ||
          // Un token caducado a mitad de vuelo se renueva y se reintenta UNA
          // vez más; si vuelve a pasar, es un problema de configuración.
          exigeTokenNuevo(codigo))

      if (!puedeReintentar) throw error
      await this.dormir(this.espera(intento))
    }

    throw ultimoError ?? new MembegoError('NETWORK_ERROR', 'sin respuesta', 0, null)
  }

  /**
   * Espera exponencial con jitter. El jitter no es adorno: veinte satélites que
   * reintenten exactamente al segundo vuelven a caer todos a la vez sobre el
   * servidor que acababa de recuperarse.
   */
  private espera(intento: number): number {
    const base = Math.min(2 ** intento * 500, 8_000)
    return base + Math.random() * base * 0.3
  }

  // ── Lecturas ──────────────────────────────────────────────────────────────

  /** Quién soy y qué scopes tiene ESTE token. El primer paso al integrar. */
  systemsMe(): Promise<SystemMeResponse> {
    return this.pedir('GET', '/api/platform/v1/systems/me')
  }

  /** Sobre qué empresas puedo actuar. */
  entitlements(): Promise<EntitlementsResponse> {
    return this.pedir('GET', '/api/platform/v1/entitlements')
  }

  company(companyId: string): Promise<CompanyDTO> {
    return this.pedir('GET', `/api/platform/v1/companies/${encodeURIComponent(companyId)}`)
  }

  branches(companyId: string): Promise<BranchesResponse> {
    return this.pedir('GET', `/api/platform/v1/branches?companyId=${encodeURIComponent(companyId)}`)
  }

  customer(companyId: string, customerId: string): Promise<CustomerDTO> {
    return this.pedir(
      'GET',
      `/api/platform/v1/customers/${encodeURIComponent(customerId)}?companyId=${encodeURIComponent(companyId)}`
    )
  }

  /**
   * «¿Quién es este?» por un identificador EXACTO. Exactamente uno de los tres.
   *
   * `plate` existe porque en un lavadero el cliente se identifica por la
   * matrícula, no por su correo. Fue el primer hueco que destapó meter a Car
   * Wash por este mismo contrato.
   */
  resolveCustomer(
    companyId: string,
    por: { email: string } | { phone: string } | { plate: string }
  ): Promise<CustomerDTO> {
    const clave = 'email' in por ? 'email' : 'phone' in por ? 'phone' : 'plate'
    const valor = 'email' in por ? por.email : 'phone' in por ? por.phone : por.plate
    return this.pedir(
      'GET',
      `/api/platform/v1/customers/resolve?companyId=${encodeURIComponent(companyId)}&${clave}=${encodeURIComponent(valor)}`
    )
  }

  /**
   * BUSCA por texto parcial. Distinto de `resolveCustomer`: aquí el empleado
   * teclea «mar» y espera ver a María.
   *
   * Con límite y mínimo de caracteres del lado del servidor: buscar sí, listar
   * la base entera a base de probar no.
   */
  searchCustomers(companyId: string, termino: string): Promise<{ customers: CustomerDTO[] }> {
    return this.pedir(
      'GET',
      `/api/platform/v1/customers/search?companyId=${encodeURIComponent(companyId)}&q=${encodeURIComponent(termino)}`
    )
  }

  /** Vehículos de un cliente. Un lavadero identifica al cliente por el coche. */
  vehiclesOfCustomer(companyId: string, customerId: string): Promise<VehiclesResponse> {
    return this.pedir(
      'GET',
      `/api/platform/v1/vehicles?companyId=${encodeURIComponent(companyId)}&customerId=${encodeURIComponent(customerId)}`
    )
  }

  /**
   * El vehículo de una matrícula, o `null`.
   *
   * Devuelve `null` y no lanza porque «esa placa no está» es el caso NORMAL en
   * una pista: entra un coche que nunca vino. Tratarlo como excepción obligaría
   * a envolver en try la operación más frecuente del día.
   */
  async vehicleByPlate(companyId: string, placa: string): Promise<VehicleDTO | null> {
    try {
      return await this.pedir<VehicleDTO>(
        'GET',
        `/api/platform/v1/vehicles/by-plate?companyId=${encodeURIComponent(companyId)}&plate=${encodeURIComponent(placa)}`
      )
    } catch (e) {
      if (e instanceof MembegoError && e.code === 'NOT_FOUND') return null
      throw e
    }
  }

  /** Para PINTAR el estado. No autoriza: para eso, `evaluateBenefits`. */
  activeMemberships(companyId: string, customerId: string): Promise<MembershipsActiveResponse> {
    return this.pedir(
      'GET',
      `/api/platform/v1/memberships/active?companyId=${encodeURIComponent(companyId)}&customerId=${encodeURIComponent(customerId)}`
    )
  }

  /**
   * Qué puede consumir el cliente AHORA. Es un POST que no escribe: llamarlo
   * diez veces da diez respuestas y cero efectos, así que no lleva clave.
   *
   * Y no reserva nada: entre evaluar y canjear el beneficio puede consumirse en
   * otra sucursal. El canje vuelve a decidir.
   */
  evaluateBenefits(peticion: EvaluateRequest): Promise<EvaluateResponse> {
    return this.pedir('POST', '/api/platform/v1/benefits/evaluate', { cuerpo: peticion })
  }

  /**
   * Canjea el token SSO que MembeGo puso en `?token=` al abrir tu sistema.
   *
   * Puedes verificar el token por tu cuenta con el secreto compartido —el
   * camino de siempre— pero entonces NO hay uso único: MembeGo no se entera de
   * esa verificación, así que el mismo token vale las veces que se use durante
   * sus 90 segundos, y quien capture la URL entra.
   *
   * Canjeándolo aquí, el primero gana y el segundo recibe
   * `SSO_TOKEN_ALREADY_USED`.
   */
  redeemSso(token: string): Promise<SsoRedeemResponse> {
    return this.pedir('POST', '/api/platform/v1/sso/redeem', { cuerpo: { token } })
  }

  // ── Escrituras ────────────────────────────────────────────────────────────

  /**
   * Consumir un beneficio.
   *
   * `idempotencyKey` es OBLIGATORIA y la pone quien llama, no el SDK. Es a
   * propósito: la clave tiene que identificar **la operación de tu negocio**
   * —la comanda, el ticket—, no la llamada HTTP. Si la generara el SDK, un
   * reintento del satélite entero (tras un reinicio, tras un error de su propia
   * cola) traería una clave nueva y el beneficio se consumiría dos veces.
   */
  async redeem(
    peticion: RedemptionRequest,
    idempotencyKey: string
  ): Promise<RedemptionResponse> {
    // `async` para que el fallo llegue por rechazo y no por excepción síncrona:
    // el resto de errores del cliente rechazan, y un satélite que escriba
    // `client.redeem(...).catch(...)` se encontraría este suelto.
    if (!idempotencyKey) {
      throw new MembegoError('IDEMPOTENCY_KEY_REQUIRED', 'redeem: idempotencyKey es obligatoria', 0, null)
    }
    return this.pedir('POST', '/api/platform/v1/redemptions', {
      cuerpo: peticion,
      idempotencyKey,
    })
  }

  /** Registrar una venta del vertical en MembeGo. No es un cobro ni un canje. */
  async recordTransaction(
    peticion: TransactionRequest,
    idempotencyKey: string
  ): Promise<TransactionResponse> {
    if (!idempotencyKey) {
      throw new MembegoError(
        'IDEMPOTENCY_KEY_REQUIRED',
        'recordTransaction: idempotencyKey es obligatoria',
        0,
        null
      )
    }
    return this.pedir('POST', '/api/platform/v1/transactions', {
      cuerpo: peticion,
      idempotencyKey,
    })
  }
}
