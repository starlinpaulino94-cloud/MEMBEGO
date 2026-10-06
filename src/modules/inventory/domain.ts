import type { InventoryBucket, InventoryMovementType } from '@prisma/client'
import {
  type TraspasoPermitido,
  aplicarMovimientoGenerico,
  cubetasVaciasGenerico,
  invarianteCumplidoGenerico,
  saldoDeAsientosGenerico,
  sumaCubetasGenerico,
  validarMovimientoGenerico,
} from '@/lib/commerce-primitives/ledger'

/**
 * COMMERCE CORE · inventario — el dominio PURO (Fase 2).
 *
 * Sin Prisma ni base de datos: decide qué movimiento es válido y qué deja en
 * las cubetas. Lo que escribe en la base es `service.ts`.
 *
 * Un movimiento es un TRASLADO entre tres cubetas (la mecánica genérica vive en
 * `lib/commerce-primitives/ledger`, la misma que usa Supply V2):
 *
 *   AVAILABLE  se puede vender
 *   RESERVED   apartado, con una reserva viva detrás
 *   DAMAGED    está en la sucursal pero no se vende
 *
 *   onHand    = AVAILABLE + RESERVED
 *   available = onHand − reserved   (= la cubeta AVAILABLE)
 *
 * El invariante «available nunca negativo» sale solo del ledger: un traslado
 * que dejaría una cubeta por debajo de cero se rechaza.
 *
 * La tabla de traslados permitidos tiene su gemela en la base (CHECK
 * `inventory_movements_traslado`, migración 20261038); una prueba contra
 * PostgreSQL recorre las 144 combinaciones tipo×origen×destino para que no se
 * separen.
 */

export const BUCKETS: readonly InventoryBucket[] = ['AVAILABLE', 'RESERVED', 'DAMAGED']
export type Cubetas = Record<InventoryBucket, number>

export const TIPOS_DE_MOVIMIENTO: readonly InventoryMovementType[] = [
  'PURCHASE',
  'SALE',
  'RETURN',
  'TRANSFER_IN',
  'TRANSFER_OUT',
  'ADJUSTMENT',
  'DAMAGE',
  'RESERVATION',
  'RESERVATION_RELEASE',
]

export interface Movimiento {
  type: InventoryMovementType
  sourceBucket: InventoryBucket | null
  destinationBucket: InventoryBucket | null
  quantity: number
  reason?: string | null
}

export const MOVIMIENTOS_PERMITIDOS: Record<InventoryMovementType, readonly TraspasoPermitido<InventoryBucket>[]> = {
  /** Llega mercancía: entra de fuera a vendible. */
  PURCHASE: [{ source: null, destination: 'AVAILABLE' }],
  /** Se vende: sale de lo vendible (venta directa) o de lo apartado (venta de una reserva). */
  SALE: [
    { source: 'AVAILABLE', destination: null },
    { source: 'RESERVED', destination: null },
  ],
  /** El cliente devuelve: vuelve a lo vendible. */
  RETURN: [{ source: null, destination: 'AVAILABLE' }],
  /** Las dos patas de una transferencia entre sucursales. */
  TRANSFER_IN: [{ source: null, destination: 'AVAILABLE' }],
  TRANSFER_OUT: [{ source: 'AVAILABLE', destination: null }],
  /**
   * Corrige un descuadre con motivo obligatorio: sobrante o faltante de
   * vendible, baja de lo dañado, o lo dañado que resultó vendible. NO toca lo
   * apartado: para mover una reserva se libera o se consume.
   */
  ADJUSTMENT: [
    { source: null, destination: 'AVAILABLE' },
    { source: 'AVAILABLE', destination: null },
    { source: 'DAMAGED', destination: null },
    { source: 'DAMAGED', destination: 'AVAILABLE' },
  ],
  /** Se daña mercancía vendible. */
  DAMAGE: [{ source: 'AVAILABLE', destination: 'DAMAGED' }],
  RESERVATION: [{ source: 'AVAILABLE', destination: 'RESERVED' }],
  RESERVATION_RELEASE: [{ source: 'RESERVED', destination: 'AVAILABLE' }],
}

