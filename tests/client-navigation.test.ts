import { test } from 'node:test'
import assert from 'node:assert/strict'
import { goBackOr, resolveBackAction } from '../apps/client/src/lib/navigation'

test('deep-linked plan detail replaces instead of dispatching GO_BACK without history', () => {
  assert.deepEqual(resolveBackAction(false, '/planes'), {
    type: 'replace',
    href: '/planes',
  })
})

test('stacked plan detail keeps normal back navigation', () => {
  assert.deepEqual(resolveBackAction(true, '/planes'), {
    type: 'back',
  })
})

test('goBackOr uses the navigation history when it exists', () => {
  const calls: string[] = []
  const router = {
    canGoBack: () => true,
    back: () => calls.push('back'),
    replace: (href: string) => calls.push(`replace:${href}`),
  }

  goBackOr(router, '/planes')

  assert.deepEqual(calls, ['back'])
})

test('goBackOr uses the fallback only for a deep link without history', () => {
  const calls: string[] = []
  const router = {
    canGoBack: () => false,
    back: () => calls.push('back'),
    replace: (href: string) => calls.push(`replace:${href}`),
  }

  goBackOr(router, '/planes')

  assert.deepEqual(calls, ['replace:/planes'])
})
