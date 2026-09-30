import type { SupplyV2DepositStatus, SupplyV2InvoiceStatus, SupplyV2ObligationStatus, SupplyV2ReconciliationStatus, SupplyV2SupplierPaymentStatus } from '@prisma/client'
import { StatusChip } from '@/components/ui/status-chip'
import {
  DEPOSIT_STATUS_LABELS,
  DEPOSIT_STATUS_TONE,
  INVOICE_STATUS_LABELS,
  INVOICE_STATUS_TONE,
  OBLIGATION_STATUS_LABELS,
  OBLIGATION_STATUS_TONE,
  RECONCILIATION_STATUS_LABELS,
  RECONCILIATION_STATUS_TONE,
  SUPPLIER_PAYMENT_STATUS_LABELS,
  SUPPLIER_PAYMENT_STATUS_TONE,
} from '@/modules/supply-v2/core/catalogo'

export function ChipFactura({ estado }: { estado: SupplyV2InvoiceStatus }) {
  return <StatusChip tone={INVOICE_STATUS_TONE[estado]} pulso={estado === 'PENDING_APPROVAL'} data-testid="estado-factura">{INVOICE_STATUS_LABELS[estado]}</StatusChip>
}
export function ChipDeposito({ estado }: { estado: SupplyV2DepositStatus }) {
  return <StatusChip tone={DEPOSIT_STATUS_TONE[estado]} data-testid="estado-deposito">{DEPOSIT_STATUS_LABELS[estado]}</StatusChip>
}
export function ChipPagoProveedor({ estado }: { estado: SupplyV2SupplierPaymentStatus }) {
  return <StatusChip tone={SUPPLIER_PAYMENT_STATUS_TONE[estado]} pulso={estado === 'PENDING'} data-testid="estado-pago">{SUPPLIER_PAYMENT_STATUS_LABELS[estado]}</StatusChip>
}
export function ChipObligacion({ estado }: { estado: SupplyV2ObligationStatus }) {
  return <StatusChip tone={OBLIGATION_STATUS_TONE[estado]} data-testid="estado-obligacion">{OBLIGATION_STATUS_LABELS[estado]}</StatusChip>
}
export function ChipConciliacion({ estado }: { estado: SupplyV2ReconciliationStatus }) {
  return <StatusChip tone={RECONCILIATION_STATUS_TONE[estado]} data-testid="estado-conciliacion">{RECONCILIATION_STATUS_LABELS[estado]}</StatusChip>
}
