/**
 * SDK · INBOX — procesar cada evento exactamente una vez.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ HACE FALTA, SI YA HAY VENTANA ANTI-REPLAY
 *
 * Son dos defensas distintas y hacen falta las dos: **la ventana acota el
 * tiempo, el inbox acota las veces**.
 *
 * MembeGo reintenta un webhook hasta ocho veces, y el panel puede reencolar la
 * cola de descarte. Todos esos intentos son legítimos, llevan firma válida y
 * caen dentro de la ventana — y todos traen el MISMO `eventId`. Sin inbox, un
 * satélite que sume puntos al recibir `visit.completed` los suma ocho veces.
 *
 * Reintentar de más es seguro por diseño (perder un evento no lo es); lo que
 * hace que sea seguro es esto.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL ALMACÉN LO PONE EL SATÉLITE
 *
 * En memoria vale para desarrollo y para un proceso único. En producción, con
 * varias instancias, el inbox tiene que estar en la base del satélite: dos
 * instancias con dos memorias procesan el mismo evento dos veces, que es
 * exactamente lo que se venía a evitar.
 *
 * Por eso `AlmacenInbox` es una interfaz de dos métodos y no una tabla nuestra:
 * el satélite es dueño de sus datos (§14).
 */

export interface AlmacenInbox {
  /**
   * Marca el evento como visto. Devuelve `true` si es la PRIMERA vez.
   *
   * Tiene que ser atómico. En SQL eso es
   * `INSERT ... ON CONFLICT DO NOTHING` mirando cuántas filas entraron: un
   * `SELECT` seguido de un `INSERT` deja la ventana en la que dos entregas
   * simultáneas leen «no visto» y las dos procesan.
   */
  marcarSiEsNuevo(eventId: string): Promise<boolean>
}

/** Almacén en memoria. Para desarrollo y procesos únicos; ver arriba. */
export class InboxEnMemoria implements AlmacenInbox {
  private readonly vistos = new Set<string>()

  constructor(private readonly maximo = 10_000) {}

  async marcarSiEsNuevo(eventId: string): Promise<boolean> {
    if (this.vistos.has(eventId)) return false
    // Poda simple: sin ella, un proceso de larga vida acumula todos los ids que
    // ha visto y acaba siendo una fuga de memoria con forma de defensa.
    if (this.vistos.size >= this.maximo) {
      const masViejo = this.vistos.values().next().value
      if (masViejo !== undefined) this.vistos.delete(masViejo)
    }
    this.vistos.add(eventId)
    return true
  }
}

export type ResultadoInbox = 'PROCESADO' | 'DUPLICADO'

/**
 * Procesa el evento solo si no se había visto.
 *
 * SI `manejar` LANZA, EL EVENTO SE DESMARCA. Es deliberado: dejarlo marcado
 * haría que el reintento de MembeGo se descartara como duplicado y el evento se
 * perdería para siempre — el peor final posible, porque MembeGo lo daría por
 * entregado y el satélite nunca lo procesó.
 *
 * La consecuencia es que un fallo A MITAD de un manejador no atómico puede
 * dejar trabajo hecho y repetirse. Por eso el manejador debe ser idempotente o
 * transaccional; el inbox evita las repeticiones normales, no sustituye a una
 * transacción.
 */
export async function procesarUnaVez(
  almacen: AlmacenInbox,
  eventId: string,
  manejar: () => Promise<void>
): Promise<ResultadoInbox> {
  const esNuevo = await almacen.marcarSiEsNuevo(eventId)
  if (!esNuevo) return 'DUPLICADO'

  try {
    await manejar()
    return 'PROCESADO'
  } catch (e) {
    await desmarcar(almacen, eventId)
    throw e
  }
}

/**
 * Deshace la marca. Opcional en la interfaz porque un almacén SQL puede
 * preferir borrar la fila y otro marcarla como fallida; si no lo implementa, el
 * evento queda marcado y el satélite tendrá que reprocesarlo a mano — se avisa
 * en vez de fallar en silencio.
 */
async function desmarcar(almacen: AlmacenInbox, eventId: string): Promise<void> {
  const conBorrado = almacen as AlmacenInbox & { desmarcar?: (id: string) => Promise<void> }
  if (typeof conBorrado.desmarcar === 'function') {
    await conBorrado.desmarcar(eventId).catch(() => {})
    return
  }
  if (almacen instanceof InboxEnMemoria) {
    // El almacén en memoria sí sabe deshacerlo.
    ;(almacen as unknown as { vistos: Set<string> }).vistos.delete(eventId)
    return
  }
  console.warn(
    `[membego-sdk] el evento ${eventId} falló y el inbox no implementa desmarcar(): ` +
      'el reintento se descartará como duplicado y habrá que reprocesarlo a mano.'
  )
}