export const TIPOS_CON_MOTIVO_OBLIGATORIO: readonly InventoryMovementType[] = ['ADJUSTMENT', 'DAMAGE']

/** Lo máximo que mueve UN movimiento, y lo máximo que cabe en un saldo (INTEGER de la base con margen). */
export const CANTIDAD_MAXIMA = 1_000_000
export const EXISTENCIA_MAXIMA = 1_000_000_000

/** Los tres contadores de un saldo, tal como están en la tabla. */
export interface Saldo {
  onHand: number
  reserved: number
  damaged: number
}

export function cubetasVacias(): Cubetas {
  return cubetasVaciasGenerico(BUCKETS)
}

export function cubetasDeSaldo(s: Saldo): Cubetas {
  return { AVAILABLE: s.onHand - s.reserved, RESERVED: s.reserved, DAMAGED: s.damaged }
}

export function saldoDeCubetas(c: Cubetas): Saldo {
  return { onHand: c.AVAILABLE + c.RESERVED, reserved: c.RESERVED, damaged: c.DAMAGED }
}

/** Lo que se puede vender ahora: lo que hay menos lo apartado. */
export function disponible(s: Pick<Saldo, 'onHand' | 'reserved'>): number {
  return s.onHand - s.reserved
}

export function sumaCubetas(c: Cubetas): number {
  return sumaCubetasGenerico(BUCKETS, c)
}

/** Devuelve el mensaje de error o `null` si el movimiento es válido en abstracto. */
export function validarMovimiento(m: Movimiento): string | null {
  if (m.quantity > CANTIDAD_MAXIMA) return `Un movimiento no puede mover más de ${CANTIDAD_MAXIMA.toLocaleString('es-DO')} unidades.`
  return validarMovimientoGenerico(m, MOVIMIENTOS_PERMITIDOS, TIPOS_CON_MOTIVO_OBLIGATORIO)
}

/**
 * Aplica un movimiento y devuelve las cubetas resultantes. Lanza si no es
 * válido o si dejaría una cubeta en negativo (`available` nunca negativo).
 */
export function aplicarMovimiento(antes: Cubetas, m: Movimiento): Cubetas {
  const error = validarMovimiento(m)
  if (error) throw new Error(error)
  const despues = aplicarMovimientoGenerico(antes, m, MOVIMIENTOS_PERMITIDOS, TIPOS_CON_MOTIVO_OBLIGATORIO)
  if (sumaCubetas(despues) > EXISTENCIA_MAXIMA) throw new Error('La existencia en esta sucursal superaría el máximo admitido.')
  return despues
}

/** Lo que dejan los movimientos: saldo por cubeta según el ledger. */
export function saldoDeMovimientos(movs: readonly Pick<Movimiento, 'sourceBucket' | 'destinationBucket' | 'quantity'>[]): Cubetas {
  return saldoDeAsientosGenerico(BUCKETS, movs)
}

/**
 * El cuadre: los contadores del saldo son iguales a lo que suma el ledger.
 * Es la prueba de que nadie tocó el saldo por fuera de un movimiento.
 */
export function cuadra(s: Saldo, movs: readonly Pick<Movimiento, 'sourceBucket' | 'destinationBucket' | 'quantity'>[]): boolean {
  const delLedger = saldoDeMovimientos(movs)
  const delSaldo = cubetasDeSaldo(s)
  return (
    invarianteCumplidoGenerico(BUCKETS, sumaCubetas(delLedger), delSaldo) &&
    BUCKETS.every((b) => delLedger[b] === delSaldo[b])
  )
}

// ── Estado de stock ──────────────────────────────────────────────────────────

export type EstadoStock = 'AGOTADO' | 'BAJO' | 'OK'

