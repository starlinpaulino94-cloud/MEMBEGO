import type {
  CardnetCaptureSession,
  CardnetPaymentStatus,
  CardnetSessionStartResult,
  CardnetSessionTarget,
} from './api'

export type MembershipCardnetStartAction =
  | { kind: 'capture'; session: CardnetCaptureSession }
  | { kind: 'resume'; sessionId: string }

export function membershipCardnetStartAction(
  result: CardnetSessionStartResult,
): MembershipCardnetStartAction {
  if ('captureNonce' in result) {
    return { kind: 'capture', session: result }
  }

  return { kind: 'resume', sessionId: result.sessionId }
}

export function membershipCardnetTarget(
  membershipId: string,
  canSaveCard: boolean,
  saveCardConsent: boolean,
  savedCardId?: string | null,
): CardnetSessionTarget {
  if (savedCardId) return { kind: 'membership', membershipId, tarjetaGuardadaId: savedCardId }
  if (canSaveCard && saveCardConsent) {
    return { kind: 'membership', membershipId, guardarTarjeta: true }
  }

  return { kind: 'membership', membershipId }
}

export function isCardnetServerApproved(status: CardnetPaymentStatus): boolean {
  return status.status === 'approved'
}
