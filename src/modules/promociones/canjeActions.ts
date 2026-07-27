'use server'

/**
 * Fase E5 · Canje (consumo) de una promoción comprada, desde el escáner.
 * Mismo esquema atómico que confirmarVisita: invalidar QR + descontar uso +
 * transacción oficial (Transaction Engine, tipo PROMOTION_USE) en un solo
 * commit; luego el ticket del Receipt Engine.
 */

import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'
import { getRequestMeta } from '@/lib/server-utils'
import { SCANNER_ROLES } from '@/types'
import { canAccessAdminSection } from '@/lib/auth/permissions'
import { crearTransaccionAplicada } from '@/lib/transactions'
import type { TicketPayload } from '@/modules/transacciones/actions'
import { registrarTransicionCompra, validarConsumoCompra } from '@/modules/promociones/compra'
import { registrarHitoInvitacion } from '@/modules/invitaciones/hitosConversion'

export interface CanjeState {
  error?: string
  success?: boolean
  /** Usos restantes tras el canje. */
  restantes?: number
  /** true → fue el último uso: la compra quedó CONSUMIDA. */
  consumida?: boolean
  transaccionId?: string
  codigo?: string
  ticketNumero?: string
  ticket?: TicketPayload
  /** Campaña en cadena: beneficio que este canje acaba de desbloquear. */
  siguientePaso?: { titulo: string; companyName: string }
}

