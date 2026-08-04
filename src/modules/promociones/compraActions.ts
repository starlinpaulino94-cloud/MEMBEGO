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
import {
  registrarTransicionCompra,
  validarVentanaAdquisicion,
  estadoLimiteCliente,
  mensajeLimitePorCliente,
} from '@/modules/promociones/compra'

export interface CompraState {
  error?: string
  success?: boolean
  compraId?: string
  /** true → gratis: quedó ACTIVA sin pasar por pago. */
  activada?: boolean
}

// Estados que cuentan como "compra en proceso o activa" de la misma promo.
const ESTADOS_VIVOS = ['SOLICITADA', 'PENDIENTE_PAGO', 'EN_VALIDACION', 'APROBADA', 'ACTIVA'] as const

async function clienteAutenticado() {
  const user = await getUser()
  if (!user || user.metadata.role !== 'CLIENTE' || !user.metadata.clienteId) return null
  return user
}

/** Paso 1: el cliente solicita la compra (valida ventana de adquisición y cupo). */
export async function solicitarCompraPromocion(
  _prev: CompraState,
  formData: FormData
): Promise<CompraState> {
  try {
    const user = await clienteAutenticado()
    if (!user) return { error: 'Inicia sesión como cliente para adquirir promociones.' }
    if (!(await formSubmitLimiter(user.metadata.clienteId!))) {
      return { error: 'Demasiados intentos. Intenta de nuevo en unos minutos.' }
    }

    const promocionId = String(formData.get('promocionId') ?? '')
    if (!promocionId) return { error: 'Promoción no especificada.' }

    const [cliente, promo] = await sinEmpresa(
      'promociones: lookup de cliente y promoción por id (pertenencia se valida después)',
      (tx) =>
        Promise.all([
          tx.cliente.findUnique({ where: { id: user.metadata.clienteId! } }),
          tx.promocion.findUnique({ where: { id: promocionId } }),
        ])
    )
    if (!cliente) return { error: 'Cliente no encontrado.' }
    if (!promo) return { error: 'Promoción no encontrada.' }

    // Debe ser cliente de la empresa dueña de la promoción.
    if (promo.companyId !== cliente.companyId) {
      return { error: 'Para adquirir esta promoción primero únete a la empresa que la publica.' }
    }

    // Rule Engine de adquisición: ventana + cupo + estado de publicación.
    const ventana = validarVentanaAdquisicion(promo)
    if (!ventana.ok) return { error: ventana.mensaje }

    // Promoción privada: solo miembros con membresía activa.
    if (promo.visibilidad === 'privada') {
      const activa = await conEmpresa(promo.companyId, (tx) =>
        tx.membership.findFirst({
          where: { clienteId: cliente.id, companyId: promo.companyId, estado: 'ACTIVA' },
          select: { id: true },
        })
      )
      if (!activa) return { error: 'Esta promoción es exclusiva para miembros con membresía activa.' }
    }

    // Sin compras duplicadas vivas de la misma promoción.
    const viva = await conEmpresa(promo.companyId, (tx) =>
      tx.productoCompra.findFirst({
        where: {
          clienteId: cliente.id,
          promocionId: promo.id,
          estado: { in: [...ESTADOS_VIVOS] },
        },
        select: { id: true, estado: true },
      })
    )
    if (viva) {
      return viva.estado === 'ACTIVA'
        ? { error: 'Ya tienes esta promoción activa.', compraId: viva.id }
        : { error: 'Ya tienes una compra de esta promoción en proceso.', compraId: viva.id }
    }

    // Límite por cliente: promociones de un solo uso (ej. "primer lavado gratis")
    // no pueden re-adquirirse aunque ya se hayan usado o vencido.
    if (promo.limitePorCliente != null) {
      const limite = await conEmpresa(promo.companyId, (tx) =>
        estadoLimiteCliente(cliente.id, promo.id, promo.limitePorCliente, tx)
      )
      if (limite.alcanzado) {
        return { error: mensajeLimitePorCliente(promo.limitePorCliente) }
      }
    }

    const precio = Number(promo.precio ?? 0)
    const esGratis = precio <= 0

    const compra = await conEmpresa(promo.companyId, async (tx) => {
      const creada = await tx.productoCompra.create({
        data: {
          tipo: 'PROMOCION',
          estado: esGratis ? 'SOLICITADA' : 'PENDIENTE_PAGO',
          companyId: promo.companyId,
          clienteId: cliente.id,
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
        userId: user.metadata.dbUserId ?? null,
      })
      if (!esGratis) {
        await registrarTransicionCompra(tx, {
          compraId: creada.id,
          desde: 'SOLICITADA',
          hacia: 'PENDIENTE_PAGO',
          motivo: 'Esperando transferencia del cliente',
          userId: user.metadata.dbUserId ?? null,
        })
      }
      return creada
    })

    // Campañas conjuntas en cadena: si esta promoción es un eslabón, la compra
    // queda marcada como tal (y el cliente inscrito si es el primer paso).
    // Así el cliente entra a la cadena por el flujo normal, sin pantallas
    // extra. Fail-open: nunca invalida una compra legítima.
    const { vincularCompraSiEsPaso } = await import('@/modules/campanas/cadena')
    await vincularCompraSiEsPaso(compra.id, promo.id, cliente.id)

    // Promoción gratuita: activación directa (sin pago), QR inmediato.
    if (esGratis) {
      const meta = await getRequestMeta()
      const res = await activarCompraPromocion(compra.id, user.metadata.dbUserId ?? null, meta, {
        motivo: 'Promoción gratuita: activación directa',
      })
      if (!res.ok) return { error: res.error }
      revalidatePath('/cliente/mis-promociones')
      return { success: true, compraId: compra.id, activada: true }
    }

    revalidatePath('/cliente/mis-promociones')
    return { success: true, compraId: compra.id }
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
    if (compra.clienteId !== user.metadata.clienteId) return { error: 'No autorizado.' }
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
    if (!compra || compra.clienteId !== user.metadata.clienteId) {
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
  if (!compra || compra.clienteId !== user.metadata.clienteId) {
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
