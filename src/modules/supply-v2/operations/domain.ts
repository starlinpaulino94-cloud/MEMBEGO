import { createHash, randomUUID } from 'node:crypto'
import type { SupplyV2ExternalEventStatus, SupplyV2OutboxStatus } from '@prisma/client'
import { decimal, redondear2, type Decimal } from '../core/dinero'
import type { Transiciones } from '../core/estados'
import { agotoLosIntentos, proximoIntentoTras } from '../../integraciones/reintentos'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 9 · NÚCLEO OPERATIVO, parte pura.
 *
 * Sin Prisma, sin red y sin `server-only`: aquí viven las decisiones que
 * tienen consecuencias —qué identidad tiene un evento externo, cuándo se
 * reintenta, cuándo se da por muerto, qué se puede contar en un log— y por
 * tanto son las que se prueban.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE NO SE REINVENTA
 *
 * La ESCALERA de reintentos es la de `modules/integraciones/reintentos.ts`:
 * ocho intentos de 30 s a 24 h, con jitter, la misma que usan las dos colas de
 * salida de Connect. Aquí solo se envuelve con el vocabulario de Supply.
 *
 * Tener dos escaleras con números distintos sería tener dos promesas distintas
 * sobre cuánto tarda Membego en rendirse, y nadie habría decidido la segunda.
 * ────────────────────────────────────────────────────────────────────────────
 */

// ── Identidad de un evento externo (§4A) ────────────────────────────────────

export interface IdentidadEvento {
  provider: string
  externalEventId: string
  eventType: string
}

/**
 * La identidad estable de un evento externo: `provider + externalEventId +
 * eventType`, normalizada.
 *
 * Normaliza a propósito: un proveedor que un día manda `PAYMENT_CONFIRMED` y
 * otro `payment_confirmed` está mandando LO MISMO, y tratarlo como dos eventos
 * distintos sería confirmar dos veces. El id externo NO se pasa a minúsculas:
 * puede ser sensible a mayúsculas del lado del proveedor.
 */
export function identidadDeEvento(d: IdentidadEvento): IdentidadEvento {
  return {
    provider: d.provider.trim().toUpperCase(),
    externalEventId: d.externalEventId.trim(),
    eventType: d.eventType.trim().toUpperCase(),
  }
}

/** La misma identidad, como una sola cadena: para candados y para logs. */
export function claveDeEvento(d: IdentidadEvento): string {
  const i = identidadDeEvento(d)
  return `${i.provider}:${i.externalEventId}:${i.eventType}`
}

export function identidadValida(d: IdentidadEvento): string | null {
  const i = identidadDeEvento(d)
  if (!i.provider) return 'El evento no dice de qué proveedor viene.'
  if (!i.externalEventId) return 'El evento no trae su identificador externo: sin él no se puede deduplicar.'
  if (!i.eventType) return 'El evento no dice qué tipo de evento es.'
  if (i.provider.length > 40) return 'El nombre del proveedor es demasiado largo.'
  if (i.externalEventId.length > 200) return 'El identificador externo es demasiado largo.'
  return null
}

/**
 * Huella del cuerpo recibido. Distingue «el mismo evento otra vez» —un
 * reintento del proveedor, que es idempotente— de «otra cosa con el id de
 * antes», que es un error del proveedor y se le dice en vez de procesarlo.
 */
export function huellaDePayload(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload ?? null)).digest('hex')
}

/** Hilo que une todo lo que pasa por una operación (§25). */
export function nuevoCorrelationId(): string {
  return `sv2-${randomUUID()}`
}

// ── Máquinas de estado (§4B) ────────────────────────────────────────────────

/**
 * RECEIVED → PROCESSING → PROCESSED | FAILED | IGNORED
 * FAILED → PROCESSING (reintento) | DEAD_LETTER
 *
 * `PROCESSED`, `IGNORED` y `DEAD_LETTER` son FINALES. Que `PROCESSED` lo sea
 * es la mitad de la idempotencia: un evento ya procesado no vuelve a entrar al
 * camino que mueve dinero, por muchas veces que el proveedor lo reenvíe.
 */
