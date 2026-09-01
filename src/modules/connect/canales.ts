import 'server-only'
import { whatsappDisponible } from '@/modules/connect/whatsapp'
import { calendarioDisponible } from '@/modules/connect/googleCalendar'
import { haySuscripcionesActivas } from '@/modules/connect/webhooks'

/**
 * QUÉ CANALES FUNCIONAN DE VERDAD EN ESTA EMPRESA (Connect · Fase 7).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL PROBLEMA QUE RESUELVE
 *
 * Las acciones del motor DEGRADAN en silencio: si una automatización manda un
 * WhatsApp y la empresa no tiene el conector conectado, la ejecución se marca
 * como correcta y registra la intención. Ese comportamiento es el bueno —una
 * regla publicada no puede empezar a fallar porque falte una conexión— pero
 * tiene un coste: quien la configuró cree que sus clientes reciben mensajes, y
 * no los reciben.
 *
 * Esto pone esa verdad en una pantalla. No cambia ninguna decisión del motor:
 * la misma pregunta que el motor se hace en el momento de actuar se le enseña
 * a la persona ANTES, para que la respuesta no sea una sorpresa dentro de tres
 * semanas.
 *
 * NO SE INVENTA NADA: cada canal responde consultando exactamente lo mismo que
 * consulta el motor. Si un día una de las dos respuestas cambiara sin la otra,
 * esta pantalla mentiría — por eso comparten la función, no la lógica copiada.
 */

export type EstadoCanal = 'listo' | 'no_configurado'

export interface CanalAutomatizacion {
  /** Coincide con el `channel` que la acción registra en la auditoría. */
  clave: 'inapp' | 'email' | 'whatsapp' | 'webhook'
  nombre: string
  estado: EstadoCanal
  /** Qué hacer para encenderlo. Vacío cuando ya está listo. */
  comoEncenderlo: string
}

export async function canalesDeEmpresa(companyId: string): Promise<CanalAutomatizacion[]> {
  const [whatsapp, webhook] = await Promise.all([
    whatsappDisponible(companyId),
    haySuscripcionesActivas(companyId),
  ])

  return [
    {
      clave: 'inapp',
      nombre: 'Aviso dentro de la app',
      // La campana in-app no depende de nada externo: siempre funciona.
      estado: 'listo',
      comoEncenderlo: '',
    },
    {
      clave: 'email',
      nombre: 'Correo',
      // El correo depende de la plataforma, no de la empresa. Si faltara la
      // clave de Resend, `sendEmail` degrada y lo dice en su propio resultado;
      // aquí se informa del estado del despliegue, que es lo que la empresa
      // puede llegar a preguntar.
      estado: process.env.RESEND_API_KEY ? 'listo' : 'no_configurado',
      comoEncenderlo: process.env.RESEND_API_KEY
        ? ''
        : 'El envío de correos no está configurado en la plataforma. Escríbenos.',
    },
    {
      clave: 'whatsapp',
      nombre: 'WhatsApp',
      estado: whatsapp ? 'listo' : 'no_configurado',
      comoEncenderlo: whatsapp
        ? ''
        : 'Conecta WhatsApp más abajo, en Aplicaciones. Sin eso, tus automatizaciones no envían mensajes aunque los tengan configurados.',
    },
    {
      clave: 'webhook',
      nombre: 'Aviso a tu sistema (webhook)',
      estado: webhook ? 'listo' : 'no_configurado',
      comoEncenderlo: webhook ? '' : 'Crea un webhook más abajo y apúntalo a tu servidor.',
    },
  ]
}

/**
 * Google Calendar no es un canal de automatización: no lo usa ninguna acción
 * del motor, lo usa la confirmación de una cita. Se expone aparte para que la
 * pantalla pueda enseñarlo sin mezclarlo con los canales — mezclarlos haría
 * creer que una regla puede escribir en la agenda, y no puede.
 */
export async function calendarioDeEmpresa(
  companyId: string
): Promise<{ estado: EstadoCanal; comoEncenderlo: string }> {
  const listo = await calendarioDisponible(companyId)
  return {
    estado: listo ? 'listo' : 'no_configurado',
    comoEncenderlo: listo
      ? ''
      : 'Conecta Google Calendar más abajo para que tus citas confirmadas aparezcan en la agenda del negocio.',
  }
}
