'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'
import { requireAdminUser } from '@/lib/auth/guards'
import { generarCodigo } from '@/lib/codes'
import { getRegalosConfig } from '@/modules/regalos/config'
import { notificarClienteRegalo } from '@/modules/regalos/entrega'
import { notificarAdmins } from '@/modules/notificaciones/service'
import { registrarEntregaBeneficio } from '@/modules/transacciones/entrega'
import { crearTransaccionAplicada } from '@/lib/transactions/application/transaction-service'
import { getRequestMeta } from '@/lib/server-utils'

/**
 * Gift cards de monto abierto (Regalos P2P · extensión de R4) — acciones.
 *
 * Compra (cliente): elige monto y destinatario; el código GC-XXXXXX es la
 * referencia para pagar en sucursal o por transferencia. Confirmación y
 * consumo (admin/cajero): la confirmación registra la VENTA (Transaction SALE
 * con factura); cada consumo descuenta saldo de forma atómica y deja un
 * comprobante de entrega (el dinero ya entró: no se duplica el ingreso).
 */

const fmtRD = (n: number) => `RD$${n.toLocaleString('es-DO', { minimumFractionDigits: 2 })}`

export interface GiftCardActionState {
  error?: string
  success?: boolean
  detalle?: string
}

export async function comprarGiftCard(
  _prev: GiftCardActionState,
  formData: FormData
): Promise<GiftCardActionState & { codigo?: string }> {
  try {
    const user = await getUser()
    if (!user || user.metadata.role !== 'CLIENTE') return { error: 'No autorizado.' }
    const { clienteId, companyId } = user.metadata
    if (!clienteId || !companyId) return { error: 'Tu cuenta no está vinculada a una empresa.' }

    const monto = Math.round(Number(formData.get('monto')) * 100) / 100
    let destinatarioId: string | null =
      String(formData.get('destinatarioId') ?? '').trim() || null
    const contactoRaw = String(formData.get('destinatarioContacto') ?? '').trim()
    const mensaje = String(formData.get('mensaje') ?? '').trim().slice(0, 200) || null

    const config = await getRegalosConfig(companyId)
    if (!config.permitirGiftCards) {
      return { error: 'El negocio no tiene activadas las gift cards.' }
    }
    // Plataforma modular · E4: la capacidad GIFT_CARDS también manda (el
    // superadmin puede apagarla por empresa). Fail-open: sin config = activa.
    const { tieneCapacidad } = await import('@/modules/capacidades/resolver')
    if (!(await tieneCapacidad(companyId, 'GIFT_CARDS'))) {
      return { error: 'El negocio no tiene activadas las gift cards.' }
    }
    if (!Number.isFinite(monto) || monto < config.giftCardMontoMin || monto > config.giftCardMontoMax) {
      return {
        error: `El monto debe estar entre ${fmtRD(config.giftCardMontoMin)} y ${fmtRD(config.giftCardMontoMax)}.`,
      }
    }

    // Destinatario: cuenta existente o contacto externo (mismas reglas que las
    // transferencias de la Fase R4).
    let destinatarioContacto: string | null = null
    if (!destinatarioId) {
      if (!contactoRaw) return { error: 'Datos incompletos.' }
      if (contactoRaw.includes('@')) {
        const correo = contactoRaw.toLowerCase()
        if (!/^\S+@\S+\.\S+$/.test(correo)) return { error: 'Escribe un correo válido.' }
        destinatarioContacto = correo
      } else {
        const digits = contactoRaw.replace(/\D/g, '')
        if (digits.length < 7) {
          return { error: 'Escribe un teléfono válido (al menos 7 dígitos) o un correo.' }
        }
        destinatarioContacto = digits
      }
      const existente = destinatarioContacto.includes('@')
        ? await prisma.cliente.findFirst({
            where: { companyId, email: { equals: destinatarioContacto, mode: 'insensitive' } },
            select: { id: true },
          })
        : await prisma.cliente.findFirst({
            where: { companyId, telefono: { contains: destinatarioContacto } },
            select: { id: true },
          })
      if (existente) {
        destinatarioId = existente.id
        destinatarioContacto = null
      }
    }

    if (destinatarioId === clienteId) return { error: 'Para ti mismo no hace falta gift card 🙂' }
    if (destinatarioContacto) {
      const yo = await prisma.cliente.findUnique({
        where: { id: clienteId },
        select: { email: true, telefono: true },
      })
      const misDigits = yo?.telefono?.replace(/\D/g, '') ?? ''
      if (
        yo?.email?.toLowerCase() === destinatarioContacto ||
        (misDigits.length >= 7 && misDigits === destinatarioContacto)
      ) {
        return { error: 'Para ti mismo no hace falta gift card 🙂' }
      }
    }

    let destinatarioNombre: string | null = null
    if (destinatarioId) {
      const destinatario = await prisma.cliente.findFirst({
        where: { id: destinatarioId, companyId },
        select: { nombre: true },
      })
      if (!destinatario) return { error: 'Destinatario no encontrado en este negocio.' }
      destinatarioNombre = destinatario.nombre
    }

    // Código único: referencia de pago Y llave de consumo.
    let codigo: string | null = null
    for (let intento = 0; intento < 5 && !codigo; intento++) {
      const candidato = `GC-${generarCodigo(6)}`
      const ocupado = await prisma.giftCard.findUnique({
        where: { codigo: candidato },
        select: { id: true },
      })
      if (!ocupado) codigo = candidato
    }
    if (!codigo) return { error: 'No se pudo generar el código. Intenta de nuevo.' }

    await prisma.giftCard.create({
      data: {
        companyId,
        codigo,
        monto,
        saldo: monto,
        compradorClienteId: clienteId,
        destinatarioClienteId: destinatarioId,
        destinatarioContacto,
        mensaje,
      },
    })

    await notificarAdmins(companyId, {
      tipo: 'NUEVO_COMPROBANTE',
      titulo: 'Gift card por cobrar',
      mensaje: `Un cliente quiere comprar una gift card de ${fmtRD(monto)} (código ${codigo}). Cóbrala en caja o confírmala al recibir la transferencia.`,
      href: '/admin/regalos',
    })

    revalidatePath('/cliente/regalos')
    return {
      success: true,
      codigo,
      detalle: `Gift card creada. Paga ${fmtRD(monto)} citando el código ${codigo} y ${destinatarioNombre?.split(/\s+/)[0] ?? 'tu persona especial'} podrá usarla.`,
    }
  } catch (e) {
    console.error('[giftcards] comprar:', e)
    return { error: 'Ocurrió un error inesperado. Intenta de nuevo.' }
  }
}