export const TRANSICIONES_EVENTO_EXTERNO: Transiciones<SupplyV2ExternalEventStatus> = {
  RECEIVED: ['PROCESSING', 'IGNORED'],
  PROCESSING: ['PROCESSED', 'FAILED', 'IGNORED'],
  PROCESSED: [],
  FAILED: ['PROCESSING', 'DEAD_LETTER'],
  DEAD_LETTER: ['PROCESSING'],
  IGNORED: [],
}

/** Estados en los que el evento ya no tiene nada pendiente que hacer. */
export const EVENTO_RESUELTO: readonly SupplyV2ExternalEventStatus[] = ['PROCESSED', 'IGNORED']

/**
 * PENDING → PROCESSING → DELIVERED | FAILED
 * FAILED → PROCESSING | DEAD_LETTER
 *
 * `DEAD_LETTER` vuelve a `PROCESSING` solo por decisión de una persona: es la
 * misma doctrina del outbox de satélites —un fallo se reintenta solo; un
 * difunto necesita que alguien decida—.
 */
export const TRANSICIONES_OUTBOX: Transiciones<SupplyV2OutboxStatus> = {
  PENDING: ['PROCESSING', 'FAILED'],
  PROCESSING: ['DELIVERED', 'FAILED'],
  DELIVERED: [],
  FAILED: ['PROCESSING', 'DEAD_LETTER'],
  DEAD_LETTER: ['PROCESSING'],
}

// ── Reintentos y muerte (§4D, §4E) ──────────────────────────────────────────

export interface Reprogramacion {
  /** Estado al que pasa la fila tras este fallo. */
  status: 'FAILED' | 'DEAD_LETTER'
  /** Cuándo toca el siguiente intento. Null cuando ya no habrá más. */
  nextAttemptAt: Date | null
  intentos: number
}

/**
 * Qué hacer tras un intento fallido. Usa la escalera COMPARTIDA: ocho
 * intentos, de 30 s a 24 h, con jitter sembrado por la identidad de la fila
 * para que mil fallos del mismo proveedor no vuelvan todos en el mismo
 * segundo.
 *
 * `intentosPrevios` son los que YA se hicieron sin contar este. Se pasa
 * `ahora` para poder probarlo sin tocar el reloj.
 */
export function reprogramarTrasFallo(intentosPrevios: number, semilla: string, ahora = new Date()): Reprogramacion {
  const intentos = intentosPrevios + 1
  if (agotoLosIntentos(intentos)) {
    return { status: 'DEAD_LETTER', nextAttemptAt: null, intentos }
  }
  const proximo = proximoIntentoTras(intentos, semilla, ahora)
  return { status: 'FAILED', nextAttemptAt: proximo?.fecha ?? null, intentos }
}

/** ¿Toca intentarlo ya? NULL en `nextAttemptAt` significa vencido, no «nunca». */
export function tocaIntentar(nextAttemptAt: Date | null, ahora = new Date()): boolean {
  return nextAttemptAt == null || nextAttemptAt.getTime() <= ahora.getTime()
}

// ── Clasificación de errores (§6F, §27) ─────────────────────────────────────

/**
 * Un evento externo puede no cuadrar por razones MUY distintas, y la respuesta
 * correcta a cada una es distinta:
 *
 *   · `REINTENTABLE` — no es culpa del evento: la base no respondió, hubo un
 *     bloqueo. Se reintenta.
 *   · `DESCARTABLE` — el evento es válido pero no produce efecto: la orden ya
 *     estaba pagada, el tipo no nos interesa. IGNORED, sin incidente.
 *   · `INCIDENTE` — el evento dice algo que NO cuadra con nuestra operación:
 *     monto distinto, moneda distinta, orden que no existe, estado imposible.
 *     Nunca se toca el dinero: se abre un incidente para que una persona lo
 *     mire.
 */
export type ClaseDeFallo = 'REINTENTABLE' | 'DESCARTABLE' | 'INCIDENTE'

