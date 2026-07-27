'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'
import { requireAdminUser } from '@/lib/auth/guards'
import { ensureCodigoCorto } from '@/lib/referidos'
import { createRateLimiter } from '@/lib/rate-limit'
import { getRegalosConfig } from '@/modules/regalos/config'
import { devolverUsos } from '@/modules/regalos/queries'
import { registrarEntregaBeneficio } from '@/modules/transacciones/entrega'
import { crearNotificacion, notificarAdmins } from '@/modules/notificaciones/service'
import {
  registrarTransicionCompra,
  validarVentanaAdquisicion,
  estadoLimiteCliente,
  mensajeLimitePorCliente,
} from '@/modules/promociones/compra'
import { generarCodigo } from '@/lib/codes'
import { anotarFallo } from '@/lib/prisma-errors'

/**
 * Regalos P2P · Fase R1 (docs/REGALOS-P2P.md).
 * - Mi ID MembeGo: el código corto del cliente, para recibir regalos.
 * - Buscador SEGURO de destinatarios: nunca expone listas de clientes.
 *
 * Reglas del buscador (§3.1 del doc):
 *  - Solo clientes autenticados, y solo dentro de SU misma empresa.
 *  - Por @código: coincidencia exacta (el código es identidad semipública).
 *  - Por texto: mínimo 4 caracteres, máximo 5 resultados, datos ENMASCARADOS
 *    (nombre + inicial, últimos 4 del teléfono) — suficiente para confirmar
 *    "¿es esta persona?", inútil para raspar la base de clientes.
 *  - Rate-limit por usuario contra enumeración.
 */

const busquedaLimiter = createRateLimiter({
  interval: 60 * 1000, // 1 minuto
  maxRequests: 10,
})

export interface DestinatarioResultado {
  /** Id opaco del cliente destino (cuid) — necesario para enviar el regalo. */
  clienteId: string
  /** "Juan P." — nombre de pila + inicial del apellido. */
  nombre: string
  /** "•••1234" o null si no tiene teléfono. */
  telefonoMask: string | null
  avatarUrl: string | null
  /** Su @ID (visible: es identidad semipública para regalos). */
  codigo: string | null
}

function enmascararNombre(nombre: string): string {
  const partes = nombre.trim().split(/\s+/)
  if (partes.length === 1) return partes[0]
  return `${partes[0]} ${partes[1][0]?.toUpperCase() ?? ''}.`
}

function enmascararTelefono(telefono: string | null): string | null {
  if (!telefono) return null
  const digits = telefono.replace(/\D/g, '')
  return digits.length >= 4 ? `•••${digits.slice(-4)}` : null
}

export async function buscarDestinatario(
  query: string
): Promise<{ error?: string; resultados?: DestinatarioResultado[] }> {
  const user = await getUser()
  if (!user || user.metadata.role !== 'CLIENTE') return { error: 'No autorizado.' }
  const { clienteId, companyId } = user.metadata
  if (!clienteId || !companyId) return { error: 'Tu cuenta no está vinculada a una empresa.' }

  if (!(await busquedaLimiter(`regalo-busca:${clienteId}`))) {
    return { error: 'Demasiadas búsquedas. Espera un momento.' }
  }

  const term = query.trim()

  // ── Por @código: exacto, sin mínimo de longitud ────────────────────────────
  const codigo = term.startsWith('@') ? term.slice(1) : term
  if (/^[A-Za-z0-9]{4,12}$/.test(codigo)) {
    const porCodigo = await prisma.cliente.findFirst({
      where: { codigoCorto: codigo.toUpperCase(), companyId },
      select: { id: true, nombre: true, telefono: true, avatarUrl: true, codigoCorto: true },
    })
    if (porCodigo && porCodigo.id !== clienteId) {
      return {
        resultados: [
          {
            clienteId: porCodigo.id,
            nombre: enmascararNombre(porCodigo.nombre),
            telefonoMask: enmascararTelefono(porCodigo.telefono),
            avatarUrl: porCodigo.avatarUrl,
            codigo: porCodigo.codigoCorto,
          },
        ],
      }
    }
    // Si parecía un código pero no existe, seguimos al texto libre (puede ser
    // un nombre corto como "Juan").
  }

  // ── Por texto: nombre / teléfono / correo exacto ───────────────────────────
  if (term.length < 4) {
    return { error: 'Escribe al menos 4 caracteres, o el @ID exacto de la persona.' }
  }

  const digits = term.replace(/\D/g, '')
  const clientes = await prisma.cliente.findMany({
    where: {
      companyId,
      id: { not: clienteId },
      OR: [
        { nombre: { contains: term, mode: 'insensitive' } },
        { email: { equals: term, mode: 'insensitive' } },
        ...(digits.length >= 7 ? [{ telefono: { contains: digits } }] : []),
      ],
    },
    select: { id: true, nombre: true, telefono: true, avatarUrl: true, codigoCorto: true },
    orderBy: { createdAt: 'asc' },
    take: 5,
  })

  return {
    resultados: clientes.map((c) => ({
      clienteId: c.id,
      nombre: enmascararNombre(c.nombre),
      telefonoMask: enmascararTelefono(c.telefono),
      avatarUrl: c.avatarUrl,
      codigo: c.codigoCorto,
    })),
  }
}

