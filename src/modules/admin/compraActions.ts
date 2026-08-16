'use server'

/**
 * Fase E5 · Acciones del ADMIN para validar pagos de compras de promociones.
 * Mismo patrón que confirmarPago/rechazarPago de membresías: guard de
 * sección + pertenencia a la empresa + activación vía punto único.
 */

import { revalidatePath } from 'next/cache'
import { requireSection, type requireAdminUser } from '@/lib/auth/guards'
import { getRequestMeta } from '@/lib/server-utils'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { paymentLimiter } from '@/lib/rate-limit'
import { crearNotificacion } from '@/modules/notificaciones/service'
import { activarCompraPromocion } from '@/modules/pagos/activacionCompra'
import { registrarVentaConfirmada } from '@/modules/pagos/venta'
import { registrarTransicionCompra } from '@/modules/promociones/compra'

export interface CompraAdminState {
  error?: string
  success?: boolean
}

async function assertCompraOwnership(
  compraId: string,
  user: NonNullable<Awaited<ReturnType<typeof requireAdminUser>>>
) {
  const compra = await sinEmpresa('compra por id sin conocer la empresa', (tx) =>
    tx.productoCompra.findUnique({
      where: { id: compraId },
      include: {
        cliente: true,
        promocion: { select: { titulo: true, precio: true } },
        sucursalPago: { select: { id: true, nombre: true } },
      },
    })
  )
  if (!compra) return null
  if (user.metadata.role !== 'SUPERADMIN' && compra.companyId !== user.metadata.companyId) {
    return null
  }
  return compra
}

export async function aprobarCompra(
  _prev: CompraAdminState,
  formData: FormData
): Promise<CompraAdminState> {
  try {
    const user = await requireSection('pagos', 'aprobar_compra')
    if (!user) return { error: 'No autorizado.' }
    if (!(await paymentLimiter(user.metadata.dbUserId ?? 'admin'))) {
      return { error: 'Demasiadas operaciones. Espera un momento.' }
    }

    const compraId = String(formData.get('compraId') ?? '')
    const compra = await assertCompraOwnership(compraId, user)
    if (!compra) return { error: 'Compra no encontrada.' }

    const meta = await getRequestMeta()
    const res = await activarCompraPromocion(compra.id, user.metadata.dbUserId ?? null, meta)
    if (!res.ok) return { error: res.error }

    // Venta oficial de la compra aprobada: ticket + factura imprimible
    // (mismo cierre de hueco que confirmarPago de membresías).
    await registrarVentaConfirmada({
      companyId: compra.companyId,
      clienteId: compra.clienteId,
      clienteNombre: compra.cliente.nombre,
      empleadoId: user.metadata.dbUserId ?? null,
      detalle: `Promoción ${compra.promocion?.titulo ?? ''}`.trim(),
      monto: Number(compra.precioCongelado ?? compra.promocion?.precio ?? 0),
      metodoCobro: compra.comprobanteUrl != null ? 'TRANSFERENCIA' : 'OTRO',
      metodoCobroLabel:
        compra.comprobanteUrl != null ? 'Transferencia' : 'Confirmado por el negocio',
      // Recibo de pago (G6): nota de referencia declarada por el cliente.
      referenciaPago: compra.comprobanteNota?.trim() || null,
      sucursalId: compra.sucursalPago?.id ?? null,
      sucursalNombre: compra.sucursalPago?.nombre ?? null,
      auditoria: meta,
    })

    revalidatePath('/admin/pagos')
    revalidatePath('/admin/promociones')
    revalidatePath('/cliente/mis-promociones')
    return { success: true }
  } catch (e) {
    console.error('[admin] aprobarCompra:', e)
    return { error: 'No se pudo aprobar la compra.' }
  }
}

export async function rechazarCompra(
  _prev: CompraAdminState,
  formData: FormData
): Promise<CompraAdminState> {
  try {
    const user = await requireSection('pagos', 'rechazar_compra')
    if (!user) return { error: 'No autorizado.' }

    const compraId = String(formData.get('compraId') ?? '')
    const motivo = String(formData.get('motivo') ?? '').trim()
    if (!motivo) return { error: 'Indica el motivo del rechazo.' }

    const compra = await assertCompraOwnership(compraId, user)
    if (!compra) return { error: 'Compra no encontrada.' }
    if (!['EN_VALIDACION', 'PENDIENTE_PAGO', 'SOLICITADA'].includes(compra.estado)) {
      return { error: 'Esta compra no está pendiente de validación.' }
    }

    const meta = await getRequestMeta()
    await conEmpresa(compra.companyId, async (tx) => {
      const upd = await tx.productoCompra.updateMany({
        where: { id: compra.id, estado: compra.estado },
        data: { estado: 'RECHAZADA', rechazadoReason: motivo },
      })
      if (upd.count === 0) throw new Error('ESTADO_CAMBIADO')
      await registrarTransicionCompra(tx, {
        compraId: compra.id,
        desde: compra.estado,
        hacia: 'RECHAZADA',
        motivo,
        userId: user.metadata.dbUserId ?? null,
      })
      await tx.auditLog.create({
        data: {
          companyId: compra.companyId,
          userId: user.metadata.dbUserId ?? null,
          accion: 'PAGO_RECHAZADO',
          entidadTipo: 'ProductoCompra',
          entidadId: compra.id,
          payload: { motivo, promocionId: compra.promocionId },
          ...meta,
        },
      })
    })

    const clienteUser = await sinEmpresa('user del cliente por supabaseId', (tx) =>
      tx.user
        .findUnique({ where: { supabaseId: compra.cliente.supabaseId }, select: { id: true } })
        .catch(() => null)
    )
    if (clienteUser) {
      await crearNotificacion({
        userId: clienteUser.id,
        tipo: 'PAGO_RECHAZADO',
        titulo: 'Pago de promoción rechazado',
        mensaje: `Tu comprobante de «${compra.promocion?.titulo ?? 'la promoción'}» fue rechazado: ${motivo}. Puedes subir uno nuevo.`,
        href: `/cliente/mis-promociones/${compra.id}`,
      })
    }

    revalidatePath('/admin/pagos')
    revalidatePath('/cliente/mis-promociones')
    return { success: true }
  } catch (e) {
    console.error('[admin] rechazarCompra:', e)
    return { error: 'No se pudo rechazar la compra.' }
  }
}
