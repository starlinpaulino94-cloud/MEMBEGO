/**
 * COMMERCE CORE · Merchant Billing — textos y formato para la interfaz.
 *
 * Puro y SIN runtime de Prisma: lo importan también los componentes de cliente (que
 * no pueden importar el servicio ni las lecturas, arrastrarían Prisma al navegador).
 * Solo tipos del cliente de Prisma.
 */
import type { MerchantBillingStatus, MerchantFeeModel, MerchantLedgerEntryType } from '@prisma/client'

export const ETIQUETA_TIPO_ASIENTO: Record<MerchantLedgerEntryType, string> = {
  REDEMPTION_FEE: 'Comisión por canje (CPA)',
  ORDER_FEE: 'Comisión por pedido',
  REFUND: 'Reverso de comisión',
  ADJUSTMENT: 'Ajuste',
  PAYMENT: 'Pago de la empresa',
  CREDIT: 'Crédito a favor',
  PROMOTIONAL_CREDIT: 'Crédito promocional',
  VERIFICATION_ADJUSTMENT: 'Ajuste por pago verificado',
}

export const ETIQUETA_ESTADO: Record<MerchantBillingStatus, string> = {
  ACTIVE: 'Al día',
  GRACE_PERIOD: 'En gracia',
  SUSPENDED: 'Suspendida',
}

export const ETIQUETA_MODELO: Record<MerchantFeeModel, string> = {
  CPA_FIXED: 'CPA fijo por pedido',
  PERCENTAGE: 'Porcentaje del pedido',
  HYBRID: 'CPA, o porcentaje si el pago está verificado',
}

export const ETIQUETA_CICLO = { WEEKLY: 'Semanal', BIWEEKLY: 'Quincenal', MONTHLY: 'Mensual' } as const

export type VarianteBadge = 'default' | 'secondary' | 'destructive' | 'warning' | 'success' | 'outline'

export const BADGE_ESTADO_CUENTA: Record<MerchantBillingStatus, VarianteBadge> = {
  ACTIVE: 'success',
  GRACE_PERIOD: 'warning',
  SUSPENDED: 'destructive',
}

/** Qué significa cada estado, en una frase para la empresa. */
export const AYUDA_ESTADO: Record<MerchantBillingStatus, string> = {
  ACTIVE: 'Tu cuenta está dentro de su límite de crédito.',
  GRACE_PERIOD: 'Superaste tu límite de crédito. Ponte al día antes de que venza el plazo para evitar la suspensión.',
  SUSPENDED: 'Tu cuenta está suspendida: no puedes crear campañas con presupuesto hasta ponerte al día. Tus pedidos y clientes no se afectan.',
}

const NUMERO = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Un monto (texto de dos decimales) para mostrar: `RD$ 1,234.50`, `−RD$ 30.00`. Solo presentación. */
export function formatoMonto(m: string | number, moneda = 'DOP'): string {
  const n = Number(m)
  if (!Number.isFinite(n)) return '—'
  const simbolo = moneda === 'DOP' ? 'RD$' : moneda
  return `${n < 0 ? '−' : ''}${simbolo} ${NUMERO.format(Math.abs(n))}`
}

const FECHA = new Intl.DateTimeFormat('es-DO', { timeZone: 'America/Santo_Domingo', day: '2-digit', month: 'short', year: 'numeric' })
const FECHA_HORA = new Intl.DateTimeFormat('es-DO', { timeZone: 'America/Santo_Domingo', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export const formatearFecha = (d: Date | string) => FECHA.format(new Date(d))
export const formatearFechaHora = (d: Date | string) => FECHA_HORA.format(new Date(d))

/** El periodo de un corte: inicio incluido y fin excluido → «1 ene 2031 – 31 ene 2031». */
export function etiquetaDePeriodo(inicio: Date | string, fin: Date | string): string {
  const ultimoDia = new Date(new Date(fin).getTime() - 1)
  return `${formatearFecha(inicio)} – ${formatearFecha(ultimoDia)}`
}
