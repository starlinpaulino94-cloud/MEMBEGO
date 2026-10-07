import type { MembegoPaymentMethod } from '@prisma/client'
import { Prisma } from '@prisma/client'
import { METODOS_VERIFICABLES, REFERENCIA_PAGO_MAXIMA } from '@/modules/orders/domain'

/**
 * POS CONECTADO A COMMERCE CORE · núcleo puro (Fase 7). Sin Prisma ni Next.
 *
 * La CAJA cobra de tres maneras al mostrador: efectivo, transferencia y tarjeta. Aquí se decide
 * cómo se traduce cada una a lo que entiende un pedido Membego (`MembegoPaymentMethod`) y a lo que
 * entiende la caja (`MetodoCobroTipo`, que no distingue la tarjeta), y qué se le exige a quien cobra.
 *
 * LA REGLA QUE IMPORTA: la caja NO inventa evidencia. Que un pago cuente como «verificado» lo
 * decide el dominio de pedidos (`pagoVerificado`): método verificable (transferencia o tarjeta),
 * CON referencia y por el monto del pedido; el efectivo deja constancia pero no verifica. Por eso
 * aquí la transferencia y la tarjeta EXIGEN su referencia —un cobro «verificado» sin comprobante no
 * existe— y el efectivo no.
 */

export const METODOS_POS = ['EFECTIVO', 'TRANSFERENCIA', 'TARJETA'] as const
export type MetodoPos = (typeof METODOS_POS)[number]

export const ETIQUETA_METODO_POS: Readonly<Record<MetodoPos, string>> = {
  EFECTIVO: 'Efectivo',
  TRANSFERENCIA: 'Transferencia',
  TARJETA: 'Tarjeta',
}

/** Cómo lo llama el pedido. */
export function metodoDePedido(m: MetodoPos): MembegoPaymentMethod {
  return m === 'EFECTIVO' ? 'CASH' : m === 'TRANSFERENCIA' ? 'TRANSFER' : 'CARD'
}

/** Cómo lo llama la caja (que solo conoce efectivo, transferencia y «otro»). */
export function metodoDeCaja(m: MetodoPos): 'EFECTIVO' | 'TRANSFERENCIA' | 'OTRO' {
  return m === 'EFECTIVO' ? 'EFECTIVO' : m === 'TRANSFERENCIA' ? 'TRANSFERENCIA' : 'OTRO'
}

export function esMetodoPos(v: unknown): v is MetodoPos {
  return typeof v === 'string' && (METODOS_POS as readonly string[]).includes(v)
}

/** ¿Este método, con referencia, verifica el pago? (La misma lista que usa el dominio de pedidos.) */
export function metodoVerifica(m: MetodoPos): boolean {
  return METODOS_VERIFICABLES.includes(metodoDePedido(m))
}

export interface CobroPos {
  metodo: MetodoPos
  referencia: string | null
  /** Solo efectivo: lo que entregó el cliente. */
  recibido: Prisma.Decimal | null
  /** Solo efectivo con `recibido`: lo que se devuelve. */
  cambio: Prisma.Decimal | null
}

/**
 * Valida el cobro contra el total REAL del pedido (el que calcula el servidor, nunca el que mande el
 * navegador).
 */
