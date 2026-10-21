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

/**
 * ¿Se ofrece el panel de renovación automática en esta membresía? Las mismas
 * condiciones que exige el cobro, para no prometer una renovación que no va a
 * ocurrir: activa y sin vencer, con fecha de vencimiento (sin fecha no hay ciclo
 * que medir), sin la cancelación programada (el cliente acaba de decir que no
 * quiere seguir), sin un cambio de plan por pagar y con un plan que cuesta algo.
 *
 * Pura: la usan la web, la API de la app móvil y las pruebas.
 */
export function renovacionVisible(
  m: {
    estado: string
    fechaVencimiento: Date | null
    planIdSolicitado: string | null
    canceladaAlVencimiento: Date | null
    precioPlan: number
  },
  ahora: Date = new Date()
): boolean {
  return (
    m.estado === 'ACTIVA' &&
    m.fechaVencimiento != null &&
    m.fechaVencimiento.getTime() > ahora.getTime() &&
    m.planIdSolicitado == null &&
    m.canceladaAlVencimiento == null &&
    m.precioPlan > 0
  )
}
