import 'server-only'
import { conEmpresa, sinEmpresa, type Tx } from '@/lib/tenant'
import { marcarEntrega } from '@/modules/pagos/intentos'
import { RECLAMO_PERDIDO, extenderMembresiaCobrada } from '@/modules/pagos/renovacion-extension'
import { asegurarVentaDelIntento } from '@/modules/pagos/venta-tarjeta'
import { anotarFallo, esViolacionUnica, logErrorBd } from '@/lib/prisma-errors'
import { puedeCobrarToken } from '@/modules/pagos/cardnetToken'
import {
  cobrarConCredencialGuardada,
  borrarPerfilCardnet,
} from '@/lib/payments/cardnet-tokens'
import { cifrarTokenCardnet, descifrarTokenCardnet } from '@/lib/payments/cardnet-vault'
import { tarjetaCardnetVencida } from '@/modules/pagos/cardnet-expiracion'
import { stablePurchaseId } from '@/modules/pagos/cardnetClientCore'
import {
  consentimientoVigente,
  otorgarConsentimiento,
  revocarConsentimientos,
} from '@/modules/pagos/consentimientos'
import { exigeAvisoPrevio, type ContextoConsentimiento } from '@/modules/pagos/consentimientosCore'
import { avisarCliente, avisoPrevioRegistrado } from '@/modules/pagos/avisosRenovacion'
import {
  clavesDeAviso,
  etiquetaTarjeta,
  formatoVencimiento,
} from '@/modules/pagos/avisosRenovacionCore'
import {
  MARGEN_PRIMER_INTENTO_MS,
  POLITICA_RENOVACION,
  claveDeCiclo,
  clasificarCobro,
  decidirTrasRechazo,
  evaluarCiclo,
  inicioDelCiclo,
  rechazosDelCron,
  tocaRenovar,
  type MotivoDeBloqueo,
} from '@/modules/pagos/renovacionPolitica'

/** El canal con el que `pago_intentos` marca un cobro automático (CHECK `pago_intentos_canal`). */
const CANAL_RENOVACION = 'RENOVACION_AUTOMATICA'

/**
 * FASE 2 — TARJETA GUARDADA Y RENOVACIÓN AUTOMÁTICA (CardNET tokenización).
 *
 * Guarda SOLO referencias de CardNET (customer/perfil) y datos de exhibición.
 * El cobro recurrente se hace server-to-server con esas referencias; la tarjeta
 * vive únicamente en CardNET. Nada de PAN/CVV toca este sistema.
 */

export interface GuardarTarjetaInput {
  companyId: string
  clienteId: string
  customerId: string
  paymentProfileId?: string | null
  token?: string | null
  marca?: string | null
  ultimos4?: string | null
  vencMes?: number | null
  vencAnio?: number | null
  cardnetCaptureSessionId?: string | null
  /**
   * Qué texto aceptó el cliente y desde dónde. OBLIGATORIO: guardar una tarjeta
   * sin dejar constancia de que se aceptó es el estado que `consentimientos_pago`
   * existe para impedir. Quien llama sabe de dónde viene la aceptación (la ruta
   * tiene la petición; el flujo móvil, su sesión); este módulo no la inventa.
   */
  consentimiento: ContextoConsentimiento
}

/**
 * Persiste un perfil ya consultado directamente en CardNET. No acepta datos
 * del perfil enviados por el navegador y nunca activa la renovación.
 */
export async function guardarTarjeta(input: GuardarTarjetaInput) {
  if (!input.companyId || !input.clienteId || !input.customerId || !input.paymentProfileId || !input.token || input.token.length > 512) {
    throw new Error('CardNET no devolvió un perfil reusable válido.')
  }
  const tokenCifrado = cifrarTokenCardnet(input.token)
  // DOS PETICIONES A LA VEZ con el mismo perfil (un doble envío, el retorno del
  // navegador y el webhook) chocan en el índice único. En PostgreSQL ese choque
  // ABORTA la transacción entera, así que la recuperación no puede ir dentro de
  // ella (respondería 25P02, «transacción abortada»): se repite la operación en
  // una transacción NUEVA, que ya ve la fila ganadora y la actualiza en vez de
  // crear otra. Mismo patrón que `supply-v2/operations/inbox.ts`.
  for (let intento = 1; ; intento++) {
    try {
      return await guardarTarjetaUnaVez(input, tokenCifrado)
    } catch (e) {
      if (intento >= 3 || !esViolacionUnica(e)) throw e
    }
  }
}

function guardarTarjetaUnaVez(input: GuardarTarjetaInput, tokenCifrado: string) {
  return conEmpresa(input.companyId, async (tx) => {
    const tarjeta = await guardarFila(tx, input, tokenCifrado)
    // El consentimiento queda en el MISMO instante atómico que la tarjeta: o
    // quedan las dos cosas o ninguna. Idempotente: guardar otra vez el mismo
    // perfil no duplica el consentimiento ni reescribe su fecha.
    await otorgarConsentimiento(tx, {
      companyId: input.companyId,
      clienteId: input.clienteId,
      tipo: 'GUARDAR_TARJETA',
      tarjetaId: tarjeta.id,
      contexto: input.consentimiento,
    })
    return tarjeta
  })
}

