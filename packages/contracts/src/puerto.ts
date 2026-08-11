import type {
  BranchesResponse,
  CompanyDTO,
  CreateCustomerRequest,
  CreateCustomerResponse,
  CustomerDTO,
  EntitlementsResponse,
  EvaluateRequest,
  EvaluateResponse,
  MembershipsActiveResponse,
  RedemptionRequest,
  RedemptionResponse,
  SystemMeResponse,
  TransactionRequest,
  TransactionResponse,
  VehicleDTO,
  VehiclesResponse,
} from './api'

/**
 * CONTRATOS · EL PUERTO. Lo que un sistema vertical le puede pedir a MembeGo.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * UNA INTERFAZ, DOS IMPLEMENTACIONES
 *
 *   `MembegoClient`  (SDK)   habla HTTP. Es la de un satélite de verdad.
 *   `clienteLocal()` (Core)  llama a los módulos de MembeGo directamente. Es la
 *                            de un vertical que todavía vive dentro.
 *
 * Las dos declaran `implements ClientePlataforma`, así que el compilador
 * comprueba que sirven lo mismo. Si una se queda atrás, `tsc` lo dice.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PARA QUÉ SIRVE ESTO DE VERDAD
 *
 * Car Wash vive dentro del monolito y hoy lee las tablas del Core directamente.
 * Extraerlo así sería reescribir cada una de esas lecturas el mismo día que se
 * mueve el código — el día con menos margen de todos.
 *
 * Con el puerto, el vertical ya pide por el contrato AHORA, con una
 * implementación que no cruza la red. El día de la extracción se cambia una
 * línea: `clienteLocal(...)` por `new MembegoClient(...)`.
 *
 * Y de paso el ejercicio contesta la pregunta que ninguna documentación
 * contesta: **¿sirve este contrato para operar de verdad?** Lo que Car Wash
 * necesite y el puerto no dé es un hueco real, encontrado con el vertical que
 * ya funciona en vez de con el primero que se integre.
 */
export interface ClientePlataforma {
  // ── Sobre el propio sistema ───────────────────────────────────────────────

  systemsMe(): Promise<SystemMeResponse>
  entitlements(): Promise<EntitlementsResponse>

  // ── Lecturas de una empresa ───────────────────────────────────────────────

  company(companyId: string): Promise<CompanyDTO>
  branches(companyId: string): Promise<BranchesResponse>
  customer(companyId: string, customerId: string): Promise<CustomerDTO>

  /**
   * Resuelve UN cliente por un identificador exacto.
   *
   * `plate` se añadió porque Car Wash lo necesitaba y el contrato no lo daba:
   * en un lavadero el cliente se identifica por la matrícula del coche, no por
   * su correo. Es el primer hueco que este ejercicio destapó.
   */
  resolveCustomer(
    companyId: string,
    por: { email: string } | { phone: string } | { plate: string }
  ): Promise<CustomerDTO>

  /**
   * BUSCA clientes por texto parcial. Distinto de `resolveCustomer`, que exige
   * un identificador exacto y devuelve como mucho uno.
   *
   * Existe porque el mostrador lo necesita —el empleado teclea «mar» y espera
   * ver a María— y devolver la base entera a base de probar es justo lo que
   * `resolveCustomer` evitaba. Por eso esto va con límite y mínimo de
   * caracteres: buscar sí, listar no.
   */
  searchCustomers(companyId: string, termino: string): Promise<{ customers: CustomerDTO[] }>

  /**
   * Vehículos de un cliente.
   *
   * Está en el puerto porque el ejercicio de la Fase 6 lo exigió: un lavadero
   * identifica al cliente por el coche, no por su correo, y sin esto el
   * contrato no podía servir al vertical que MembeGo ya opera.
   */
  vehiclesOfCustomer(companyId: string, customerId: string): Promise<VehiclesResponse>

  /** El vehículo concreto de una matrícula. `null` si esa placa no está. */
  vehicleByPlate(companyId: string, placa: string): Promise<VehicleDTO | null>

  activeMemberships(companyId: string, customerId: string): Promise<MembershipsActiveResponse>

  // ── Decisiones y escrituras ───────────────────────────────────────────────

  /**
   * Da de alta a alguien que llegó sin cuenta.
   *
   * ESTE MÉTODO ESTUVO FUERA DEL PUERTO A PROPÓSITO, y entra ahora por el
   * camino que la Fase 6 dejó escrito: «llegan como escrituras del Core cuando
   * un satélite real las necesite, con su idempotencia». Restaurant es ese
   * satélite, y quien llega sin reserva es su caso normal.
   *
   * Lo que NO cambia es de quién es la identidad. El Core sigue decidiendo cómo
   * queda la fila —que no pueda iniciar sesión, de qué canal vino, si en
   * realidad ya existía—; el vertical manda un nombre y recibe un id.
   *
   * Deduplica por el identificador que venga, así que puede devolver un cliente
   * que ya existía con `created: false`. Sin identificador no hay nada con qué
   * deduplicar y siempre crea: por eso la clave de idempotencia es obligatoria.
   */
  createCustomer(
    peticion: CreateCustomerRequest,
    idempotencyKey: string
  ): Promise<CreateCustomerResponse>

  evaluateBenefits(peticion: EvaluateRequest): Promise<EvaluateResponse>
  redeem(peticion: RedemptionRequest, idempotencyKey: string): Promise<RedemptionResponse>
  recordTransaction(
    peticion: TransactionRequest,
    idempotencyKey: string
  ): Promise<TransactionResponse>
}

/**
 * Lo que el puerto NO ofrece, y por qué. Vive en el código y no solo en un
 * documento para que quien busque un método y no lo encuentre lea aquí la
 * razón, en vez de suponer que se olvidó.
 *
 *   · Crear VEHÍCULOS — sigue fuera, y la razón es que ningún satélite real lo
 *     ha necesitado todavía. Restaurant no tiene coches. El alta de clientes
 *     entró en la Fase 7 porque el primer satélite la pedía de verdad; añadir
 *     el vehículo «ya que estamos» sería diseñar un contrato contra un caso
 *     imaginado, que es exactamente cómo se llenan las APIs de métodos que
 *     nadie usa y nadie puede quitar. Entrará el día que un vertical con
 *     vehículos viva fuera del monolito.
 *
 *   · Fusionar un cliente de mostrador con su cuenta — se queda en el Core
 *     para siempre. Fusionar identidades es irreversible y toca membresías,
 *     compras e historial; un satélite no puede tener ese poder por muy
 *     legítimo que sea su caso de uso.
 *
 *   · Listar el personal de la empresa — no es un hueco, es un límite. Un
 *     satélite conoce a sus usuarios porque entran por SSO, y con el `jti` de
 *     la Fase 5 sabe cuándo entra cada uno por primera vez. Darle la plantilla
 *     entera de MembeGo sería exponer a gente que nunca usó su sistema.
 */
export const FUERA_DEL_PUERTO = ['vehicles:create', 'customers:merge', 'staff:list'] as const