// ── Fase R2 · Transferir usos ────────────────────────────────────────────────

/** Notifica al User dueño de un Cliente (si tiene cuenta vinculada). */
async function notificarCliente(
  clienteId: string,
  titulo: string,
  mensaje: string,
  href: string
) {
  try {
    const cliente = await prisma.cliente.findUnique({
      where: { id: clienteId },
      select: { supabaseId: true },
    })
    if (!cliente?.supabaseId) return
    const u = await prisma.user.findUnique({
      where: { supabaseId: cliente.supabaseId },
      select: { id: true },
    })
    if (u) await crearNotificacion({ userId: u.id, tipo: 'SISTEMA', titulo, mensaje, href })
  } catch (e) {
    console.error('[regalos] notificar', e)
  }
}

export interface RegaloActionState {
  error?: string
  success?: boolean
  detalle?: string
}

/**
 * Envía una transferencia de usos (wallet o lavados del plan) a otro cliente
 * de la MISMA empresa. Los usos se RESERVAN al enviar (descuento atómico) y
 * se devuelven si el regalo se rechaza, expira o se cancela.
 */
export async function enviarTransferencia(
  _prev: RegaloActionState,
  formData: FormData
): Promise<RegaloActionState> {
  const user = await getUser()
  if (!user || user.metadata.role !== 'CLIENTE') return { error: 'No autorizado.' }
  const { clienteId, companyId } = user.metadata
  if (!clienteId || !companyId) return { error: 'Tu cuenta no está vinculada a una empresa.' }

  const origen = String(formData.get('origen') ?? '')
  const origenId = String(formData.get('origenId') ?? '').trim()
  let destinatarioId: string | null = String(formData.get('destinatarioId') ?? '').trim() || null
  const contactoRaw = String(formData.get('destinatarioContacto') ?? '').trim()
  const usos = Math.trunc(Number(formData.get('usos') ?? 1))
  const mensaje = String(formData.get('mensaje') ?? '').trim().slice(0, 200) || null

  if (!['COMPRA', 'MEMBRESIA'].includes(origen)) return { error: 'Origen no válido.' }
  if (!origenId) return { error: 'Datos incompletos.' }
  if (!Number.isFinite(usos) || usos < 1 || usos > 20) return { error: 'Cantidad de usos no válida.' }

  // R4: receptor SIN cuenta — se identifica por correo o teléfono y reclama el
  // regalo automáticamente al registrarse (vincularRegalosPorContacto).
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

    // Si ese contacto YA es cliente del negocio, el regalo va directo a su
    // cuenta (misma experiencia que si lo hubieran buscado por nombre).
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

  if (destinatarioId === clienteId) return { error: 'No puedes enviarte un regalo a ti mismo.' }
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
      return { error: 'No puedes enviarte un regalo a ti mismo.' }
    }
    // Los lavados del plan exigen membresía activa del receptor: imposible
    // validarla sin cuenta.
    if (origen === 'MEMBRESIA') {
      return {
        error:
          'Los lavados del plan solo se transfieren a alguien con cuenta y membresía activa. Envíale usos de una promoción de tu wallet, o invítalo a registrarse primero.',
      }
    }
  }

  const config = await getRegalosConfig(companyId)
  if (!config.permitirTransferencias) {
    return { error: 'El negocio no tiene activadas las transferencias entre usuarios.' }
  }

  // Límite mensual (anti-abuso): cuenta lo enviado este mes que no fue cancelado.
  const inicioMes = new Date()
  inicioMes.setDate(1)
  inicioMes.setHours(0, 0, 0, 0)
  const enviadasMes = await prisma.regalo.count({
    where: {
      remitenteId: clienteId,
      tipo: 'TRANSFERENCIA_USOS',
      createdAt: { gte: inicioMes },
      estado: { not: 'CANCELADO' },
    },
  })
  if (enviadasMes >= config.maxTransferenciasMes) {
    return { error: `Alcanzaste el límite de ${config.maxTransferenciasMes} transferencias este mes.` }
  }

  // Destinatario con cuenta: mismo negocio, existente.
  let destinatarioNombre: string | null = null
  if (destinatarioId) {
    const destinatario = await prisma.cliente.findFirst({
      where: { id: destinatarioId, companyId },
      select: { id: true, nombre: true },
    })
    if (!destinatario) return { error: 'Destinatario no encontrado en este negocio.' }
    destinatarioNombre = destinatario.nombre
  }

  // Origen + RESERVA atómica de los usos (guard de saldo contra doble gasto).
  let promocionId: string | null = null
  let compraOrigenId: string | null = null
  let membershipOrigenId: string | null = null
  let etiqueta = ''

  if (origen === 'COMPRA') {
    const compra = await prisma.productoCompra.findFirst({
      where: {
        id: origenId,
        clienteId,
        companyId,
        estado: 'ACTIVA',
        promocionId: { not: null },
        // Anti-farmeo: los beneficios gratis (campaña/ruleta/bienvenida) no se
        // transfieren; solo compras con precio real.
        precioCongelado: { gt: 0 },
      },
      select: { id: true, promocionId: true, promocion: { select: { titulo: true } } },
    })
    if (!compra) return { error: 'Ese beneficio no existe o no es transferible.' }
    const res = await prisma.productoCompra.updateMany({
      where: { id: compra.id, usosRestantes: { gte: usos } },
      data: { usosRestantes: { decrement: usos } },
    })
    if (res.count === 0) return { error: 'No tienes suficientes usos disponibles.' }
    compraOrigenId = compra.id
    promocionId = compra.promocionId
    etiqueta = compra.promocion?.titulo ?? 'Beneficio'
  } else {
    const membresia = await prisma.membership.findFirst({
      where: {
        id: origenId,
        cliente: { id: clienteId },
        estado: 'ACTIVA',
        OR: [{ fechaVencimiento: null }, { fechaVencimiento: { gt: new Date() } }],
      },
      select: { id: true, plan: { select: { nombre: true } } },
    })
    if (!membresia) return { error: 'No tienes una membresía activa con lavados.' }
    // El receptor necesita membresía ACTIVA: los lavados del plan viven en el
    // plan (el caso sin cuenta ya se rechazó arriba).
    if (!destinatarioId) return { error: 'Datos incompletos.' }
    const memDest = await prisma.membership.findFirst({
      where: {
        cliente: { id: destinatarioId },
        estado: 'ACTIVA',
        OR: [{ fechaVencimiento: null }, { fechaVencimiento: { gt: new Date() } }],
      },
      select: { id: true },
    })
    if (!memDest) {
      return {
        error:
          'Tu amigo necesita una membresía activa para recibir lavados del plan. Puedes transferirle usos de una promoción de tu wallet.',
      }
    }
    const res = await prisma.membership.updateMany({
      where: { id: membresia.id, lavadosRestantes: { gte: usos } },
      data: { lavadosRestantes: { decrement: usos } },
    })
    if (res.count === 0) return { error: 'No tienes suficientes lavados disponibles.' }
    membershipOrigenId = membresia.id
    etiqueta = `Lavados del plan ${membresia.plan.nombre}`
  }

  const regalo = await prisma.regalo.create({
    data: {
      companyId,
      tipo: 'TRANSFERENCIA_USOS',
      remitenteId: clienteId,
      destinatarioId,
      destinatarioContacto,
      compraOrigenId,
      membershipOrigenId,
      promocionId,
      usos,
      mensaje,
      expiraAt: new Date(Date.now() + config.vigenciaHoras * 60 * 60 * 1000),
    },
    select: { id: true },
  })

  if (destinatarioId) {
    await notificarCliente(
      destinatarioId,
      '🎁 Te enviaron un regalo',
      `Te transfirieron ${usos} uso${usos !== 1 ? 's' : ''} de ${etiqueta}. Acéptalo antes de que expire.`,
      '/cliente/regalos'
    )
  }

  revalidatePath('/cliente/regalos')
  revalidatePath('/cliente/mis-promociones')
  if (!destinatarioId) {
    return {
      success: true,
      detalle: `Regalo enviado a ${destinatarioContacto}. Cuéntale que se registre en MembeGo con ese ${destinatarioContacto?.includes('@') ? 'correo' : 'teléfono'} para reclamarlo antes de que expire.`,
    }
  }
  return { success: true, detalle: `Regalo enviado a ${destinatarioNombre?.split(/\s+/)[0] ?? 'tu amigo'}. ID ${regalo.id.slice(-6)}` }
}

