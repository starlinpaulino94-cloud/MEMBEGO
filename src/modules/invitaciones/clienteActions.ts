'use server'

import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { getUser } from '@/lib/auth'
import { getRequestMeta } from '@/lib/server-utils'
import { hashIp } from '@/lib/referidos'
import { createRateLimiter } from '@/lib/rate-limit'
import { fichaEnEmpresa } from '@/modules/cliente/afiliacion'

const shareLimiter = createRateLimiter({
  interval: 60 * 60 * 1000,
  maxRequests: 15,
})

// Eventos anónimos del embudo (landing pública): límite por huella de red
// para que nadie infle las métricas con requests repetidos.
const eventoLimiter = createRateLimiter({
  interval: 60 * 60 * 1000,
  maxRequests: 60,
})

export async function registrarShareCampana(
  campanaId: string,
  canal: string
): Promise<{ ok: boolean }> {
  try {
    const user = await getUser()
    if (!user || user.metadata.role !== 'CLIENTE') return { ok: false }
    if (!(await shareLimiter(`campshare:${user.supabaseId}`))) {
      return { ok: false }
    }

    const campana = await sinEmpresa('invitaciones: buscar campaña por id (empresa se valida contra la ficha)', (tx) =>
      tx.campanaInvitacion.findUnique({
        where: { id: campanaId },
        select: { id: true, companyId: true, estado: true },
      })
    )
    if (!campana || campana.estado !== 'ACTIVA') return { ok: false }

    /**
     * LA FICHA DE LA EMPRESA DE LA CAMPAÑA, NO LA ACTIVA.
     *
     * Antes esto tomaba `metadata.clienteId` y exigía que su empresa fuera la
     * de la campaña. Desde que se puede invitar desde cualquiera de sus
     * negocios, esa comprobación rechazaba en silencio —`{ ok: false }`, sin
     * mensaje— cada compartido hecho desde un negocio que no fuera el activo:
     * el evento no se registraba, «invitaciones enviadas» no subía nunca y el
     * embudo de referidos perdía su primer eslabón.
     *
     * Sigue siendo una comprobación de pertenencia, no un pase libre: sin
     * ficha en la empresa de esa campaña, no hay evento.
     */
    const clienteId = await fichaEnEmpresa(user.supabaseId, campana.companyId)
    if (!clienteId) return { ok: false }

    const reciente = await conEmpresa(campana.companyId, (tx) =>
      tx.invitacionEvento.findFirst({
        where: {
          campanaId,
          clienteId,
          tipo: 'COMPARTIDA',
          createdAt: { gte: new Date(Date.now() - 60 * 1000) },
        },
        select: { id: true },
      })
    )
    if (reciente) return { ok: true }

    await conEmpresa(campana.companyId, (tx) =>
      tx.invitacionEvento.create({
        data: {
          campanaId,
          clienteId,
          companyId: campana.companyId,
          tipo: 'COMPARTIDA',
          canal: String(canal).slice(0, 30),
        },
      })
    )

    return { ok: true }
  } catch (e) {
    console.error('[invitaciones] registrarShareCampana error:', e)
    return { ok: false }
  }
}

export async function registrarEventoCampana(
  campanaId: string,
  tipo: 'ENLACE_ABIERTO' | 'LANDING_VISTA' | 'REGISTRO_INICIADO',
  meta?: Record<string, unknown>
): Promise<void> {
  try {
    const { ipAddress } = await getRequestMeta()
    const huella = hashIp(ipAddress) ?? 'anon'
    if (!(await eventoLimiter(`campevento:${huella}`))) return

    const campana = await sinEmpresa('invitaciones: buscar campaña por id (empresa desconocida)', (tx) =>
      tx.campanaInvitacion.findUnique({
        where: { id: campanaId },
        select: { id: true, companyId: true },
      })
    )
    if (!campana) return

    await conEmpresa(campana.companyId, (tx) =>
      tx.invitacionEvento.create({
        data: {
          campanaId,
          companyId: campana.companyId,
          tipo,
          meta: (meta ?? {}) as object,
        },
      })
    )
  } catch (e) {
    console.error('[invitaciones] registrarEventoCampana error:', e)
  }
}

// Nota: el reclamo manual del premio fue eliminado. La entrega del premio
// del invitante es AUTOMÁTICA al alcanzar la meta (ver motorProgreso.ts),
// según el spec del Growth Engine: "no debe existir intervención manual".
