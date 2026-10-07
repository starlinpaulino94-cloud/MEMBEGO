/**
 * MEMBEGO SUPPLY · SLICE 9 · BLOQUE 5 · WHATSAPP, DICHO COMO ES.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE LA AUDITORÍA ENCONTRÓ (§8)
 *
 * Membego SÍ manda WhatsApp, y bien: `modules/mensajeria` habla con la API de
 * Meta, respeta la ventana de 24 horas, usa plantillas aprobadas y deja cada
 * mensaje en su conversación. Hay incluso un `whatsappDisponible(companyId)`
 * que comprueba de verdad si hay credencial viva.
 *
 * Pero todo eso es POR EMPRESA. Un mensaje sale de la cuenta de WhatsApp de
 * una empresa concreta, dentro de una `Conversacion` de esa empresa, contra su
 * `PlantillaWhatsapp` aprobada. Los avisos de Supply son de PLATAFORMA:
 * «tu compra está confirmada» lo manda Membego, no el restaurante.
 *
 * Para mandarlos por WhatsApp haría falta una cuenta de WhatsApp Business de
 * Membego, con sus plantillas aprobadas por Meta, y la organización no la
 * tiene habilitada. Eso no es una decisión técnica que se pueda tomar aquí.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ENTONCES: NO SE SIMULA
 *
 * La tentación es escribir el adaptador contra un `fetch` que nunca se llama y
 * marcar el punto como hecho. §26 lo prohíbe y con razón: un canal que dice
 * estar integrado y no manda nada es peor que uno que dice que no está, porque
 * el día que alguien cuente con él no habrá ni aviso ni error.
 *
 * Lo que sí se hace:
 *
 *   · el canal existe en el vocabulario del dominio y en las preferencias, así
 *     que la decisión de la persona se puede guardar YA y no habrá que migrar
 *     nada después;
 *   · `estadoDeWhatsapp()` dice NOT_CONFIGURED con su motivo, y el Centro de
 *     Operaciones lo enseña igual que cualquier otra pieza de configuración;
 *   · un efecto de aviso por WhatsApp NO se encola: se descarta en el origen
 *     con su razón, en vez de llenar la cola de difuntos con algo que no va a
 *     funcionar por mucho que se reintente;
 *   · lo que faltaría para encenderlo está escrito abajo, con nombres.
 *
 * Y el resto del sistema sigue funcionando sin él, que es lo que §26 pide
 * demostrar: los avisos salen in-app y por correo.
 */

export type EstadoDeCanal = 'CONFIGURED' | 'NOT_CONFIGURED'

export interface SaludDeWhatsapp {
  estado: EstadoDeCanal
  /** Qué falta, en una frase. Nunca un valor de configuración. */
  motivo: string
  /** Lo que habría que hacer, con nombres concretos. */
  remedio: string
}

/**
 * Las variables que tendrían que existir para que Membego mandara WhatsApp
 * como PLATAFORMA. Hoy no existen, y por eso son el centinela.
 *
 * No se reutilizan las de Connect (`modules/connect/whatsapp`) a propósito:
 * esas son las credenciales de UNA empresa, guardadas por empresa, y usarlas
 * para mandar un aviso de Membego sería mandar en nombre de un comercio algo
 * que el comercio no dijo.
 */
const VARIABLES = ['SUPPLY_V2_WHATSAPP_PHONE_ID', 'SUPPLY_V2_WHATSAPP_TOKEN'] as const

export function estadoDeWhatsapp(): SaludDeWhatsapp {
  const faltan = VARIABLES.filter((v) => !process.env[v]?.trim())
  if (faltan.length === 0) {
    // Aun con las variables puestas haría falta una plantilla aprobada por
    // Meta para cada aviso. Mientras no exista ese catálogo, tener la
    // credencial no alcanza, y decir CONFIGURED sería volver a prometer de más.
    return {
      estado: 'NOT_CONFIGURED',
      motivo: 'hay credencial de plataforma, pero no hay catálogo de plantillas aprobadas por Meta para estos avisos',
      remedio: 'Dar de alta las plantillas en Meta y mapearlas a los avisos de `notifications/dominio.ts` antes de encender el canal.',
    }
  }
  return {
    estado: 'NOT_CONFIGURED',
    motivo: 'Membego no tiene cuenta de WhatsApp Business de plataforma',
    remedio:
      'Dar de alta una cuenta de WhatsApp Business de Membego, aprobar las plantillas en Meta y poner SUPPLY_V2_WHATSAPP_PHONE_ID y SUPPLY_V2_WHATSAPP_TOKEN. Las credenciales por empresa de Connect NO sirven: mandarían en nombre del comercio.',
  }
}

/** ¿Se puede mandar un aviso de plataforma por WhatsApp ahora mismo? */
export function whatsappDePlataformaDisponible(): boolean {
  return estadoDeWhatsapp().estado === 'CONFIGURED'
}