/** Acepta o rechaza un regalo PENDIENTE dirigido al usuario autenticado. */
export async function responderRegalo(
  _prev: RegaloActionState,
  formData: FormData
): Promise<RegaloActionState> {
  const user = await getUser()
  if (!user || user.metadata.role !== 'CLIENTE') return { error: 'No autorizado.' }
  const clienteId = user.metadata.clienteId
  if (!clienteId) return { error: 'Tu cuenta no está vinculada a una empresa.' }

  const regaloId = String(formData.get('regaloId') ?? '').trim()
  const aceptar = String(formData.get('decision') ?? '') === 'aceptar'

  const regalo = await prisma.regalo.findFirst({
    where: { id: regaloId, destinatarioId: clienteId, estado: 'PENDIENTE' },
    include: { remitente: { select: { id: true, nombre: true } } },
  })
  if (!regalo) return { error: 'Este regalo ya no está pendiente.' }

  // ¿Expiró? Se marca y se devuelven los usos al remitente.
  if (regalo.expiraAt < new Date()) {
    const upd = await prisma.regalo.updateMany({
      where: { id: regalo.id, estado: 'PENDIENTE' },
      data: { estado: 'EXPIRADO', resueltoAt: new Date() },
    })
    if (upd.count > 0) await devolverUsos(regalo).catch(anotarFallo('regalos:regalo.updateMany'))
    revalidatePath('/cliente/regalos')
    return { error: 'Este regalo expiró y los usos volvieron a tu amigo.' }
  }

  const remitenteNombre = regalo.remitente.nombre.split(/\s+/)[0]

  if (!aceptar) {
    const upd = await prisma.regalo.updateMany({
      where: { id: regalo.id, estado: 'PENDIENTE' },
      data: { estado: 'RECHAZADO', resueltoAt: new Date() },
    })
    if (upd.count === 0) return { error: 'Este regalo ya no está pendiente.' }
    await devolverUsos(regalo).catch((e) => console.error('[regalos] refund rechazo', e))
    await notificarCliente(
      regalo.remitenteId,
      'Regalo rechazado',
      'Tu transferencia fue rechazada; tus usos volvieron a tu cuenta.',
      '/cliente/regalos'
    )
    revalidatePath('/cliente/regalos')
    return { success: true, detalle: 'Regalo rechazado. Los usos volvieron a tu amigo.' }
  }

  // ── Aceptar ────────────────────────────────────────────────────────────────
  let etiqueta = 'Beneficio'
  let compraDestinoId: string | null = null
  let membershipDestinoId: string | null = null

  if (regalo.compraOrigenId && regalo.promocionId) {
    // Compra ESPEJO en la wallet del receptor: hereda promoción, precio y
    // vencimiento del origen → el canje con QR funciona sin cambios.
    const origenCompra = await prisma.productoCompra.findUnique({
      where: { id: regalo.compraOrigenId },
      select: { precioCongelado: true, fechaVencimiento: true, promocion: { select: { titulo: true } } },
    })
    etiqueta = origenCompra?.promocion?.titulo ?? 'Beneficio'
    const espejo = await prisma.productoCompra.create({
      data: {
        tipo: 'PROMOCION',
        estado: 'ACTIVA',
        companyId: regalo.companyId,
        clienteId,
        promocionId: regalo.promocionId,
        precioCongelado: origenCompra?.precioCongelado ?? null,
        pagoConfirmado: true,
        usosIncluidos: regalo.usos,
        usosRestantes: regalo.usos,
        fechaActivacion: new Date(),
        fechaVencimiento: origenCompra?.fechaVencimiento ?? null,
        adminNota: `Transferencia P2P de ${regalo.remitente.nombre} (regalo ${regalo.id})`,
      },
      select: { id: true },
    })
    compraDestinoId = espejo.id
  } else if (regalo.membershipOrigenId) {
    // Lavados del plan → a la membresía ACTIVA del receptor (revalidada aquí).
    const memDest = await prisma.membership.findFirst({
      where: {
        cliente: { id: clienteId },
        estado: 'ACTIVA',
        OR: [{ fechaVencimiento: null }, { fechaVencimiento: { gt: new Date() } }],
      },
      select: { id: true, plan: { select: { nombre: true } } },
    })
    if (!memDest) {
      return { error: 'Necesitas una membresía activa para recibir estos lavados.' }
    }
    etiqueta = 'Lavados del plan'
    await prisma.membership.update({
      where: { id: memDest.id },
      data: { lavadosRestantes: { increment: regalo.usos } },
    })
    membershipDestinoId = memDest.id
  } else {
    return { error: 'Este regalo tiene un contenido no válido.' }
  }

  // Guard atómico del estado: si otra pestaña lo aceptó primero, deshacemos.
  const upd = await prisma.regalo.updateMany({
    where: { id: regalo.id, estado: 'PENDIENTE' },
    data: { estado: 'ACEPTADO', resueltoAt: new Date(), compraDestinoId, membershipDestinoId },
  })
  if (upd.count === 0) {
    if (compraDestinoId) {
      await prisma.productoCompra.delete({ where: { id: compraDestinoId } }).catch(anotarFallo('regalos:productoCompra.delete'))
    }
    if (membershipDestinoId) {
      await prisma.membership
        .update({ where: { id: membershipDestinoId }, data: { lavadosRestantes: { decrement: regalo.usos } } })
        .catch(anotarFallo('regalos:membership.update'))
    }
    return { error: 'Este regalo ya fue procesado.' }
  }

  // Comprobantes (G3): una Transaction por cada parte, reimprimibles.
  const receptor = await prisma.cliente.findUnique({
    where: { id: clienteId },
    select: { nombre: true },
  })
  const [txRem, txDest] = await Promise.all([
    registrarEntregaBeneficio({
      tipo: 'BENEFIT_USE',
      companyId: regalo.companyId,
      clienteId: regalo.remitenteId,
      clienteNombre: regalo.remitente.nombre,
      empleadoId: null,
      beneficio: `Transferencia enviada · ${etiqueta}`,
      detalle: `Transferencia de ${regalo.usos} uso(s) de ${etiqueta} a ${receptor?.nombre ?? 'otro usuario'}`,
      observaciones: regalo.mensaje,
    }),
    registrarEntregaBeneficio({
      tipo: 'BENEFIT_USE',
      companyId: regalo.companyId,
      clienteId,
      clienteNombre: receptor?.nombre ?? 'Cliente',
      empleadoId: null,
      beneficio: etiqueta,
      detalle: `Regalo recibido de ${regalo.remitente.nombre}: ${regalo.usos} uso(s) de ${etiqueta}`,
      restantes: regalo.usos,
      observaciones: regalo.mensaje,
    }),
  ])
  await prisma.regalo
    .update({
      where: { id: regalo.id },
      data: { txRemitenteId: txRem?.id ?? null, txDestinatarioId: txDest?.id ?? null },
    })
    .catch(anotarFallo('regalos:regalo.update'))

  await notificarCliente(
    regalo.remitenteId,
    '🎉 Aceptaron tu regalo',
    `${receptor?.nombre?.split(/\s+/)[0] ?? 'Tu amigo'} aceptó tu transferencia de ${etiqueta}.`,
    '/cliente/regalos'
  )

  revalidatePath('/cliente/regalos')
  revalidatePath('/cliente/mis-promociones')
  return { success: true, detalle: `¡Listo! Recibiste ${regalo.usos} uso${regalo.usos !== 1 ? 's' : ''} de ${etiqueta} de ${remitenteNombre}.` }
}

