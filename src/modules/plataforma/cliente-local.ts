import 'server-only'
import { conEmpresa } from '@/lib/tenant'
import { branchDTO, companyDTO, membershipSummaryDTO } from '@/modules/plataforma/dto'
import {
  buscarClientes,
  clientePorEmail,
  clientePorId,
  clientePorPlaca,
  clientePorTelefono,
  vehiculoPorPlaca,
  vehiculosDeCliente,
} from '@/modules/plataforma/consultas'
import { altaCliente } from '@/modules/plataforma/alta-cliente'
import { ejecutarCanje } from '@/modules/visitas/canje'
import type {
  BranchesResponse,
  ClientePlataforma,
  CompanyDTO,
  CreateCustomerRequest,
  CreateCustomerResponse,
  CustomerDTO,
  EntitlementsResponse,
  EvaluateResponse,
  MembershipsActiveResponse,
  RedemptionRequest,
  RedemptionResponse,
  SystemMeResponse,
  TransactionRequest,
  TransactionResponse,
  VehicleDTO,
  VehiclesResponse,
} from '@membego/contracts'

/**
 * PLATAFORMA · Fase 6 — EL CONTRATO, SIN RED.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ ES ESTO
 *
 * La MISMA interfaz que usa un satélite (`ClientePlataforma`), implementada
 * llamando a los módulos de MembeGo directamente. Sin HTTP, sin token, sin
 * serializar: un vertical que todavía vive dentro del monolito pide por el
 * contrato y paga cero.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PARA QUÉ SIRVE
 *
 * Car Wash lee hoy las tablas del Core directamente. Extraerlo así obligaría a
 * reescribir cada una de esas lecturas el mismo día que se mueve el código —el
 * día con menos margen de todos—. Con esto, el vertical ya pide por el contrato
 * AHORA, y el día de la extracción se cambia una línea:
 *
 *     const membego = clienteLocal(companyId)      // hoy
 *     const membego = new MembegoClient({ ... })   // el día que salga
 *
 * Y de paso contesta la pregunta que ninguna documentación contesta: **¿sirve
 * este contrato para operar de verdad?** Lo que Car Wash necesitó y el puerto no
 * daba —resolver por matrícula, buscar por texto— se descubrió aquí, con el
 * vertical que ya funciona, en vez de con el primer satélite que se integre.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA EMPRESA VA EN EL CONSTRUCTOR, NO EN CADA LLAMADA
 *
 * Un satélite manda `companyId` en cada petición porque atiende a muchas. Un
 * vertical embebido opera dentro de UNA: fijarla al construir el cliente hace
 * imposible que una llamada se equivoque de empresa, que es la clase de error
 * que aquí no da ningún síntoma.
 *
 * Los métodos siguen recibiendo `companyId` porque la interfaz es la misma —y
 * tiene que serlo—, pero se comprueba que coincide. No se corrige en silencio:
 * si no coincide, alguien está razonando sobre otra empresa.
 */
