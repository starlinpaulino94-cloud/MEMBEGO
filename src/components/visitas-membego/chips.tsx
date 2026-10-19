import type { AncillaryEvidenceLevel, AncillarySaleStatus, MembegoVisitStatus, VisitDisputeStatus } from '@prisma/client'
import { StatusChip } from '@/components/ui/status-chip'
import { DISPUTE_STATUS_LABELS, EVIDENCE_LABELS, SALE_STATUS_LABELS, VISIT_STATUS_LABELS } from '@/modules/visitas-membego/domain'

/** SUPPLIER & FULFILLMENT COMMERCE · chips de estado de la visita atribuida. */

type Tono = React.ComponentProps<typeof StatusChip>['tone']

const TONO_VISITA: Record<MembegoVisitStatus, Tono> = { OPEN: 'info', CLOSED: 'success', CANCELLED: 'neutral' }
const TONO_VENTA: Record<AncillarySaleStatus, Tono> = { REPORTED: 'info', CONFIRMED: 'success', DISPUTED: 'warning', ADJUSTED: 'warning', REVERSED: 'danger' }
const TONO_DISPUTA: Record<VisitDisputeStatus, Tono> = { OPEN: 'warning', UNDER_REVIEW: 'info', RESOLVED_MERCHANT: 'success', RESOLVED_CUSTOMER: 'success', DISMISSED: 'neutral' }
const TONO_EVIDENCIA: Record<AncillaryEvidenceLevel, Tono> = { MERCHANT_REPORTED: 'neutral', CUSTOMER_CONFIRMED: 'info', PAYMENT_VERIFIED: 'success', FISCALLY_RECONCILED: 'success' }

export function ChipVisita({ estado }: { estado: MembegoVisitStatus }) {
  return <StatusChip tone={TONO_VISITA[estado]} pulso={estado === 'OPEN'} data-testid="chip-visita">{VISIT_STATUS_LABELS[estado]}</StatusChip>
}

export function ChipVenta({ estado }: { estado: AncillarySaleStatus }) {
  return <StatusChip tone={TONO_VENTA[estado]} data-testid="chip-venta">{SALE_STATUS_LABELS[estado]}</StatusChip>
}

export function ChipDisputa({ estado }: { estado: VisitDisputeStatus }) {
  return <StatusChip tone={TONO_DISPUTA[estado]} pulso={estado === 'OPEN'} data-testid="chip-disputa">{DISPUTE_STATUS_LABELS[estado]}</StatusChip>
}

export function ChipEvidencia({ nivel }: { nivel: AncillaryEvidenceLevel }) {
  return <StatusChip tone={TONO_EVIDENCIA[nivel]} data-testid="chip-evidencia">{EVIDENCE_LABELS[nivel]}</StatusChip>
}
