import { EVENTOS_REENVIADOS } from '@/modules/integraciones/nucleo'
import { eventosDeSincronizacion } from '@/modules/plataforma/proyecciones'

/**
 * PLATAFORMA · Fase 3 — SOBRE DE EVENTOS v2 (núcleo puro).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ LE FALTABA AL FORMATO ANTERIOR
 *
 * El webhook salía como `{ id, tipo, companyId, payload, emitidoEn }`. Con un
 * satélite se aguanta; con diez faltan tres cosas:
 *
 *  · `version` — el día que `data` cambie de forma, el satélite necesita poder
 *    atender las dos a la vez mientras despliega. Sin número de versión, el
 *    cambio obliga a desplegar Core y satélites el mismo minuto.
 *
 *  · `traceId` — una visita genera hasta cuatro eventos hacia dos sistemas. Sin
 *    un hilo común, reconstruir «qué pasó con la visita de las 3 de la tarde»
 *    es cruzar registros a ojo entre logs de empresas distintas.
 *
 *  · `source` — hoy todo sale de MembeGo, así que parece sobrar. Deja de
 *    sobrar el primer día que un vertical reenvíe un evento a otro: sin
 *    origen, un bucle de reenvío no se distingue de tráfico legítimo.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LOS NOMBRES CAMBIAN, Y NADA SE ROMPE
 *
 * `cliente.visita` pasa a `visit.completed`. El motivo no es estético: los
 * nombres viajan al manifest de cada satélite y a su documentación, y
 * `recurso.accion` en inglés es el mismo criterio que ya se aplicó a las
 * capabilities en la Fase 1a — un identificador de protocolo no se traduce.
 *
 * Durante la ventana de migración el sobre lleva LOS DOS: `eventType` con el
 * nombre nuevo y `legacyType` con el viejo. Un satélite que hoy compara con
 * `cliente.visita` sigue funcionando sin desplegar nada; cuando migre, borra la
 * rama vieja. `legacyType` desaparece cuando no quede ninguno.
 */

export const VERSION_SOBRE = 1

/**
 * Nombre v2 de cada evento del bus. La clave es el nombre interno de MembeGo
 * —que NO cambia, porque lo usan las automatizaciones— y el valor es el que
 * viaja por el cable.
 */
export const TIPO_V2: Record<string, string> = {
  'cliente.registrado': 'customer.created',
  'cliente.primera_visita': 'visit.first_completed',
  'cliente.visita': 'visit.completed',
  'cliente.compro_servicio': 'purchase.completed',
  'cliente.primera_compra': 'purchase.first_completed',
  'membresia.activada': 'membership.activated',
  'referido.convirtio': 'referral.converted',
}

/** Índice inverso, para que un satélite ya migrado pueda pedir por el nuevo. */
export const TIPO_INTERNO: Record<string, string> = Object.fromEntries(
  Object.entries(TIPO_V2).map(([interno, v2]) => [v2, interno])
)

export function tipoV2(interno: string): string {
  return TIPO_V2[interno] ?? interno
}

export interface SobreEvento {
  /** Id estable. Es la clave de deduplicación del inbox del satélite. */
  eventId: string
  eventType: string
  /**
   * Nombre anterior, mientras dure la migración. Un satélite que aún compare
   * con él sigue funcionando sin desplegar.
   */
  legacyType?: string
  version: number
  /** ISO 8601. Cuándo ocurrió, no cuándo se envió: los reintentos no lo mueven. */
  occurredAt: string
  companyId: string
  /** Sujeto del evento cuando lo hay (el cliente, casi siempre). */
  customerId?: string
  source: 'membego'
  /** Hilo que une los eventos de una misma operación. */
  traceId: string
  data: Record<string, unknown>
}

/**
 * Construye el sobre a partir de una fila del outbox.
 *
 * `occurredAt` sale de `createdAt` de la fila y NO del reloj de ahora: si un
 * evento se reintenta tres días después, sigue diciendo cuándo ocurrió. Un
 * satélite que lo usara para ordenar su historia lo colocaría en el sitio
 * correcto, no al final.
 */
export function construirSobre(fila: {
  id: string
  tipo: string
  companyId: string
  payload: unknown
  createdAt: Date
  traceId?: string | null
}): SobreEvento {
  const data = (fila.payload ?? {}) as Record<string, unknown>
  const v2 = tipoV2(fila.tipo)
  const clienteId = typeof data.clienteId === 'string' ? data.clienteId : undefined

  return {
    eventId: fila.id,
    eventType: v2,
    ...(v2 !== fila.tipo ? { legacyType: fila.tipo } : {}),
    version: VERSION_SOBRE,
    occurredAt: fila.createdAt.toISOString(),
    companyId: fila.companyId,
    ...(clienteId ? { customerId: clienteId } : {}),
    source: 'membego' as const,
    traceId: fila.traceId ?? fila.id,
    data,
  }
}

/**
 * Claves del formato anterior, que siguen viajando junto a las nuevas.
 *
 * ESTO ES LO QUE HACE QUE NADA SE ROMPA. Los satélites que hay hoy leen `tipo`,
 * `payload`, `id` y `emitidoEn`. Si el cuerpo pasara a ser solo el sobre v2,
 * dejarían de reconocer sus propios eventos el minuto del despliegue — y con
 * Car Wash en producción eso no es una regresión, es una parada.
 *
 * Son duplicados exactos de los campos nuevos, no datos distintos: un satélite
 * no puede leer dos verdades. Se retiran cuando no quede ninguno usándolos.
 */
export interface ClavesLegado {
  id: string
  tipo: string
  payload: Record<string, unknown>
  emitidoEn: string
}

export function clavesLegado(sobre: SobreEvento): ClavesLegado {
  return {
    id: sobre.eventId,
    tipo: sobre.legacyType ?? sobre.eventType,
    payload: sobre.data,
    emitidoEn: sobre.occurredAt,
  }
}

/**
 * Serialización canónica del cuerpo que se envía: sobre v2 + claves de legado.
 *
 * La firma se calcula sobre ESTA cadena y el cuerpo enviado es exactamente
 * ella — no se serializa dos veces. Parece una obviedad y no lo es: firmar un
 * objeto y volver a serializarlo para mandarlo produce, tarde o temprano, dos
 * cadenas distintas (orden de claves, espaciado) y una firma que el satélite
 * rechaza sin poder explicar por qué.
 */
export function cuerpoDelSobre(sobre: SobreEvento): string {
  return JSON.stringify({ ...sobre, ...clavesLegado(sobre) })
}

/**
 * Eventos que MembeGo puede emitir hoy, con su nombre v2. Es la lista que se
 * copia a la documentación del satélite.
 */
export function catalogoV2(): string[] {
  return [...new Set(EVENTOS_REENVIADOS.map(tipoV2))].sort()
}

/**
 * Eventos v2 que el contrato de proyección (Fase 1a) exige y que el bus NO
 * emite todavía.
 *
 * No es una lista de fallos: `company.updated` o `branch.deleted` son eventos
 * que aún no existen en el bus interno, y un satélite que dependa de ellos para
 * refrescar su copia local se quedará desfasado. Que salga aquí es la manera de
 * que eso sea una decisión visible y no una sorpresa a los tres meses.
 */
export function eventosDeProyeccionSinEmisor(): string[] {
  const emitidos = new Set(catalogoV2())
  return eventosDeSincronizacion().filter((e) => !emitidos.has(e))
}