export function clienteLocal(companyId: string, sistemaSlug = 'carwash'): ClientePlataforma {
  const mismaEmpresa = (recibida: string) => {
    if (recibida !== companyId) {
      throw new Error(
        `clienteLocal: se pidió sobre "${recibida}" con el cliente de "${companyId}". ` +
          'Construye un cliente por empresa.'
      )
    }
    return companyId
  }

  const noEncontrado = (que: string): never => {
    // Se lanza con el mismo mensaje que devolvería un 404 de la API, para que
    // el vertical trate los dos caminos igual y la extracción no cambie su
    // manejo de errores.
    throw new Error(`NOT_FOUND: ${que}`)
  }

  return {
    async systemsMe(): Promise<SystemMeResponse> {
      // Un vertical embebido no tiene credencial ni scopes: los tiene TODOS,
      // porque corre dentro. Se responde con la verdad —esto no es un satélite—
      // en vez de inventar una lista que induciría a comprobar permisos que
      // aquí no existen.
      return {
        slug: sistemaSlug,
        nombre: sistemaSlug,
        estado: 'EMBEDDED',
        businessTypes: [],
        scopes: [],
      }
    },

    async entitlements(): Promise<EntitlementsResponse> {
      // Exactamente una: la suya. Un vertical embebido no elige empresa.
      const c = await conEmpresa(companyId, (tx) =>
        tx.company.findUnique({ where: { id: companyId }, select: { name: true, slug: true } })
      ).catch(() => null)
      return {
        entitlements: [
          {
            companyId,
            nombre: c?.name ?? null,
            slug: c?.slug ?? null,
            plan: null,
            habilitadoDesde: null,
          },
        ],
      }
    },

    async company(id: string): Promise<CompanyDTO> {
      const empresa = await conEmpresa(mismaEmpresa(id), (tx) =>
        tx.company.findUnique({
          where: { id: companyId },
          select: {
            id: true, name: true, slug: true, logoUrl: true,
            moneda: true, zonaHoraria: true, idioma: true,
          },
        })
      ).catch(() => null)
      return empresa ? companyDTO(empresa) : noEncontrado('company')
    },

    async branches(id: string): Promise<BranchesResponse> {
      const filas = await conEmpresa(mismaEmpresa(id), (tx) =>
        tx.sucursal.findMany({
          where: { companyId },
          select: { id: true, companyId: true, nombre: true, direccion: true, activa: true },
          orderBy: { nombre: 'asc' },
        })
      ).catch(() => [])
      return { branches: filas.map(branchDTO) }
    },

    async customer(id: string, customerId: string): Promise<CustomerDTO> {
      const c = await clientePorId(mismaEmpresa(id), customerId)
      return c ?? noEncontrado('customer')
    },

    async resolveCustomer(
      id: string,
      por: { email: string } | { phone: string } | { plate: string }
    ): Promise<CustomerDTO> {
      const empresa = mismaEmpresa(id)
      const c =
        'email' in por
          ? await clientePorEmail(empresa, por.email)
          : 'phone' in por
            ? await clientePorTelefono(empresa, por.phone)
            : await clientePorPlaca(empresa, por.plate)
      return c ?? noEncontrado('customer')
    },

    async searchCustomers(id: string, termino: string): Promise<{ customers: CustomerDTO[] }> {
      return { customers: await buscarClientes(mismaEmpresa(id), termino) }
    },

    async vehiclesOfCustomer(id: string, customerId: string): Promise<VehiclesResponse> {
      return { vehicles: await vehiculosDeCliente(mismaEmpresa(id), customerId) }
    },

    async vehicleByPlate(id: string, placa: string): Promise<VehicleDTO | null> {
      return vehiculoPorPlaca(mismaEmpresa(id), placa)
    },

    async activeMemberships(id: string, customerId: string): Promise<MembershipsActiveResponse> {
      const filas = await conEmpresa(mismaEmpresa(id), (tx) =>
        tx.membership.findMany({
          where: { companyId, clienteId: customerId, estado: 'ACTIVA' },
          select: {
            id: true, clienteId: true, companyId: true, estado: true,
            fechaVencimiento: true, plan: { select: { nombre: true } },
          },
          orderBy: { fechaVencimiento: 'desc' },
        })
      ).catch(() => [])
      return {
        memberships: filas.map((m) => membershipSummaryDTO({ ...m, estado: String(m.estado) })),
        autoriza: false,
      }
    },

    async createCustomer(
      peticion: CreateCustomerRequest,
      idempotencyKey: string
    ): Promise<CreateCustomerResponse> {
      if (!idempotencyKey) throw new Error('createCustomer: idempotencyKey es obligatoria')
      const empresa = mismaEmpresa(peticion.companyId)

      // EL MISMO servicio que usa la API. La deduplicación, el prefijo `local:`
      // y el canal de origen se deciden en un solo sitio: si esto llamara a
      // `tx.cliente.create` por su cuenta, el mostrador y el satélite crearían
      // fichas distintas para el mismo caso y solo se notaría al cruzarlas.
      //
      // Como en `redeem`, la clave de idempotencia se exige pero no se aplica:
      // en proceso no hay reintento de red que proteger. Se pide para que la
      // firma sea la misma y el día de la extracción no cambie quien llama.
      const alta = await altaCliente(
        empresa,
        { nombre: peticion.name, telefono: peticion.phone, email: peticion.email },
        sistemaSlug
      )
      if ('error' in alta) throw new Error(`INVALID_REQUEST: ${alta.error}`)
      return { customer: alta.cliente, created: alta.creado }
    },

    async evaluateBenefits(): Promise<EvaluateResponse> {
      // Deliberadamente sin implementar EN PROCESO.
      //
      // Un vertical embebido que necesite evaluar beneficios está a un paso de
      // decidir el canje por su cuenta, y ese paso es el que no puede darse. El
      // motor de elegibilidad ya lo consume `benefits/evaluate` y el canje lo
      // hace `redeem`; duplicar la evaluación aquí crearía la segunda
      // implementación que la Fase 3b existió para evitar.
      throw new Error(
        'clienteLocal: evaluateBenefits no está disponible en proceso. ' +
          'Un vertical embebido canjea con redeem(), que ya decide.'
      )
    },

    async redeem(peticion: RedemptionRequest, idempotencyKey: string): Promise<RedemptionResponse> {
      if (!idempotencyKey) throw new Error('redeem: idempotencyKey es obligatoria')
      const empresa = mismaEmpresa(peticion.companyId)

      // EL MISMO servicio que usan el mostrador y `/redemptions`. La única
      // diferencia con el camino HTTP es que aquí no hay red.
      //
      // La idempotencia NO se aplica: en proceso no hay reintento de red que
      // proteger —quien llama está en la misma transacción lógica— y montar la
      // tabla de claves para una llamada local sería pagar por un problema que
      // aquí no existe. La clave se exige igual para que la firma sea la misma
      // y el día de la extracción no cambie ni una línea de quien llama.
      const resultado = await ejecutarCanje(
        {
          origen: 'SISTEMA',
          dbUserId: null,
          nombre: sistemaSlug,
          companyId: empresa,
          sistemaSlug,
        },
        {
          membershipId: peticion.membershipId,
          servicio: peticion.servicio,
          vehiculoId: peticion.vehiculoId ?? null,
          notas: peticion.notas ?? null,
          sucursalId: peticion.sucursalId ?? null,
          qrTokenId: peticion.qrTokenId ?? null,
        },
        { ipAddress: null, userAgent: `membego-local/${sistemaSlug}`, iniciadoEn: Date.now() }
      )

      if (!resultado.ok) throw new Error(`${resultado.motivo}: ${resultado.mensaje}`)

      return {
        redemptionId: resultado.transaccionId,
        visitId: resultado.visitId,
        codigo: resultado.codigo,
        ticketNumero: resultado.ticketNumero,
        customerId: resultado.clienteId,
        companyId: resultado.companyId,
        servicio: resultado.servicio,
        usesLeft: resultado.ilimitado ? null : resultado.restantes,
        unlimited: resultado.ilimitado,
        redeemedAt: new Date().toISOString(),
      }
    },

    async recordTransaction(peticion: TransactionRequest): Promise<TransactionResponse> {
      // Tampoco en proceso: un vertical embebido ya escribe sus transacciones
      // por la caja de MembeGo, que es la suya. Este método existe para el
      // satélite que cobra por su cuenta y quiere que el importe aparezca en el
      // informe del dueño — una situación que, estando dentro, no se da.
      void peticion
      throw new Error(
        'clienteLocal: recordTransaction no está disponible en proceso. ' +
          'Un vertical embebido registra sus ventas por la caja de MembeGo.'
      )
    },
  }
}