/** La fila de la tarjeta, sin su consentimiento (ver `guardarTarjeta`). */
async function guardarFila(tx: Tx, input: GuardarTarjetaInput, tokenCifrado: string) {
  const existing = input.paymentProfileId
    ? await tx.tarjetaTokenizada.findFirst({
        where: {
          companyId: input.companyId,
          clienteId: input.clienteId,
          customerId: input.customerId,
          paymentProfileId: input.paymentProfileId,
          activa: true,
        },
      })
    : null
  if (existing) {
    return tx.tarjetaTokenizada.update({
      where: { id: existing.id },
      data: {
        tokenCifrado: existing.tokenCifrado ?? tokenCifrado,
        token: null,
        marca: input.marca?.slice(0, 32) ?? existing.marca,
        ultimos4: input.ultimos4 && /^\d{4}$/.test(input.ultimos4) ? input.ultimos4 : existing.ultimos4,
        vencMes: input.vencMes && input.vencMes >= 1 && input.vencMes <= 12 ? input.vencMes : existing.vencMes,
        vencAnio: input.vencAnio && input.vencAnio >= 2000 && input.vencAnio <= 9999 ? input.vencAnio : existing.vencAnio,
        consentimientoGuardadoAt: existing.consentimientoGuardadoAt ?? new Date(),
        ...(input.cardnetCaptureSessionId ? { cardnetCaptureSessionId: input.cardnetCaptureSessionId } : {}),
      },
    })
  }

  const primera = !(await tx.tarjetaTokenizada.findFirst({
    where: { companyId: input.companyId, clienteId: input.clienteId, activa: true },
    select: { id: true },
  }))
  // Si otra petición guardó a la vez el mismo perfil (o la predeterminada del
  // cliente), esto choca con el índice único y la transacción queda abortada:
  // lo resuelve `guardarTarjeta` repitiendo en una transacción nueva.
  return tx.tarjetaTokenizada.create({
    data: {
      companyId: input.companyId,
      clienteId: input.clienteId,
      customerId: input.customerId,
      proveedorCuenta: 'CARDNET',
      paymentProfileId: input.paymentProfileId ?? null,
      tokenCifrado,
      cardnetCaptureSessionId: input.cardnetCaptureSessionId ?? null,
      marca: input.marca?.slice(0, 32) ?? null,
      ultimos4: input.ultimos4 && /^\d{4}$/.test(input.ultimos4) ? input.ultimos4 : null,
      vencMes: input.vencMes && input.vencMes >= 1 && input.vencMes <= 12 ? input.vencMes : null,
      vencAnio: input.vencAnio && input.vencAnio >= 2000 && input.vencAnio <= 9999 ? input.vencAnio : null,
      predeterminada: primera,
      consentimientoGuardadoAt: new Date(),
    },
  })
}

/** Tarjetas activas del cliente (para "Mis tarjetas"). Nunca expone el token. */
export async function listarTarjetasCliente(clienteId: string, companyId: string) {
  const tarjetas = await conEmpresa(companyId, (tx) =>
    tx.tarjetaTokenizada.findMany({
      where: { clienteId, companyId, OR: [{ activa: true }, { eliminacionPendiente: true }] },
      select: {
        id: true,
        marca: true,
        ultimos4: true,
        vencMes: true,
        vencAnio: true,
        createdAt: true,
        predeterminada: true,
        eliminacionPendiente: true,
      },
      orderBy: { createdAt: 'desc' },
    })
  )
  return tarjetas.map((tarjeta) => ({
    ...tarjeta,
    vencida: tarjetaCardnetVencida(tarjeta.vencMes, tarjeta.vencAnio),
  }))
}

/** Marca una tarjeta como predeterminada sin exponer ni aceptar referencias CardNET. */
export async function establecerTarjetaPredeterminada(id: string, clienteId: string, companyId: string): Promise<boolean> {
  return conEmpresa(companyId, async (tx) => {
    const tarjeta = await tx.tarjetaTokenizada.findFirst({
      where: { id, clienteId, companyId, activa: true, eliminacionPendiente: false },
      select: { id: true, vencMes: true, vencAnio: true },
    })
    if (!tarjeta || tarjetaCardnetVencida(tarjeta.vencMes, tarjeta.vencAnio)) return false
    await tx.tarjetaTokenizada.updateMany({
      where: { clienteId, companyId, activa: true, predeterminada: true },
      data: { predeterminada: false },
    })
    await tx.tarjetaTokenizada.update({ where: { id: tarjeta.id }, data: { predeterminada: true } })
    return true
  })
}

/** El cliente quita su tarjeta: se desactiva, se borra en CardNET y se apaga la renovación. */
export async function eliminarTarjeta(
  id: string,
  clienteId: string,
  companyId: string
): Promise<'eliminada' | 'pendiente' | 'no_encontrada'> {
  const tarjeta = await conEmpresa(companyId,
    (tx) => tx.tarjetaTokenizada.findFirst({ where: { id, companyId, clienteId } })
  ).catch(() => null)
  if (!tarjeta || (!tarjeta.activa && !tarjeta.eliminacionPendiente)) return 'no_encontrada'

  // Se revoca localmente antes de la llamada remota: aunque CardNET falle, el
  // backend deja de ofrecer esta referencia y registra el borrado pendiente.
  await conEmpresa(tarjeta.companyId, async (tx) => {
    await tx.tarjetaTokenizada.updateMany({
      where: { id, clienteId, activa: true },
      data: {
        activa: false,
        predeterminada: false,
        eliminacionPendiente: true,
        tokenCifrado: null,
        token: null,
      },
    })
    // Las membresías que renovaban con esta tarjeta: sus ids, para retirar también
    // el consentimiento de renovar de cada una (la renovación se apaga aquí y un
    // consentimiento vigente sin renovación no puede quedar flotando).
    const renovaban = await tx.membership.findMany({
      where: { tarjetaTokenizadaId: id },
      select: { id: true },
    })
    await tx.membership.updateMany({
      where: { tarjetaTokenizadaId: id },
      data: { autoRenovar: false, tarjetaTokenizadaId: null },
    })
    // Quitar la tarjeta retira lo que el cliente aceptó sobre ella. La fila no se
    // borra: queda con su `revocadoAt`, que es la evidencia de que lo retiró.
    await revocarConsentimientos(tx, { tarjetaId: id })
    for (const m of renovaban) {
      await revocarConsentimientos(tx, { tipo: 'RENOVACION_AUTOMATICA', membershipId: m.id })
    }
    if (tarjeta.predeterminada) {
      const siguiente = await tx.tarjetaTokenizada.findFirst({
        where: { companyId: tarjeta.companyId, clienteId, activa: true, eliminacionPendiente: false },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      })
      if (siguiente) {
        await tx.tarjetaTokenizada.update({ where: { id: siguiente.id }, data: { predeterminada: true } })
      }
    }
  }).catch((error) => {
    anotarFallo('pagos:eliminarTarjeta:revocarLocal', { id })(error)
    throw error
  })

  const remotoEliminado = !tarjeta.paymentProfileId || await borrarPerfilCardnet({
    customerId: tarjeta.customerId,
    paymentProfileId: tarjeta.paymentProfileId,
  }).catch(() => false)
  if (remotoEliminado) {
    await conEmpresa(tarjeta.companyId, (tx) =>
      tx.tarjetaTokenizada.updateMany({ where: { id, clienteId }, data: { eliminacionPendiente: false } })
    )
    return 'eliminada'
  }
  return 'pendiente'
}

