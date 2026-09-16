import type { NextRequest } from 'next/server'
import { conEmpresa } from '@/lib/tenant'
import { autenticarSobreEmpresa, esFallo, exigeEmpresa } from '@/modules/plataforma/api'
import { errorApi, respuestaApi } from '@/modules/plataforma/errores'
import { anotarConector } from '@/modules/connect/bitacora'

export const dynamic = 'force-dynamic'

/**
 * DELETE /api/platform/v1/webhooks/{id} — retirar una suscripción (B-2).
 *
 * Es la otra mitad de lo que necesita un constructor de flujos: al apagar el
 * Zap, Zapier llama aquí y la suscripción desaparece. Sin esto, cada flujo
 * apagado dejaría un webhook vivo entregando a una URL que ya no escucha —y
 * fallando— hasta que alguien entrara al panel a limpiarlo.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * AQUÍ SÍ SE BORRA, Y CUESTA ALGO
 *
 * Es la excepción a la regla del módulo («retirar no borra»), y conviene tener
 * clara la factura: `EntregaWebhook` está en cascada con la suscripción, así que
 * borrarla se lleva SU HISTORIAL DE ENTREGAS — el mismo que la pantalla de
 * entregas enseña.
 *
 * Aun así se borra, por dos razones:
 *
 *  1. Una suscripción de webhook guarda un SECRETO de firma. Una fila retirada
 *     pero conservada deja ese secreto vivo, en una tabla, para siempre. Los
 *     conectores no se borran porque las empresas construyen cosas encima
 *     (credenciales, conexiones); aquí no hay nada construido encima.
 *  2. Esta fila es del FLUJO que la creó, no de una persona. Cuando el flujo se
 *     apaga deja de tener dueño, y conservarla llenaría el panel de webhooks
 *     que nadie creó a mano y que nadie va a reactivar.
 *
 * Lo que SÍ sobrevive es el apunte de la bitácora, que es lo que permite
 * reconstruir quién retiró qué y cuándo. Y nótese la asimetría deliberada: el
 * PANEL no borra suscripciones, solo las pausa. Las que se crean a mano son de
 * una persona y su historial le pertenece.
 */
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  const auth = await autenticarSobreEmpresa(req, 'webhooks:manage', null, {
    claveDeEmpresa: true,
  })
  if (esFallo(auth)) return auth.fallo
  exigeEmpresa(auth.ctx)

  const r = await conEmpresa(auth.companyId, (tx) =>
    // Acotado por empresa: el id viaja en la URL y lo escribe quien llama. Sin
    // la condición, una clave podría retirarle los avisos a otra empresa — que
    // es cortarle el servicio sin tocar un solo dato suyo.
    tx.suscripcionWebhook.deleteMany({ where: { id, companyId: auth.companyId } })
  ).catch(() => null)

  if (!r || r.count === 0) return errorApi('NOT_FOUND', auth.ctx.requestId)

  await anotarConector({
    companyId: auth.companyId,
    origen: 'CLAVE_API',
    origenId: auth.ctx.principal.tipo === 'empresa' ? auth.ctx.principal.claveId : null,
    evento: 'webhook.retirado_por_api',
    detalle: { suscripcionId: id },
  })

  return respuestaApi({ deleted: true, id }, auth.ctx.requestId)
}
