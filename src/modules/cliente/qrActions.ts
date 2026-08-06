'use server'

import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { getUser } from '@/lib/auth'
import { getRequestMeta } from '@/lib/server-utils'

export interface CompartirQrState {
  error?: string
  success?: boolean
  /** ISO del momento en que quedó registrado el envío. */
  compartidoEn?: string
  /** Total de veces que se ha compartido este QR. */
  compartidoCount?: number
}

/**
 * Registra que el cliente compartió su QR (por WhatsApp u otro medio).
 *
 * NO consume el token: el QR sigue siendo de un solo uso —quien lo escanee
 * primero lo invalida y se regenera—. Compartir solo deja rastro en el
 * historial (audit log) y actualiza los contadores del token para poder
 * mostrar cuándo y cuántas veces se envió.
 *
 * Solo el cliente dueño de la membresía puede compartir su propio QR.
 */
export async function compartirQrToken(
  qrTokenId: string
): Promise<CompartirQrState> {
  try {
    const user = await getUser()
    if (!user || user.metadata.role !== 'CLIENTE') {
      return { error: 'No autorizado.' }
    }

    const id = qrTokenId.trim()
    if (!id) return { error: 'Falta el código QR.' }

    const qr = await sinEmpresa('cliente: buscar mi QR', (tx) =>
      tx.qrToken.findUnique({
        where: { id },
        include: {
          cliente: { select: { id: true, supabaseId: true, companyId: true } },
        },
      })
    )
    if (!qr) return { error: 'El código QR no existe.' }

    // Propiedad: por supabaseId o, como respaldo, por el clienteId de la sesión
    // (mismo criterio que la página de detalle de la membresía).
    const esPropietario =
      qr.cliente.supabaseId === user.supabaseId ||
      qr.cliente.id === user.metadata.clienteId
    if (!esPropietario) return { error: 'No autorizado.' }

    if (!qr.activo) {
      return {
        error:
          'Este código ya fue utilizado. Abre tu QR actualizado para compartirlo.',
      }
    }

    const now = new Date()
    const meta = await getRequestMeta()

    // Actualiza contadores + deja rastro inmutable en el historial.
    const [actualizado] = await conEmpresa(qr.cliente.companyId, (tx) =>
      Promise.all([
        tx.qrToken.update({
          where: { id },
          data: {
            compartidoCount: { increment: 1 },
            ultimoCompartido: now,
          },
          select: { compartidoCount: true, ultimoCompartido: true },
        }),
        tx.auditLog.create({
          data: {
            companyId: qr.cliente.companyId,
            userId: user.metadata.dbUserId ?? null,
            accion: 'QR_COMPARTIDO',
            entidadTipo: 'QrToken',
            entidadId: id,
            payload: {
              clienteId: qr.cliente.id,
              membresiaId: qr.membresiaId,
            },
            ...meta,
          },
        }),
      ])
    )

    return {
      success: true,
      compartidoEn: (actualizado.ultimoCompartido ?? now).toISOString(),
      compartidoCount: actualizado.compartidoCount,
    }
  } catch (e) {
    console.error('[qrActions] compartirQrToken error:', e)
    return { error: 'No se pudo registrar el envío. Intenta de nuevo.' }
  }
}