/**
 * APAGA la renovación automática porque el SISTEMA decidió que ya no se puede
 * cobrar (rechazos agotados, tarjeta vencida). No es lo mismo que cuando la apaga
 * el cliente: aquí NO se programa la cancelación al vencimiento —la membresía
 * simplemente deja de renovarse sola— y la tarjeta se queda guardada.
 *
 * Retira el consentimiento de renovar: la fila no se borra, queda con su fecha de
 * revocación, igual que cuando lo retira el cliente. Volver a encenderla exige un
 * consentimiento nuevo, con el texto de entonces: es una decisión nueva sobre una
 * tarjeta que acaba de fallar.
 *
 * Devuelve `true` si ESTA llamada la apagó. Si ya estaba apagada (el cliente se
 * adelantó, otra ejecución llegó antes) devuelve `false`, y quien llama no avisa
 * de algo que ya no es cierto.
 */
async function apagarRenovacionPorFallo(
  tx: Tx,
  input: { membershipId: string }
): Promise<boolean> {
  const r = await tx.membership.updateMany({
    where: { id: input.membershipId, autoRenovar: true },
    data: { autoRenovar: false },
  })
  if (r.count === 0) return false
  await revocarConsentimientos(tx, {
    tipo: 'RENOVACION_AUTOMATICA',
    membershipId: input.membershipId,
  })
  return true
}

/** La clasificación que dejó el cobro en `respuesta._clasificacion`, si la dejó. */
function clasificacionDe(respuesta: unknown): string | null {
  if (respuesta && typeof respuesta === 'object' && !Array.isArray(respuesta)) {
    const c = (respuesta as Record<string, unknown>)._clasificacion
    return typeof c === 'string' ? c : null
  }
  return null
}

/** El estado HTTP de la llamada al proveedor, que `evidencia` guarda como `_http`. */
function httpDe(crudo: unknown): number | null {
  if (crudo && typeof crudo === 'object') {
    const h = (crudo as Record<string, unknown>)._http
    return typeof h === 'number' ? h : null
  }
  return null
}

/**
 * Deja un intento cuyo resultado NO es un rechazo: no se sabe si cobró
 * (`incierto`) o la pasarela ni lo procesó (`tecnico`). Queda `ERROR` con su
 * clasificación, que es lo que lee `evaluarCiclo` para no volver a cobrar.
 */
async function marcarIntentoSinResultado(
  companyId: string,
  intentoId: string,
  clasificacion: 'incierto' | 'tecnico',
  motivo: string,
  crudo: Record<string, unknown> | null
): Promise<void> {
  await conEmpresa(companyId, (tx) =>
    tx.pagoIntento.update({
      where: { id: intentoId },
      data: {
        estado: 'ERROR',
        motivoRechazo: motivo,
        respuesta: { ...(crudo ?? {}), _clasificacion: clasificacion } as never,
      },
    })
  ).catch(anotarFallo('pagos:renovacion:errorUpdate', { intentoId }))
}

export interface RechazoDeRenovacion {
  companyId: string
  clienteId: string
  membershipId: string
  intentoId: string
  clase: 'rechazo' | 'rechazo_definitivo'
  /** El motivo para el cliente (ya traducido); sin él, el aviso usa uno genérico. */
  motivo: string | null
  codigo: string | null
  crudo: Record<string, unknown> | null
  /** Contando este. */
  rechazosEnCiclo: number
  vencimiento: Date
  aviso: { plan: string; monto: number; tarjeta: string }
  /** Lo confirmó la conciliación automática después, no la respuesta del cobro. */
  conciliado?: boolean
}

/**
 * UN RECHAZO REAL de una renovación automática.
 *
 * Se registra el intento, el asiento de auditoría y —si corresponde— se apaga la
 * renovación, TODO en una transacción: o queda dicho lo que pasó y lo que se
 * decidió, o no queda nada a medias. Después se avisa al cliente.
 *
 * Lo comparten el cobro (la pasarela contestó «no») y la conciliación automática
 * (CardNET confirmó, al consultarlo después, que un cobro dudoso se rechazó): las
 * dos aplican la misma política, con el mismo conteo de intentos.
 *
 * Solo cierra un intento que sigue ABIERTO (`CREADO`, o `ERROR` sin activar): si
 * otra ejecución o una persona ya lo resolvió, no toca nada y devuelve `null`.
 * También devuelve `null` si la base falla; entonces el intento queda abierto y
 * `evaluarCiclo` lo lee como resultado desconocido, que no se cobra solo.
 */
