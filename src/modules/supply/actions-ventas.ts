'use server'

import { revalidatePath } from 'next/cache'
import { getUser } from '@/lib/auth'
import { misClienteIds } from '@/modules/cliente/afiliacion'
import { exigirPlataforma } from './permisos'
import { auditar, comoError, numero, refrescarPlataforma, texto, type EstadoAccion } from './actions-util'
import { abrirPedidoDeVenta } from './cobro'
import { cerrarVenta } from './ventas'
import { claveIdempotencia } from './codigos'

/**
 * MEMBEGO SUPPLY · server actions de la venta sin precompra (Fase 6).
 *
 * El cliente abre la venta (que crea el pedido de cobro), paga por el flujo
 * de cobro ya existente (`adjuntarComprobanteAction` → `confirmarPedidoAction`)
 * y el comercio entrega con el escáner (`redimirAction` con `ventaId`).
 * Aquí solo viven el arranque y la cancelación administrativa.
 */

export type { EstadoAccion }

export async function abrirVentaAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  try {
    const user = await getUser()
    if (!user) return { error: 'Inicia sesión para comprar.' }

    const clienteId = texto(fd, 'clienteId', 60)
    const acuerdoId = texto(fd, 'acuerdoId', 60)
    if (!clienteId || !acuerdoId) return { error: 'Faltan datos de la compra.' }

    // La ficha tiene que ser de quien pulsa: sin esto, cualquier sesión podría
    // abrir ventas a nombre de otro cliente conociendo su id.
    const mias = await misClienteIds(user.supabaseId)
    if (!mias.includes(clienteId)) return { error: 'Esa ficha de cliente no es tuya.' }

    const cantidad = Math.max(1, Math.min(20, numero(fd, 'cantidad') ?? 1))
    // Dos toques de «Comprar» en cinco minutos abren UN pedido; una compra
    // igual más tarde es otra compra. El cliente no manda la clave: la
    // fabrica el servidor.
    const ventana = Math.floor(Date.now() / 300_000)
    const res = await abrirPedidoDeVenta({
      clienteId,
      acuerdoId,
      cantidad,
      sucursalId: texto(fd, 'sucursalId', 60) || null,
      cuentaId: texto(fd, 'cuentaId', 60) || null,
      claveIdempotencia: claveIdempotencia('venta', clienteId, acuerdoId, String(cantidad), String(ventana)),
    })
    if (!res.ok) return { error: res.mensaje }

    if (res.ventaId) {
      await auditar('SUPPLY_VENTA_ABIERTA', 'SupplyVentaDirecta', res.ventaId, {
        acuerdoId,
        clienteId,
        cantidad,
        pedidoId: res.pedidoId,
        monto: res.monto,
      })
    }
    revalidatePath('/cliente/beneficios')
    revalidatePath('/cliente/explorar')
    return { success: `Pedido ${res.numero} abierto. Paga y sube el comprobante.`, id: res.pedidoId }
  } catch (e) {
    return comoError(e)
  }
}

export async function cerrarVentaAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  try {
    const user = await exigirPlataforma('MEMBEGO_SUPPLY_ADJUST')
    const ventaId = texto(fd, 'ventaId', 60)
    const hasta = texto(fd, 'hasta', 20) === 'REEMBOLSADA' ? 'REEMBOLSADA' : 'CANCELADA'
    const motivo = texto(fd, 'motivo', 500)
    if (!ventaId) return { error: 'Falta la venta.' }
    await cerrarVenta(ventaId, hasta, motivo, user.metadata.dbUserId ?? null)
    await auditar('SUPPLY_VENTA_CANCELADA', 'SupplyVentaDirecta', ventaId, { despues: hasta, motivo })
    refrescarPlataforma('ventas')
    refrescarPlataforma('finanzas/cuentas-por-pagar')
    return { success: `Venta → ${hasta}.` }
  } catch (e) {
    return comoError(e)
  }
}
