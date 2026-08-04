/**
 * Growth Engine 3.0 · Enganche del registro con un enlace de invitación.
 *
 * Server-internal (SIN 'use server'). Se invoca tras crear la cuenta del
 * invitado (después de `vincularReferido`). Atribuye el registro al enlace,
 * entrega el beneficio de bienvenida ofrecido (req #4/#5) y dispara las reglas
 * configurables del evento REGISTRO. Nunca lanza: no debe romper el registro.
 */

import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { logReferralEvent } from '@/lib/referidos'
import { resolverGrowthLink } from './links'
import { evaluarRecompensasGrowth, otorgarBeneficioReferido } from './rewards'

export async function procesarRegistroGrowth(
  glCode: string,
  companyId: string,
  referidoClienteId: string
): Promise<void> {
  const code = (glCode ?? '').trim()
  if (!code) return
  try {
    const link = await resolverGrowthLink(code)
    if (!link || link.companyId !== companyId) return

    // No auto-atribuir si el invitado ES el dueño del enlace.
    if (link.clienteId === referidoClienteId) return

    // El referido creado por vincularReferido (auditoría / antifraude).
    const referido = await sinEmpresa('growth: buscar vínculo referido por id (su empresa se valida contra la del enlace)', (tx) =>
      tx.referido
        .findUnique({
          where: { referidoClienteId },
          select: { id: true, sospechoso: true },
        })
    ).catch(() => null)

    // Evento de embudo atribuido al enlace concreto.
    await logReferralEvent({
      clienteId: link.clienteId,
      companyId,
      tipo: 'REGISTRO',
      referidoClienteId,
      growthLinkId: link.id,
      // Ya existe un REGISTRO del flujo legacy; este marca la atribución al
      // enlace. Puntos 0 para no duplicar la gamificación del referente.
      puntos: 0,
      meta: { code: link.code, via: 'growth_link' },
    })

    // Antifraude: si el vínculo es sospechoso, no se entregan recompensas.
    if (referido?.sospechoso) return

    // Beneficio de bienvenida ofrecido por el enlace (entrega inmediata).
    if (!link.expirado && link.promocionId) {
      await otorgarBeneficioReferido({
        companyId,
        clienteId: referidoClienteId,
        promocionId: link.promocionId,
      })
    }

    // Reglas configurables del evento REGISTRO (puntos al referente, etc.).
    await evaluarRecompensasGrowth({
      companyId,
      trigger: 'REGISTRO',
      referenteClienteId: link.clienteId,
      referidoClienteId,
      growthLinkId: link.id,
      referidoId: referido?.id ?? null,
    })
  } catch (e) {
    console.error('[growth] procesarRegistroGrowth', e)
  }
}

/**
 * Dispara las recompensas configurables de una CONVERSIÓN del referido
 * (MEMBRESIA / COMPRA) cuando este activa su primer producto. Resuelve el
 * referente y el enlace desde la atribución del registro. Nunca lanza.
 */
export async function procesarConversionGrowth(
  referidoClienteId: string,
  companyId: string,
  opts: { trigger: 'MEMBRESIA' | 'COMPRA'; planId?: string | null }
): Promise<void> {
  try {
    const referido = await sinEmpresa('growth: buscar vínculo referido por id (empresa desconocida)', (tx) =>
      tx.referido
        .findUnique({
          where: { referidoClienteId },
          select: { id: true, referenteClienteId: true, sospechoso: true },
        })
    ).catch(() => null)
    if (!referido || referido.sospechoso) return

    // Enlace concreto que originó el registro (atribución por evento).
    const evento = await conEmpresa(companyId, (tx) =>
      tx.referralEvent
        .findFirst({
          where: { referidoClienteId, companyId, growthLinkId: { not: null } },
          orderBy: { createdAt: 'asc' },
          select: { growthLinkId: true },
        })
    ).catch(() => null)

    await evaluarRecompensasGrowth({
      companyId,
      trigger: opts.trigger,
      referenteClienteId: referido.referenteClienteId,
      referidoClienteId,
      growthLinkId: evento?.growthLinkId ?? null,
      referidoId: referido.id,
      planId: opts.planId ?? null,
    })
  } catch (e) {
    console.error('[growth] procesarConversionGrowth', e)
  }
}