/**
 * AGOTADO: nada vendible. BAJO: queda el umbral o menos (solo si hay umbral).
 * OK: el resto. Un umbral 0 significa «sin alerta», no «alerta con cero».
 */
export function estadoDeStock(s: Pick<Saldo, 'onHand' | 'reserved'> & { lowStockThreshold: number }): EstadoStock {
  const d = disponible(s)
  if (d <= 0) return 'AGOTADO'
  if (s.lowStockThreshold > 0 && d <= s.lowStockThreshold) return 'BAJO'
  return 'OK'
}

// ── Entradas del usuario ─────────────────────────────────────────────────────

/** Una cantidad entera de 1 a CANTIDAD_MAXIMA, o el mensaje de por qué no. */
export function validarCantidad(n: unknown): { ok: true; valor: number } | { ok: false; error: string } {
  if (typeof n !== 'number' || !Number.isFinite(n) || !Number.isInteger(n)) return { ok: false, error: 'La cantidad debe ser un número entero.' }
  if (n < 1) return { ok: false, error: 'La cantidad debe ser al menos 1.' }
  if (n > CANTIDAD_MAXIMA) return { ok: false, error: `La cantidad no puede pasar de ${CANTIDAD_MAXIMA.toLocaleString('es-DO')}.` }
  return { ok: true, valor: n }
}

/** El umbral de stock bajo: entero de 0 a CANTIDAD_MAXIMA (0 = sin alerta). */
export function validarUmbral(n: unknown): { ok: true; valor: number } | { ok: false; error: string } {
  if (typeof n !== 'number' || !Number.isFinite(n) || !Number.isInteger(n)) return { ok: false, error: 'El umbral debe ser un número entero.' }
  if (n < 0) return { ok: false, error: 'El umbral no puede ser negativo.' }
  if (n > CANTIDAD_MAXIMA) return { ok: false, error: `El umbral no puede pasar de ${CANTIDAD_MAXIMA.toLocaleString('es-DO')}.` }
  return { ok: true, valor: n }
}

export const MOTIVO_MAXIMO = 300

/** El motivo recortado, o null si está vacío; error si es demasiado largo. */
export function normalizarMotivo(m: unknown): { ok: true; valor: string | null } | { ok: false; error: string } {
  if (m === undefined || m === null) return { ok: true, valor: null }
  if (typeof m !== 'string') return { ok: false, error: 'El motivo no es válido.' }
  const t = m.trim().replace(/\s+/g, ' ')
  if (t.length > MOTIVO_MAXIMO) return { ok: false, error: `El motivo no puede pasar de ${MOTIVO_MAXIMO} caracteres.` }
  return { ok: true, valor: t === '' ? null : t }
}

// ── Reservas ─────────────────────────────────────────────────────────────────

export const TTL_POR_DEFECTO_MINUTOS = 30
export const TTL_MINIMO_MINUTOS = 1
/** 7 días: un apartado más largo es otra cosa (un pedido a medida), no una reserva de carrito. */
export const TTL_MAXIMO_MINUTOS = 7 * 24 * 60

export function validarTtl(minutos: unknown): { ok: true; valor: number } | { ok: false; error: string } {
  if (typeof minutos !== 'number' || !Number.isFinite(minutos) || !Number.isInteger(minutos)) return { ok: false, error: 'La vigencia de la reserva debe ser un número entero de minutos.' }
  if (minutos < TTL_MINIMO_MINUTOS || minutos > TTL_MAXIMO_MINUTOS) return { ok: false, error: `La vigencia de la reserva va de ${TTL_MINIMO_MINUTOS} minuto a 7 días.` }
  return { ok: true, valor: minutos }
}

export function vencimientoDeReserva(ahora: Date, minutos: number): Date {
  return new Date(ahora.getTime() + minutos * 60_000)
}

/** Una reserva ya no aparta nada pasada su hora, aunque el barrido no haya corrido. */
export function reservaVencida(expiresAt: Date, ahora: Date): boolean {
  return expiresAt.getTime() <= ahora.getTime()
}
