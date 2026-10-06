import type { SupplyV2Bucket, SupplyV2LedgerEntryType } from '@prisma/client'
import {
  type TraspasoPermitido,
  cubetasVaciasGenerico,
  sumaCubetasGenerico,
  validarMovimientoGenerico,
  aplicarMovimientoGenerico,
  saldoDeAsientosGenerico,
  invarianteCumplidoGenerico,
} from '@/lib/commerce-primitives/ledger'

/**
 * MEMBEGO SUPPLY 2.0 · EL LEDGER (Slice 1).
 *
 * PURO: sin Prisma, sin base de datos. Decide qué asiento es válido y qué
 * deja en las cubetas. Lo que escribe en la base es `pool/lotes.ts`.
 *
 * Un asiento es un TRASLADO: `quantity` unidades salen de `sourceBucket` y
 * entran en `destinationBucket`. Origen nulo = entran al lote desde fuera
 * (recepción); destino nulo = salen del lote (transferencia).
 *
 * EL INVARIANTE
 *
 *   quantityReceived = AVAILABLE + ALLOCATED + RESERVED + ISSUED + REDEEMED + CLOSED
 *
 * Con traslados se cumple solo: cada asiento resta de una cubeta lo que suma
 * a otra. Los contadores del lote son caché; la suma de asientos es la verdad.
 *
 * La mecánica de cubetas genéricas (suma, validación, aplicación, invariante)
 * vive en src/lib/commerce-primitives/ledger.ts (Fase 0); las 6 cubetas y la
 * tabla de traslados de abajo son el modelo específico de Supply V2.
 */

export const BUCKETS: readonly SupplyV2Bucket[] = [
  'AVAILABLE',
  'ALLOCATED',
  'RESERVED',
  'ISSUED',
  'REDEEMED',
  'CLOSED',
]

export type Buckets = Record<SupplyV2Bucket, number>

export interface LedgerMove {
  type: SupplyV2LedgerEntryType
  sourceBucket: SupplyV2Bucket | null
  destinationBucket: SupplyV2Bucket | null
  quantity: number
  reason?: string | null
}

/**
 * Traslados permitidos por tipo. Un tipo que no declare aquí su traslado se
 * rechaza. El Slice 1 solo usa RECEIPT, ADJUSTMENT y CANCELLATION; el resto
 * queda declarado para que el ledger no cambie de forma cuando llegue el
 * Slice 2, pero ningún flujo los escribe todavía.
 */
export const MOVIMIENTOS_PERMITIDOS: Record<
  SupplyV2LedgerEntryType,
  readonly TraspasoPermitido<SupplyV2Bucket>[]
> = {
  RECEIPT: [{ source: null, destination: 'AVAILABLE' }],
  ALLOCATION: [{ source: 'AVAILABLE', destination: 'ALLOCATED' }],
  RELEASE_ALLOCATION: [{ source: 'ALLOCATED', destination: 'AVAILABLE' }],
  RESERVATION: [
    { source: 'AVAILABLE', destination: 'RESERVED' },
    { source: 'ALLOCATED', destination: 'RESERVED' },
  ],
  RELEASE_RESERVATION: [
    { source: 'RESERVED', destination: 'AVAILABLE' },
    { source: 'RESERVED', destination: 'ALLOCATED' },
  ],
  ISSUE: [
    { source: 'AVAILABLE', destination: 'ISSUED' },
    { source: 'ALLOCATED', destination: 'ISSUED' },
    { source: 'RESERVED', destination: 'ISSUED' },
  ],
  REDEMPTION: [{ source: 'ISSUED', destination: 'REDEEMED' }],
  REVERSAL: [{ source: 'REDEEMED', destination: 'ISSUED' }],
  EXPIRATION: [
    { source: 'AVAILABLE', destination: 'CLOSED' },
    { source: 'ALLOCATED', destination: 'CLOSED' },
    { source: 'RESERVED', destination: 'CLOSED' },
    { source: 'ISSUED', destination: 'CLOSED' },
  ],
  CANCELLATION: [
    { source: 'AVAILABLE', destination: 'CLOSED' },
    { source: 'ALLOCATED', destination: 'CLOSED' },
    { source: 'RESERVED', destination: 'CLOSED' },
    { source: 'ISSUED', destination: 'CLOSED' },
  ],
  /** Comodín con motivo obligatorio: corrige un descuadre entre dos cubetas. */
  ADJUSTMENT: [],
  TRANSFER: [
    { source: 'AVAILABLE', destination: null },
    { source: null, destination: 'AVAILABLE' },
  ],
}

export const TIPOS_CON_MOTIVO_OBLIGATORIO: readonly SupplyV2LedgerEntryType[] = [
  'ADJUSTMENT',
  'CANCELLATION',
  'REVERSAL',
]

export function cubetasVacias(): Buckets {
  return cubetasVaciasGenerico(BUCKETS)
}

/** Lee las cubetas de una fila de lote (o de cualquier objeto con esos campos). */
export function cubetasDeLote(l: {
  quantityAvailable: number
  quantityAllocated: number
  quantityReserved: number
  quantityIssued: number
  quantityRedeemed: number
  quantityClosed: number
}): Buckets {
  return {
    AVAILABLE: l.quantityAvailable,
    ALLOCATED: l.quantityAllocated,
    RESERVED: l.quantityReserved,
    ISSUED: l.quantityIssued,
    REDEEMED: l.quantityRedeemed,
    CLOSED: l.quantityClosed,
  }
}

export function sumaCubetas(b: Buckets): number {
  return sumaCubetasGenerico(BUCKETS, b)
}

/** Devuelve el mensaje de error o `null` si el asiento es válido en abstracto. */
export function validarMovimiento(m: LedgerMove): string | null {
  return validarMovimientoGenerico(m, MOVIMIENTOS_PERMITIDOS, TIPOS_CON_MOTIVO_OBLIGATORIO, 'ADJUSTMENT')
}

/**
 * Aplica un traslado y devuelve las cubetas resultantes. Lanza si el asiento
 * no es válido o dejaría una cubeta en negativo. No muta la entrada.
 */
export function aplicarMovimiento(antes: Buckets, m: LedgerMove): Buckets {
  return aplicarMovimientoGenerico(antes, m, MOVIMIENTOS_PERMITIDOS, TIPOS_CON_MOTIVO_OBLIGATORIO, 'ADJUSTMENT')
}

/** Lo recibido según las cubetas: lo que entró menos lo que salió del lote. */
export function saldoDeAsientos(
  asientos: readonly Pick<LedgerMove, 'sourceBucket' | 'destinationBucket' | 'quantity'>[]
): Buckets {
  return saldoDeAsientosGenerico(BUCKETS, asientos)
}

/** El invariante del lote, para validarlo en dominio y en prueba. */
export function invarianteCumplido(quantityReceived: number, b: Buckets): boolean {
  return invarianteCumplidoGenerico(BUCKETS, quantityReceived, b)
}
