/**
 * GOOGLE CALENDAR · reglas puras (sin red, sin Prisma, sin `server-only`).
 *
 * Todo lo que decide CÓMO se construye un evento y CUÁNDO una respuesta de
 * Google cuenta como hecha vive aquí y se prueba sin tocar la API. La capa
 * con red (`googleCalendar.ts`) solo llama.
 */

/** La clave con la que el evento recuerda de qué cita es. */
export const PROPIEDAD_CITA = 'membegoCitaId'

/**
 * EL ID DEL EVENTO SE DERIVA DE LA CITA.
 *
 * La API v3 admite un `id` elegido por el cliente en `events.insert`: base32hex
 * (`[a-v0-9]`), de 5 a 1024 caracteres. Con un id determinista, crear dos veces
 * el evento de la misma cita devuelve 409 en vez de un duplicado — la
 * idempotencia la impone Google, no un candado nuestro que un reintento a
 * medias podría saltarse.
 *
 * El cuid de la cita lleva letras w–z, fuera del alfabeto. En hexadecimal
 * (0–9, a–f) cabe entero, y con el prefijo se distingue de cualquier id que
 * Google genere por su cuenta.
 */
export function idEventoDeCita(citaId: string): string {
  return `membego${Buffer.from(citaId, 'utf8').toString('hex')}`
}

/** Lo que Google acepta como id de evento. */
export function esIdEventoValido(id: string): boolean {
  return /^[a-v0-9]{5,1024}$/.test(id)
}

export interface EventoCita {
  titulo: string
  descripcion?: string
  inicio: Date
  fin: Date
  /** IANA («America/Santo_Domingo»). Google la exige junto a la hora. */
  zonaHoraria: string
}

/**
 * El cuerpo de `events.insert`, tal cual lo espera la referencia v3.
 *
 *  · `dateTime` + `timeZone`: sin la zona, Google interpreta la hora en la
 *    del calendario, y una cita de las 9:00 en Santo Domingo aparecería a
 *    otra hora para un calendario configurado en otro país.
 *  · `extendedProperties.private`: la cita viaja dentro del evento, para
 *    poder encontrarlo con `events.list?privateExtendedProperty=` aunque el
 *    id guardado se perdiera.
 *  · `reminders.useDefault`: los avisos son los que el negocio ya tiene en su
 *    calendario; no se inventa una antelación.
 */
export function cuerpoEvento(citaId: string, evento: EventoCita) {
  return {
    id: idEventoDeCita(citaId),
    summary: evento.titulo,
    description: evento.descripcion,
    start: { dateTime: evento.inicio.toISOString(), timeZone: evento.zonaHoraria },
    end: { dateTime: evento.fin.toISOString(), timeZone: evento.zonaHoraria },
    extendedProperties: { private: { [PROPIEDAD_CITA]: citaId } },
    reminders: { useDefault: true },
  }
}

/**
 * ¿Un borrado que Google responde así ya está hecho? 404 (no existe) y 410
 * (ya se borró) significan lo mismo para nosotros: el evento no está en la
 * agenda, que es lo que se quería.
 */
export function borradoYaHecho(estado: number): boolean {
  return estado === 404 || estado === 410
}

/** ¿Al crear, 409 significa que YA existía? Es la respuesta al id repetido. */
export function creacionYaHecha(estado: number): boolean {
  return estado === 409
}

/**
 * ¿La configuración de la conexión pide llevar las citas confirmadas?
 * Ausente = sí: quien conecta un calendario lo conecta para esto. Solo un
 * `false` explícito —la casilla desmarcada en el alta— lo apaga.
 */
export function sincronizaConfirmadas(config: Record<string, unknown>): boolean {
  return config.sincronizarConfirmadas !== false
}
