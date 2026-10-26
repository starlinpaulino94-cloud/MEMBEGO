import 'server-only'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { logErrorBd } from '@/lib/prisma-errors'
import { consultarComprasCardnet } from '@/lib/payments/cardnet-tokens'
import { interpretarCompraToken, referenciaCobro } from '@/lib/payments/cardnet-tokens-core'
import { matchingPurchases, purchaseDecision, purchaseList } from '@/modules/pagos/cardnetClientCore'
import { reintentarEntrega } from '@/modules/pagos/intentos'
import { registrarRechazoDeRenovacion } from '@/modules/pagos/cardnetTokenGuardado'
import { etiquetaTarjeta } from '@/modules/pagos/avisosRenovacionCore'
import { POLITICA_RENOVACION, clasificarCobro, inicioDelCiclo } from '@/modules/pagos/renovacionPolitica'

/**
 * CONCILIACIÓN AUTOMÁTICA DE LAS RENOVACIONES DUDOSAS.
 *
 * Un cobro automático que se cayó sin respuesta (o con un 5xx, o el código 94)
 * pudo haber salido. Por eso no se repite solo: bloquea el ciclo hasta que
 * alguien sepa qué pasó. Ese «alguien» era siempre una persona mirando el panel
 * de CardNET. Ahora, primero, se le pregunta a CardNET con la misma consulta de
 * compras que ya usa la app para sus cobros ambiguos (`consultarComprasCardnet`
 * + `purchaseDecision`), buscando ESE cobro por su orden y su `UniqueID`:
 *
 *  · CardNET dice que SE APROBÓ: se registra como cobro aprobado y se entrega
 *    con `reintentarEntrega` (extiende la membresía y deja la venta, sin volver a
 *    cobrar). Si la entrega falla, queda en la Conciliación como cualquier
 *    cobro sin entregar, y el barrido de entregas la reintenta.
 *  · CardNET dice que SE RECHAZÓ: es un rechazo real, con la misma política que
 *    si el banco hubiera contestado a tiempo (cuenta como intento, avisa al
 *    cliente, apaga la renovación si toca). El siguiente cobro lo reintenta.
 *  · Cualquier otra cosa (no aparece, aparece dos veces, pendiente, la consulta
 *    falla): SIGUE DUDOSO. No aparecer no prueba que no se cobró. Lo resuelve
 *    una persona (runbook de pagos, § 7), como antes.
 *
 * Solo se consultan intentos que llevan `UniqueID` (los anteriores a que la
 * renovación lo enviara no se pueden identificar con certeza) y de los últimos
 * 14 días, que es lo que muestra la Conciliación.
 */

const CANAL_RENOVACION = 'RENOVACION_AUTOMATICA'
const DIA_MS = 86_400_000
const VENTANA_DIAS = 14

export type VeredictoDeCompra =
  | { kind: 'approved'; authorization: string | null; fila: Record<string, unknown> }
  | { kind: 'declined'; fila: Record<string, unknown> }
  | { kind: 'unknown' }

/**
 * Qué dice CardNET de UN cobro, a partir de la respuesta de la consulta de
 * compras. Pura. Solo da un veredicto si hay EXACTAMENTE una compra con esa
 * orden, ese `UniqueID`, ese cliente y dentro de las fechas: con cero o con dos
 * no se sabe cuál es, y se queda dudoso.
 */
export function veredictoDeCompra(
  json: unknown,
  esperado: { customerId: string; orderNumber: string; uniqueId: string; from: Date; to: Date }
): VeredictoDeCompra {
  const filas = purchaseList(json)
  if (!filas) return { kind: 'unknown' }
  const exactas = matchingPurchases(filas, esperado)
  if (exactas.length !== 1) return { kind: 'unknown' }
  const fila = exactas[0]
  if (!fila || typeof fila !== 'object' || Array.isArray(fila)) return { kind: 'unknown' }
  const registro = fila as Record<string, unknown>
  const decision = purchaseDecision(200, registro)
  if (decision.kind === 'approved') return { kind: 'approved', authorization: decision.authorization, fila: registro }
  if (decision.kind === 'declined') return { kind: 'declined', fila: registro }
  return { kind: 'unknown' }
}

/** `AAAAMMDD`, el formato de fechas de la consulta de compras. */
function fechaConsulta(fecha: Date): string {
  return fecha.toISOString().slice(0, 10).replaceAll('-', '')
}

