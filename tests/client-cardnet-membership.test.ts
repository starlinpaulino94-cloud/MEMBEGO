import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CardnetPaymentStatus, CardnetSessionStartResult } from '../apps/client/src/lib/api'
import { isCardnetServerApproved, membershipCardnetStartAction, membershipCardnetTarget } from '../apps/client/src/lib/cardnet-membership-checkout'

test('unchecked consent does not request renewal storage', () => {
  assert.deepEqual(membershipCardnetTarget('membership-1', true, false), {
    kind: 'membership',
    membershipId: 'membership-1',
  })
})

test('affirmative consent on a membership purchase requests renewal storage', () => {
  assert.deepEqual(membershipCardnetTarget('membership-1', true, true), {
    kind: 'membership',
    membershipId: 'membership-1',
    guardarParaRenovacion: true,
  })
})

test('plan changes cannot request renewal storage', () => {
  assert.deepEqual(membershipCardnetTarget('membership-1', false, true), {
    kind: 'membership',
    membershipId: 'membership-1',
  })
})

test('pending server status is not approval', () => {
  const status: CardnetPaymentStatus = { status: 'pending' }
  assert.equal(isCardnetServerApproved(status), false)
})

test('server-approved status is approval', () => {
  const status: CardnetPaymentStatus = { status: 'approved' }
  assert.equal(isCardnetServerApproved(status), true)
})

test('processing session-start result resumes server status instead of opening capture', () => {
  const result: CardnetSessionStartResult = { status: 'processing', sessionId: 'in-flight-session' }
  assert.deepEqual(membershipCardnetStartAction(result), {
    kind: 'resume',
    sessionId: 'in-flight-session',
  })
})
