import type { SupplyV2PaymentMode } from '@prisma/client'

/** Forma de pago en corto, como la muestra la columna «Condición» de Stitch. */
export const CONDICION_CORTA: Record<SupplyV2PaymentMode, string> = {
  PREPAID: 'Prepagado',
  PARTIAL: 'Pago parcial',
  PAY_LATER: 'Crédito',
}

/** «Crédito 15d» cuando el acuerdo trae plazo; si no, solo la forma de pago. */
export function textoCondicion(modo: SupplyV2PaymentMode, plazoDias: number | null): string {
  return modo === 'PAY_LATER' && plazoDias ? `Crédito ${plazoDias}d` : CONDICION_CORTA[modo]
}
