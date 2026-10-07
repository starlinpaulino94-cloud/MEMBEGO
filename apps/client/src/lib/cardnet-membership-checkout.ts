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
  canSaveForRenewal: boolean,
  renewalConsent: boolean,
): CardnetSessionTarget {
  if (canSaveForRenewal && renewalConsent) {
    return { kind: 'membership', membershipId, guardarParaRenovacion: true }
  }

  return { kind: 'membership', membershipId }
}

export function isCardnetServerApproved(status: CardnetPaymentStatus): boolean {
  return status.status === 'approved'
}
