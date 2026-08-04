'use server'

import { getUser } from '@/lib/auth'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { logReferralEvent } from '@/lib/referidos'
import { createRateLimiter } from '@/lib/rate-limit'

// Anti-abuso: compartir suma pocos puntos, pero igual se limita para que no se
// pueda "farmear" con clics repetidos al botón.
const shareLimiter = createRateLimiter({
  interval: 60 * 60 * 1000, // 1 hora
  maxRequests: 10,
})

/**
 * Registra que el cliente compartió su enlace (evento SHARE, +puntos).
 * `canal`: native | copy | whatsapp | telegram | facebook | x | email | sms | qr
 */
export async function registrarShare(canal: string): Promise<{ ok: boolean }> {
  try {
    const user = await getUser()
    if (!user || user.metadata.role !== 'CLIENTE' || !user.metadata.clienteId) {
      return { ok: false }
    }
    if (!(await shareLimiter(`share:${user.metadata.clienteId}`))) {
      return { ok: false }
    }

    const cliente = await sinEmpresa('referidos: buscar cliente por id (empresa desconocida)', (tx) =>
      tx.cliente.findUnique({
        where: { id: user.metadata.clienteId },
        select: { id: true, companyId: true },
      })
    )
    if (!cliente) return { ok: false }

    // Dedupe en BD (el rate limiter en memoria no cubre múltiples lambdas):
    // un mismo gesto de compartir puede disparar el tracking más de una vez
    // (ej. abrir el QR + elegir canal). Solo cuenta 1 share por minuto.
    const reciente = await conEmpresa(cliente.companyId, (tx) =>
      tx.referralEvent.findFirst({
        where: {
          clienteId: cliente.id,
          tipo: 'SHARE',
          createdAt: { gte: new Date(Date.now() - 60 * 1000) },
        },
        select: { id: true },
      })
    )
    if (reciente) return { ok: true }

    const canalLimpio = String(canal).slice(0, 30)
    await logReferralEvent({
      clienteId: cliente.id,
      companyId: cliente.companyId,
      tipo: 'SHARE',
      canal: canalLimpio,
    })
    return { ok: true }
  } catch (e) {
    console.error('[referidos] registrarShare error:', e)
    return { ok: false }
  }
}
