/**
 * Lo que una pantalla ve de una tarjeta guardada para elegirla al activar la
 * renovación: solo lo que permite reconocerla. Está aparte del servicio porque
 * los componentes de cliente importan este tipo, y un módulo `server-only` no
 * puede aparecer en el árbol de uno aunque sea por un tipo.
 *
 * La etiqueta («Visa ····4242») sale de `etiquetaTarjeta`, en `avisosRenovacionCore`.
 */
export interface TarjetaDePantalla {
  id: string
  marca: string | null
  ultimos4: string | null
  predeterminada: boolean
  /** El vencimiento es conocido y ya pasó. Sin dato, `false`: no se bloquea por suponer. */
  vencida: boolean
}
