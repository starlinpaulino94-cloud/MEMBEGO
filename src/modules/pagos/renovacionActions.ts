'use server'

import { revalidatePath } from 'next/cache'
import { sinEmpresa } from '@/lib/tenant'
import { getUser } from '@/lib/auth'
import { formSubmitLimiter } from '@/lib/rate-limit'
import { getRequestMeta } from '@/lib/server-utils'
import { puedeCobrarToken } from '@/modules/pagos/cardnetToken'
import { TEXTO_VERSION_RENOVACION } from '@/modules/pagos/consentimientosCore'
import { activarRenovacion, desactivarRenovacion } from '@/modules/pagos/renovacionCliente'

/**
 * LAS ACCIONES DEL CLIENTE SOBRE LA RENOVACIÓN AUTOMÁTICA (la puerta).
 *
 * Aquí se decide QUIÉN puede y SI se puede; lo que se hace una vez dentro está en
 * `renovacionCliente.ts`.
 *
 * DOS REGLAS QUE NO SON LAS MISMAS:
 *
 *  · **Encender** exige que la empresa pueda cobrar con tarjeta ahora mismo (si no
 *    puede, prometer «se renovará sola» sería mentirle), y la aceptación explícita
 *    del texto.
 *  · **Apagar** NO exige nada de eso. Dejar de cobrarle a alguien no puede depender
 *    de un interruptor de la empresa: si apagan el cobro con tarjeta con clientes
 *    que ya renuevan solos, esos clientes tienen que poder desactivarlo.
 */

export interface RenovacionActionState {
  error?: string
  success?: boolean
}

const NO_AUTORIZADO: RenovacionActionState = { error: 'No autorizado.' }

async function clienteActual() {
  const user = await getUser()
  if (!user || user.metadata.role !== 'CLIENTE' || !user.metadata.clienteId) return null
  return { user, clienteId: user.metadata.clienteId }
}

/**
 * La membresía de ESTA persona. La pertenencia es de la persona y no de la ficha
 * activa (cliente global): la misma regla que usa la pantalla de la membresía y
 * `cancelarMiMembresia`.
 */
async function membresiaDeLaPersona(
  user: { supabaseId: string; metadata: { clienteId?: string | null } },
  membershipId: string
) {
  const m = await sinEmpresa('renovación: la persona busca su membresía entre todas sus fichas', (tx) =>
    tx.membership.findUnique({
      where: { id: membershipId },
      select: { id: true, cliente: { select: { id: true, supabaseId: true, companyId: true } } },
    })
  ).catch(() => null)
  if (!m) return null
  const esSuya = m.cliente.supabaseId === user.supabaseId || m.cliente.id === user.metadata.clienteId
  return esSuya ? m : null
}

export async function activarRenovacionAction(
  _prev: RenovacionActionState,
  formData: FormData
): Promise<RenovacionActionState> {
  try {
    const ctx = await clienteActual()
    if (!ctx) return NO_AUTORIZADO
    if (!(await formSubmitLimiter(ctx.clienteId))) {
      return { error: 'Demasiados intentos. Intenta de nuevo en unos minutos.' }
    }
    const membershipId = String(formData.get('membershipId') ?? '')
    const tarjetaId = String(formData.get('tarjetaId') ?? '')
    if (!membershipId) return { error: 'Falta la membresía.' }
    if (!tarjetaId) return { error: 'Elige la tarjeta con la que se renovará.' }

    // SIN ACEPTACIÓN EXPLÍCITA NO SE ENCIENDE. Es lo único que el servidor puede
    // exigir: que el formulario que lleva el texto diga que se aceptó. Un
    // consentimiento que se registra sin que nadie lo marque no es evidencia.
    if (formData.get('acepto') !== 'on') {
      return { error: 'Marca la casilla para autorizar la renovación automática.' }
    }

    const m = await membresiaDeLaPersona(ctx.user, membershipId)
    if (!m) return NO_AUTORIZADO
    if (!(await puedeCobrarToken(m.cliente.companyId))) {
      return { error: 'El pago con tarjeta no está disponible para este negocio.' }
    }

    const meta = await getRequestMeta()
    const r = await activarRenovacion({
      companyId: m.cliente.companyId,
      clienteId: m.cliente.id,
      membershipId,
      tarjetaId,
      contexto: {
        textoVersion: TEXTO_VERSION_RENOVACION,
        ip: meta.ipAddress?.split(',')[0]?.trim() ?? null,
        userAgent: meta.userAgent,
      },
    })
    const MENSAJES: Record<Exclude<typeof r, 'ok'>, string> = {
      membresia_no_encontrada: 'No encontramos esa membresía.',
      membresia_no_activa: 'La renovación automática solo se puede activar en una membresía activa.',
      cancelacion_programada: 'Esta membresía tiene la cancelación programada y no se va a renovar.',
      cambio_de_plan_pendiente: 'Primero termina de pagar el cambio de plan.',
      plan_sin_precio: 'Este plan no tiene un precio que cobrar.',
      tarjeta_no_encontrada: 'No encontramos esa tarjeta.',
      tarjeta_sin_perfil: 'Esa tarjeta no se puede usar para renovar. Registra otra al pagar.',
      tarjeta_vencida: 'Esa tarjeta está vencida. Registra una vigente al pagar.',
    }
    if (r !== 'ok') return { error: MENSAJES[r] }
    revalidatePath(`/membresia/${membershipId}`)
    return { success: true }
  } catch (e) {
    console.error('[renovacion:activar]', e)
    return { error: 'No pudimos activar la renovación automática. Intenta de nuevo.' }
  }
}

export async function desactivarRenovacionAction(
  _prev: RenovacionActionState,
  formData: FormData
): Promise<RenovacionActionState> {
  try {
    const ctx = await clienteActual()
    if (!ctx) return NO_AUTORIZADO
    if (!(await formSubmitLimiter(ctx.clienteId))) {
      return { error: 'Demasiados intentos. Intenta de nuevo en unos minutos.' }
    }
    const membershipId = String(formData.get('membershipId') ?? '')
    if (!membershipId) return { error: 'Falta la membresía.' }

    const m = await membresiaDeLaPersona(ctx.user, membershipId)
    if (!m) return NO_AUTORIZADO

    const r = await desactivarRenovacion({
      companyId: m.cliente.companyId,
      clienteId: m.cliente.id,
      membershipId,
    })
    if (r === 'membresia_no_encontrada') return { error: 'No encontramos esa membresía.' }
    revalidatePath(`/membresia/${membershipId}`)
    return { success: true }
  } catch (e) {
    console.error('[renovacion:desactivar]', e)
    return { error: 'No pudimos desactivar la renovación. Intenta de nuevo.' }
  }
}
