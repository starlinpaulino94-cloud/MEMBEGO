import 'server-only'
import { anotarConector } from '@/modules/connect/bitacora'
import { leerCredencial } from '@/modules/connect/credenciales'
import { llamarGraph } from '@/modules/connect/meta/graph'

/**
 * AL DESCONECTAR WHATSAPP, DECÍRSELO A META (Fase 1).
 *
 * Borrar nuestra credencial no le dice nada a Meta: la app seguía suscrita a
 * los webhooks del WABA del cliente y sus eventos seguían llegando — sin
 * dueño, pero llegando. `DELETE /{WABA_ID}/subscribed_apps` anula la
 * suscripción (guía de webhooks para Solution Partners / Tech Providers).
 *
 * Best-effort: se hace ANTES de borrar la credencial, porque hace falta el
 * token; si Meta no responde, se desconecta igual y queda anotado.
 *
 * Vive aparte de `whatsapp.ts` para que `registro.ts` pueda llamarlo sin
 * cerrar un ciclo (whatsapp.ts importa la salud de registro.ts).
 */
export type ResultadoAnulacion = 'anulada' | 'sin_credencial' | 'sin_waba' | 'fallo'

export async function desconectarWhatsappEnMeta(input: {
  companyId: string
  conexionId: string
}): Promise<ResultadoAnulacion> {
  const cred = await leerCredencial({
    companyId: input.companyId,
    conexionId: input.conexionId,
    tipo: 'API_KEY',
  })
  if (!cred.ok) return 'sin_credencial'

  let token: string | null = null
  let wabaId: string | null = null
  try {
    const c = JSON.parse(cred.secreto) as { token?: string; wabaId?: string }
    token = typeof c.token === 'string' ? c.token : null
    wabaId = typeof c.wabaId === 'string' ? c.wabaId : null
  } catch {
    return 'sin_credencial'
  }
  if (!token) return 'sin_credencial'
  // El alta manual con token no sabe el WABA: no hay suscripción nuestra que anular.
  if (!wabaId) return 'sin_waba'

  const r = await llamarGraph({ ruta: `/${encodeURIComponent(wabaId)}/subscribed_apps`, metodo: 'DELETE', token })
  await anotarConector({
    companyId: input.companyId,
    origen: 'CONEXION',
    origenId: input.conexionId,
    nivel: r.ok ? 'INFO' : 'WARN',
    evento: r.ok ? 'meta.suscripcion_anulada' : 'meta.suscripcion_no_anulada',
    detalle: r.ok ? { wabaId } : { wabaId, status: r.respuesta.status, codigoMeta: r.respuesta.codigo },
  })
  return r.ok ? 'anulada' : 'fallo'
}
