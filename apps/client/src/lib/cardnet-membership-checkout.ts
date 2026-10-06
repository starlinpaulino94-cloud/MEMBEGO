import type { CardnetPaymentStatus, CardnetSessionTarget } from './api'

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
