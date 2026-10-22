import { mensajeParaUsuario } from '@/modules/identidad/identidadCore'

/**
 * LOS AVISOS A LA PERSONA cuando su verificación se resuelve (Fase 3) o el equipo le pide algo (Fase 4). Puro: sin
 * Prisma ni Next, se prueba con valores (`tests/identidad-avisos.test.ts`).
 *
 * Reglas:
 *  · UN aviso por intento y por resultado (`claveDeAviso`): repetir el evento no repite el aviso.
 *  · Solo avisan los resultados que la persona espera: verificada, no se pudo, en revisión, «repite la verificación».
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
  tipoNotificacion: 'IDENTIDAD_VERIFICADA' | 'IDENTIDAD_RECHAZADA' | 'IDENTIDAD_EN_REVISION' | 'IDENTIDAD_REPETIR'
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
export const claveDeAvisoDeRepeticion = (intentoId: string) => `identidad:${intentoId}:repeticion`
export const claveDeAvisoDeIncidencia = (incidenciaId: string) => `identidad-incidencia:${incidenciaId}`

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
      // El mismo texto que la pantalla: los códigos que no se explican (fraude, documento alterado, revisión negada) ya tienen
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

/**
 * El equipo le pide a la persona que REPITA la verificación (un caso en revisión que no se pudo resolver, o un flujo que
 * hubo que corregir). No es un rechazo: no activa la espera ni cuenta para el tope semanal, y el aviso lo dice.
 */
export function redactarAvisoDeRepeticion(): AvisoDeIdentidad {
  return {
    tipoNotificacion: 'IDENTIDAD_REPETIR',
    titulo: 'Necesitamos que repitas tu verificación',
    mensaje: 'No pudimos completar tu verificación y necesitamos que la repitas. No cuenta como un intento fallido.',
    asunto: 'Necesitamos que repitas tu verificación de identidad',
    parrafos: ['No pudimos completar tu verificación y necesitamos que la repitas desde tu perfil.', 'No cuenta como un intento fallido: puedes empezar cuando quieras.'],
    boton: 'Verificar de nuevo',
    href: RUTA_DEL_AVISO_DE_IDENTIDAD,
    tono: 'aviso',
  }
}

/** La respuesta del equipo a una incidencia, para la campana de la persona. La respuesta la escribe el equipo, no la persona. */
export function redactarAvisoDeRespuesta(respuesta: string): { titulo: string; mensaje: string; href: string } {
  return {
    titulo: 'Respondimos tu reporte de verificación',
    mensaje: respuesta.slice(0, 500),
    href: RUTA_DEL_AVISO_DE_IDENTIDAD,
  }
}