export async function confirmarCanjePromocion(
  _prev: CanjeState,
  formData: FormData
): Promise<CanjeState> {
  const t0 = Date.now()
  try {
    const user = await getUser()
    if (!user || !SCANNER_ROLES.includes(user.metadata.role)) {
      return { error: 'No tienes permisos para confirmar canjes.' }
    }

    const compraId = String(formData.get('compraId') ?? '')
    const qrTokenId = String(formData.get('qrTokenId') ?? '')
    const notas = String(formData.get('notas') ?? '').trim() || null
    const sucursalId = String(formData.get('sucursalId') ?? '').trim() || null
    // Canje INTERNO (módulo Seguimiento): el admin canjea sin escanear el QR
    // del cliente. Queda marcado en la transacción y en auditoría con fecha,
    // hora y responsable. Solo roles con acceso a la sección de seguimiento.
    const interno = String(formData.get('interno') ?? '') === '1'
    if (interno && !canAccessAdminSection(user.metadata.role, 'seguimiento')) {
      return { error: 'No tienes permisos para canjes internos.' }
    }
    if (!compraId || !qrTokenId) return { error: 'Datos del canje incompletos.' }

    // Documento comercial: SIEMPRE el nombre del empleado, nunca su correo.
    const empleadoNombre =
      (user.metadata.dbUserId
        ? (
            await prisma.user.findUnique({
              where: { id: user.metadata.dbUserId },
              select: { name: true },
            })
          )?.name
        : null) ??
      user.email ??
      null

    const compra = await prisma.productoCompra.findUnique({
      where: { id: compraId },
      include: {
        promocion: true,
        cliente: {
          include: {
            company: {
              select: { name: true, direccion: true, telefono: true, website: true, logoUrl: true, zonaHoraria: true },
            },
          },
        },
      },
    })
    if (!compra || !compra.promocion) return { error: 'Compra no encontrada.' }
    if (
      user.metadata.role !== 'SUPERADMIN' &&
      user.metadata.companyId &&
      compra.companyId !== user.metadata.companyId
    ) {
      return { error: 'Esta promoción pertenece a otra empresa.' }
    }

    // Rule Engine de consumo (revalidación server-side justo antes de aplicar).
    const promo = compra.promocion
    const validacion = validarConsumoCompra(
      compra,
      { diasPermitidos: promo.diasPermitidos, horaDesde: promo.horaDesde, horaHasta: promo.horaHasta },
      new Date(),
      compra.cliente.company.zonaHoraria
    )
    if (!validacion.puedeUsar) {
      return { error: validacion.mensaje ?? 'La promoción no puede canjearse ahora.' }
    }

    let sucursalNombre: string | null = null
    if (sucursalId) {
      const suc = await prisma.sucursal.findUnique({ where: { id: sucursalId }, select: { nombre: true, companyId: true } })
      if (!suc || suc.companyId !== compra.companyId) return { error: 'Sucursal no válida.' }
      sucursalNombre = suc.nombre
    }

    const meta = await getRequestMeta()
    const empleadoId = user.metadata.dbUserId ?? null

    const result = await prisma.$transaction(async (tx) => {
      // QR de un solo uso: guard atómico anti doble-canje.
      const qrUpd = await tx.qrToken.updateMany({
        where: { id: qrTokenId, activo: true, compraId: compra.id },
        data: { activo: false },
      })
      if (qrUpd.count === 0) throw new Error('QR_YA_USADO')

      const compraUpd = await tx.productoCompra.updateMany({
        where: { id: compra.id, estado: 'ACTIVA', usosRestantes: { gt: 0 } },
        data: { usosRestantes: { decrement: 1 } },
      })
      if (compraUpd.count === 0) throw new Error('SIN_USOS')

      const actual = await tx.productoCompra.findUniqueOrThrow({
        where: { id: compra.id },
        select: { usosRestantes: true },
      })
      const restantes = actual.usosRestantes
      const consumida = restantes <= 0

      if (consumida) {
        await tx.productoCompra.update({
          where: { id: compra.id },
          data: { estado: 'CONSUMIDA', consumidaAt: new Date() },
        })
        await registrarTransicionCompra(tx, {
          compraId: compra.id,
          desde: 'ACTIVA',
          hacia: 'CONSUMIDA',
          motivo: 'Último uso canjeado',
          userId: empleadoId,
        })
      } else {
        // Quedan usos: regenerar QR (mismo patrón single-use de membresías).
        const nuevoQr = await tx.qrToken.create({
          data: { clienteId: compra.clienteId, compraId: compra.id },
        })
        await tx.auditLog.create({
          data: {
            companyId: compra.companyId,
            userId: empleadoId,
            accion: 'QR_GENERADO',
            entidadTipo: 'QrToken',
            entidadId: nuevoQr.id,
            payload: { compraId: compra.id, motivo: 'regeneracion_post_canje' },
            ...meta,
          },
        })
      }

      await tx.auditLog.create({
        data: {
          companyId: compra.companyId,
          userId: empleadoId,
          accion: 'QR_USADO',
          entidadTipo: 'ProductoCompra',
          entidadId: compra.id,
          payload: {
            promocionId: promo.id,
            clienteId: compra.clienteId,
            restantes,
            ...(interno ? { interno: true } : {}),
          },
          ...meta,
        },
      })

      // Registro oficial de la operación (Transaction Engine).
      const transaccion = await crearTransaccionAplicada(tx, {
        tipo: 'PROMOTION_USE',
        companyId: compra.companyId,
        sucursalId,
        clienteId: compra.clienteId,
        empleadoId,
        qrTokenUsadoId: qrTokenId,
        snapshot: {
          cliente: compra.cliente.nombre,
          empresa: compra.cliente.company.name,
          sucursal: sucursalNombre ?? undefined,
          promocion: promo.titulo,
          servicio: promo.titulo,
          descuento: promo.descuento != null ? String(promo.descuento) : undefined,
          empleado: empleadoNombre ?? undefined,
          restantes,
          ...(interno ? { canjeInterno: true } : {}),
        },
        auditoria: { ...meta },
        resultado: notas,
        executionMs: Date.now() - t0,
        timeZone: compra.cliente.company.zonaHoraria,
        userId: empleadoId,
      })

      return { restantes, consumida, transaccion }
    })

    // Growth Engine: primer canje de un cliente atribuido a una campaña de
    // invitación (deduplicado internamente; nunca rompe el canje).
    await registrarHitoInvitacion(compra.clienteId, 'PRIMER_CANJE')

    // Campañas conjuntas EN CADENA: si esta compra era un eslabón, canjearlo
    // desbloquea el beneficio de la empresa aliada. Va DESPUÉS de la
    // transacción y con fail-open: el canje ya está confirmado y ningún
    // problema de la cadena puede revertirlo.
    // Se dispara en CUALQUIER canje, no solo en el último: el desbloqueo llega
    // al PRIMER uso, para que la recompensa se sienta inmediata. En usos
    // posteriores la cadena detecta que el eslabón ya se entregó y no anuncia
    // nada, así que llamar siempre es seguro.
    let siguientePaso: { titulo: string; companyName: string } | null = null
    {
      const { avanzarCadenaTrasCanje } = await import('@/modules/campanas/cadena')
      const avance = await avanzarCadenaTrasCanje(compra.id)
      if (avance.entregado) {
        siguientePaso = {
          titulo: avance.entregado.titulo,
          companyName: avance.entregado.companyName,
        }
      }
    }

    // Payload del ticket (Receipt Engine) — plantilla de la empresa.
    const [plantilla, promosActivas] = await Promise.all([
      prisma.receiptTemplate.findUnique({ where: { companyId: compra.companyId } }).catch(() => null),
      prisma.promocion
        .findMany({
          where: {
            companyId: compra.companyId,
            activo: true,
            archivada: false,
            vigenciaDesde: { lte: new Date() },
            OR: [{ vigenciaHasta: null }, { vigenciaHasta: { gte: new Date() } }],
          },
          orderBy: { prioridad: 'desc' },
          take: 3,
          select: { titulo: true },
        })
        .catch(() => []),
    ])

    const empresa = compra.cliente.company
    const ticket: TicketPayload = {
      transactionId: result.transaccion.id,
      lineas: [],
      metodoPago: null,
      esEntrega: false,
      timeZone: empresa.zonaHoraria,
      empresa: {
        nombre: empresa.name,
        sucursal: sucursalNombre,
        direccion: empresa.direccion,
        telefono: empresa.telefono,
        web: empresa.website,
        logoUrl: empresa.logoUrl,
      },
      template: (plantilla?.config ?? {}) as TicketPayload['template'],
      transaccion: {
        codigo: result.transaccion.codigo,
        ticketNumero: result.transaccion.ticketNumero,
        fecha: new Date().toISOString(),
        caja: null,
        empleado: empleadoNombre,
        cliente: compra.cliente.nombre,
        vehiculo: null,
        placa: null,
        membresia: null,
        plan: null,
        nivel: null,
        puntos: null,
        servicio: promo.titulo,
        promocion: promo.titulo,
        beneficio: null,
        descuento: promo.descuento != null ? String(promo.descuento) : null,
        subtotal: null,
        total: null,
        restantes: result.restantes,
        observaciones: notas,
        promosActivas: promosActivas.map((p) => p.titulo),
      },
    }

    return {
      success: true,
      restantes: result.restantes,
      consumida: result.consumida,
      transaccionId: result.transaccion.id,
      codigo: result.transaccion.codigo,
      ticketNumero: result.transaccion.ticketNumero,
      ticket,
      ...(siguientePaso ? { siguientePaso } : {}),
    }
  } catch (e) {
    if (e instanceof Error && e.message === 'QR_YA_USADO') {
      return { error: 'Este QR ya fue utilizado. Pide al cliente su QR actualizado.' }
    }
    if (e instanceof Error && e.message === 'SIN_USOS') {
      return { error: 'No quedan usos disponibles en esta promoción.' }
    }
    console.error('[promociones] confirmarCanjePromocion:', e)
    return { error: 'Error interno al confirmar el canje. Intenta de nuevo.' }
  }
}
