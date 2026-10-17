import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { reciboDeIntentoExiste, registrarReciboDePasarela } from '@/modules/pagos/reciboPasarela'

/**
 * RECIBOS DE LOS PAGOS CON TARJETA ANTERIORES AL 16-10-2026.
 *
 * Hasta ese día un cobro aprobado de CardNET activaba la membresía o la compra
 * y no dejaba la venta oficial (ver `reciboPasarela.ts`). Aquí se recuperan:
 * por cada intento aprobado sin recibo se crea la venta con la FECHA DEL COBRO
 * (`activadoAt`), el monto y la autorización reales. Idempotente: un intento
 * con recibo no se vuelve a tocar, así que correrlo dos veces no duplica nada.
 *
 * Solo se emite recibo de un cobro que se entregó. «Cobrado pero no entregado»
 * (entrega FALLIDA o en proceso) es un caso de conciliación con reintento, no
 * un comprobante: se lista aparte para que alguien lo mire. Los intentos
 * anteriores al 12-09-2026 no tienen estado de entrega (la columna nació ese
 * día con 'PENDIENTE' por defecto), así que para ellos se mira el producto: si
 * quedó pagado y activo, se entregó.
 */

/** Día en que `pago_intentos.fulfillmentEstado` empezó a escribirse (P1B). Antes, 'PENDIENTE' no significa nada. */
export const INICIO_DEL_CUMPLIMIENTO = new Date('2026-09-12T00:00:00-04:00')

export type MotivoOmision = 'ENTREGA_FALLIDA' | 'ENTREGA_EN_PROCESO' | 'COBRADO_SIN_ENTREGAR' | 'SIN_CLIENTE'

export interface ReciboPendiente {
  intentoId: string
  companyId: string
  empresa: string
  clienteId: string | null
  membershipId: string | null
  compraId: string | null
  monto: number
  autorizacion: string | null
  cobradoEn: Date
  detalle: string
}

export interface PlanDeRecibos {
  /** Intentos aprobados y entregados que todavía no tienen recibo. */
  porEmitir: ReciboPendiente[]
  /** Intentos aprobados que ya tenían recibo. */
  yaTenian: number
  /** Cobrados que NO se emiten, y por qué (conciliación). */
  omitidos: { intentoId: string; empresa: string; monto: number; cobradoEn: Date; motivo: MotivoOmision }[]
}

export interface OpcionesDeRecibos {
  companyId?: string
  /** Solo cobros desde esta fecha (inclusive). */
  desde?: Date
  /** Tope de intentos a revisar en una corrida. */
  limite?: number
}

export async function planificarRecibosAnteriores(opciones: OpcionesDeRecibos = {}): Promise<PlanDeRecibos> {
  const intentos = await sinEmpresa('recibos anteriores: intentos de tarjeta aprobados de todas las empresas (tarea de mantenimiento)', (tx) =>
    tx.pagoIntento.findMany({
      where: {
        proveedor: 'CARDNET',
        estado: 'APROBADO',
        activadoAt: { not: null, ...(opciones.desde ? { gte: opciones.desde } : {}) },
        monto: { gt: 0 },
        ...(opciones.companyId ? { companyId: opciones.companyId } : {}),
      },
      select: {
        id: true,
        companyId: true,
        clienteId: true,
        membershipId: true,
        compraId: true,
        monto: true,
        autorizacion: true,
        activadoAt: true,
        fulfillmentEstado: true,
        company: { select: { name: true } },
        membership: { select: { clienteId: true, pagoConfirmado: true, plan: { select: { nombre: true } } } },
        compra: { select: { clienteId: true, pagoConfirmado: true, promocion: { select: { titulo: true } } } },
      },
      orderBy: { activadoAt: 'asc' },
      take: opciones.limite ?? 500,
    })
  )

  const plan: PlanDeRecibos = { porEmitir: [], yaTenian: 0, omitidos: [] }
  for (const i of intentos) {
    const cobradoEn = i.activadoAt as Date
    const base = { intentoId: i.id, empresa: i.company.name, monto: Number(i.monto), cobradoEn }

    if (await reciboDeIntentoExiste(i.companyId, i.id)) {
      plan.yaTenian += 1
      continue
    }

    const productoPagado = Boolean(i.membership?.pagoConfirmado || i.compra?.pagoConfirmado)
    const entregado =
      i.fulfillmentEstado === 'COMPLETADA' ||
      (i.fulfillmentEstado === 'PENDIENTE' && cobradoEn < INICIO_DEL_CUMPLIMIENTO && productoPagado)
    if (!entregado) {
      const motivo: MotivoOmision =
        i.fulfillmentEstado === 'FALLIDA' ? 'ENTREGA_FALLIDA' : i.fulfillmentEstado === 'PROCESANDO' ? 'ENTREGA_EN_PROCESO' : 'COBRADO_SIN_ENTREGAR'
      plan.omitidos.push({ ...base, motivo })
      continue
    }

    const clienteId = i.clienteId ?? i.membership?.clienteId ?? i.compra?.clienteId ?? null
    if (!clienteId) {
      plan.omitidos.push({ ...base, motivo: 'SIN_CLIENTE' })
      continue
    }

    let detalle = 'Pago con tarjeta'
    if (i.membershipId && i.membership) {
      // La renovación automática dejó `intentoId` en su bitácora: es lo que la distingue de la primera activación.
      const renovacion = await conEmpresa(i.companyId, (tx) =>
        tx.auditLog.findFirst({
          where: { entidadTipo: 'Membership', entidadId: i.membershipId as string, accion: 'PAGO_APROBADO', payload: { path: ['intentoId'], equals: i.id } },
          select: { id: true },
        })
      )
      detalle = `${renovacion ? 'Renovación · ' : 'Plan '}${i.membership.plan.nombre}`
    } else if (i.compra) {
      detalle = `Promoción ${i.compra.promocion?.titulo ?? ''}`.trim()
    }

    plan.porEmitir.push({
      ...base,
      companyId: i.companyId,
      clienteId,
      membershipId: i.membershipId,
      compraId: i.compraId,
      autorizacion: i.autorizacion,
      detalle,
    })
  }
  return plan
}

export interface ResultadoDeEmision {
  creados: { intentoId: string; codigo: string; ticketNumero: string }[]
  fallidos: { intentoId: string }[]
}

/** Crea los recibos del plan, uno por uno. Un fallo no detiene el resto; el helper nunca lanza. */
export async function emitirRecibosAnteriores(plan: PlanDeRecibos): Promise<ResultadoDeEmision> {
  const resultado: ResultadoDeEmision = { creados: [], fallidos: [] }
  for (const r of plan.porEmitir) {
    const venta = await registrarReciboDePasarela({
      companyId: r.companyId,
      intentoId: r.intentoId,
      clienteId: r.clienteId,
      membershipId: r.membershipId,
      compraId: r.compraId,
      monto: r.monto,
      autorizacion: r.autorizacion,
      proveedor: 'CARDNET',
      detalle: r.detalle,
      ocurridoEn: r.cobradoEn,
    })
    if (venta) resultado.creados.push({ intentoId: r.intentoId, codigo: venta.codigo, ticketNumero: venta.ticketNumero })
    else resultado.fallidos.push({ intentoId: r.intentoId })
  }
  return resultado
}
