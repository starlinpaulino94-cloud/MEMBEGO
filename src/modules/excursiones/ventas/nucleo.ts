/**
 * EXCURSIONES · Ventas — NÚCLEO PURO.
 *
 * La venta es el hecho financiero: la reserva se cobró y el dinero entró. De
 * ella nace la comisión, y por eso lleva su propio número y su propia vida —
 * una reserva se puede reabrir y renegociar; una venta, no.
 */

export const ESTADOS_VENTA = ['CONFIRMADA', 'COMPLETADA', 'CANCELADA', 'REEMBOLSADA'] as const
export type EstadoVenta = (typeof ESTADOS_VENTA)[number]

export const ESTADO_VENTA_LABEL: Record<EstadoVenta, string> = {
  CONFIRMADA: 'Confirmada',
  COMPLETADA: 'Completada',
  CANCELADA: 'Cancelada',
  REEMBOLSADA: 'Reembolsada',
}

export const TONO_VENTA: Record<EstadoVenta, 'success' | 'warning' | 'neutral' | 'info'> = {
  CONFIRMADA: 'info',
  COMPLETADA: 'success',
  CANCELADA: 'neutral',
  REEMBOLSADA: 'warning',
}

/** SAL-000184: correlativo por empresa, corto y legible en un recibo. */
export function numeroVenta(prefijo: string, n: number): string {
  const p = (prefijo || 'SAL').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'SAL'
  return `${p}-${String(Math.max(1, Math.trunc(n))).padStart(6, '0')}`
}

/**
 * La base comisionable de una venta: lo que la empresa ingresa de verdad, sin
 * el impuesto que hay que entregarle al Estado. Nunca negativa.
 */
export function baseComisionable(total: number, impuestos: number): number {
  const base = (Number(total) || 0) - (Number(impuestos) || 0)
  return Math.round(Math.max(0, base) * 100) / 100
}
