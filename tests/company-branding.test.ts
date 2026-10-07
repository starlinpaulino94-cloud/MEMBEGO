import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  normalizeCompanyBrandColor,
  withCompanyBrandColor,
} from '../src/lib/company-branding'

test('company brand colors normalize short and full hex values', () => {
  assert.equal(normalizeCompanyBrandColor(' #aBc '), '#aabbcc')
  assert.equal(normalizeCompanyBrandColor('#00AEFF'), '#00aeff')
})

test('company brand color validation rejects malformed values and allows clearing', () => {
  assert.equal(normalizeCompanyBrandColor('blue'), null)
  assert.equal(normalizeCompanyBrandColor('#12xz89'), null)
  assert.equal(normalizeCompanyBrandColor(''), null)
})

test('updating a company color keeps engagement flags synchronized', () => {
  assert.deepEqual(
    withCompanyBrandColor({ color: '#ffa200', campanas: false, popups: true }, '#00aeff'),
    { color: '#00aeff', campanas: false, popups: true },
  )
  assert.deepEqual(
    withCompanyBrandColor({ color: '#ffa200', campanas: false }, null),
    { campanas: false },
  )
})
