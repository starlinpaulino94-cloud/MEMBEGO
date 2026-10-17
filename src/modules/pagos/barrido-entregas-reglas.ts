/**
 * EL BARRIDO DE ENTREGAS DE PAGO — sus reglas, en funciones PURAS.
 *
 * Un cobro con tarjeta aprobado en la app puede quedar sin entregar (la función serverless murió entre el cobro y la
 * activación, la base falló un instante…). Hay rutas que lo reintentan al momento (el retorno del navegador, el webhook),
 * pero si ninguna vuelve a pasar por ahí el cliente se queda esperando hasta que alguien mire la conciliación. El cron de
 * entregas es la RED DE SEGURIDAD: reintenta lo que sigue sin entregar y, cuando no puede, AVISA a los administradores.
 *
 * Qué decide cada función de aquí, sin base de datos ni Next, para probarlo con datos sueltos:
 *   · cuándo reintentar un cobro, cuándo esperar y cuándo rendirse (nunca reintentar para siempre);
 *   · qué se le dice a los administradores.
 */

/** Solo se reintenta solo un cobro reciente: uno de hace meses lo decide una persona (puede haberse resuelto por fuera). */
export const VENTANA_REINTENTO_DIAS = 7

/** Tope de reintentos automáticos de un mismo cobro. Contados por `fulfillmentIntentos`, que también suma los manuales. */
export const MAX_REINTENTOS_AUTOMATICOS = 5

/** Espera tras el primer reintento fallido; se duplica con cada uno (15 min, 30 min, 1 h, 2 h…), con tope de un día. */
export const ESPERA_BASE_MS = 15 * 60_000
export const ESPERA_MAX_MS = 24 * 3_600_000

/** Un cliente esperando se AVISA a los administradores solo si lleva al menos esto (no es una entrega en vuelo). */
export const UMBRAL_AVISO_MS = 30 * 60_000

/** Un cobro entregado sin comprobante se repara solo si es reciente y de los que ya nacen con su canal (no es retroactivo). */
export const VENTANA_COMPROBANTE_DIAS = 14

const DIA_MS = 86_400_000

/** Cuánto hay que dejar pasar desde la última actividad antes del siguiente reintento, según los que ya se hicieron. */
export function esperaTrasIntentos(intentos: number): number {
  if (!Number.isFinite(intentos) || intentos <= 0) return 0
  return Math.min(ESPERA_MAX_MS, ESPERA_BASE_MS * 2 ** (intentos - 1))
}

export type DecisionDeReintento = 'REINTENTAR' | 'ESPERAR' | 'AGOTADO' | 'FUERA_DE_VENTANA' | 'REQUIERE_PERSONA'

export interface CobroPorReintentar {
  /** Reintentos hechos hasta ahora (`fulfillmentIntentos`). */
  intentos: number
  /** Última vez que el cobro cambió (`updatedAt`): el reintento anterior, o el propio cobro. */
  actualizadoAt: Date
  /** Cuándo la pasarela aprobó el cobro. Sin fecha no se puede acotar ni demostrar nada. */
  activadoAt: Date | null
  /** Un cambio de plan ya pagado: lo aplica una persona, reintentarlo no lo resuelve nunca (ver `entregaRequierePersona`). */
  requierePersona?: boolean
}

/** Qué hace el barrido con un cliente que está esperando. El orden de las comprobaciones es parte de la regla. */
export function decidirReintento(c: CobroPorReintentar, ahora: Date): DecisionDeReintento {
  if (c.requierePersona) return 'REQUIERE_PERSONA'
  if (!c.activadoAt) return 'FUERA_DE_VENTANA'
  if (ahora.getTime() - c.activadoAt.getTime() > VENTANA_REINTENTO_DIAS * DIA_MS) return 'FUERA_DE_VENTANA'
  if (c.intentos >= MAX_REINTENTOS_AUTOMATICOS) return 'AGOTADO'
  if (ahora.getTime() - c.actualizadoAt.getTime() < esperaTrasIntentos(c.intentos)) return 'ESPERAR'
  return 'REINTENTAR'
}

const fmtRD = (n: number) => `RD$${n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export interface ResumenParaAviso {
  /** Clientes que pagaron con tarjeta y siguen sin su producto (ya pasado el umbral de aviso). */
  esperando: number
  monto: number
  /** De esos, en cuántos el sistema ya agotó sus reintentos, es demasiado viejo o es un cambio de plan: hace falta una persona. */
  sinSalidaAutomatica: number
}

/** El aviso a los administradores. Una fila por empresa y día: un recordatorio, no una lluvia de avisos. */
export function avisoDeEntregas(r: ResumenParaAviso): { titulo: string; mensaje: string } {
  const n = r.esperando
  const quien = n === 1 ? 'Un cliente pagó con tarjeta y todavía no tiene su producto' : `${n} clientes pagaron con tarjeta y todavía no tienen su producto`
  const resto =
    r.sinSalidaAutomatica > 0
      ? r.sinSalidaAutomatica === n
        ? ' El sistema ya no puede resolverlo solo: hace falta una persona.'
        : ` En ${r.sinSalidaAutomatica} el sistema ya no puede resolverlo solo: hace falta una persona.`
      : ' El sistema sigue reintentando la entrega.'
  return {
    titulo: n === 1 ? 'Un pago con tarjeta sin entregar' : 'Pagos con tarjeta sin entregar',
    mensaje: `${quien} (${fmtRD(r.monto)}).${resto} Revísalo en Conciliación.`,
  }
}

/** Clave que hace que el aviso sea UNO por empresa y día (`notificaciones` tiene índice único por usuario y clave). */
export function claveDeAvisoDelDia(companyId: string, ahora: Date): string {
  return `entregas-sin-cerrar:${companyId}:${ahora.toISOString().slice(0, 10)}`
}
