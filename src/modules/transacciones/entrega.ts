import { conEmpresa } from '@/lib/tenant'
import { crearTransaccionAplicada } from '@/lib/transactions'
import type { TransactionTipo } from '@/lib/transactions'

/**
 * Entrega de un beneficio SIN COSTO a un cliente (Control de comprobantes ·
 * Fase 1). Deja el registro oficial en el libro mayor (`Transaction`) y habilita
 * el comprobante imprimible/reimprimible con la misma maquinaria que las ventas
 * (`obtenerTicket` + `ReceiptImpresion`), pero marcado como **comprobante de
 * entrega** (sin valor comercial): no lleva precio ni método de cobro.
 *
 * Úsalo en los puntos donde el negocio ENTREGA algo gratis y esa entrega no
 * pasa ya por la caja/escáner (que sí registran su propia transacción). Hoy:
 * el uso de un Regalo VIP (`registrarUsoOferta`).
 *
 * Nunca lanza: cuando se llama, el beneficio YA se entregó y no debe deshacerse
 * por un fallo de facturación (el error queda en el log del servidor).
 */
export async function registrarEntregaBeneficio(input: {
  /** BENEFIT_USE (beneficio/regalo) o REWARD_REDEMPTION (premio). */
  tipo: Extract<TransactionTipo, 'BENEFIT_USE' | 'REWARD_REDEMPTION'>
  companyId: string
  clienteId: string
  clienteNombre: string
  /** User.id del staff que entrega (su nombre sale en el comprobante). */
  empleadoId: string | null
  /** Qué se entregó, p. ej. "12 lavados gratis (Regalo VIP)". */
  beneficio: string
  /** Título del renglón "Servicio"; por defecto "Entrega de beneficio". */
  detalle?: string
  sucursalId?: string | null
  sucursalNombre?: string | null
  restantes?: number | null
  observaciones?: string | null
  auditoria?: { ipAddress?: string | null; userAgent?: string | null }
}): Promise<{ id: string; codigo: string; ticketNumero: string } | null> {
  try {
    return await conEmpresa(input.companyId, async (tx) => {
      const empleadoNombre = input.empleadoId
        ? ((
            await tx.user.findUnique({
              where: { id: input.empleadoId },
              select: { name: true },
            })
          )?.name ?? null)
        : null

      return crearTransaccionAplicada(tx, {
        tipo: input.tipo,
        companyId: input.companyId,
        sucursalId: input.sucursalId ?? null,
        clienteId: input.clienteId,
        empleadoId: input.empleadoId,
        // Entrega gratuita: sin monto ni método de cobro (no cuenta como venta).
        monto: 0,
        metodoCobro: null,
        snapshot: {
          esEntrega: true,
          cliente: input.clienteNombre,
          empleado: empleadoNombre ?? undefined,
          sucursal: input.sucursalNombre ?? undefined,
          servicio: input.detalle ?? 'Entrega de beneficio',
          beneficio: input.beneficio,
          restantes: input.restantes ?? undefined,
          observaciones: input.observaciones ?? undefined,
          // Sin total/subtotal → el comprobante no muestra importes.
          metodoCobroLabel: 'Regalo · sin costo',
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
    console.error('[entrega-beneficio]', e)
    return null
  }
}