/** El remitente cancela un regalo PENDIENTE: recupera sus usos. */
export async function cancelarRegalo(
  _prev: RegaloActionState,
  formData: FormData
): Promise<RegaloActionState> {
  const user = await getUser()
  if (!user || user.metadata.role !== 'CLIENTE') return { error: 'No autorizado.' }
  const clienteId = user.metadata.clienteId
  if (!clienteId) return { error: 'Tu cuenta no está vinculada a una empresa.' }

  const regaloId = String(formData.get('regaloId') ?? '').trim()
  const regalo = await prisma.regalo.findFirst({
    where: { id: regaloId, remitenteId: clienteId, estado: 'PENDIENTE' },
    select: { id: true, compraOrigenId: true, membershipOrigenId: true, usos: true },
  })
  if (!regalo) return { error: 'Este regalo ya no está pendiente.' }

  const upd = await prisma.regalo.updateMany({
    where: { id: regalo.id, estado: 'PENDIENTE' },
    data: { estado: 'CANCELADO', resueltoAt: new Date() },
  })
  if (upd.count === 0) return { error: 'Este regalo ya fue procesado.' }
  await devolverUsos(regalo).catch((e) => console.error('[regalos] refund cancel', e))

  revalidatePath('/cliente/regalos')
  revalidatePath('/cliente/mis-promociones')
  return { success: true, detalle: 'Regalo cancelado. Tus usos volvieron a tu cuenta.' }
}

