import 'server-only'
import type { NotifTipo } from '@prisma/client'
import { anotarFallo } from '@/lib/prisma-errors'
import { appUrl } from '@/lib/site'
import { sinEmpresa } from '@/lib/tenant'
import { ubicarIntento } from '@/modules/identidad/identidad'
import { armarCorreoDeIdentidad } from '@/modules/identidad/correoAviso'
import {
  avisaEsteResultado,
  claveDeAviso,
  claveDeAvisoDeIncidencia,
  claveDeAvisoDeRepeticion,
  RUTA_DEL_AVISO_PARA_PROVEEDOR,
  redactarAvisoDeIdentidad,
  redactarAvisoDeRepeticion,
  redactarAvisoDeRespuesta,
  type AvisoDeIdentidad,
} from '@/modules/identidad/avisosCore'
import { encolarEmail } from '@/modules/jobs/emisiones'
import { enviarPushNotificaciones } from '@/modules/notificaciones/push'

/**
 * LOS AVISOS DE LA VERIFICACIÓN (Fases 3 y 4): la campana de la persona, su notificación push y, para los resultados,
 * un correo. La persona suele irse a otra app mientras el proveedor procesa o el equipo revisa, así que el aviso es
 * parte de la experiencia, no un adorno.
 *
 * UN aviso por hecho: el reclamo es una fila de `notificaciones` con su clave de deduplicación; si ya existe, no se
 * avisa dos veces aunque el evento llegue repetido o lo reconcilie el barrido. NUNCA lanza: un aviso que falla no puede
 * tumbar la resolución de la verificación (`anotarFallo` deja el rastro).
 *
 * Los textos son de `avisosCore.ts`: sin datos personales y sin el motivo de un rechazo por fraude.
 */
export type ResultadoDelAviso = 'enviado' | 'ya_enviado' | 'omitido' | 'fallo'

/** Deja el aviso en la campana (una sola vez por clave), empuja el push y, si se pide, manda el correo. */
async function dejarAviso(entrada: {
  userId: string
  tipo: NotifTipo
  titulo: string
  mensaje: string
  href: string
  dedupeKey: string
  correo?: AvisoDeIdentidad
}): Promise<ResultadoDelAviso> {
  const destino = await sinEmpresa('identidad: se deja el aviso en la campana de la persona', async (tx) => {
    const user = await tx.user.findUnique({ where: { id: entrada.userId }, select: { email: true, role: true } })
    if (!user) return null
    // Quien no es cliente (el representante de un proveedor) verifica desde su portal: el enlace del aviso va allí.
    const href = user.role === 'CLIENTE' ? entrada.href : RUTA_DEL_AVISO_PARA_PROVEEDOR
    // El reclamo: crear con la clave de deduplicación sin abortar la transacción si ya existe.
    const reclamo = await tx.notificacion.createMany({
      data: [{ userId: entrada.userId, tipo: entrada.tipo, titulo: entrada.titulo, mensaje: entrada.mensaje, href, dedupeKey: entrada.dedupeKey }],
      skipDuplicates: true,
    })
    if (reclamo.count === 0) return 'ya_enviado' as const
    const notificacion = await tx.notificacion.findFirstOrThrow({
      where: { userId: entrada.userId, dedupeKey: entrada.dedupeKey },
      select: { id: true, userId: true, titulo: true, mensaje: true, href: true },
    })
    return { email: user.email, notificacion, href }
  })
  if (destino === null) return 'omitido'
  if (destino === 'ya_enviado') return 'ya_enviado'

  await enviarPushNotificaciones([destino.notificacion]).catch(anotarFallo('identidad:aviso-push', { clave: entrada.dedupeKey }))
  const correo = destino.email?.trim()
  if (correo && entrada.correo) {
    try {
      const { html, text } = armarCorreoDeIdentidad({ ...entrada.correo, href: destino.href }, { urlBase: appUrl() })
      await encolarEmail({ to: correo, subject: entrada.correo.asunto, html, text })
    } catch (e) {
      anotarFallo('identidad:aviso-correo', { clave: entrada.dedupeKey })(e)
    }
  }
  return 'enviado'
}

export async function avisarResultadoDeIdentidad(intentoId: string): Promise<ResultadoDelAviso> {
  try {
    const intento = await ubicarIntento(intentoId)
    if (!intento || !avisaEsteResultado(intento.estado)) return 'omitido'
    const resultado = intento.estado
    // En revisión por un documento repetido no se explica el motivo: es el mismo aviso genérico.
    const aviso = redactarAvisoDeIdentidad(resultado, resultado === 'en_revision' ? null : intento.codigoRazon)
    return await dejarAviso({
      userId: intento.userId,
      tipo: aviso.tipoNotificacion,
      titulo: aviso.titulo,
      mensaje: aviso.mensaje,
      href: aviso.href,
      dedupeKey: claveDeAviso(intentoId, resultado),
      correo: aviso,
    })
  } catch (e) {
    anotarFallo('identidad:aviso', { intento: intentoId })(e)
    return 'fallo'
  }
}

/** Le avisa a la persona que el equipo le pide repetir la verificación (no es un rechazo). */
export async function avisarRepeticionDeIdentidad(intentoId: string): Promise<ResultadoDelAviso> {
  try {
    const intento = await ubicarIntento(intentoId)
    if (!intento) return 'omitido'
    const aviso = redactarAvisoDeRepeticion()
    return await dejarAviso({
      userId: intento.userId,
      tipo: aviso.tipoNotificacion,
      titulo: aviso.titulo,
      mensaje: aviso.mensaje,
      href: aviso.href,
      dedupeKey: claveDeAvisoDeRepeticion(intentoId),
      correo: aviso,
    })
  } catch (e) {
    anotarFallo('identidad:aviso-repeticion', { intento: intentoId })(e)
    return 'fallo'
  }
}

/** Le deja a la persona, en su campana, la respuesta del equipo a su reporte. Sin correo: la respuesta ya va en la campana y el push. */
export async function avisarRespuestaDeIncidencia(userId: string, incidenciaId: string, respuesta: string): Promise<ResultadoDelAviso> {
  try {
    const a = redactarAvisoDeRespuesta(respuesta)
    return await dejarAviso({ userId, tipo: 'SISTEMA', titulo: a.titulo, mensaje: a.mensaje, href: a.href, dedupeKey: claveDeAvisoDeIncidencia(incidenciaId) })
  } catch (e) {
    anotarFallo('identidad:aviso-respuesta', { incidencia: incidenciaId })(e)
    return 'fallo'
  }
}