export type ResultadoConciliacion = 'aprobada' | 'rechazada' | 'sigue_dudosa'

export interface ResumenConciliacion {
  revisadas: number
  /** CardNET confirmó el cobro: se registró y se entregó (o quedó en la cola de entregas). */
  aprobadas: number
  /** CardNET confirmó el rechazo: cuenta como intento y el ciclo sigue. */
  rechazadas: number
  /** Sin respuesta clara: siguen en la Conciliación para una persona. */
  siguenDudosas: number
}

/** Concilia UN intento de renovación dudoso. Exportada para probarla contra una base real. */
export async function conciliarRenovacionDudosa(intentoId: string): Promise<ResultadoConciliacion> {
  const i = await sinEmpresa(
    'pagos: conciliar una renovación automática dudosa (su empresa se deriva del intento)',
    (tx) =>
      tx.pagoIntento.findUnique({
        where: { id: intentoId },
        select: {
          id: true,
          companyId: true,
          clienteId: true,
          membershipId: true,
          monto: true,
          createdAt: true,
          estado: true,
          activadoAt: true,
          cardnetUniqueId: true,
          membership: {
            select: {
              fechaVencimiento: true,
              fechaPago: true,
              plan: { select: { nombre: true } },
              tarjetaTokenizada: { select: { customerId: true, marca: true, ultimos4: true } },
            },
          },
        },
      })
  ).catch(() => null)
  if (!i || !i.membershipId || !i.membership || !i.cardnetUniqueId || !i.clienteId) return 'sigue_dudosa'
  const clienteId = i.clienteId
  if (i.activadoAt || (i.estado !== 'ERROR' && i.estado !== 'CREADO')) return 'sigue_dudosa'
  const tarjeta = i.membership.tarjetaTokenizada
  if (!tarjeta?.customerId) return 'sigue_dudosa'

  const ahora = new Date()
  const esperado = {
    customerId: tarjeta.customerId,
    orderNumber: referenciaCobro(i.id),
    uniqueId: i.cardnetUniqueId,
    from: new Date(i.createdAt.getTime() - DIA_MS),
    to: new Date(ahora.getTime() + DIA_MS),
  }
  const consulta = await consultarComprasCardnet({
    customerId: esperado.customerId,
    from: fechaConsulta(esperado.from),
    to: fechaConsulta(esperado.to),
    orderNumber: esperado.orderNumber,
  }).catch(() => null)
  if (!consulta?.ok) return 'sigue_dudosa'
  const veredicto = veredictoDeCompra(consulta.json, esperado)

  if (veredicto.kind === 'approved') {
    // Se registra como lo que es —un cobro aprobado sin entregar— y se entrega
    // por el camino de siempre. `FALLIDA` es el estado del que `reintentarEntrega`
    // parte sin esperar; si no llega a entregarse, así se queda y se ve.
    const marcado = await conEmpresa(i.companyId, (tx) =>
      tx.pagoIntento.updateMany({
        where: { id: i.id, estado: { in: ['CREADO', 'ERROR'] }, activadoAt: null },
        data: {
          estado: 'APROBADO',
          autorizacion: veredicto.authorization,
          activadoAt: i.createdAt,
          fulfillmentEstado: 'FALLIDA',
          motivoRechazo: 'CardNET confirmó el cobro al conciliarlo; falta extender la membresía.',
          respuesta: { ...veredicto.fila, _conciliado: 'automatico' } as never,
        },
      })
    ).catch((e) => {
      logErrorBd('pagos:conciliar-renovacion:aprobar', e, { intentoId: i.id })
      return { count: 0 }
    })
    if (marcado.count !== 1) return 'sigue_dudosa'
    const entrega = await reintentarEntrega(i.id).catch((e) => {
      logErrorBd('pagos:conciliar-renovacion:entrega', e, { intentoId: i.id })
      return null
    })
    if (entrega?.ok && entrega.entrega === 'COMPLETADA') {
      await conEmpresa(i.companyId, (tx) =>
        tx.pagoIntento.update({ where: { id: i.id }, data: { motivoRechazo: null } })
      ).catch(() => undefined)
      const membresia = await conEmpresa(i.companyId, (tx) =>
        tx.membership.findUnique({ where: { id: i.membershipId! }, select: { fechaVencimiento: true } })
      ).catch(() => null)
      const { enviarConfirmacionPago } = await import('@/modules/pagos/correoConfirmacion')
      await enviarConfirmacionPago({
        companyId: i.companyId,
        clienteId,
        planNombre: i.membership.plan.nombre,
        monto: Number(i.monto),
        motivo: 'renovacion',
        vigenteHasta: membresia?.fechaVencimiento ?? null,
      }).catch((e) => logErrorBd('pagos:conciliar-renovacion:correo', e, { intentoId: i.id }))
    } else {
      logErrorBd(
        'pagos:conciliar-renovacion:sin-entregar',
        new Error('CardNET confirmó el cobro, pero la membresía no se extendió todavía.'),
        { intentoId: i.id, error: entrega?.error ?? null }
      )
    }
    return 'aprobada'
  }

  if (veredicto.kind === 'declined') {
    const interpretado = interpretarCompraToken(veredicto.fila)
    // La consulta dice «rechazada» con todas sus letras: aunque no traiga código,
    // no es dudoso. Solo cambia si el código dice que reintentar es inútil.
    const clase =
      clasificarCobro({
        aprobada: false,
        codigo: interpretado.codigo,
        requiereActivacion: false,
        httpStatus: 200,
      }) === 'rechazo_definitivo'
        ? ('rechazo_definitivo' as const)
        : ('rechazo' as const)
    const vencimiento = i.membership.fechaVencimiento ?? ahora
    const previos = await conEmpresa(i.companyId, (tx) =>
      tx.pagoIntento.count({
        where: {
          membershipId: i.membershipId!,
          proveedor: 'CARDNET',
          canal: CANAL_RENOVACION,
          estado: 'RECHAZADO',
          id: { not: i.id },
          createdAt: { gte: inicioDelCiclo(vencimiento, i.membership!.fechaPago) },
        },
      })
    ).catch(() => null)
    if (previos === null) return 'sigue_dudosa'
    const registro = await registrarRechazoDeRenovacion({
      companyId: i.companyId,
      clienteId,
      membershipId: i.membershipId,
      intentoId: i.id,
      clase,
      motivo: interpretado.motivo,
      codigo: interpretado.codigo || null,
      crudo: veredicto.fila,
      rechazosEnCiclo: previos + 1,
      vencimiento,
      aviso: {
        plan: i.membership.plan.nombre,
        monto: Number(i.monto),
        tarjeta: etiquetaTarjeta(tarjeta.marca, tarjeta.ultimos4),
      },
      conciliado: true,
    })
    return registro ? 'rechazada' : 'sigue_dudosa'
  }

  return 'sigue_dudosa'
}