// ── Fase R3 · Regalos pagados (promoción o membresía nueva) ──────────────────

/**
 * Regalar una PROMOCIÓN: la compra se crea bajo el COMPRADOR (así usa todo el
 * flujo de pago existente: transferencia con comprobante, referencia POS,
 * caja) con `beneficiarioClienteId`. Al validarse el pago, la activación la
 * entrega a la wallet del amigo y resuelve el Regalo.
 */
export async function regalarPromocion(
  _prev: RegaloActionState,
  formData: FormData
): Promise<RegaloActionState & { compraId?: string }> {
  try {
    const user = await getUser()
    if (!user || user.metadata.role !== 'CLIENTE') return { error: 'No autorizado.' }
    const { clienteId, companyId } = user.metadata
    if (!clienteId || !companyId) return { error: 'Tu cuenta no está vinculada a una empresa.' }

    const promocionId = String(formData.get('promocionId') ?? '').trim()
    const destinatarioId = String(formData.get('destinatarioId') ?? '').trim()
    const mensaje = String(formData.get('mensaje') ?? '').trim().slice(0, 200) || null
    if (!promocionId || !destinatarioId) return { error: 'Datos incompletos.' }
    if (destinatarioId === clienteId) return { error: 'Para ti mismo usa la compra normal.' }

    const config = await getRegalosConfig(companyId)
    if (!config.permitirRegalos) {
      return { error: 'El negocio no tiene activados los regalos entre usuarios.' }
    }

    const [promo, destinatario] = await Promise.all([
      prisma.promocion.findFirst({ where: { id: promocionId, companyId } }),
      prisma.cliente.findFirst({
        where: { id: destinatarioId, companyId },
        select: { id: true, nombre: true },
      }),
    ])
    if (!promo) return { error: 'Promoción no encontrada.' }
    if (!destinatario) return { error: 'Destinatario no encontrado en este negocio.' }

    const precio = Number(promo.precio ?? 0)
    if (precio <= 0) return { error: 'Las promociones gratuitas no se regalan: tu amigo puede reclamarla directo.' }

    const ventana = validarVentanaAdquisicion(promo)
    if (!ventana.ok) return { error: ventana.mensaje }

    if (promo.visibilidad === 'privada') {
      const activa = await prisma.membership.findFirst({
        where: { clienteId: destinatario.id, companyId, estado: 'ACTIVA' },
        select: { id: true },
      })
      if (!activa) return { error: 'Esta promoción es exclusiva para miembros: tu amigo necesita membresía activa.' }
    }

    // El regalo cuenta contra los límites del BENEFICIARIO (él lo recibe).
    if (promo.limitePorCliente != null) {
      const limite = await estadoLimiteCliente(destinatario.id, promo.id, promo.limitePorCliente)
      if (limite.alcanzado) return { error: mensajeLimitePorCliente(promo.limitePorCliente) }
    }

    const compra = await prisma.$transaction(async (tx) => {
      const creada = await tx.productoCompra.create({
        data: {
          tipo: 'PROMOCION',
          estado: 'PENDIENTE_PAGO',
          companyId,
          clienteId, // el COMPRADOR gestiona el pago
          beneficiarioClienteId: destinatario.id, // la activación la entrega al amigo
          promocionId: promo.id,
          precioCongelado: promo.precio,
          usosIncluidos: promo.usosPorCompra,
          adminNota: `Regalo P2P para ${destinatario.nombre}`,
        },
      })
      await registrarTransicionCompra(tx, {
        compraId: creada.id,
        desde: null,
        hacia: 'SOLICITADA',
        motivo: `Regalo para ${destinatario.nombre}`,
        userId: user.metadata.dbUserId ?? null,
      })
      await registrarTransicionCompra(tx, {
        compraId: creada.id,
        desde: 'SOLICITADA',
        hacia: 'PENDIENTE_PAGO',
        motivo: 'Esperando el pago del regalador',
        userId: user.metadata.dbUserId ?? null,
      })
      await tx.regalo.create({
        data: {
          companyId,
          tipo: 'REGALO_COMPRA',
          remitenteId: clienteId,
          destinatarioId: destinatario.id,
          promocionId: promo.id,
          compraDestinoId: creada.id,
          usos: promo.usosPorCompra,
          mensaje,
          // El pago puede tardar: vigencia amplia (el regalo se entrega al pagar).
          expiraAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      })
      return creada
    })

    revalidatePath('/cliente/regalos')
    revalidatePath('/cliente/mis-promociones')
    return {
      success: true,
      compraId: compra.id,
      detalle: `Regalo creado. Completa el pago y ${destinatario.nombre.split(/\s+/)[0]} lo recibirá al confirmarse.`,
    }
  } catch (e) {
    console.error('[regalos] regalarPromocion:', e)
    return { error: 'Ocurrió un error inesperado. Intenta de nuevo.' }
  }
}

/**
 * Regalar una MEMBRESÍA: se crea directamente a nombre del amigo (los lavados
 * del plan viven en su membresía) con referencia POS para que el REGALADOR
 * pague en sucursal o por transferencia indicando esa referencia. El admin/
 * caja la confirma como cualquier pago; al activarse se notifica a ambos.
 */
export async function regalarMembresia(
  _prev: RegaloActionState,
  formData: FormData
): Promise<RegaloActionState & { referencia?: string }> {
  try {
    const user = await getUser()
    if (!user || user.metadata.role !== 'CLIENTE') return { error: 'No autorizado.' }
    const { clienteId, companyId } = user.metadata
    if (!clienteId || !companyId) return { error: 'Tu cuenta no está vinculada a una empresa.' }

    const planId = String(formData.get('planId') ?? '').trim()
    const destinatarioId = String(formData.get('destinatarioId') ?? '').trim()
    const mensaje = String(formData.get('mensaje') ?? '').trim().slice(0, 200) || null
    if (!planId || !destinatarioId) return { error: 'Datos incompletos.' }
    if (destinatarioId === clienteId) return { error: 'Para ti mismo usa la selección de plan normal.' }

    const config = await getRegalosConfig(companyId)
    if (!config.permitirRegalos) {
      return { error: 'El negocio no tiene activados los regalos entre usuarios.' }
    }

    const [plan, destinatario] = await Promise.all([
      prisma.plan.findFirst({ where: { id: planId, companyId, activo: true } }),
      prisma.cliente.findFirst({
        where: { id: destinatarioId, companyId },
        select: { id: true, nombre: true },
      }),
    ])
    if (!plan) return { error: 'Plan no encontrado.' }
    if (!destinatario) return { error: 'Destinatario no encontrado en este negocio.' }

    // Estado actual del amigo: con ACTIVA no se regala otra; con solicitud en
    // curso tampoco (no pisamos su propio proceso de pago).
    const existente = await prisma.membership.findFirst({
      where: { clienteId: destinatario.id, companyId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, estado: true },
    })
    if (existente?.estado === 'ACTIVA') {
      return { error: 'Tu amigo ya tiene una membresía activa.' }
    }
    if (existente && ['PENDIENTE', 'PENDIENTE_PAGO'].includes(existente.estado)) {
      return { error: 'Tu amigo ya tiene una solicitud de membresía en proceso.' }
    }

    // Referencia única para pagar en caja (o citarla en la transferencia).
    let referencia: string | null = null
    for (let intento = 0; intento < 5 && !referencia; intento++) {
      const candidata = `ORD-${generarCodigo(6)}`
      const ocupada = await prisma.membership.findUnique({
        where: { referencia: candidata },
        select: { id: true },
      })
      if (!ocupada) referencia = candidata
    }
    if (!referencia) return { error: 'No se pudo generar la referencia. Intenta de nuevo.' }

    const membership = await prisma.membership.create({
      data: {
        clienteId: destinatario.id, // la membresía ES del amigo
        companyId,
        planId: plan.id,
        estado: 'PENDIENTE',
        referencia,
        beneficiarioClienteId: destinatario.id,
        userId: user.metadata.dbUserId || null,
        comprobanteNota: `Regalo: la paga ${user.email ?? 'otro cliente'} (ref. ${referencia})`,
      },
      select: { id: true },
    })

    await prisma.regalo.create({
      data: {
        companyId,
        tipo: 'REGALO_MEMBRESIA',
        remitenteId: clienteId,
        destinatarioId: destinatario.id,
        planId: plan.id,
        membershipDestinoId: membership.id,
        mensaje,
        expiraAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    })

    await notificarAdmins(companyId, {
      tipo: 'NUEVO_COMPROBANTE',
      titulo: 'Membresía de regalo por cobrar',
      mensaje: `Un cliente regalará el plan ${plan.nombre} a ${destinatario.nombre}. Referencia ${referencia}: cóbrala en caja o confírmala al recibir la transferencia.`,
      href: '/admin/pagos',
    })

    revalidatePath('/cliente/regalos')
    return {
      success: true,
      referencia,
      detalle: `Regalo creado. Paga con la referencia ${referencia} y ${destinatario.nombre.split(/\s+/)[0]} recibirá su membresía.`,
    }
  } catch (e) {
    console.error('[regalos] regalarMembresia:', e)
    return { error: 'Ocurrió un error inesperado. Intenta de nuevo.' }
  }
}

// ── Fase R4 · Configuración del programa (panel admin) ───────────────────────

/**
 * Guarda la configuración de regalos de la empresa (companies.regalosConfig):
 * activar/desactivar transferencias y regalos pagados, límite mensual y
 * vigencia de los pendientes. Lo no definido cae a REGALOS_DEFAULTS.
 */
export async function guardarRegalosConfig(
  _prev: RegaloActionState,
  formData: FormData
): Promise<RegaloActionState> {
  const user = await requireAdminUser()
  if (!user) return { error: 'No autorizado.' }
  const companyId = user.metadata.companyId
  if (!companyId) return { error: 'Tu cuenta no está vinculada a una empresa.' }

  const maxTransferenciasMes = Math.trunc(Number(formData.get('maxTransferenciasMes')))
  const vigenciaHoras = Math.trunc(Number(formData.get('vigenciaHoras')))
  const giftCardMontoMin = Math.trunc(Number(formData.get('giftCardMontoMin')))
  const giftCardMontoMax = Math.trunc(Number(formData.get('giftCardMontoMax')))
  if (!Number.isFinite(maxTransferenciasMes) || maxTransferenciasMes < 0 || maxTransferenciasMes > 100) {
    return { error: 'El límite mensual debe estar entre 0 y 100 (0 = desactivado).' }
  }
  if (!Number.isFinite(vigenciaHoras) || vigenciaHoras < 1 || vigenciaHoras > 24 * 30) {
    return { error: 'La vigencia debe estar entre 1 hora y 30 días (720 horas).' }
  }
  if (
    !Number.isFinite(giftCardMontoMin) ||
    !Number.isFinite(giftCardMontoMax) ||
    giftCardMontoMin < 50 ||
    giftCardMontoMax > 1_000_000 ||
    giftCardMontoMin > giftCardMontoMax
  ) {
    return { error: 'El rango de la gift card debe ser válido (mínimo RD$50 y mínimo ≤ máximo).' }
  }

  const config = {
    permitirTransferencias: formData.get('permitirTransferencias') === 'on',
    permitirRegalos: formData.get('permitirRegalos') === 'on',
    maxTransferenciasMes,
    vigenciaHoras,
    permitirGiftCards: formData.get('permitirGiftCards') === 'on',
    giftCardMontoMin,
    giftCardMontoMax,
  }

  try {
    await prisma.company.update({
      where: { id: companyId },
      data: { regalosConfig: config },
    })
  } catch (e) {
    console.error('[regalos] guardarRegalosConfig', e)
    return { error: 'No se pudo guardar la configuración. Intenta de nuevo.' }
  }

  revalidatePath('/admin/regalos')
  revalidatePath('/cliente/regalos')
  return { success: true, detalle: 'Configuración guardada.' }
}

// ── Fase R4 · Cancelación desde el panel admin ───────────────────────────────

/**
 * El negocio cancela un regalo PENDIENTE (soporte/anti-abuso): devuelve los
 * usos reservados al remitente y avisa a ambas partes con el motivo. Para los
 * regalos PAGADOS pendientes, la orden/membresía asociada se gestiona además
 * desde el módulo de Pagos.
 */
export async function cancelarRegaloAdmin(
  regaloId: string,
  motivo: string
): Promise<{ error?: string; success?: boolean }> {
  const user = await requireAdminUser()
  if (!user) return { error: 'No autorizado.' }
  const companyId = user.metadata.companyId
  if (!companyId) return { error: 'Tu cuenta no está vinculada a una empresa.' }

  const motivoLimpio = motivo.trim().slice(0, 300)
  if (motivoLimpio.length < 3) return { error: 'Escribe el motivo de la cancelación.' }

  const regalo = await prisma.regalo.findFirst({
    where: { id: regaloId, companyId, estado: 'PENDIENTE' },
    select: {
      id: true,
      tipo: true,
      usos: true,
      compraOrigenId: true,
      membershipOrigenId: true,
      remitenteId: true,
      destinatarioId: true,
    },
  })
  if (!regalo) return { error: 'Este regalo ya no está pendiente.' }

  const upd = await prisma.regalo.updateMany({
    where: { id: regalo.id, estado: 'PENDIENTE' },
    data: { estado: 'CANCELADO', resueltoAt: new Date() },
  })
  if (upd.count === 0) return { error: 'Este regalo ya fue procesado.' }
  await devolverUsos(regalo).catch((e) => console.error('[regalos] refund admin', e))

  await notificarCliente(
    regalo.remitenteId,
    'Regalo cancelado por el negocio',
    `El negocio canceló tu regalo${regalo.tipo === 'TRANSFERENCIA_USOS' ? ' y los usos volvieron a tu cuenta' : ''}. Motivo: ${motivoLimpio}`,
    '/cliente/regalos'
  )
  if (regalo.destinatarioId) {
    await notificarCliente(
      regalo.destinatarioId,
      'Regalo cancelado',
      'El negocio canceló un regalo que tenías pendiente de aceptar.',
      '/cliente/regalos'
    )
  }

  revalidatePath('/admin/regalos')
  revalidatePath('/cliente/regalos')
  return { success: true }
}

/**
 * Mi ID MembeGo (@código): lo genera la primera vez si no existe. Es la
 * identidad que el cliente comparte para RECIBIR regalos.
 */
export async function obtenerMiIdMembego(): Promise<{ error?: string; codigo?: string }> {
  const user = await getUser()
  if (!user || user.metadata.role !== 'CLIENTE') return { error: 'No autorizado.' }
  if (!user.metadata.clienteId) return { error: 'Tu cuenta no está vinculada a una empresa.' }
  try {
    const codigo = await ensureCodigoCorto(user.metadata.clienteId)
    return { codigo }
  } catch (e) {
    console.error('[regalos] obtenerMiIdMembego', e)
    return { error: 'No se pudo obtener tu ID. Intenta de nuevo.' }
  }
}