export const CODIGOS_DE_FALLO = {
  ORDEN_DESCONOCIDA: 'INCIDENTE',
  MONTO_NO_CUADRA: 'INCIDENTE',
  MONEDA_NO_CUADRA: 'INCIDENTE',
  ESTADO_IMPOSIBLE: 'INCIDENTE',
  PAYLOAD_DISTINTO: 'INCIDENTE',
  ORDEN_YA_PAGADA: 'DESCARTABLE',
  TIPO_NO_MANEJADO: 'DESCARTABLE',
  SIN_REFERENCIA: 'INCIDENTE',
  ERROR_TRANSITORIO: 'REINTENTABLE',
} as const satisfies Record<string, ClaseDeFallo>

export type CodigoDeFallo = keyof typeof CODIGOS_DE_FALLO

export function claseDeFallo(codigo: CodigoDeFallo): ClaseDeFallo {
  return CODIGOS_DE_FALLO[codigo]
}

/** Lo que una persona lee cuando investiga. Técnico fuera, castellano dentro. */
export const MENSAJES_DE_FALLO: Record<CodigoDeFallo, string> = {
  ORDEN_DESCONOCIDA: 'El evento apunta a una compra que no existe en Membego.',
  MONTO_NO_CUADRA: 'El monto del evento no coincide con el total de la compra.',
  MONEDA_NO_CUADRA: 'La moneda del evento no coincide con la de la compra.',
  ESTADO_IMPOSIBLE: 'La compra está en un estado que no admite este evento.',
  PAYLOAD_DISTINTO: 'Ya llegó un evento con ese identificador y un contenido distinto.',
  ORDEN_YA_PAGADA: 'La compra ya estaba pagada: el evento no cambia nada.',
  TIPO_NO_MANEJADO: 'Ese tipo de evento no se procesa en Supply 2.0.',
  SIN_REFERENCIA: 'El evento no dice a qué compra se refiere.',
  ERROR_TRANSITORIO: 'No se pudo procesar ahora; se reintentará.',
}

// ── Validación del evento contra la operación interna (§6F) ─────────────────

export interface EventoDePago {
  /** Referencia a la compra tal como la manda el proveedor. */
  orderNumber?: string | null
  orderId?: string | null
  amount?: number | string | null
  currency?: string | null
}

export interface OrdenParaConciliar {
  id: string
  number: string
  status: string
  currency: string
  total: Decimal
}

/**
 * ¿Este evento se puede aplicar a esta orden? Devuelve el código del problema,
 * o null si cuadra.
 *
 * EL PROVEEDOR EXTERNO NO ES LA FUENTE DE LA VERDAD. Dice que cobró 1 000; lo
 * que decide si eso corresponde a esta compra es el total de la compra, que es
 * nuestro. Si no cuadran, no se toca nada y se abre un incidente.
 */
export function validarEventoContraOrden(e: EventoDePago, o: OrdenParaConciliar | null): CodigoDeFallo | null {
  if (!o) return e.orderId || e.orderNumber ? 'ORDEN_DESCONOCIDA' : 'SIN_REFERENCIA'
  if (o.status === 'PAID') return 'ORDEN_YA_PAGADA'
  if (o.status !== 'PENDING' && o.status !== 'AWAITING_PAYMENT') return 'ESTADO_IMPOSIBLE'
  if (e.currency && e.currency.trim().toUpperCase() !== o.currency.toUpperCase()) return 'MONEDA_NO_CUADRA'
  if (e.amount == null || e.amount === '') return 'MONTO_NO_CUADRA'
  let monto: Decimal
  try {
    monto = redondear2(decimal(e.amount))
  } catch {
    return 'MONTO_NO_CUADRA'
  }
  // Tolerancia de un centavo, la misma que usa el checkout al confirmar a mano.
  if (monto.minus(redondear2(o.total)).abs().greaterThan(0.01)) return 'MONTO_NO_CUADRA'
  return null
}

// ── Saneamiento (§26, §49) ──────────────────────────────────────────────────

/**
 * Claves que NUNCA se guardan ni se registran. No es una lista de buenos
 * modales: un volcado de la tabla de eventos con la firma dentro permite
 * fabricar un evento válido, y con el número de tarjeta dentro convierte una
 * fuga de base en una fuga de datos de pago.
 */