export async function registrarRechazoDeRenovacion(
  r: RechazoDeRenovacion
): Promise<{ apagada: boolean } | null> {
  const decision = decidirTrasRechazo({
    clase: r.clase,
    rechazosEnCiclo: r.rechazosEnCiclo,
    ahora: new Date(),
    vencimiento: r.vencimiento,
  })
  const registro = await conEmpresa(r.companyId, async (tx) => {
    const cerrado = await tx.pagoIntento.updateMany({
      where: { id: r.intentoId, estado: { in: ['CREADO', 'ERROR'] }, activadoAt: null },
      data: {
        estado: 'RECHAZADO',
        motivoRechazo: r.motivo ?? 'Rechazada',
        respuesta: {
          ...(r.crudo ?? {}),
          _clasificacion: r.clase,
          ...(r.conciliado ? { _conciliado: 'automatico' } : {}),
        } as never,
      },
    })
    if (cerrado.count !== 1) return null
    const apagada =
      decision.accion === 'desactivar'
        ? await apagarRenovacionPorFallo(tx, { membershipId: r.membershipId })
        : false
    await tx.auditLog.create({
      data: {
        companyId: r.companyId,
        userId: null,
        accion: 'PAGO_RECHAZADO',
        entidadTipo: 'Membership',
        entidadId: r.membershipId,
        payload: {
          motivo: 'renovacion_automatica_tarjeta',
          intentoId: r.intentoId,
          codigo: r.codigo,
          rechazo: r.rechazosEnCiclo,
          maximo: POLITICA_RENOVACION.maxRechazosPorCiclo,
          resultado: decision.accion === 'reintentar' ? 'se_reintentara' : 'renovacion_desactivada',
          causa: decision.accion === 'desactivar' ? decision.causa : null,
          ...(r.conciliado ? { conciliado: 'automatico' } : {}),
        },
      },
    })
    return { apagada }
  }).catch((e) => {
    // El cliente no recibe aviso de algo que no quedó registrado; por eso se hace ruido.
    logErrorBd('pagos:renovacion:rechazo', e, { membershipId: r.membershipId, intentoId: r.intentoId })
    return null
  })

  if (registro && (decision.accion === 'reintentar' || registro.apagada)) {
    await avisarCliente({
      companyId: r.companyId,
      clienteId: r.clienteId,
      tipo: decision.accion === 'reintentar' ? 'rechazo_con_reintento' : 'rechazo_final',
      datos: {
        plan: r.aviso.plan,
        monto: r.aviso.monto,
        tarjeta: r.aviso.tarjeta,
        vence: r.vencimiento,
        membershipId: r.membershipId,
        motivo: r.motivo,
        causa: decision.accion === 'desactivar' ? decision.causa : undefined,
        intentos: r.rechazosEnCiclo,
      },
      dedupeKey: clavesDeAviso.rechazo(r.intentoId),
    })
  }
  return registro
}

/** Por qué una renovación se omitió. Es lo que cuenta el resumen del cron. */
export type RazonOmision =
  | 'sin_aviso'
  | 'tarjeta_vencida'
  | 'fuera_de_ventana'
  | 'reciente'
  | 'agotada'
  | 'incierta'
  | 'cobrada'

export type RenovacionResultado =
  | { estado: 'renovada'; nuevaVigencia: Date }
  | { estado: 'omitida'; motivo: string; razon?: RazonOmision }
  /** El banco o la pasarela dijeron que no. `desactivada`: ese rechazo apagó la renovación. */
  | { estado: 'rechazada'; motivo: string; desactivada: boolean }
  /** `incierto`: no se sabe si cobró, y por eso no se vuelve a intentar solo. */
  | { estado: 'error'; motivo: string; incierto?: boolean }

// Margen: se empieza a cobrar cuando faltan <= N días para vencer. Son 3, no 1:
// con un día de margen caben uno o dos intentos antes de que el job de
// vencimientos pase la membresía a VENCIDA, y los reintentos no existen. Ver
// `POLITICA_RENOVACION.diasAntesDelPrimerIntento`.
const MARGEN_MS = MARGEN_PRIMER_INTENTO_MS

/**
 * CUÁNTO ATRÁS SE PUEDE MIRAR. El suelo que faltaba.
 *
 * La selección pedía `fechaVencimiento <= ahora + 1 día` y nada más. Sin suelo,
 * eso no significa «vence mañana»: significa «vence mañana O venció en
 * cualquier momento del pasado». Una membresía que caducó en marzo y seguía
 * diciendo ACTIVA —porque el job diario que las vence no había pasado— entraba
 * en la tanda y se le COBRABA LA TARJETA meses después.
 *
 * El cron corre a diario, así que tres días cubren de sobra que un día falle,
 * se retrase o la cola se atasque. Lo que queda fuera es justo lo que nadie
 * quiere: resucitar cobrando algo que el cliente dio por terminado hace
 * semanas. Ésa renueva por el camino normal, con el cliente delante.
 */
const GRACIA_VENCIDA_MS = 3 * 24 * 60 * 60 * 1000

export type ReclamoRenovacion =
  | { ok: true; id: string; uniqueId: string; rechazosPrevios: number }
  | { ok: false; motivo: MotivoDeBloqueo }

/**
 * RECLAMO ATÓMICO DEL INTENTO DE RENOVACIÓN.
 *
 * La guarda anti-duplicado era «consultar si hubo un intento reciente» y, por
 * separado, «crear el intento». Entre las dos hay un hueco: dos ejecuciones del
 * cron a la vez (un reintento de la plataforma, un disparo manual encima del
 * programado) consultan, las dos ven que no hay nada, y las dos crean y cobran.
 * Una guarda que no es atómica solo protege cuando el segundo intento llega
 * después de que el primero terminó, que es justo el caso en que no hacía falta.
 *
 * Se cierra serializando por membresía con un candado de la base de datos que
 * vive lo que dura la transacción: la consulta y la creación ocurren con él
 * tomado, y quien llegue segundo espera, ve el intento ya confirmado y se
 * detiene. El `UniqueID` que va al proveedor es la segunda barrera.
 *
 * QUÉ SE CONSULTA. Los intentos del CICLO de esta renovación (desde
 * `inicioCiclo`), y `evaluarCiclo` decide: separación mínima entre intentos,
 * tope de rechazos, y —lo que antes no existía— no volver a cobrar si un intento
 * anterior quedó con resultado desconocido o si cobró y no extendió la
 * membresía. La ventana fija de 12 h que había se vencía antes del siguiente
 * cron, así que un cobro caído se repetía al día siguiente.
 *
 * Devuelve el intento creado, o por qué no se puede crear. LANZA si la base
 * falla: quien llama NO debe cobrar. Antes ese error se tragaba y se seguía
 * como si no hubiera intento previo.
 *
 * Exportada para poder probarla en concurrencia contra una base real.
 */
