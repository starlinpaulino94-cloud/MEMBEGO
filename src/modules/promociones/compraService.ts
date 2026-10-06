import 'server-only'
import type { SessionUser } from '@/types'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { getRequestMeta } from '@/lib/server-utils'
import { formSubmitLimiter } from '@/lib/rate-limit'
import { activarCompraPromocion } from '@/modules/pagos/activacionCompra'
import {
  registrarTransicionCompra,
  validarVentanaAdquisicion,
  estadoLimiteCliente,
  mensajeLimitePorCliente,
} from '@/modules/promociones/compra'
import { asegurarClienteEnEmpresa } from '@/modules/cliente/afiliacion'

const ESTADOS_VIVOS = ['SOLICITADA', 'PENDIENTE_PAGO', 'EN_VALIDACION', 'APROBADA', 'ACTIVA'] as const

export type SolicitudCompraPromocion =
  | { readonly success: true; readonly compraId: string; readonly activada: boolean }
  | { readonly error: string; readonly compraId?: string }

export async function adquirirPromocion(
  user: SessionUser,
  promocionId: string
): Promise<SolicitudCompraPromocion> {
  const fichaActivaId = user.metadata.clienteId
  if (user.metadata.role !== 'CLIENTE' || !fichaActivaId) {
    return { error: 'Inicia sesión como cliente para adquirir promociones.' }
  }
  if (!(await formSubmitLimiter(fichaActivaId))) {
    return { error: 'Demasiados intentos. Intenta de nuevo en unos minutos.' }
  }
  if (!promocionId.trim()) return { error: 'Promoción no especificada.' }

  const [cliente, promo] = await sinEmpresa(
    'promociones: lookup de cliente y promoción por id (pertenencia se valida después)',
    (tx) =>
      Promise.all([
        tx.cliente.findUnique({ where: { id: fichaActivaId } }),
        tx.promocion.findUnique({ where: { id: promocionId } }),
      ])
  )
  if (!cliente || cliente.supabaseId !== user.supabaseId) return { error: 'Cliente no encontrado.' }
  if (!promo) return { error: 'Promoción no encontrada.' }

  const ventana = validarVentanaAdquisicion(promo)
  if (!ventana.ok) return { error: ventana.mensaje ?? 'Esta promoción no está disponible.' }

  if (promo.visibilidad === 'privada') {
    const activa = await conEmpresa(promo.companyId, (tx) =>
      tx.membership.findFirst({
        where: {
          cliente: { supabaseId: user.supabaseId, companyId: promo.companyId },
          companyId: promo.companyId,
          estado: 'ACTIVA',
        },
        select: { id: true },
      })
    )
    if (!activa) return { error: 'Esta promoción es exclusiva para miembros con membresía activa.' }
  }

  let clienteId = cliente.id
  if (promo.companyId !== cliente.companyId) {
    const alta = await asegurarClienteEnEmpresa(user.supabaseId, user.email, promo.companyId)
    if ('error' in alta) return alta
    clienteId = alta.clienteId
  }

  const viva = await conEmpresa(promo.companyId, (tx) =>
    tx.productoCompra.findFirst({
      where: { clienteId, promocionId: promo.id, estado: { in: [...ESTADOS_VIVOS] } },
      select: { id: true, estado: true },
    })
  )
  if (viva) {
    return {
      error: viva.estado === 'ACTIVA'
        ? 'Ya tienes esta promoción activa.'
        : 'Ya tienes una compra de esta promoción en proceso.',
      compraId: viva.id,
    }
  }

  if (promo.limitePorCliente != null) {
    const limite = await conEmpresa(promo.companyId, (tx) =>
      estadoLimiteCliente(clienteId, promo.id, promo.limitePorCliente, tx)
    )
    if (limite.alcanzado) return { error: mensajeLimitePorCliente(promo.limitePorCliente) }
  }

  const gratis = Number(promo.precio ?? 0) <= 0
  const compra = await conEmpresa(promo.companyId, async (tx) => {
    const creada = await tx.productoCompra.create({
      data: {
        tipo: 'PROMOCION',
        estado: gratis ? 'SOLICITADA' : 'PENDIENTE_PAGO',
        companyId: promo.companyId,
        clienteId,
        promocionId: promo.id,
        precioCongelado: promo.precio,
        usosIncluidos: promo.usosPorCompra,
      },
    })
    await registrarTransicionCompra(tx, {
      compraId: creada.id,
      desde: null,
      hacia: 'SOLICITADA',
      motivo: 'Solicitud del cliente',
      userId: user.metadata.dbUserId || null,
    })
    if (!gratis) {
      await registrarTransicionCompra(tx, {
        compraId: creada.id,
        desde: 'SOLICITADA',
        hacia: 'PENDIENTE_PAGO',
        motivo: 'Esperando transferencia del cliente',
        userId: user.metadata.dbUserId || null,
      })
    }
    return creada
  })

  const { vincularCompraSiEsPaso } = await import('@/modules/campanas/cadena')
  await vincularCompraSiEsPaso(compra.id, promo.id, clienteId)

  if (gratis) {
    const meta = await getRequestMeta()
    const res = await activarCompraPromocion(compra.id, user.metadata.dbUserId || null, meta, {
      motivo: 'Promoción gratuita: activación directa',
    })
    if (!res.ok) return { error: res.error }
  }

  return { success: true, compraId: compra.id, activada: gratis }
}