const PROHIBIDAS = [
  'signature', 'firma', 'secret', 'secreto', 'token', 'authorization', 'auth',
  'password', 'contrasena', 'contraseña', 'apikey', 'api_key', 'key',
  'card', 'tarjeta', 'pan', 'cvv', 'cvc', 'expiry', 'vencimiento',
]

const MAX_TEXTO = 500

/**
 * Deja un objeto apto para guardar o registrar: quita las claves prohibidas,
 * recorta los textos largos y no baja más de seis niveles —un payload
 * anidado hasta el infinito es una forma barata de llenarnos la base—.
 */
export function sanear(valor: unknown, profundidad = 0): unknown {
  if (valor === null || valor === undefined) return null
  if (profundidad > 6) return '[profundidad máxima]'
  if (typeof valor === 'string') return valor.length > MAX_TEXTO ? `${valor.slice(0, MAX_TEXTO)}…` : valor
  if (typeof valor === 'number' || typeof valor === 'boolean') return valor
  if (valor instanceof Date) return valor.toISOString()
  if (Array.isArray(valor)) return valor.slice(0, 50).map((v) => sanear(v, profundidad + 1))
  if (typeof valor === 'object') {
    const salida: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
      if (esProhibida(k)) {
        salida[k] = '[oculto]'
        continue
      }
      salida[k] = sanear(v, profundidad + 1)
    }
    return salida
  }
  return String(valor)
}

function esProhibida(clave: string): boolean {
  const k = clave.toLowerCase()
  return PROHIBIDAS.some((p) => k === p || k.includes(p))
}

/**
 * Un mensaje de error apto para guardar en `lastError` y para enseñar en una
 * pantalla de operaciones. Recorta, y pasa por el mismo filtro de claves: un
 * error de un cliente HTTP puede traer la petición entera, cabeceras
 * incluidas.
 */
export function sanearError(e: unknown): string {
  // Un `Error('')` existe y es frecuente (librerías que lanzan vacío). Su
  // mensaje vacío NO puede acabar en `lastError`: una fila muerta con el error
  // en blanco no le dice nada a quien tiene que decidir qué hacer con ella.
  const bruto =
    e instanceof Error
      ? e.message?.trim() || e.name?.trim() || 'Error'
      : typeof e === 'string'
        ? e.trim()
        : JSON.stringify(e ?? null)
  let texto = bruto?.trim() || 'error sin mensaje'
  // `clave=valor` o `"clave": "valor"` con una clave prohibida → se tapa el valor.
  for (const p of PROHIBIDAS) {
    const re = new RegExp(`(["']?\\b\\w*${p}\\w*\\b["']?\\s*[:=]\\s*)(["']?)([^,}\\s"']+)(\\2)`, 'gi')
    texto = texto.replace(re, (_m, antes, q) => `${antes}${q}[oculto]${q}`)
  }
  return texto.length > MAX_TEXTO ? `${texto.slice(0, MAX_TEXTO)}…` : texto
}

// ── Outbox (§4C) ────────────────────────────────────────────────────────────

export interface EfectoPendiente {
  eventType: string
  aggregateType: string
  aggregateId: string
  payload: Record<string, unknown>
  correlationId: string
  /** Lo que define «el mismo efecto»; si se omite, se deriva de lo anterior. */
  dedupeKey?: string | null
}

/**
 * Identidad de una EMISIÓN del outbox. Dos veces el mismo efecto para la misma
 * operación es una sola fila, igual que `(sistemaId, domainEventId)` en el
 * outbox de satélites.
 *
 * Deriva de tipo + agregado y NO del correlationId: dos intentos de confirmar
 * la misma orden llegan con hilos distintos, y el efecto —avisar al cliente de
 * que su compra está pagada— es el mismo.
 */
export function claveDeEfecto(e: Pick<EfectoPendiente, 'eventType' | 'aggregateType' | 'aggregateId'>): string {
  return `${e.eventType}:${e.aggregateType}:${e.aggregateId}`
}