export async function reclamarIntentoDeRenovacion(input: {
  companyId: string
  clienteId: string
  membershipId: string
  pesos: number
  clienteIp: string
  /** Desde cuándo cuentan los intentos de ESTE ciclo. Ver `inicioDelCiclo`. */
  inicioCiclo: Date
}): Promise<ReclamoRenovacion> {
  return conEmpresa(input.companyId, async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`renovacion:${input.membershipId}`}, 0))`
    // TODOS los intentos con CardNET de esta membresía en el ciclo, no solo los
    // del cron: un cliente que está pagando a mano ahora mismo, o que cobró y no
    // se le entregó, también impide cobrarle encima. Lo que solo cuenta el cron
    // son los rechazos (ver `rechazosDelCron`).
    //
    // Además del ciclo se conserva la regla que ya había: una renovación APROBADA
    // y sin entregar de los últimos 30 días bloquea otro cobro aunque quede fuera
    // del ciclo (se resuelve con su entrega, no con un cobro nuevo).
    const previos = (
      await tx.pagoIntento.findMany({
        where: {
          membershipId: input.membershipId,
          proveedor: 'CARDNET',
          OR: [
            { createdAt: { gte: input.inicioCiclo } },
            {
              estado: 'APROBADO',
              canal: CANAL_RENOVACION,
              fulfillmentEstado: { not: 'COMPLETADA' },
              activadoAt: { gte: new Date(Date.now() - 30 * 86_400_000) },
            },
          ],
        },
        select: {
          estado: true,
          createdAt: true,
          activadoAt: true,
          fulfillmentEstado: true,
          respuesta: true,
          canal: true,
        },
      })
    ).map((p) => ({
      estado: p.estado,
      createdAt: p.createdAt,
      activadoAt: p.activadoAt,
      fulfillmentEstado: p.fulfillmentEstado,
      clasificacion: clasificacionDe(p.respuesta),
      delCron: p.canal === CANAL_RENOVACION,
    }))
    const evaluacion = evaluarCiclo(previos, new Date())
    if (!evaluacion.permitido) return { ok: false as const, motivo: evaluacion.motivo }
    const creado = await tx.pagoIntento.create({
      data: {
        companyId: input.companyId,
        clienteId: input.clienteId,
        proveedor: 'CARDNET',
        membershipId: input.membershipId,
        // Sin el cliente delante: es lo que separa esta renovación de un pago
        // suyo, y lo que permite reportar «renovaciones automáticas».
        canal: CANAL_RENOVACION,
        monto: input.pesos,
        moneda: 'DOP',
        estado: 'CREADO',
        ipAddress: input.clienteIp,
        // Va al proveedor como `UniqueID`: es lo que permite preguntarle después
        // por ESTE cobro si su respuesta se pierde (ver `conciliarRenovacionesDudosas`).
        cardnetUniqueId: stablePurchaseId(),
      },
      select: { id: true, cardnetUniqueId: true },
    })
    return {
      ok: true as const,
      id: creado.id,
      uniqueId: creado.cardnetUniqueId!,
      rechazosPrevios: rechazosDelCron(previos),
    }
  })
}

/** Lo que dice el resultado cuando el ciclo no deja cobrar. Los dos graves se registran. */
function omisionPorBloqueo(
  membershipId: string,
  motivo: MotivoDeBloqueo
): Extract<RenovacionResultado, { estado: 'omitida' }> {
  switch (motivo) {
    case 'reciente':
      return { estado: 'omitida', motivo: 'Ya hubo un intento reciente.', razon: 'reciente' }
    case 'agotado':
      return { estado: 'omitida', motivo: 'Ya se usaron los intentos de este ciclo.', razon: 'agotada' }
    case 'incierto':
      // Un intento anterior pudo haber cobrado. Repetirlo solo es el doble
      // cargo: lo decide una persona, y por eso se hace ruido.
      logErrorBd(
        'pagos:renovacion:bloqueada-incierta',
        new Error('Hay un intento anterior sin resultado confirmado; no se vuelve a cobrar sin conciliarlo.'),
        { membershipId }
      )
      return {
        estado: 'omitida',
        motivo: 'Un intento anterior no tiene resultado confirmado: no se vuelve a cobrar sin conciliarlo.',
        razon: 'incierta',
      }
    case 'cobrado':
      logErrorBd(
        'pagos:renovacion:bloqueada-cobrada',
        new Error('Un intento anterior COBRÓ y la membresía no se extendió; no se vuelve a cobrar.'),
        { membershipId }
      )
      return {
        estado: 'omitida',
        motivo: 'Hay un cobro aprobado sin entregar: se resuelve en Conciliación.',
        razon: 'cobrada',
      }
  }
}

/**
 * Cobra la tarjeta guardada de UNA membresía y la extiende si aprueba.
 *
 * Idempotencia práctica: al renovar, `fechaVencimiento` salta ~un período
 * adelante, así que el cron no la vuelve a elegir. Dentro del ciclo, el reclamo
 * (`reclamarIntentoDeRenovacion`) impide el doble cobro: separación entre
 * intentos, tope de rechazos, y nada de repetir un cobro que pudo haber salido.
 *
 * QUÉ PASA CUANDO NO APRUEBA (`clasificarCobro`):
 *  · Rechazo real: queda `RECHAZADO` con su motivo y su asiento de auditoría, y
 *    se le AVISA al cliente. Según `decidirTrasRechazo` se reintenta en el
 *    siguiente cron o se apaga la renovación (la tarjeta se conserva).
 *  · Resultado desconocido (sin respuesta, error del servidor, «ya se
 *    procesó»): queda `ERROR` marcado `incierto`. NO se avisa al cliente, porque
 *    no se sabe qué decirle, y NO se vuelve a cobrar hasta que alguien lo
 *    concilie.
 *  · La pasarela ni procesó la petición: `ERROR` marcado `tecnico`. No cuenta
 *    contra el cliente.
 *
 * Una tarjeta con vencimiento conocido y ya vencida NO genera intento: se apaga
 * la renovación y se avisa.
 */
export async function renovarMembresiaPorTarjeta(
  membershipId: string,
  clienteIp = '0.0.0.0'
): Promise<RenovacionResultado> {
  const m = await sinEmpresa(
    'pagos: localizar membresía por id para renovación (su empresa se deriva de la membresía)',
    (tx) =>
      tx.membership.findUnique({
        where: { id: membershipId },
        include: { plan: true, tarjetaTokenizada: true },
      })
  ).catch(() => null)
  if (!m) return { estado: 'omitida', motivo: 'Membresía no encontrada.' }
  if (!m.autoRenovar || !m.tarjetaTokenizada || !m.tarjetaTokenizada.activa) {
    return { estado: 'omitida', motivo: 'Sin renovación automática o sin tarjeta activa.' }
  }
  // La membresía tiene que seguir activa y en la ventana de cobro AHORA, no solo
  // cuando el cron la eligió. Entre elegirla y cobrarla pasa tiempo, y a veces
  // otra ejecución: sin esto, un segundo cron que llega después de que el
  // primero renovó leería el estado nuevo y cobraría otra vez. La aprobación,
  // además, deja la membresía en ACTIVA: no puede resucitar una cancelada.
  if (m.estado !== 'ACTIVA') {
    return { estado: 'omitida', motivo: 'La membresía ya no está activa.' }
  }
  const ventana = tocaRenovar({
    vencimiento: m.fechaVencimiento,
    fechaPago: m.fechaPago,
    ahora: new Date(),
    graciaMs: GRACIA_VENCIDA_MS,
  })
  if (!ventana.toca) {
    const motivos = {
      sin_fecha: 'La membresía no tiene fecha de vencimiento.',
      todavia_no: 'Todavía no toca renovar.',
      ya_vencio: 'La membresía venció hace demasiado para cobrarla sola.',
      pagada_hace_poco: 'Se pagó hace muy poco.',
    } as const
    return {
      estado: 'omitida',
      motivo: motivos[ventana.razon],
      razon: ventana.razon === 'pagada_hace_poco' ? 'reciente' : 'fuera_de_ventana',
    }
  }
  if (!(await puedeCobrarToken(m.companyId))) {
    return { estado: 'omitida', motivo: 'La pasarela no está disponible para esta empresa.' }
  }
  const tarjeta = m.tarjetaTokenizada
  // La tarjeta tiene que ser del cliente de la membresía. Antes de la etapa 1,
  // `POST /guardar` aceptaba ids del navegador y se pudo atar la tarjeta de otra
  // persona; el candado de la ruta no limpia lo que ya se escribió, este sí
  // impide cobrarlo.
  if (tarjeta.clienteId !== m.clienteId) {
    return { estado: 'omitida', motivo: 'La tarjeta guardada no pertenece al cliente de la membresía.' }
  }
  // Sin id de perfil ni token, el cobro solo diría «cobra a este cliente» y
  // CardNET elegiría por su cuenta entre las tarjetas que tenga — un Customer
  // acumula un perfil por cada vez que se registró una. No se cobra una tarjeta
  // que no se pueda señalar.
  if (!tarjeta.paymentProfileId && !tarjeta.tokenCifrado && !tarjeta.token) {
    return { estado: 'omitida', motivo: 'La tarjeta guardada no identifica un perfil de pago.' }
  }

  // CONSENTIMIENTO. `autoRenovar` por sí solo no basta: cobrar sin que el
  // cliente esté delante exige que conste que lo autorizó, y que no lo retiró.
  // Las renovaciones que ya existían quedaron con un consentimiento HEREDADO
  // (migración 20261077), así que esto no las detiene.
  const consentimiento = await conEmpresa(m.companyId, (tx) =>
    consentimientoVigente(tx, { tipo: 'RENOVACION_AUTOMATICA', membershipId })
  ).catch(() => null)
  if (!consentimiento) {
    return { estado: 'omitida', motivo: 'No hay un consentimiento de renovación automática vigente.' }
  }

  const ahora = new Date()
  // Sin fecha de vencimiento no hay ciclo que medir; se trata como «ya no queda
  // tiempo», que es la lectura que no promete reintentos.
  const vencimiento = m.fechaVencimiento ?? ahora

  // TARJETA VENCIDA: ni se intenta. Un cobro contra una tarjeta que ya sabemos
  // vencida solo produce un rechazo —con su ruido en el banco del cliente— y le
  // gasta un intento. Se apaga la renovación y se le dice por qué. Solo actúa si
  // CardNET entregó el vencimiento: sin el dato no se bloquea nada por suponer.
  if (tarjetaCardnetVencida(m.tarjetaTokenizada.vencMes, m.tarjetaTokenizada.vencAnio)) {
    const apagada = await conEmpresa(m.companyId, async (tx) => {
      const ok = await apagarRenovacionPorFallo(tx, { membershipId })
      if (ok) {
        await tx.auditLog.create({
          data: {
            companyId: m.companyId,
            userId: null,
            accion: 'PAGO_RECHAZADO',
            entidadTipo: 'Membership',
            entidadId: membershipId,
            payload: {
              motivo: 'renovacion_automatica_tarjeta',
              tipo: 'renovacion_no_intentada',
              causa: 'tarjeta_vencida',
              tarjetaId: tarjeta.id,
              vencimientoTarjeta: formatoVencimiento(tarjeta.vencMes, tarjeta.vencAnio),
            },
          },
        })
      }
      return ok
    }).catch((e) => {
      logErrorBd('pagos:renovacion:tarjeta-vencida', e, { membershipId })
      return false
    })
    if (apagada) {
      await avisarCliente({
        companyId: m.companyId,
        clienteId: m.clienteId,
        tipo: 'tarjeta_vencida',
        datos: {
          plan: m.plan.nombre,
          monto: Number(m.plan.precio),
          tarjeta: etiquetaTarjeta(tarjeta.marca, tarjeta.ultimos4),
          vence: vencimiento,
          membershipId,
          tarjetaVence: formatoVencimiento(tarjeta.vencMes, tarjeta.vencAnio),
        },
        dedupeKey: clavesDeAviso.tarjetaVencida(membershipId, claveDeCiclo(vencimiento)),
      })
    }
    return {
      estado: 'omitida',
      motivo: 'La tarjeta guardada está vencida: no se intentó el cobro.',
      razon: 'tarjeta_vencida',
    }
  }

  // AVISO PREVIO. Quien aceptó `renovacion-v1` aceptó que se le avisaría antes de
  // cada cobro; si no consta el aviso de este ciclo, no se cobra. Los
  // consentimientos anteriores nunca prometieron nada, así que no se les exige.
  if (exigeAvisoPrevio(consentimiento.textoVersion)) {
    const avisado = await avisoPrevioRegistrado({
      companyId: m.companyId,
      clienteId: m.clienteId,
      membershipId,
      vence: vencimiento,
    }).catch(() => false)
    if (!avisado) {
      return {
        estado: 'omitida',
        motivo: 'Falta el aviso previo al cliente: no se cobra sin él.',
        razon: 'sin_aviso',
      }
    }
  }

  // El token está cifrado (o, en filas históricas, en claro). Se abre ANTES de
  // reclamar el intento y fuera del `try` del cobro: un token que no se puede
  // leer (llave ausente o distinta) NO es un cobro de resultado desconocido,
  // porque ni siquiera se llegó a llamar a la pasarela. Sin él aún se puede
  // cobrar si hay `paymentProfileId`; si no lo hay, el token era la única
  // referencia y sin poder leerlo no hay tarjeta que cobrar.
  let tokenAbierto: string | null = tarjeta.token
  if (tarjeta.tokenCifrado) {
    try {
      tokenAbierto = descifrarTokenCardnet(tarjeta.tokenCifrado)
    } catch (e) {
      logErrorBd('pagos:renovacion:token-ilegible', e, { membershipId, tarjetaId: tarjeta.id })
      tokenAbierto = null
      if (!tarjeta.paymentProfileId) {
        return { estado: 'omitida', motivo: 'No se pudo leer la tarjeta guardada.' }
      }
    }
  }

  const pesos = Number(m.plan.precio)
  if (pesos <= 0) return { estado: 'omitida', motivo: 'Precio del plan no válido.' }

  let reclamo: ReclamoRenovacion
  try {
    reclamo = await reclamarIntentoDeRenovacion({
      companyId: m.companyId,
      clienteId: m.clienteId,
      membershipId,
      pesos,
      clienteIp,
      inicioCiclo: inicioDelCiclo(vencimiento, m.fechaPago),
    })
  } catch (e) {
    logErrorBd('pagos:renovacion:reclamo', e, { membershipId })
    return { estado: 'error', motivo: 'No se pudo registrar el intento de cobro.' }
  }
  if (!reclamo.ok) return omisionPorBloqueo(membershipId, reclamo.motivo)
  const intento = reclamo

  let cobro
  try {
    cobro = await cobrarConCredencialGuardada({
      customerId: tarjeta.customerId,
      paymentProfileId: tarjeta.paymentProfileId,
      token: tokenAbierto,
      pesos,
      orden: intento.id,
      clienteIp,
      purchaseUniqueId: intento.uniqueId,
    })
  } catch (e) {
    // Una excepción en la llamada NO dice que no se cobró: pudo salir la
    // petición y perderse la respuesta. Se trata como resultado desconocido.
    logErrorBd('pagos:renovacion:cobrar', e, { membershipId })
    await marcarIntentoSinResultado(
      m.companyId,
      intento.id,
      'incierto',
      'La llamada a la pasarela falló: no se sabe si se cobró.',
      null
    )
    return { estado: 'error', motivo: 'No se pudo contactar la pasarela.', incierto: true }
  }

  const clase = clasificarCobro({
    aprobada: cobro.aprobada,
    codigo: cobro.codigo ?? '',
    requiereActivacion: cobro.requiereActivacion,
    httpStatus: httpDe(cobro.crudo),
  })

  if (clase === 'incierto' || clase === 'tecnico') {
    const incierto = clase === 'incierto'
    const motivo = incierto
      ? 'Sin resultado confirmado de la pasarela; no se reintenta hasta conciliar.'
      : 'La pasarela no procesó la petición (credenciales o ruta).'
    await marcarIntentoSinResultado(m.companyId, intento.id, clase, motivo, cobro.crudo ?? null)
    // Es un asunto para una persona, no para el cliente: ruido en el registro de
    // errores, ningún aviso al cliente.
    logErrorBd(
      incierto ? 'pagos:renovacion:resultado-incierto' : 'pagos:renovacion:fallo-tecnico',
      new Error(motivo),
      { membershipId, intentoId: intento.id, codigo: cobro.codigo || null, http: httpDe(cobro.crudo) }
    )
    return { estado: 'error', motivo, incierto }
  }

  if (clase !== 'aprobada') {
    const registro = await registrarRechazoDeRenovacion({
      companyId: m.companyId,
      clienteId: m.clienteId,
      membershipId,
      intentoId: intento.id,
      clase,
      motivo: cobro.motivo ?? null,
      codigo: cobro.codigo || null,
      crudo: cobro.crudo ?? null,
      rechazosEnCiclo: intento.rechazosPrevios + 1,
      vencimiento,
      aviso: { plan: m.plan.nombre, monto: pesos, tarjeta: etiquetaTarjeta(tarjeta.marca, tarjeta.ultimos4) },
    })
    return {
      estado: 'rechazada',
      motivo: cobro.motivo ?? 'La tarjeta fue rechazada.',
      desactivada: registro?.apagada ?? false,
    }
  }

  // Aprobada: cerrar el cobro y extender la membresía (desde el vencimiento actual si aún es futuro, si no desde el
  // cobro). El cobro se reclama como cualquier entrega de pasarela —`PROCESANDO` con su `claimAt`—: si la extensión falla,
  // la entrega queda FALLIDA y `reintentarEntrega` la rehace sin recobrar (ver `renovacion-extension.ts`).
  const now = new Date()
  const claimAt = now
  const marca = await conEmpresa(m.companyId, (tx) =>
    tx.pagoIntento.updateMany({
      where: { id: intento.id, activadoAt: null },
      data: {
        estado: 'APROBADO',
        updatedAt: claimAt,
        activadoAt: now,
        fulfillmentEstado: 'PROCESANDO',
        fulfillmentIntentos: { increment: 1 },
        autorizacion: cobro.autorizacion,
        respuesta: (cobro.crudo ?? null) as never,
      },
    })
  )
  if (marca.count === 0) return { estado: 'omitida', motivo: 'Ya estaba renovada.' }

  let extension: Awaited<ReturnType<typeof extenderMembresiaCobrada>>
  try {
    extension = await extenderMembresiaCobrada({ companyId: m.companyId, intentoId: intento.id, claimAt })
  } catch (e) {
    extension = { ok: false, error: e instanceof Error && e.message === RECLAMO_PERDIDO ? RECLAMO_PERDIDO : 'Cobrado, pero la extensión falló.' }
    logErrorBd('pagos:renovacion:extension', e, { membershipId, intentoId: intento.id })
  }
  if (!extension.ok) {
    // El cobro SÍ ocurrió; no se revierte activadoAt. Si otro proceso ganó el reclamo, él decide el resultado. Si no, la
    // entrega queda FALLIDA con su motivo: caso de conciliación con reintento explícito.
    if (extension.error !== RECLAMO_PERDIDO) {
      await marcarEntrega(m.companyId, intento.id, false, 'Cobrado, pero la extensión falló.', claimAt)
      await conEmpresa(m.companyId, (tx) =>
        tx.pagoIntento
          .update({ where: { id: intento.id }, data: { motivoRechazo: 'Cobrado, pero la extensión falló.' } })
      ).catch(anotarFallo('pagos:renovacion:extensionFallo', { intentoId: intento.id }))
    }
    return { estado: 'error', motivo: 'Cobrado, pero la extensión falló. Revisar a mano.' }
  }
  const nuevaVigencia = extension.nuevaVigencia

  // El cobro automático también es una venta del libro, con su ticket y comprobante.
  await asegurarVentaDelIntento(intento.id)

  // Recibo por correo al cliente (best-effort; el cobro ya está hecho).
  const { enviarConfirmacionPago } = await import('@/modules/pagos/correoConfirmacion')
  await enviarConfirmacionPago({
    companyId: m.companyId,
    clienteId: m.clienteId,
    planNombre: m.plan.nombre,
    monto: pesos,
    motivo: 'renovacion',
    vigenteHasta: nuevaVigencia,
  }).catch(anotarFallo('pagos:renovacion:correo', { membershipId }))

  return { estado: 'renovada', nuevaVigencia }
}

/**
 * Membresías que toca renovar ahora (activas, con tarjeta, por vencer).
 *
 * `companyId` es opcional y por defecto no filtra: el cron barre TODAS las
 * empresas. Existe para poder acotar una pasada a una sola (pruebas, un disparo
 * manual) sin tocar a las demás.
 */
export async function membresiasARenovar(limite = 200, companyId?: string): Promise<string[]> {
  const ahora = Date.now()
  const corte = new Date(ahora + MARGEN_MS)
  const suelo = new Date(ahora - GRACIA_VENCIDA_MS)
  const filas = await sinEmpresa(
    'pagos: el cron de renovación selecciona membresías por vencer de todas las empresas',
    (tx) =>
      tx.membership.findMany({
        where: {
          ...(companyId ? { companyId } : {}),
          estado: 'ACTIVA',
          autoRenovar: true,
          tarjetaTokenizadaId: { not: null },
          tarjetaTokenizada: { activa: true },
          // Una ventana, no una media recta: entre «venció hace poco» y «vence
          // dentro del margen del primer intento». Ver `GRACIA_VENCIDA_MS`.
          fechaVencimiento: { not: null, gte: suelo, lte: corte },
        },
        select: { id: true },
        // Lo que vence antes va primero: si la tanda se pasa del límite, lo que
        // queda para mañana es lo que todavía tiene tiempo.
        orderBy: { fechaVencimiento: 'asc' },
        take: limite,
      })
  ).catch(() => [])
  return filas.map((f) => f.id)
}

export interface ResumenRenovaciones {
  candidatas: number
  renovadas: number
  /** El banco o la pasarela dijeron que no. */
  rechazadas: number
  /** De las rechazadas, las que apagaron la renovación automática. */
  desactivadas: number
  omitidas: number
  /** Omitidas porque no consta el aviso previo que el texto aceptado promete. */
  sinAviso: number
  /** Omitidas por un intento anterior sin resultado confirmado o cobrado sin extender: las atiende una persona. */
  bloqueadas: number
  errores: number
  /** De los errores, los de resultado desconocido (puede haberse cobrado). */
  inciertas: number
}

/**
 * Corre una tanda de renovaciones. Lo llama el cron. Devuelve un resumen.
 *
 * Los dos números que importan mirar a diario son `bloqueadas` e `inciertas`:
 * cada uno es un cobro que pudo haber salido y que nadie va a repetir solo.
 */
export async function ejecutarRenovacionesTarjeta(companyId?: string): Promise<ResumenRenovaciones> {
  const ids = await membresiasARenovar(200, companyId)
  const resumen: ResumenRenovaciones = {
    candidatas: ids.length,
    renovadas: 0,
    rechazadas: 0,
    desactivadas: 0,
    omitidas: 0,
    sinAviso: 0,
    bloqueadas: 0,
    errores: 0,
    inciertas: 0,
  }
  for (const id of ids) {
    const r = await renovarMembresiaPorTarjeta(id)
    if (r.estado === 'renovada') resumen.renovadas++
    else if (r.estado === 'rechazada') {
      resumen.rechazadas++
      if (r.desactivada) resumen.desactivadas++
    } else if (r.estado === 'omitida') {
      resumen.omitidas++
      if (r.razon === 'sin_aviso') resumen.sinAviso++
      else if (r.razon === 'incierta' || r.razon === 'cobrada') resumen.bloqueadas++
    } else {
      resumen.errores++
      if (r.incierto) resumen.inciertas++
    }
  }
  return resumen
}
