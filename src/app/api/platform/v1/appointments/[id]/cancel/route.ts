import type { NextRequest } from 'next/server'
import { sinEmpresa } from '@/lib/tenant'
import { anotarFallo } from '@/lib/prisma-errors'
import { autenticarSobreEmpresa, esFallo, exigeEmpresa } from '@/modules/plataforma/api'
import { errorApi, respuestaApi } from '@/modules/plataforma/errores'
import { cancelarCitaDeNegocio } from '@/modules/citas/cancelacion'
import { crearNotificacion } from '@/modules/notificaciones/service'
import { etiquetaDia, ymdEnTz } from '@/modules/citas/disponibilidad'

export const dynamic = 'force-dynamic'

/**
 * POST /api/platform/v1/appointments/{id}/cancel — cancelar una cita (B-5).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ `POST …/cancel` Y NO `DELETE …`
 *
 * Cancelar NO borra la cita: la mueve a `CANCELADA` dentro de su máquina de
 * estados, conservando quién y por qué. El historial de la agenda —y la
 * proyección de quien integra— necesita ver la cancelación, no un hueco. `DELETE`
 * prometería una desaparición que no ocurre; una acción con nombre es honesta.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SOLO CLAVES DE EMPRESA, SCOPE `appointments:manage`
 *
 * Como editar un cliente (B-5), cancelar es «ordenar tus propios registros»: lo
 * hace una integración de trastienda —una agenda que sincroniza cancelaciones—,
 * no un satélite que canjea. Por eso `exigeEmpresa` y un scope separado del
 * `:read` con el que se PINTA la agenda.
 *
 * IDEMPOTENTE: cancelar una cita ya cancelada devuelve 200 con `applied:false`,
 * que es la respuesta correcta a un reintento tras un timeout. No pide
 * `Idempotency-Key`: repetir la llamada deja la cita igual (cancelada), así que
 * es inofensiva por construcción, como el `PATCH` de cliente.
 */
interface Cuerpo {
  /** Por qué se cancela. Opcional: el negocio puede cancelar sin dar motivo. */
  reason?: string
}

export async function POST(req: NextRequest, ctxRuta: { params: Promise<{ id: string }> }) {
  const { id } = await ctxRuta.params

  const auth = await autenticarSobreEmpresa(req, 'appointments:manage', null, {
    claveDeEmpresa: true,
  })
  if (esFallo(auth)) return auth.fallo
  exigeEmpresa(auth.ctx)

  const cuerpo = (await req.json().catch(() => ({}))) as Cuerpo | null
  const motivo = typeof cuerpo?.reason === 'string' ? cuerpo.reason.trim().slice(0, 300) || null : null

  if (!id?.trim()) {
    return errorApi('INVALID_REQUEST', auth.ctx.requestId, { message: 'appointmentId is required.' })
  }

  const res = await cancelarCitaDeNegocio(auth.companyId, id.trim(), motivo)

  if (!res.ok) {
    if (res.motivo === 'no_encontrada') return errorApi('NOT_FOUND', auth.ctx.requestId)
    // COMPLETADA o NO_ASISTIO: la cita ya ocurrió, no hay nada que cancelar.
    return errorApi('INVALID_REQUEST', auth.ctx.requestId, {
      message: 'This appointment already took place and cannot be cancelled.',
    })
  }

  // Solo si ESTA llamada cambió algo se avisa al cliente: un reintento sobre una
  // cita ya cancelada no debe volver a notificar.
  if (res.cambiada) {
    const tz = res.cita.zonaHoraria
    const cuando = etiquetaDia(ymdEnTz(res.cita.inicio, tz), tz)
    const clienteUser = await sinEmpresa(
      'appointments: usuario del cliente por supabaseId (avisar de la cancelación)',
      (tx) => tx.user.findUnique({ where: { supabaseId: res.cita.clienteSupabaseId }, select: { id: true } })
    ).catch(() => null)
    if (clienteUser) {
      await crearNotificacion({
        userId: clienteUser.id,
        tipo: 'CITA_CANCELADA',
        titulo: 'Tu cita fue cancelada',
        mensaje: `El negocio canceló tu cita del ${cuando}${motivo ? `: ${motivo}` : ''}. Puedes reservar otro turno.`,
        href: '/cliente/citas',
      }).catch(anotarFallo('appointments:cancel:notificar'))
    }
  }

  return respuestaApi(
    {
      appointmentId: res.cita.id,
      status: 'cancelled',
      /** `false` = ya estaba cancelada y esta llamada no cambió nada. */
      applied: res.cambiada,
    },
    auth.ctx.requestId
  )
}
