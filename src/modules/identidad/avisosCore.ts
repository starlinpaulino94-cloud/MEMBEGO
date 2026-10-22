import { mensajeParaUsuario } from '@/modules/identidad/identidadCore'

/**
 * LOS AVISOS A LA PERSONA cuando su verificación se resuelve (Fase 3). Puro: sin
 * Prisma ni Next, se prueba con valores (`tests/identidad-avisos.test.ts`).
 *
 * Reglas:
 *  · UN aviso por intento y por resultado (`claveDeAviso`): repetir el evento no repite el aviso.
 *  · Solo avisan los resultados que la persona espera: verificada, no se pudo, en revisión.
 *  · NUNCA llevan el motivo de un rechazo por fraude ni el de un documento ya asociado a otra
 *    cuenta: «contacta a soporte» y nada más. Los textos salen del catálogo de códigos
 *    (`mensajeParaUsuario`), la misma fuente que la pantalla.
 *  · NUNCA llevan datos personales: ni nombre, ni documento, ni fecha de nacimiento.
 */

export type ResultadoQueAvisa = 'aprobada' | 'rechazada_reintentable' | 'rechazada_definitiva' | 'en_revision'

export function avisaEsteResultado(estado: string): estado is ResultadoQueAvisa {
  return estado === 'aprobada' || estado === 'rechazada_reintentable' || estado === 'rechazada_definitiva' || estado === 'en_revision'
}

/** La ruta a la que lleva el aviso (en la app móvil se traduce a su pantalla de identidad). */
export const RUTA_DEL_AVISO_DE_IDENTIDAD = '/cliente/identidad'

export interface AvisoDeIdentidad {
  tipoNotificacion: 'IDENTIDAD_VERIFICADA' | 'IDENTIDAD_RECHAZADA' | 'IDENTIDAD_EN_REVISION'
  titulo: string
  /** El texto corto de la campana. */
  mensaje: string
  asunto: string
  parrafos: string[]
  boton: string
  href: string
  tono: 'exito' | 'aviso' | 'info'
}

export const claveDeAviso = (intentoId: string, resultado: ResultadoQueAvisa) => `identidad:${intentoId}:${resultado}`

const SOPORTE = 'Si necesitas ayuda, entra a tu perfil y cuéntanos qué pasa.'

export function redactarAvisoDeIdentidad(resultado: ResultadoQueAvisa, codigoRazon: string | null): AvisoDeIdentidad {
  const href = RUTA_DEL_AVISO_DE_IDENTIDAD
  switch (resultado) {
    case 'aprobada':
      return {
        tipoNotificacion: 'IDENTIDAD_VERIFICADA',
        titulo: 'Tu identidad está verificada',
        mensaje: 'Verificamos tu identidad. Puedes ver el resultado en tu perfil.',
        asunto: 'Tu identidad está verificada',
        parrafos: ['Verificamos tu identidad. Puedes ver el resultado en tu perfil.', 'Las fotos de tu cédula y tu selfie ya fueron eliminadas por el proveedor: solo guardamos el resultado.'],
        boton: 'Ver mi verificación',
        href,
        tono: 'exito',
      }
    case 'en_revision':
      return {
        tipoNotificacion: 'IDENTIDAD_EN_REVISION',
        titulo: 'Estamos revisando tu verificación',
        mensaje: 'Una persona del equipo está revisando tu verificación. Te avisaremos cuando haya resultado.',
        asunto: 'Estamos revisando tu verificación de identidad',
        parrafos: ['Una persona del equipo de Membego está revisando tu verificación.', 'No tienes que hacer nada: te avisaremos cuando haya un resultado.'],
        boton: 'Ver mi verificación',
        href,
        tono: 'info',
      }
    case 'rechazada_reintentable':
    case 'rechazada_definitiva': {
      // El mismo texto que la pantalla: los códigos que no se explican (fraude, documento alterado) ya tienen
      // su mensaje neutro en el catálogo, y uno desconocido cae en el genérico.
      const motivo = mensajeParaUsuario(codigoRazon)
      const definitivo = resultado === 'rechazada_definitiva'
      const cierre = definitivo ? SOPORTE : 'Puedes intentarlo de nuevo desde tu perfil.'
      return {
        tipoNotificacion: 'IDENTIDAD_RECHAZADA',
        titulo: 'No pudimos verificar tu identidad',
        mensaje: `${motivo} ${cierre}`,
        asunto: 'No pudimos verificar tu identidad',
        parrafos: [motivo, cierre],
        boton: definitivo ? 'Contar mi problema' : 'Intentar de nuevo',
        href,
        tono: 'aviso',
      }
    }
  }
}
