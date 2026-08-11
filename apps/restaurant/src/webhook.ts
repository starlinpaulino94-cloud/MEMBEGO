import { verificarWebhook, type Cabeceras, type SobreEvento } from '@membego/platform-sdk'
import { aplicarEvento, type AlmacenProyeccion, type ResultadoProyeccion } from './proyeccion'

/**
 * RECEPTOR DE WEBHOOKS.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TRES DEFENSAS, Y NINGUNA SOBRA
 *
 *  1. FIRMA — sobre el cuerpo CRUDO. Cualquiera puede llamar a esta URL: es
 *     pública por definición. Sin verificar la firma, un tercero inventa un
 *     `customer.created` y mete a quien quiera en la proyección.
 *
 *  2. INBOX — un `eventId` ya visto no se vuelve a procesar. MembeGo reintenta
 *     lo que no responde 200, así que el duplicado no es un fallo: es el
 *     funcionamiento normal.
 *
 *  3. ORDEN — `occurredAt` decide qué versión gana (ver `proyeccion.ts`). El
 *     inbox evita repetir un evento; no evita que llegue uno viejo DESPUÉS de
 *     uno nuevo, que es un problema distinto.
 *
 * Las tres protegen de cosas diferentes. Quitar cualquiera deja un hueco que
 * las otras dos no tapan.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SE RESPONDE 200 ANTES DE PROCESAR
 *
 * Procesar primero y responder después significa que un evento lento produce un
 * reintento — y con él, más carga sobre el proceso que ya iba lento. El inbox
 * hace que responder pronto sea seguro: el reintento llega, se reconoce y no se
 * vuelve a aplicar.
 *
 * Lo que NO se hace es responder 200 a un evento con firma inválida. Eso le
 * diría a MembeGo que se recibió bien algo que se descartó.
 */

/** Almacén del inbox. En base, no en memoria: ver el esquema. */
export interface AlmacenInboxPersistente {
  yaVisto(eventId: string): Promise<boolean>
  marcar(evento: { eventId: string; eventType: string; occurredAt: Date }): Promise<void>
}

export type ResultadoWebhookRestaurante =
  | { estado: 400; motivo: string }
  | { estado: 200; duplicado: true }
  | { estado: 200; duplicado: false; proyeccion: ResultadoProyeccion; evento: SobreEvento }

/**
 * Procesa una petición de webhook ya leída como texto crudo.
 *
 * `cuerpoCrudo` es texto y no un objeto a propósito: la firma se calcula sobre
 * los bytes exactos que llegaron. Volver a serializar el JSON parseado cambia
 * el orden de las claves y los espacios, y la firma deja de cuadrar sin que
 * nada explique por qué.
 */
export async function recibirWebhook(
  cuerpoCrudo: string,
  cabeceras: Cabeceras,
  deps: {
    clavePublicaPem: string
    inbox: AlmacenInboxPersistente
    proyeccion: AlmacenProyeccion
  }
): Promise<ResultadoWebhookRestaurante> {
  const verificado = verificarWebhook(cuerpoCrudo, cabeceras, {
    clavePublicaPem: deps.clavePublicaPem,
  })
  if (!verificado.ok) return { estado: 400, motivo: verificado.fallo }

  const evento = verificado.evento

  if (await deps.inbox.yaVisto(evento.eventId)) {
    return { estado: 200, duplicado: true }
  }

  const proyeccion = await aplicarEvento(deps.proyeccion, evento)

  // Se marca SIEMPRE que se llegó hasta aquí, incluso si el evento no tocaba la
  // proyección. Marcar solo los aplicados haría que un `membership.activated`
  // —que aquí se ignora— se reprocesara en cada reintento para nada.
  await deps.inbox.marcar({
    eventId: evento.eventId,
    eventType: evento.eventType,
    occurredAt: new Date(evento.occurredAt),
  })

  return { estado: 200, duplicado: false, proyeccion, evento }
}