export function validarCobroPos(
  e: { metodo: unknown; referencia?: unknown; recibido?: unknown },
  total: Prisma.Decimal
): { ok: true; cobro: CobroPos } | { ok: false; error: string } {
  if (!esMetodoPos(e.metodo)) return { ok: false, error: 'Elige cómo paga: efectivo, transferencia o tarjeta.' }
  const metodo = e.metodo
  const referencia = typeof e.referencia === 'string' && e.referencia.trim() !== '' ? e.referencia.trim().replace(/\s+/g, ' ') : null
  if (referencia && referencia.length > REFERENCIA_PAGO_MAXIMA) return { ok: false, error: `La referencia admite como máximo ${REFERENCIA_PAGO_MAXIMA} caracteres.` }

  if (metodo !== 'EFECTIVO') {
    if (!referencia) {
      return { ok: false, error: metodo === 'TRANSFERENCIA' ? 'Escribe el número de referencia de la transferencia.' : 'Escribe el número de autorización de la tarjeta.' }
    }
    return { ok: true, cobro: { metodo, referencia, recibido: null, cambio: null } }
  }

  // Efectivo: la referencia no hace falta (y si llega, se conserva como nota). Si se dice cuánto entregó el cliente, tiene que alcanzar.
  const crudo = typeof e.recibido === 'string' ? e.recibido.trim() : typeof e.recibido === 'number' ? String(e.recibido) : ''
  if (crudo === '') return { ok: true, cobro: { metodo, referencia, recibido: null, cambio: null } }
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(crudo)) return { ok: false, error: 'Escribe cuánto entregó el cliente como un número (por ejemplo 500).' }
  const recibido = new Prisma.Decimal(crudo)
  if (recibido.lessThan(total)) return { ok: false, error: `Lo recibido (${recibido.toFixed(2)}) no alcanza para ${total.toFixed(2)}.` }
  return { ok: true, cobro: { metodo, referencia, recibido, cambio: recibido.minus(total) } }
}

// ── Carrito de mostrador ─────────────────────────────────────────────────────

export const MAX_LINEAS_MOSTRADOR = 40
export const MAX_CANTIDAD_MOSTRADOR = 999

export interface LineaDeMostrador {
  varianteId: string
  cantidad: number
}

/** Valida y une el carrito que manda el navegador. Los precios NO viajan: salen del catálogo. */
export function validarCarrito(lineas: unknown): { ok: true; lineas: LineaDeMostrador[] } | { ok: false; error: string } {
  if (!Array.isArray(lineas) || lineas.length === 0) return { ok: false, error: 'Agrega al menos un producto o servicio.' }
  if (lineas.length > MAX_LINEAS_MOSTRADOR) return { ok: false, error: `Una venta admite como máximo ${MAX_LINEAS_MOSTRADOR} renglones.` }
  const porVariante = new Map<string, number>()
  for (const l of lineas) {
    const varianteId = typeof l?.varianteId === 'string' ? l.varianteId : ''
    const cantidad = Number(l?.cantidad)
    if (!varianteId) return { ok: false, error: 'Un renglón no indica qué se vende.' }
    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > MAX_CANTIDAD_MOSTRADOR) {
      return { ok: false, error: `La cantidad tiene que ser un entero entre 1 y ${MAX_CANTIDAD_MOSTRADOR}.` }
    }
    porVariante.set(varianteId, (porVariante.get(varianteId) ?? 0) + cantidad)
  }
  for (const n of porVariante.values()) if (n > MAX_CANTIDAD_MOSTRADOR) return { ok: false, error: `Una venta admite como máximo ${MAX_CANTIDAD_MOSTRADOR} unidades por producto.` }
  return { ok: true, lineas: [...porVariante.entries()].map(([varianteId, cantidad]) => ({ varianteId, cantidad })) }
}

/** La identidad de la ficha compartida de quien paga sin que se le anote. Una por empresa. */
export const ID_CLIENTE_DE_MOSTRADOR = 'local:mostrador'
export const NOMBRE_CLIENTE_DE_MOSTRADOR = 'Cliente de mostrador (sin registro)'

/** Clave de idempotencia de una venta de mostrador: el mismo envío del formulario no vende dos veces. */
export function claveDeVenta(cajaSesionId: string, claveDelEnvio: string): string {
  return `pos:${cajaSesionId}:${claveDelEnvio}`
}

export function claveDelEnvioValida(k: unknown): k is string {
  return typeof k === 'string' && k.length >= 8 && k.length <= 80 && /^[A-Za-z0-9_-]+$/.test(k)
}