/**
 * Admin/cajero confirma el pago: la gift card pasa a ACTIVA y el ingreso queda
 * registrado como venta (Transaction SALE con factura imprimible).
 */
export async function confirmarPagoGiftCard(
  giftCardId: string,
  metodo: 'EFECTIVO' | 'TRANSFERENCIA' | 'OTRO'
): Promise<GiftCardActionState> {
  const user = await requireAdminUser()
  if (!user) return { error: 'No autorizado.' }
  const companyId = user.metadata.companyId
  if (!companyId) return { error: 'Tu cuenta no está vinculada a una empresa.' }
  if (!['EFECTIVO', 'TRANSFERENCIA', 'OTRO'].includes(metodo)) {
    return { error: 'Método de cobro no válido.' }
  }

  const card = await prisma.giftCard.findFirst({
    where: { id: giftCardId, companyId, estado: 'PENDIENTE_PAGO' },
  })
  if (!card) return { error: 'Esta gift card ya no está pendiente de pago.' }

  // Guard atómico contra doble confirmación.
  const upd = await prisma.giftCard.updateMany({
    where: { id: card.id, estado: 'PENDIENTE_PAGO' },
    data: { estado: 'ACTIVA', metodoCobro: metodo, activadaAt: new Date() },
  })
  if (upd.count === 0) return { error: 'Esta gift card ya fue procesada.' }

  const monto = Number(card.monto)
  const comprador = await prisma.cliente.findUnique({
    where: { id: card.compradorClienteId },
    select: { nombre: true },
  })

  // Venta oficial (libro mayor + factura). Best-effort: la activación ya
  // ocurrió y no se revierte por un fallo de facturación.
  try {
    const meta = await getRequestMeta()
    const detalle = `Gift card ${card.codigo}`
    const tx = await crearTransaccionAplicada(prisma, {
      tipo: 'SALE',
      companyId,
      clienteId: card.compradorClienteId,
      empleadoId: user.metadata.dbUserId ?? null,
      monto,
      metodoCobro: metodo,
      snapshot: {
        detalle,
        cliente: comprador?.nombre ?? 'Cliente',
        servicio: detalle,
        lineas: [
          { descripcion: detalle, cantidad: 1, precioUnitario: monto, descuento: 0, total: monto },
        ],
        subtotal: monto.toFixed(2),
        total: monto.toFixed(2),
        metodoCobroLabel:
          metodo === 'EFECTIVO' ? 'Efectivo' : metodo === 'TRANSFERENCIA' ? 'Transferencia' : 'Otro',
      },
      auditoria: { ipAddress: meta.ipAddress, userAgent: meta.userAgent },
      userId: user.metadata.dbUserId ?? null,
    })
    await prisma.giftCard.update({ where: { id: card.id }, data: { txVentaId: tx.id } })
  } catch (e) {
    console.error('[giftcards] venta:', e)
  }

  await notificarClienteRegalo(
    card.compradorClienteId,
    '🎉 Pago confirmado',
    `Tu gift card ${card.codigo} de ${fmtRD(monto)} ya está activa: quien la recibe puede usarla mostrando el código.`,
    '/cliente/regalos'
  )
  if (card.destinatarioClienteId) {
    const remitenteNombre = comprador?.nombre.split(/\s+/)[0] ?? 'Alguien'
    await notificarClienteRegalo(
      card.destinatarioClienteId,
      `🎁 ${remitenteNombre} te regaló una gift card`,
      `Tienes ${fmtRD(monto)} para usar en el negocio. Muestra el código ${card.codigo} al pagar${card.mensaje ? `: “${card.mensaje}”` : '.'}`,
      '/cliente/regalos'
    )
  }

  revalidatePath('/admin/regalos')
  revalidatePath('/cliente/regalos')
  return { success: true, detalle: `Gift card ${card.codigo} activada (${fmtRD(monto)}).` }
}

