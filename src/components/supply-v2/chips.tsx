import type { SupplyV2AgreementStatus, SupplyV2LotStatus, SupplyV2PurchaseOrderStatus, SupplyV2SupplierStatus } from '@prisma/client'
import { StatusChip } from '@/components/ui/status-chip'
import {
  AGREEMENT_STATUS_LABELS,
  LOT_STATUS_LABELS,
  PO_STATUS_LABELS,
  PO_STATUS_TONE,
  SUPPLIER_STATUS_LABELS,
} from '@/modules/supply-v2/core/catalogo'

export function ChipOrden({ estado }: { estado: SupplyV2PurchaseOrderStatus }) {
  return (
    <StatusChip tone={PO_STATUS_TONE[estado]} pulso={estado === 'PENDING_APPROVAL'} data-testid="estado-orden">
      {PO_STATUS_LABELS[estado]}
    </StatusChip>
  )
}

export function ChipProveedor({ estado }: { estado: SupplyV2SupplierStatus }) {
  const tone = estado === 'ACTIVE' ? 'success' : estado === 'BLOCKED' ? 'danger' : 'neutral'
  return <StatusChip tone={tone}>{SUPPLIER_STATUS_LABELS[estado]}</StatusChip>
}

export function ChipAcuerdo({ estado }: { estado: SupplyV2AgreementStatus }) {
  const tone = estado === 'ACTIVE' ? 'success' : estado === 'SUSPENDED' ? 'warning' : estado === 'TERMINATED' || estado === 'EXPIRED' ? 'danger' : 'neutral'
  return <StatusChip tone={tone}>{AGREEMENT_STATUS_LABELS[estado]}</StatusChip>
}

export function ChipLote({ estado }: { estado: SupplyV2LotStatus }) {
  const tone = estado === 'ACTIVE' ? 'success' : estado === 'EXHAUSTED' ? 'info' : estado === 'EXPIRED' || estado === 'CANCELLED' ? 'danger' : 'neutral'
  return <StatusChip tone={tone}>{LOT_STATUS_LABELS[estado]}</StatusChip>
}
