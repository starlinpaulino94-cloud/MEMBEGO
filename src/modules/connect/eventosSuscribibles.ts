import { TIPO_V2 } from '@membego/contracts'
import { EVENTOS_REENVIADOS } from '@/modules/integraciones/nucleo'
import { COMODIN } from '@/modules/connect/webhooksNucleo'

/**
 * QUÉ SE PUEDE ELEGIR al suscribir un webhook (hallazgo A-5).
 *
 * El modelo soportaba la lista de eventos desde la Fase 3 y la interfaz no
 * ofrecía ninguna casilla: toda suscripción nacía recibiéndolo todo. Para una
 * empresa a la que solo le interesa la conversión de un referido, eso es ruido,
 * coste y superficie de datos que no pidió.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA LISTA SALE DEL BUS, NO DE AQUÍ
 *
 * Los valores se derivan de `EVENTOS_REENVIADOS` —lo que el bus emite de
 * verdad— pasados por el mapa v2, que es el nombre con el que viajan por el
 * cable. Escribirlos a mano habría dado una lista que ofrece eventos que no
 * existen (nadie los recibiría nunca, y nadie sabría por qué) o que se olvida
 * de los nuevos.
 *
 * Lo único escrito a mano son las ETIQUETAS, porque `purchase.first_completed`
 * no es una frase. Una prueba exige que todo evento emitido tenga la suya: así,
 * añadir un evento al bus sin traducirlo rompe la CI en vez de enseñarle un
 * identificador en inglés a la dueña de un salón.
 *
 * Módulo PURO: sin `server-only`, sin Prisma. La pantalla recibe el resultado
 * ya calculado desde el servidor, así que nada de esto llega al navegador.
 */

/** La familia de los avisos que mandan las automatizaciones de la empresa. */
export const FAMILIA_AUTOMATIZACIONES = `automation${COMODIN}`

export interface EventoSuscribible {
  /** Lo que se guarda en `SuscripcionWebhook.eventos` y viaja por el cable. */
  valor: string
  /** La misma cosa, dicha para quien tiene un negocio. */
  label: string
}

/**
 * Etiquetas por nombre v2. Se describe CUÁNDO ocurre el evento y no cómo se
 * llama: quien marca una casilla está decidiendo «avísame cuando pase esto».
 */
const ETIQUETAS: Record<string, string> = {
  'customer.created': 'Un cliente se registra en tu negocio',
  'visit.first_completed': 'Un cliente te visita por primera vez',
  'visit.completed': 'Se registra una visita o un canje',
  'purchase.first_completed': 'Un cliente te compra por primera vez',
  'purchase.completed': 'Un cliente compra una membresía o una oferta',
  'membership.activated': 'Una membresía queda activa',
  'referral.converted': 'Un referido completa su conversión',
}

/** Los eventos del negocio que el bus emite hoy, con su nombre v2 y su frase. */
export function eventosDeNegocio(): EventoSuscribible[] {
  return [...new Set(EVENTOS_REENVIADOS.map((e) => TIPO_V2[e] ?? e))]
    .sort()
    .map((valor) => ({ valor, label: ETIQUETAS[valor] ?? valor }))
}

/**
 * TODO lo que se puede marcar, incluida la familia de las automatizaciones.
 *
 * La familia va la ÚLTIMA y no entre los eventos del negocio a propósito: no es
 * una cosa que pase en el negocio, es «lo que tus propias reglas manden». Quien
 * mira la lista tiene que poder distinguirlo sin leerse la etiqueta entera.
 */
export function eventosSuscribibles(): EventoSuscribible[] {
  return [
    ...eventosDeNegocio(),
    {
      valor: FAMILIA_AUTOMATIZACIONES,
      label: 'Avisos que manden tus automatizaciones',
    },
  ]
}

/** Los valores admitidos, para validar lo que llega del formulario. */
export function valoresSuscribibles(): string[] {
  return eventosSuscribibles().map((e) => e.valor)
}

/**
 * Filtra lo que mandó el navegador, quedándose solo con lo conocido.
 *
 * Que se DESCARTE lo desconocido y no se rechace el formulario entero es
 * deliberado: lo único que puede llegar aquí sin estar en la lista es una
 * casilla inventada a mano, y para quien lo hace un error de validación no
 * aporta nada. Lo que sí importa es que no se guarde: un evento mal escrito en
 * la lista es una suscripción que no recibe nada y una tarde buscando por qué.
 */
export function soloEventosConocidos(pedidos: readonly string[]): string[] {
  const validos = new Set(valoresSuscribibles())
  return [...new Set(pedidos.filter((p) => validos.has(p)))]
}

// ── Disparadores de una regla (B-1) ──────────────────────────────────────────

/**
 * Los eventos que puede ESCUCHAR una automatización, con su nombre INTERNO.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * INTERNO, NO v2, Y LA DIFERENCIA NO SE VE HASTA QUE NO FUNCIONA
 *
 * Por el cable viaja `visit.completed`; por el bus, `cliente.visita`. Quien
 * despacha una automatización compara contra `DomainEvent.type`, que es el
 * interno. Una lista de disparadores construida con los nombres v2 —los mismos
 * que se eligen para filtrar un webhook saliente— se guardaría sin error, se
 * vería bien en pantalla y no se dispararía nunca.
 *
 * Las etiquetas salen del MISMO sitio que las de la suscripción, buscadas por
 * su nombre v2: dos listas de frases para los mismos siete eventos acabarían
 * diciendo cosas distintas del mismo hecho.
 */
export function eventosDisparadores(): EventoSuscribible[] {
  return EVENTOS_REENVIADOS.map((interno) => ({
    valor: interno,
    label: ETIQUETAS[TIPO_V2[interno] ?? interno] ?? interno,
  }))
}
