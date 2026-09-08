import { test } from 'node:test'
import assert from 'node:assert/strict'
import { revisionEfectiva } from '../src/modules/home/composicion'

test('una publicación reciente prevalece aunque el borrador se creara antes', () => {
  const revisions = [
    { id: 'old-draft', estado: 'PUBLICADA' as const, createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-03-01'), programadaPara: null },
    { id: 'new-draft', estado: 'PUBLICADA' as const, createdAt: new Date('2026-02-01'), updatedAt: new Date('2026-02-02'), programadaPara: null },
  ]
  assert.equal(revisionEfectiva(revisions, new Date('2026-04-01'))?.id, 'old-draft')
})

test('pausar la composición vigente no resucita una publicación anterior', () => {
  const revisions = [
    { id: 'old', estado: 'PUBLICADA' as const, createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'), programadaPara: null },
    { id: 'paused', estado: 'PAUSADA' as const, createdAt: new Date('2026-01-02'), updatedAt: new Date('2026-03-01'), programadaPara: null },
  ]
  assert.equal(revisionEfectiva(revisions, new Date('2026-04-01')), null)
})

test('la hora programada, no la creación, decide cuándo sustituir la publicación', () => {
  const revisions = [
    { id: 'live', estado: 'PUBLICADA' as const, createdAt: new Date('2026-02-01'), updatedAt: new Date('2026-02-01'), programadaPara: null },
    { id: 'scheduled', estado: 'PROGRAMADA' as const, createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'), programadaPara: new Date('2026-03-01') },
  ]
  assert.equal(revisionEfectiva(revisions, new Date('2026-02-28'))?.id, 'live')
  assert.equal(revisionEfectiva(revisions, new Date('2026-03-01'))?.id, 'scheduled')
})
