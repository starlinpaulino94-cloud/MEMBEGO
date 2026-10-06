'use server'

/**
 * Fase E5 · Acciones del CLIENTE para comprar promociones.
 * Mismo ciclo que las membresías: solicitud → transferencia (puerto de
 * pagos) → comprobante → validación del admin → activación con QR.
 */

import { revalidatePath } from 'next/cache'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { getUser } from '@/lib/auth'
import { getRequestMeta } from '@/lib/server-utils'
import { formSubmitLimiter } from '@/lib/rate-limit'
import { rutaValida } from '@/modules/storage/comprobantes'
import { notificarAdmins } from '@/modules/notificaciones/service'
import { getPaymentProvider } from '@/lib/payments'
import { activarCompraPromocion } from '@/modules/pagos/activacionCompra'
import { adquirirPromocion } from '@/modules/promociones/compraService'
import {
  registrarTransicionCompra,
} from '@/modules/promociones/compra'
import { misClienteIds } from '@/modules/cliente/afiliacion'

export interface CompraState {
  error?: string
  success?: boolean
  compraId?: string
  /** true → gratis: quedó ACTIVA sin pasar por pago. */
  activada?: boolean
}

// Estados que cuentan como "compra en proceso o activa" de la misma promo.
async function clienteAutenticado() {
  const user = await getUser()
  if (!user || user.metadata.role !== 'CLIENTE' || !user.metadata.clienteId) return null
  return user
}


/**
 * ¿ES MÍA ESTA COMPRA? — contra TODAS mis fichas, no solo la activa.
 *
 * Estas comprobaciones comparaban con `user.metadata.clienteId`, la ficha de la
 * empresa que la persona tiene abierta. Mientras solo se podían adquirir
 * promociones de la propia empresa, esa ficha y la de la compra eran siempre la
 * misma y la comparación bastaba.
 *
 * Desde que se puede reclamar en cualquier negocio, ya no: una recompensa
 * adquirida en el restaurante queda bajo la ficha del restaurante, y su dueña
 * legítima se habría encontrado un «No autorizado» al ir a pagarla o
 * cancelarla. La pertenencia es de la PERSONA, así que se mira por persona.
 */
async function esMiCompra(supabaseId: string, clienteIdDeLaCompra: string): Promise<boolean> {
  const mias = await misClienteIds(supabaseId)
  return mias.includes(clienteIdDeLaCompra)
}

/** Paso 1: el cliente solicita la compra (valida ventana de adquisición y cupo). */
export async function solicitarCompraPromocion(
  _prev: CompraState,
  formData: FormData
): Promise<CompraState> {
  try {
    const user = await clienteAutenticado()
    if (!user) return { error: 'Inicia sesión como cliente para adquirir promociones.' }
    const result = await adquirirPromocion(user, String(formData.get('promocionId') ?? ''))
    if ('error' in result) return result
    revalidatePath('/cliente/mis-promociones')
    return result
  } catch (e) {
    console.error('[promociones] solicitarCompraPromocion:', e)
    return { error: 'Ocurrió un error inesperado. Intenta de nuevo.' }
  }
}

