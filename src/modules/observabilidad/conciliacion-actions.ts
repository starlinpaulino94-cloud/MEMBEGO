'use server'

import { requireSection } from '@/lib/auth/guards'
import { getRequestMeta } from '@/lib/server-utils'
import {
  generarComprobanteDeCobro,
  marcarCobroEntregado,
  reintentarEntregaDeCobro,
  type ActorDeConciliacion,
  type ResultadoDeAccion,
} from '@/modules/observabilidad/conciliacion-servicio'

/**
 * Acciones de /admin/conciliacion, llamadas desde los botones de cada caso.
 *
 * La guardia es la MISMA que confirmar un pago (`pagos` · `confirmar_pago`): quien puede aprobar un pago puede
 * resolver un cobro. Y la empresa sale de la sesión, nunca del formulario: un id de otra empresa no encuentra nada.
 */

async function autorizar(): Promise<{ companyId: string; actor: ActorDeConciliacion } | null> {
  const user = await requireSection('pagos', 'confirmar_pago')
  const companyId = user?.metadata.companyId
  if (!user || !companyId) return null
  const meta = await getRequestMeta()
  return {
    companyId,
    actor: { userId: user.metadata.dbUserId ?? null, ipAddress: meta.ipAddress, userAgent: meta.userAgent },
  }
}

const id = (v: unknown) => (typeof v === 'string' && v.length > 0 && v.length <= 64 ? v : null)

async function ejecutar(
  intentoId: unknown,
  accion: (companyId: string, intentoId: string, actor: ActorDeConciliacion) => Promise<ResultadoDeAccion>
): Promise<ResultadoDeAccion> {
  const auth = await autorizar()
  if (!auth) return { ok: false, error: 'No autorizado.' }
  const idLimpio = id(intentoId)
  if (!idLimpio) return { ok: false, error: 'Cobro no válido.' }
  // Sin `revalidatePath` a propósito: la pantalla es dinámica (no hay caché que invalidar) y revalidar haría que Next la
  // refrescara sola al terminar la acción; el caso resuelto desaparecería y con él su botón de imprimir el comprobante
  // recién generado. La lista se actualiza cuando la persona lo decide (`router.refresh()` en el componente).
  return accion(auth.companyId, idLimpio, auth.actor)
}

export async function generarComprobanteAccion(intentoId: string): Promise<ResultadoDeAccion> {
  return ejecutar(intentoId, generarComprobanteDeCobro)
}

export async function reintentarEntregaAccion(intentoId: string): Promise<ResultadoDeAccion> {
  return ejecutar(intentoId, reintentarEntregaDeCobro)
}

export async function marcarEntregadaAccion(intentoId: string, nota: string): Promise<ResultadoDeAccion> {
  return ejecutar(intentoId, (companyId, idLimpio, actor) => marcarCobroEntregado(companyId, idLimpio, actor, typeof nota === 'string' ? nota : ''))
}
