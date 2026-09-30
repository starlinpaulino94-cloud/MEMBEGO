import type { SupplyV2AgreementStatus, SupplyV2CustomerOrderStatus, SupplyV2EntitlementStatus, SupplyV2LotStatus, SupplyV2OfferStatus, SupplyV2PurchaseOrderStatus, SupplyV2SupplierStatus } from '@prisma/client'
import { StatusChip } from '@/components/ui/status-chip'
import {
  AGREEMENT_STATUS_LABELS,
  CUSTOMER_ORDER_STATUS_LABELS,
  CUSTOMER_ORDER_STATUS_TONE,
  ENTITLEMENT_STATUS_LABELS,
  ENTITLEMENT_STATUS_TONE,
  LOT_STATUS_LABELS,
  OFFER_STATUS_LABELS,
  OFFER_STATUS_TONE,
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

export function ChipOferta({ estado }: { estado: SupplyV2OfferStatus }) {
  return (
    <StatusChip tone={OFFER_STATUS_TONE[estado]} pulso={estado === 'ACTIVE'} data-testid="estado-oferta">
      {OFFER_STATUS_LABELS[estado]}
    </StatusChip>
  )
}

export function ChipCompra({ estado }: { estado: SupplyV2CustomerOrderStatus }) {
  return (
    <StatusChip tone={CUSTOMER_ORDER_STATUS_TONE[estado]} pulso={estado === 'PENDING' || estado === 'AWAITING_PAYMENT'} data-testid="estado-compra">
      {CUSTOMER_ORDER_STATUS_LABELS[estado]}
    </StatusChip>
  )
}

/** Slice 3: estado del beneficio del cliente (Disponible / Utilizado / Vencido / Cancelado). */
export function ChipDerecho({ estado }: { estado: SupplyV2EntitlementStatus }) {
  return (
    <StatusChip tone={ENTITLEMENT_STATUS_TONE[estado]} data-testid="derecho-estado">
      {ENTITLEMENT_STATUS_LABELS[estado]}
    </StatusChip>
  )
}

export function ChipRedencion({ reversada }: { reversada: boolean }) {
  return (
    <StatusChip tone={reversada ? 'warning' : 'success'} data-testid="estado-redencion">
      {reversada ? 'Reversada' : 'Entregada'}
    </StatusChip>
  )
}
