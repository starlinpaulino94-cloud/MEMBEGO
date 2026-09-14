import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';

test('bitmap measurements preserve native dimensions and count exact anchor colors', async () => {
  // Given: two rows start with primary; the third starts with the conflicting blue.
  const bytes = await sharp(Buffer.from([0,97,148, 0,97,148, 0,97,148, 2,132,199, 2,132,199, 2,132,199]),
    { raw: { width: 2, height: 3, channels: 3 } }).png().toBuffer();
  const { inspectBitmap } = await import('../scripts/visual/reference-geometry.js');
  // When: inspect without resizing or interpreting bitmap pixels as CSS.
  const result = await inspectBitmap(bytes);
  // Then: exact source coordinates and channel values survive.
  assert.deepEqual(result.dimensions, { width: 2, height: 3 });
  assert.equal(result.leadingLeftEdgeRun, 2);
  assert.deepEqual(result.colorCounts, { '#006194': 3, '#0284c7': 3 });
});

for (const args of [['--help'], []]) {
  test(`geometry CLI validates arguments when given ${JSON.stringify(args)}`, () => {
    // Given: the installed Node/tsx runner, with no application or browser fixture.
    const tsx = createRequire(import.meta.url).resolve('tsx/cli');
    // When: request help or omit the required isolated-browser parameters.
    const result = spawnSync(process.execPath, [tsx, 'scripts/visual/reference-geometry.ts', ...args], { encoding: 'utf8' });
    // Then: help is available and invalid input fails before any rendering.
    assert.equal(result.status, args.length ? 0 : 2, result.stdout + result.stderr);
  });
}
