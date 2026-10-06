import 'server-only'
import { sinEmpresa } from '@/lib/tenant'
import { fail, success, type CardnetReply } from '@/modules/pagos/cardnetClienteShared'
import type { SessionUser } from '@/types'

export async function comprarPromocionCardnet(
  user: SessionUser,
  promocionId: string
): Promise<CardnetReply> {
  const { adquirirPromocion } = await import('@/modules/promociones/compraService')
  const result = await adquirirPromocion(user, promocionId).catch(() => null)
  if (!result) return fail(500, 'No se pudo procesar la compra de la promoción.')
  if ('error' in result) {
    const status = result.error === 'Promoción no encontrada.' || result.error === 'Cliente no encontrado.' ? 404 : 409
    return fail(status, result.error)
  }
  if (result.activada) return success(200, { status: 'free_activated', compraId: result.compraId })
  const purchase = await sinEmpresa(
    'CardNET cliente: leer importe propio de la compra recién adquirida',
    (tx) => tx.productoCompra.findUnique({ where: { id: result.compraId }, select: { precioCongelado: true } })
  ).catch(() => null)
  if (!purchase) return fail(404, 'No se encontró la compra de la promoción.')
  return success(200, {
    status: 'payment_required',
    compraId: result.compraId,
    amount: Number(purchase.precioCongelado ?? 0),
    currency: 'DOP',
  })
}
