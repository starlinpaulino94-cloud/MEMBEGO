import 'server-only'
import { anotarFallo } from '@/lib/prisma-errors'
import { appUrl } from '@/lib/site'
import { sinEmpresa } from '@/lib/tenant'
import { ubicarIntento } from '@/modules/identidad/identidad'
import { armarCorreoDeIdentidad } from '@/modules/identidad/correoAviso'
import { avisaEsteResultado, claveDeAviso, redactarAvisoDeIdentidad } from '@/modules/identidad/avisosCore'
import { encolarEmail } from '@/modules/jobs/emisiones'
import { enviarPushNotificaciones } from '@/modules/notificaciones/push'

/**
 * EL AVISO DE QUE LA VERIFICACIÓN SE RESOLVIÓ (Fase 3): la campana de la persona, su
 * notificación push y un correo. La persona suele irse a otra app mientras el
 * proveedor procesa, así que el aviso es parte de la experiencia, no un adorno.
 *
 * UN aviso por intento y por resultado: el reclamo es una fila de `notificaciones` con
 * su clave de deduplicación (`claveDeAviso`); si ya existe, no se avisa dos veces aunque
 * el evento llegue repetido o lo reconcilie el barrido. NUNCA lanza: un aviso que falla
 * no puede tumbar la resolución de la verificación (`anotarFallo` deja el rastro).
 *
 * Los textos son de `avisosCore.ts`: sin datos personales y sin el motivo de un rechazo
 * por fraude.
 */
export type ResultadoDelAviso = 'enviado' | 'ya_enviado' | 'omitido' | 'fallo'

export async function avisarResultadoDeIdentidad(intentoId: string): Promise<ResultadoDelAviso> {
  try {
    const intento = await ubicarIntento(intentoId)
    if (!intento || !avisaEsteResultado(intento.estado)) return 'omitido'
    const resultado = intento.estado
    // En revisión por un documento repetido no se explica el motivo: es el mismo aviso genérico.
    const aviso = redactarAvisoDeIdentidad(resultado, resultado === 'en_revision' ? null : intento.codigoRazon)

    const destino = await sinEmpresa('identidad: el worker deja el aviso en la campana de la persona', async (tx) => {
      const user = await tx.user.findUnique({ where: { id: intento.userId }, select: { email: true } })
      if (!user) return null
      // El reclamo: crear con la clave de deduplicación sin abortar la transacción si ya existe.
      const dedupeKey = claveDeAviso(intentoId, resultado)
      const reclamo = await tx.notificacion.createMany({
        data: [{ userId: intento.userId, tipo: aviso.tipoNotificacion, titulo: aviso.titulo, mensaje: aviso.mensaje, href: aviso.href, dedupeKey }],
        skipDuplicates: true,
      })
      if (reclamo.count === 0) return 'ya_enviado' as const
      const notificacion = await tx.notificacion.findFirstOrThrow({
        where: { userId: intento.userId, dedupeKey },
        select: { id: true, userId: true, titulo: true, mensaje: true, href: true },
      })
      return { email: user.email, notificacion }
    })
    if (destino === null) return 'omitido'
    if (destino === 'ya_enviado') return 'ya_enviado'

    await enviarPushNotificaciones([destino.notificacion]).catch(anotarFallo('identidad:aviso-push', { intento: intentoId }))
    const correo = destino.email?.trim()
    if (correo) {
      try {
        const { html, text } = armarCorreoDeIdentidad(aviso, { urlBase: appUrl() })
        await encolarEmail({ to: correo, subject: aviso.asunto, html, text })
      } catch (e) {
        anotarFallo('identidad:aviso-correo', { intento: intentoId })(e)
      }
    }
    return 'enviado'
  } catch (e) {
    anotarFallo('identidad:aviso', { intento: intentoId })(e)
    return 'fallo'
  }
}
