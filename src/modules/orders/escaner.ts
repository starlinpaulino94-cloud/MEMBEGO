import type { MembegoOrderStatus } from '@prisma/client'
import { sinEmpresa } from '@/lib/tenant'
import { qrDePedidoVencido } from './domain'

/**
 * COMMERCE CORE · pedidos — el QR del pedido en el escáner (Fase 3).
 *
 * Lo que el empleado ve al escanear el QR de un pedido LISTO. Es una lectura:
 * cerrar el pedido lo hace `completarPedidoPorQr` (acción), que vuelve a
 * comprobarlo todo. El QR es una credencial al portador (192 bits): quien lo
 * tiene en pantalla es quien viene a recoger el pedido.
 */

export interface PedidoQrLookup {
  /** El token tal cual se escaneó (ya normalizado): es lo que la acción de cierre recibe. */
  token: string
  code: string
  empresa: string
  clienteNombre: string
  status: MembegoOrderStatus
  total: string
  currency: string
  lineas: { description: string; quantity: number }[]
  /** ¿El cliente confirmó el monto vigente? */
  confirmado: boolean
  /** Hay un ajuste de monto de la empresa (para que el empleado lo tenga presente al cobrar). */
  ajuste: string | null
  puedeCerrar: boolean
  mensaje?: string
}

export type ResultadoPedidoQr = { pedido: PedidoQrLookup; companyId: string } | null

/** Busca el pedido de un QR escaneado (entre todas las empresas: el token es único en la base). */
export async function buscarPedidoPorQr(token: string, ahora = new Date()): Promise<ResultadoPedidoQr> {
  if (typeof token !== 'string' || token === '' || token.length > 200) return null
  const p = await sinEmpresa('escáner: buscar el pedido de un QR (el token es único)', (tx) =>
    tx.membegoOrder.findUnique({
      where: { qrToken: token },
      select: {
        companyId: true,
        code: true,
        status: true,
        total: true,
        currency: true,
        adjustment: true,
        qrExpiresAt: true,
        completedAt: true,
        company: { select: { name: true } },
        customer: { select: { nombre: true } },
        lines: { select: { description: true, quantity: true }, orderBy: { createdAt: 'asc' } },
        confirmation: { select: { confirmedTotal: true } },
      },
    })
  )
  if (!p) return null

  let puedeCerrar = false
  let mensaje: string | undefined
  if (p.status === 'READY') {
    if (qrDePedidoVencido(p.qrExpiresAt, ahora)) mensaje = 'Este código QR venció. El cliente puede generar uno nuevo desde su pedido.'
    else puedeCerrar = true
  } else if (p.status === 'COMPLETED' || p.status === 'REFUNDED') {
    mensaje = `Este pedido ya se canjeó${p.completedAt ? ` el ${p.completedAt.toLocaleString('es-DO', { dateStyle: 'medium', timeStyle: 'short' })}` : ''}.`
  } else {
    mensaje = 'Este pedido todavía no está listo para canjear.'
  }

  return {
    companyId: p.companyId,
    pedido: {
      token,
      code: p.code,
      empresa: p.company.name,
      clienteNombre: p.customer.nombre,
      status: p.status,
      total: p.total.toFixed(2),
      currency: p.currency,
      lineas: p.lines,
      confirmado: !!p.confirmation && p.confirmation.confirmedTotal.equals(p.total),
      ajuste: p.adjustment.isZero() ? null : p.adjustment.toFixed(2),
      puedeCerrar,
      mensaje,
    },
  }
}