/** Paso 2: el cliente envía el comprobante de la transferencia. */
export async function enviarComprobanteCompra(
  _prev: CompraState,
  formData: FormData
): Promise<CompraState> {
  try {
    const user = await clienteAutenticado()
    if (!user) return { error: 'No autorizado.' }
    if (!(await formSubmitLimiter(user.metadata.clienteId!))) {
      return { error: 'Demasiados intentos. Intenta de nuevo en unos minutos.' }
    }

    const compraId = String(formData.get('compraId') ?? '').trim()
    const comprobanteUrl = String(formData.get('comprobanteUrl') ?? '').trim()
    const metodoPagoId = String(formData.get('metodoPagoId') ?? '').trim() || null
    const nota = String(formData.get('nota') ?? '').trim() || null
    const transferenciaFechaRaw = String(formData.get('transferenciaFecha') ?? '').trim()

    if (!compraId) return { error: 'Compra no especificada.' }
    if (!comprobanteUrl) return { error: 'Adjunta el comprobante de la transferencia.' }

    // Ruta dentro del bucket privado, no URL pública (auditoría · C-01), y
    // tiene que ser la de ESTA compra.
    if (!(await rutaValida('compra', compraId, comprobanteUrl))) {
      return { error: 'El comprobante adjunto no corresponde a esta compra.' }
    }

    // Fecha/hora declarada de la transferencia (opcional pero recomendada).
    let transferenciaFecha: Date | null = null
    if (transferenciaFechaRaw) {
      const d = new Date(transferenciaFechaRaw)
      if (!Number.isNaN(d.getTime()) && d <= new Date()) transferenciaFecha = d
    }

    const compra = await sinEmpresa(
      'promociones: lookup de compra por id para enviar comprobante (su empresa se valida después)',
      (tx) =>
        tx.productoCompra.findUnique({
          where: { id: compraId },
          include: { cliente: true, promocion: { select: { titulo: true } } },
        })
    )
    if (!compra) return { error: 'Compra no encontrada.' }
    if (!(await esMiCompra(user.supabaseId, compra.clienteId))) return { error: 'No autorizado.' }
    if (!['SOLICITADA', 'PENDIENTE_PAGO', 'RECHAZADA'].includes(compra.estado)) {
      return { error: 'Esta compra no está esperando comprobante.' }
    }

    // Método de pago: debe ser de la misma empresa y estar activo.
    if (metodoPagoId) {
      const metodo = await conEmpresa(compra.companyId, (tx) =>
        tx.metodoPago.findUnique({ where: { id: metodoPagoId } })
      )
      if (!metodo || metodo.companyId !== compra.companyId || !metodo.activo) {
        return { error: 'Método de pago no válido.' }
      }
    }

    await conEmpresa(compra.companyId, async (tx) => {
      await tx.productoCompra.update({
        where: { id: compra.id },
        data: {
          estado: 'EN_VALIDACION',
          comprobanteUrl,
          comprobanteNota: nota,
          metodoPagoId,
          transferenciaFecha,
          rechazadoReason: null,
        },
      })
      await registrarTransicionCompra(tx, {
        compraId: compra.id,
        desde: compra.estado,
        hacia: 'EN_VALIDACION',
        motivo: 'Comprobante enviado por el cliente',
        userId: user.metadata.dbUserId ?? null,
      })
    })

    await notificarAdmins(compra.companyId, {
      tipo: 'NUEVO_COMPROBANTE',
      titulo: 'Comprobante de promoción',
      mensaje: `${compra.cliente.nombre} envió el comprobante de «${compra.promocion?.titulo ?? 'una promoción'}». Revísalo para activarla.`,
      href: '/admin/pagos',
    })

    revalidatePath('/cliente/mis-promociones')
    revalidatePath(`/cliente/mis-promociones/${compra.id}`)
    return { success: true, compraId: compra.id }
  } catch (e) {
    console.error('[promociones] enviarComprobanteCompra:', e)
    return { error: 'Ocurrió un error inesperado. Intenta de nuevo.' }
  }
}

/** El cliente cancela una compra que aún no fue activada. */
export async function cancelarCompraCliente(compraId: string): Promise<CompraState> {
  try {
    const user = await clienteAutenticado()
    if (!user) return { error: 'No autorizado.' }

    const compra = await sinEmpresa(
      'promociones: lookup de compra por id para cancelar (su empresa se valida después)',
      (tx) => tx.productoCompra.findUnique({ where: { id: compraId } })
    )
    if (!compra || !(await esMiCompra(user.supabaseId, compra.clienteId))) {
      return { error: 'Compra no encontrada.' }
    }
    if (!['SOLICITADA', 'PENDIENTE_PAGO', 'EN_VALIDACION', 'RECHAZADA'].includes(compra.estado)) {
      return { error: 'Esta compra ya no puede cancelarse.' }
    }

    await conEmpresa(compra.companyId, async (tx) => {
      const upd = await tx.productoCompra.updateMany({
        where: { id: compra.id, estado: compra.estado },
        data: { estado: 'CANCELADA' },
      })
      if (upd.count === 0) throw new Error('ESTADO_CAMBIADO')
      await registrarTransicionCompra(tx, {
        compraId: compra.id,
        desde: compra.estado,
        hacia: 'CANCELADA',
        motivo: 'Cancelada por el cliente',
        userId: user.metadata.dbUserId ?? null,
      })
    })

    revalidatePath('/cliente/mis-promociones')
    return { success: true }
  } catch (e) {
    console.error('[promociones] cancelarCompraCliente:', e)
    return { error: 'No se pudo cancelar la compra.' }
  }
}

/** Instrucciones de pago del puerto (transferencia hoy). */
export async function instruccionesDePago(compraId: string): Promise<{
  error?: string
  instrucciones?: string
}> {
  const user = await clienteAutenticado()
  if (!user) return { error: 'No autorizado.' }
  const compra = await sinEmpresa(
    'promociones: lookup de compra por id para instrucciones de pago (pertenencia se valida después)',
    (tx) =>
      tx.productoCompra.findUnique({
        where: { id: compraId },
        include: { promocion: { select: { titulo: true } } },
      })
  )
  if (!compra || !(await esMiCompra(user.supabaseId, compra.clienteId))) {
    return { error: 'Compra no encontrada.' }
  }
  const provider = getPaymentProvider('TRANSFERENCIA')
  if (!provider) return { error: 'Método de pago no disponible.' }
  const intent = await provider.iniciar({
    companyId: compra.companyId,
    clienteId: compra.clienteId,
    referenciaId: compra.id,
    monto: Number(compra.precioCongelado ?? 0),
    descripcion: compra.promocion?.titulo ?? 'Promoción',
  })
  return intent.modo === 'manual_comprobante'
    ? { instrucciones: intent.instrucciones }
    : { error: 'Modo de pago no soportado todavía.' }
}
