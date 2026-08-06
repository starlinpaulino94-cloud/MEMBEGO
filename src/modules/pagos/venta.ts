import { conEmpresa } from '@/lib/tenant'
import { crearTransaccionAplicada } from '@/lib/transactions/application/transaction-service'

/**
 * Venta confirmada FUERA de la caja (panel admin).
 *
 * La Caja registra sus cobros en `cobrarOrden` con ticket y factura. Pero los
 * pagos también se confirman desde el panel (Confirmar pago, aprobar cambio de
 * plan, cambio directo, aprobar compra) y ese camino no dejaba Transaction:
 * la membresía quedaba activa sin ticket, sin factura imprimible y fuera del
 * historial de ventas. Este helper cierra ese hueco.
 *
 * Nunca lanza: cuando se llama, la activación YA ocurrió y no debe deshacerse
 * por un fallo de facturación (el error queda en el log del servidor).
 */
export async function registrarVentaConfirmada(input: {
  companyId: string
  clienteId: string
  clienteNombre: string
  /** User.id del staff que confirma (su nombre sale en la factura). */
  empleadoId: string | null
  detalle: string
  monto: number
  metodoCobro: 'EFECTIVO' | 'TRANSFERENCIA' | 'OTRO'
  metodoCobroLabel: string
  /** Recibo de pago (G6): banco/referencia del pago para el comprobante. */
  referenciaPago?: string | null
  sucursalId?: string | null
  sucursalNombre?: string | null
  membershipId?: string | null
  observaciones?: string | null
  auditoria?: { ipAddress?: string | null; userAgent?: string | null }
}): Promise<{ id: string; codigo: string; ticketNumero: string } | null> {
  try {
    // La venta se registra siempre dentro del contexto de la empresa: el
    // contador de ticket (transaction_counters) y la transacción misma son
    // datos de ese inquilino.
    return await conEmpresa(input.companyId, async (tx) => {
      // Documento comercial: SIEMPRE el nombre del empleado, nunca su correo.
      const empleadoNombre = input.empleadoId
        ? ((await tx.user.findUnique({
            where: { id: input.empleadoId },
            select: { name: true },
          }))?.name ?? null)
        : null

      return crearTransaccionAplicada(tx, {
        tipo: 'SALE',
        companyId: input.companyId,
        sucursalId: input.sucursalId ?? null,
        clienteId: input.clienteId,
        empleadoId: input.empleadoId,
        caja: null,
        cajaSesionId: null,
        monto: input.monto,
        metodoCobro: input.metodoCobro,
        membershipId: input.membershipId ?? null,
        snapshot: {
          detalle: input.detalle,
          cliente: input.clienteNombre,
          empleado: empleadoNombre ?? undefined,
          sucursal: input.sucursalNombre ?? undefined,
          servicio: input.detalle,
          observaciones: input.observaciones ?? undefined,
          lineas: [
            {
              descripcion: input.detalle,
              cantidad: 1,
              precioUnitario: input.monto,
              descuento: 0,
              total: input.monto,
            },
          ],
          subtotal: input.monto.toFixed(2),
          total: input.monto.toFixed(2),
          metodoCobroLabel: input.metodoCobroLabel,
          referenciaPago: input.referenciaPago ?? undefined,
        },
        auditoria: {
          ipAddress: input.auditoria?.ipAddress ?? null,
          userAgent: input.auditoria?.userAgent ?? null,
        },
        resultado: input.observaciones ?? null,
        userId: input.empleadoId,
      })
    })
  } catch (e) {
    console.error('[venta-confirmada]', e)
    return null
  }
}
