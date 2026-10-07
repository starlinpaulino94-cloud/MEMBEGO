import assert from 'node:assert/strict'
import { test } from 'node:test'
import { brandColor, brandForeground, hasBrandColor } from '../apps/client/src/lib/brand-color'

test('brandColor expands short hex and preserves full hex', () => {
  assert.equal(brandColor('#aBc', '#5b21b6'), '#aabbcc')
  assert.equal(brandColor('#123456', '#5b21b6'), '#123456')
})

test('brandColor uses the screen fallback for missing and invalid values', () => {
  assert.equal(brandColor(null, '#5b21b6'), '#5b21b6')
  assert.equal(brandColor('#12xz89', '#5b21b6'), '#5b21b6')
  assert.equal(hasBrandColor('#abc'), true)
  assert.equal(hasBrandColor('#123456'), true)
  assert.equal(hasBrandColor('blue'), false)
})

test('brandForeground selects readable text for light and dark brand surfaces', () => {
  assert.equal(brandForeground('#fff', '#5b21b6'), '#111827')
  assert.equal(brandForeground('#000', '#5b21b6'), '#ffffff')
})