/**
 * Pasa por las renovaciones dudosas de los últimos días y le pregunta a CardNET
 * por cada una. Lo llama el cron de renovaciones ANTES de cobrar: una dudosa que
 * CardNET confirma como rechazada desbloquea el reintento de ese mismo día.
 */
export async function conciliarRenovacionesDudosas(
  limite = 50,
  companyId?: string
): Promise<ResumenConciliacion> {
  const ahora = Date.now()
  const ids = await sinEmpresa(
    'pagos: el cron de renovación busca cobros automáticos dudosos de todas las empresas',
    (tx) =>
      tx.pagoIntento.findMany({
        where: {
          ...(companyId ? { companyId } : {}),
          proveedor: 'CARDNET',
          canal: CANAL_RENOVACION,
          activadoAt: null,
          cardnetUniqueId: { not: null },
          createdAt: { gte: new Date(ahora - VENTANA_DIAS * DIA_MS) },
          OR: [
            { estado: 'ERROR', respuesta: { path: ['_clasificacion'], equals: 'incierto' } },
            { estado: 'CREADO', createdAt: { lt: new Date(ahora - POLITICA_RENOVACION.intentoEnCursoMs) } },
          ],
        },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
        take: limite,
      })
  ).catch((e) => {
    logErrorBd('pagos:conciliar-renovacion:seleccion', e, {})
    return []
  })

  const resumen: ResumenConciliacion = { revisadas: ids.length, aprobadas: 0, rechazadas: 0, siguenDudosas: 0 }
  for (const { id } of ids) {
    const r = await conciliarRenovacionDudosa(id).catch((e) => {
      logErrorBd('pagos:conciliar-renovacion', e, { intentoId: id })
      return 'sigue_dudosa' as const
    })
    if (r === 'aprobada') resumen.aprobadas++
    else if (r === 'rechazada') resumen.rechazadas++
    else resumen.siguenDudosas++
  }
  return resumen
}
