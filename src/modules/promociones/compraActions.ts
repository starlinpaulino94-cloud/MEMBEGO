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
import { asegurarClienteEnEmpresa, misClienteIds } from '@/modules/cliente/afiliacion'

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

/**
 * LA FICHA CON LA QUE SE ADQUIERE ESTA PROMOCIÓN.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ANTES: «PRIMERO ÚNETE A LA EMPRESA»
 *
 * Aquí había un rechazo seco cuando la promoción era de otro negocio:
 * «Para adquirir esta promoción primero únete a la empresa que la publica».
 * Y en la pantalla de la promoción el botón directamente NO aparecía, así que
 * el mensaje ni siquiera llegaba a leerse: quien veía unos tacos gratis en un
 * restaurante que no conocía solo tenía «Ver empresa y sus planes».
 *
 * Eso invertía el trato. Una recompensa es el motivo por el que alguien se
 * acerca a un negocio nuevo; pedirle que se dé de alta ANTES es cobrarle el
 * trámite por adelantado y perder justo a quien todavía no tiene ninguna razón
 * para pagarlo.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * AHORA: EL ALTA ES LA CONSECUENCIA, NO EL REQUISITO
 *
 * Adquirir crea la ficha en esa empresa y la sigue —`asegurarClienteEnEmpresa`
 * hace las dos cosas—, y la compra queda bajo esa ficha. El negocio gana un
 * cliente y un seguidor en el momento en que la persona demuestra interés, no
 * antes.
 *
 * Lo que NO cambia es la empresa activa de la sesión: reclamar unos tacos no es
 * pedir mudarse de negocio (ver `afiliacion.ts`).
 */
async function fichaParaAdquirir(
  user: NonNullable<Awaited<ReturnType<typeof clienteAutenticado>>>,
  companyId: string,
  companyIdDeMiFicha: string,
  miClienteId: string
): Promise<{ clienteId: string } | { error: string }> {
  if (companyId === companyIdDeMiFicha) return { clienteId: miClienteId }

  const alta = await asegurarClienteEnEmpresa(user.supabaseId, user.email, companyId)
  if ('error' in alta) return alta
  return { clienteId: alta.clienteId }
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

    // Rule Engine de adquisición: ventana + cupo + estado de publicación.
    // Va ANTES del alta a propósito: si la promoción está agotada o fuera de
    // ventana, no tiene ningún sentido haberle creado una ficha a la persona en
    // una empresa a la que al final no se lleva nada.
    const ventana = validarVentanaAdquisicion(promo)
    if (!ventana.ok) return { error: ventana.mensaje }

    // Promoción privada: solo miembros con membresía activa.
    //
    // Se comprueba ANTES del alta, y se mira la ficha que la persona YA tenga
    // en esa empresa. Sin ficha no puede haber membresía, así que crear una
    // primero solo serviría para dejarla afiliada a un negocio del que se va
    // con un «es exclusiva para miembros» — y siguiéndolo, además.
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

    // Promoción de otra empresa: el alta y el seguimiento salen de adquirirla.
    const ficha = await fichaParaAdquirir(user, promo.companyId, cliente.companyId, cliente.id)
    if ('error' in ficha) return { error: ficha.error }
    const clienteId = ficha.clienteId

    // Sin compras duplicadas vivas de la misma promoción.
    const viva = await conEmpresa(promo.companyId, (tx) =>
      tx.productoCompra.findFirst({
        where: {
          clienteId,
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
        estadoLimiteCliente(clienteId, promo.id, promo.limitePorCliente, tx)
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
    await vincularCompraSiEsPaso(compra.id, promo.id, clienteId)

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
