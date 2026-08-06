'use server'

import { requireSection } from '@/lib/auth/guards'
import { conEmpresa } from '@/lib/tenant'
import { esSegmentoValido, resolverSegmento } from './segmentos'

// F4.5: envío manual de notificaciones a segmentos de clientes.
// Solo a segmentos de la propia empresa; nunca correo masivo arbitrario.

export interface NotifSegmentState {
  error?: string
  success?: boolean
  enviadas?: number
}

export async function enviarNotificacionSegmento(
  _prev: NotifSegmentState,
  formData: FormData
): Promise<NotifSegmentState> {
  const user = await requireSection('notificaciones')
  if (!user) return { error: 'No autorizado.' }

  const companyId = user.metadata.companyId
  if (!companyId) {
    return { error: 'Esta función es del panel de empresa.' }
  }

  const segmento = String(formData.get('segmento') ?? '').trim()
  const planId = String(formData.get('planId') ?? '').trim() || undefined
  const titulo = String(formData.get('titulo') ?? '').trim()
  const mensaje = String(formData.get('mensaje') ?? '').trim()

  if (!esSegmentoValido(segmento)) return { error: 'Segmento inválido.' }
  if (segmento === 'plan' && !planId) {
    return { error: 'Selecciona el plan del segmento.' }
  }
  if (!titulo || !mensaje) {
    return { error: 'Título y mensaje son obligatorios.' }
  }
  if (titulo.length > 100) return { error: 'El título es demasiado largo (máx 100).' }
  if (mensaje.length > 500) return { error: 'El mensaje es demasiado largo (máx 500).' }

  try {
    // Si es por plan, verificar que el plan pertenece a la empresa.
    if (planId) {
      const plan = await conEmpresa(companyId, (tx) =>
        tx.plan.findUnique({
          where: { id: planId },
          select: { companyId: true },
        })
      )
      if (!plan || plan.companyId !== companyId) {
        return { error: 'Plan inválido.' }
      }
    }

    const userIds = await resolverSegmento(companyId, segmento, planId)
    if (userIds.length === 0) {
      return { error: 'Ese segmento no tiene destinatarios ahora mismo.' }
    }

    await conEmpresa(companyId, (tx) =>
      tx.notificacion.createMany({
        data: userIds.map((userId) => ({
          userId,
          tipo: 'SISTEMA' as const,
          titulo,
          mensaje,
          href: '/cliente/promociones',
        })),
      })
    )

    return { success: true, enviadas: userIds.length }
  } catch (e) {
    console.error('[notif-segmento]', e)
    return { error: 'No se pudo enviar. Intenta de nuevo.' }
  }
}