/**
 * Consumo de saldo: descuento atómico (nunca queda negativo) + comprobante de
 * entrega. Al llegar a 0 la gift card pasa a AGOTADA.
 */
export async function redimirGiftCard(
  giftCardId: string,
  montoRaw: number,
  nota?: string
): Promise<GiftCardActionState> {
  const user = await requireAdminUser()
  if (!user) return { error: 'No autorizado.' }
  const companyId = user.metadata.companyId
  if (!companyId) return { error: 'Tu cuenta no está vinculada a una empresa.' }

  const monto = Math.round(Number(montoRaw) * 100) / 100
  if (!Number.isFinite(monto) || monto <= 0) return { error: 'Monto de consumo no válido.' }

  const card = await prisma.giftCard.findFirst({
    where: { id: giftCardId, companyId, estado: 'ACTIVA' },
  })
  if (!card) return { error: 'Esta gift card no está activa.' }

  // Descuento atómico: solo si el saldo alcanza.
  const upd = await prisma.giftCard.updateMany({
    where: { id: card.id, estado: 'ACTIVA', saldo: { gte: monto } },
    data: { saldo: { decrement: monto } },
  })
  if (upd.count === 0) {
    return { error: `Saldo insuficiente: quedan ${fmtRD(Number(card.saldo))}.` }
  }

  const actual = await prisma.giftCard.findUnique({
    where: { id: card.id },
    select: { saldo: true },
  })
  const saldoRestante = Number(actual?.saldo ?? 0)
  if (saldoRestante <= 0) {
    await prisma.giftCard.updateMany({
      where: { id: card.id, estado: 'ACTIVA', saldo: { lte: 0 } },
      data: { estado: 'AGOTADA', resueltoAt: new Date() },
    })
  }

  // Comprobante del consumo (el ingreso ya se registró al confirmar el pago).
  const duenoId = card.destinatarioClienteId ?? card.compradorClienteId
  const dueno = await prisma.cliente.findUnique({
    where: { id: duenoId },
    select: { nombre: true },
  })
  await registrarEntregaBeneficio({
    tipo: 'BENEFIT_USE',
    companyId,
    clienteId: duenoId,
    clienteNombre: dueno?.nombre ?? 'Cliente',
    empleadoId: user.metadata.dbUserId ?? null,
    beneficio: `Consumo gift card ${card.codigo}`,
    detalle: `Pago con gift card ${card.codigo}: ${fmtRD(monto)} (saldo restante ${fmtRD(saldoRestante)})`,
    observaciones: nota?.trim().slice(0, 300) || null,
  })

  await notificarClienteRegalo(
    duenoId,
    'Consumo de tu gift card',
    `Usaste ${fmtRD(monto)} de la gift card ${card.codigo}. Saldo restante: ${fmtRD(saldoRestante)}.`,
    '/cliente/regalos'
  )

  revalidatePath('/admin/regalos')
  revalidatePath('/cliente/regalos')
  return {
    success: true,
    detalle: `Consumo de ${fmtRD(monto)} aplicado. Saldo restante: ${fmtRD(saldoRestante)}.`,
  }
}

/** Cancela una gift card PENDIENTE_PAGO (nunca una activa: es dinero pagado). */
export async function cancelarGiftCardAdmin(
  giftCardId: string,
  motivo: string
): Promise<GiftCardActionState> {
  const user = await requireAdminUser()
  if (!user) return { error: 'No autorizado.' }
  const companyId = user.metadata.companyId
  if (!companyId) return { error: 'Tu cuenta no está vinculada a una empresa.' }

  const motivoLimpio = motivo.trim().slice(0, 300)
  if (motivoLimpio.length < 3) return { error: 'Escribe el motivo de la cancelación.' }

  const card = await prisma.giftCard.findFirst({
    where: { id: giftCardId, companyId, estado: 'PENDIENTE_PAGO' },
    select: { id: true, codigo: true, compradorClienteId: true },
  })
  if (!card) return { error: 'Solo se cancelan gift cards pendientes de pago.' }

  const upd = await prisma.giftCard.updateMany({
    where: { id: card.id, estado: 'PENDIENTE_PAGO' },
    data: { estado: 'CANCELADA', resueltoAt: new Date() },
  })
  if (upd.count === 0) return { error: 'Esta gift card ya fue procesada.' }

  await notificarClienteRegalo(
    card.compradorClienteId,
    'Gift card cancelada',
    `El negocio canceló tu gift card ${card.codigo} (no se había pagado). Motivo: ${motivoLimpio}`,
    '/cliente/regalos'
  )

  revalidatePath('/admin/regalos')
  revalidatePath('/cliente/regalos')
  return { success: true, detalle: `Gift card ${card.codigo} cancelada.` }
}
