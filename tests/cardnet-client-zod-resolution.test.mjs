import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const clientManifestPath = fileURLToPath(new URL('../apps/client/package.json', import.meta.url))
const clientRequire = createRequire(clientManifestPath)
const resolvedZodPath = clientRequire.resolve('zod')
const resolvedZodManifestPath = path.join(path.dirname(resolvedZodPath), 'package.json')
const clientZod = clientRequire('zod')
const [clientManifestText, resolvedZodManifestText] = await Promise.all([
  readFile(clientManifestPath, 'utf8'),
  readFile(resolvedZodManifestPath, 'utf8'),
])
const clientManifest = JSON.parse(clientManifestText)
const resolvedZodManifest = JSON.parse(resolvedZodManifestText)

test('Expo client runtime resolves Zod 4 datetime support', () => {
  assert.match(resolvedZodManifest.version, /^4\./)
  assert.equal(typeof clientZod.iso?.datetime, 'function')
})

test('Expo client declares Zod 4 as a direct runtime dependency', () => {
  assert.match(clientManifest.dependencies?.zod ?? '', /^[~^]?4(?:\.|$)/)
})
