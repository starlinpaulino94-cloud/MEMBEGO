import { sendEmail } from '@/lib/email'
import { sinEmpresa } from '@/lib/tenant'
import { conPorDefecto, puedeMandarse, type DefinicionDeAviso, type PreferenciasDeAviso } from './dominio'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 9 · BLOQUE 5 · EL CORREO.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * NO SE CREA UN `EmailGateway`
 *
 * §5 dice de auditar primero, y la auditoría es corta: `src/lib/email.ts` ya
 * es una abstracción usable sobre Resend, y además trae dos cosas que habría
 * que reinventar y que nadie recuerda al día siguiente:
 *
 *   · la guarda de EMPRESA DE DEMOSTRACIÓN —un «tu membresía venció» saliendo
 *     de una empresa de práctica hacia una persona real—;
 *   · el `replyTo` con el ticket firmado dentro, para que una respuesta
 *     entrante sepa a qué conversación pertenece.
 *
 * Así que esto no es un gateway nuevo: es el ADAPTADOR entre un efecto del
 * outbox y esa función. Lo único que se le añadió a `lib/email.ts` fue
 * devolver el código HTTP del proveedor, porque un efecto necesita distinguir
 * un fallo que vale la pena reintentar de uno que no.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL CORREO NO SALE DE UNA TRANSACCIÓN FINANCIERA
 *
 * Esto corre en el worker del outbox, nunca dentro de la transacción que
 * confirma un pago. Es la regla del §2 y el motivo es que si Resend está
 * caído, lo que NO puede pasar es que el pago se deshaga: el pago está bien, el
 * aviso está pendiente, y son dos cosas distintas con dos destinos distintos.
 */

/** Lo que el efecto necesita saber para escribir el correo. */
export interface CorreoDeAviso {
  asunto: string
  texto: string
}

export interface ResultadoDeCorreo {
  /** Lo que se apunta en el efecto del outbox. Nunca lleva la dirección. */
  detalle: string
}

/**
 * Por qué un fallo del proveedor se reintenta o no.
 *
 * 5xx y los cortes de red son del proveedor y se arreglan solos: ahí el
 * reintento es exactamente lo que hay que hacer. Un 4xx es nuestro —una
 * dirección que no existe, un cuerpo mal formado— y reintentarlo ocho veces
 * con una espera que llega a un día es gastar la escalera de reintentos en algo
 * que no va a cambiar, y además tapar el problema real durante una semana.
 */
export function valeLaPenaReintentar(status: number | undefined): boolean {
  if (status === undefined) return true // no hubo respuesta: corte de red
  if (status === 408 || status === 429) return true // tiempo agotado o límite de ritmo
  return status >= 500
}

/**
 * El correo de un aviso, con la preferencia de la persona respetada.
 *
 * Devuelve `null` cuando NO hay que mandar nada —porque la persona lo apagó, o
 * porque no tiene dirección— y eso no es un fallo: es la decisión de alguien,
 * cumplida.
 */
export async function mandarCorreoDeAviso(
  aviso: DefinicionDeAviso,
  userId: string,
  contenido: CorreoDeAviso
): Promise<ResultadoDeCorreo | null> {
  const persona = await sinEmpresa('Supply 2.0: a qué dirección avisar', (tx) =>
    tx.user.findUnique({
      where: { id: userId },
      select: { email: true, companyId: true, preferenciasDeAviso: true },
    })
  )
  if (!persona?.email) return null

  const preferencias: PreferenciasDeAviso | null = persona.preferenciasDeAviso
    ? {
        inApp: persona.preferenciasDeAviso.inApp ?? undefined,
        emailTransactional: persona.preferenciasDeAviso.emailTransactional ?? undefined,
        emailMarketing: persona.preferenciasDeAviso.emailMarketing ?? undefined,
        whatsappTransactional: persona.preferenciasDeAviso.whatsappTransactional ?? undefined,
        whatsappMarketing: persona.preferenciasDeAviso.whatsappMarketing ?? undefined,
      }
    : null

  if (!puedeMandarse(aviso, 'EMAIL', preferencias)) {
    return { detalle: 'no se manda: la persona tiene el correo apagado para esta clase de aviso' }
  }

  const r = await sendEmail({
    to: persona.email,
    subject: contenido.asunto,
    text: contenido.texto,
    companyId: persona.companyId,
  })

  if (r.sent) return { detalle: 'aceptado por el proveedor de correo' }

  // Sin proveedor configurado NO se reintenta: en un despliegue sin
  // `RESEND_API_KEY` todos los avisos acabarían en la cola de difuntos y el
  // panel se llenaría de ruido que no describe ninguna avería nueva. Que falta
  // la clave ya lo dice la configuración crítica del bloque 4, que es su sitio.
  if (r.status === undefined && r.reason?.includes('RESEND_API_KEY')) {
    return { detalle: 'canal de correo NO CONFIGURADO: no se intenta' }
  }
  if (r.reason === 'destinatario inválido') {
    return { detalle: 'no se manda: la dirección de la persona no es válida' }
  }
  if (r.reason?.startsWith('empresa de demostración')) {
    return { detalle: 'no se manda: empresa de demostración' }
  }

  if (valeLaPenaReintentar(r.status)) {
    // Se LANZA para que el outbox lo reprograme con su escalera. El dinero no
    // se toca: esto corre fuera de la transacción del pago.
    throw new Error(`CORREO_TRANSITORIO: ${r.reason ?? 'sin motivo'}`)
  }
  return { detalle: `el proveedor rechazó el correo (${r.status}): no se reintenta` }
}

/**
 * LO QUE NO SE PUEDE PROMETER (§6 · igual que el bloque 2 con la pasarela).
 *
 * Resend no tiene idempotencia por clave: si el proceso muere DESPUÉS de que
 * Resend aceptara el correo y ANTES de que el outbox lo marque entregado, el
 * reintento manda un segundo correo. No hay forma de evitarlo desde aquí, y
 * fingir que sí la hay sería peor que decirlo.
 *
 * El tamaño real del problema: la ventana es de milisegundos, el efecto
 * duplicado es un correo repetido —no un cobro— y la alternativa (marcar
 * entregado ANTES de mandar) cambiaría un correo repetido por un correo
 * perdido, que es peor. Si algún día Resend acepta una clave de idempotencia,
 * `idempotencyKey` del efecto ya existe y viaja desde el bloque 1: solo habría
 * que ponerla en la cabecera.
 */
export const LIMITACION_DE_IDEMPOTENCIA =
  'Resend no acepta clave de idempotencia: un corte entre la aceptación y el marcado puede repetir un correo.'
