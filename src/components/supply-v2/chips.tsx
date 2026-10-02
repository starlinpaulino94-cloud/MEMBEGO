import type { SupplyV2CustomerMembershipStatus, SupplyV2LoyaltyProgramStatus, SupplyV2MembershipPlanStatus, SupplyV2RewardClaimStatus, SupplyV2RewardStatus, SupplyV2ReferralStatus, SupplyV2CampaignStatus, SupplyV2CouponKind, SupplyV2CouponStatus, SupplyV2AgreementStatus, SupplyV2BenefitFunding, SupplyV2BenefitReservationStatus, SupplyV2BenefitStatus, SupplyV2CustomerBenefitStatus, SupplyV2CustomerOrderStatus, SupplyV2EntitlementStatus, SupplyV2LotStatus, SupplyV2OfferStatus, SupplyV2PurchaseOrderStatus, SupplyV2SupplierStatus } from '@prisma/client'
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
  BENEFIT_FUNDING_LABELS,
  BENEFIT_RESERVATION_STATUS_LABELS,
  BENEFIT_STATUS_LABELS,
  BENEFIT_STATUS_TONE,
  CUSTOMER_BENEFIT_STATUS_LABELS,
  CAMPAIGN_STATUS_LABELS,
  CAMPAIGN_STATUS_TONE,
  COUPON_KIND_LABELS,
  COUPON_STATUS_LABELS,
  COUPON_STATUS_TONE,
  LOYALTY_PROGRAM_STATUS_LABELS,
  LOYALTY_PROGRAM_STATUS_TONE,
  MEMBERSHIP_PLAN_STATUS_LABELS,
  MEMBERSHIP_PLAN_STATUS_TONE,
  MEMBERSHIP_STATUS_LABELS,
  MEMBERSHIP_STATUS_TONE,
  REFERRAL_STATUS_LABELS,
  REFERRAL_STATUS_TONE,
  REWARD_CLAIM_STATUS_LABELS,
  REWARD_CLAIM_STATUS_TONE,
  REWARD_STATUS_LABELS,
  REWARD_STATUS_TONE,
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

// ── Slice 6 · beneficios económicos (§29, §31, §32) ─────────────────────────

export function ChipBeneficio({ estado }: { estado: SupplyV2BenefitStatus }) {
  return (
    <StatusChip tone={BENEFIT_STATUS_TONE[estado]} pulso={estado === 'ACTIVE'} data-testid="estado-beneficio">
      {BENEFIT_STATUS_LABELS[estado]}
    </StatusChip>
  )
}

/** Quién financia: se dice siempre, para que nadie confunda un bono con un descuento del proveedor (§4). */
export function ChipFinanciacion({ funding }: { funding: SupplyV2BenefitFunding }) {
  const tone = funding === 'MEMBEGO' ? 'info' : funding === 'SUPPLIER' ? 'neutral' : 'warning'
  return (
    <StatusChip tone={tone} data-testid="chip-financiacion">
      {BENEFIT_FUNDING_LABELS[funding]}
    </StatusChip>
  )
}

export function ChipAsignacion({ estado }: { estado: SupplyV2CustomerBenefitStatus }) {
  const tone = estado === 'AVAILABLE' ? 'success' : estado === 'EXHAUSTED' ? 'info' : estado === 'CANCELLED' ? 'danger' : 'neutral'
  return (
    <StatusChip tone={tone} data-testid="estado-asignacion">
      {CUSTOMER_BENEFIT_STATUS_LABELS[estado]}
    </StatusChip>
  )
}

export function ChipReservaBeneficio({ estado }: { estado: SupplyV2BenefitReservationStatus }) {
  const tone = estado === 'APPLIED' ? 'success' : estado === 'ACTIVE' ? 'warning' : estado === 'REVERSED' ? 'danger' : 'neutral'
  return (
    <StatusChip tone={tone} data-testid="estado-reserva-beneficio">
      {BENEFIT_RESERVATION_STATUS_LABELS[estado]}
    </StatusChip>
  )
}

// ── Slice 7 · campañas y cupones (§18, §21, §26) ────────────────────────────

export function ChipCampana({ estado }: { estado: SupplyV2CampaignStatus }) {
  return (
    <StatusChip tone={CAMPAIGN_STATUS_TONE[estado]} pulso={estado === 'ACTIVE'} data-testid="estado-campana">
      {CAMPAIGN_STATUS_LABELS[estado]}
    </StatusChip>
  )
}

export function ChipCupon({ estado }: { estado: SupplyV2CouponStatus }) {
  return (
    <StatusChip tone={COUPON_STATUS_TONE[estado]} data-testid="estado-cupon">
      {COUPON_STATUS_LABELS[estado]}
    </StatusChip>
  )
}

/** Público o privado: se dice siempre, porque cambia quién puede usarlo. */
export function ChipTipoCupon({ kind }: { kind: SupplyV2CouponKind }) {
  return (
    <StatusChip tone={kind === 'PUBLIC' ? 'info' : 'neutral'} data-testid="tipo-cupon">
      {COUPON_KIND_LABELS[kind]}
    </StatusChip>
  )
}

// ── Slice 8 · fidelización ──────────────────────────────────────────────────

export function ChipPrograma({ estado }: { estado: SupplyV2LoyaltyProgramStatus }) {
  return (
    <StatusChip tone={LOYALTY_PROGRAM_STATUS_TONE[estado]} pulso={estado === 'PENDING_APPROVAL'} data-testid="estado-programa">
      {LOYALTY_PROGRAM_STATUS_LABELS[estado]}
    </StatusChip>
  )
}

export function ChipPlan({ estado }: { estado: SupplyV2MembershipPlanStatus }) {
  return (
    <StatusChip tone={MEMBERSHIP_PLAN_STATUS_TONE[estado]} data-testid="estado-plan">
      {MEMBERSHIP_PLAN_STATUS_LABELS[estado]}
    </StatusChip>
  )
}

export function ChipMembresia({ estado }: { estado: SupplyV2CustomerMembershipStatus }) {
  return (
    <StatusChip tone={MEMBERSHIP_STATUS_TONE[estado]} data-testid="estado-membresia">
      {MEMBERSHIP_STATUS_LABELS[estado]}
    </StatusChip>
  )
}

export function ChipRecompensa({ estado }: { estado: SupplyV2RewardStatus }) {
  return (
    <StatusChip tone={REWARD_STATUS_TONE[estado]} data-testid="estado-recompensa">
      {REWARD_STATUS_LABELS[estado]}
    </StatusChip>
  )
}

export function ChipReclamacion({ estado }: { estado: SupplyV2RewardClaimStatus }) {
  return <StatusChip tone={REWARD_CLAIM_STATUS_TONE[estado]}>{REWARD_CLAIM_STATUS_LABELS[estado]}</StatusChip>
}

export function ChipReferido({ estado }: { estado: SupplyV2ReferralStatus }) {
  return (
    <StatusChip tone={REFERRAL_STATUS_TONE[estado]} data-testid="estado-referido">
      {REFERRAL_STATUS_LABELS[estado]}
    </StatusChip>
  )
}
