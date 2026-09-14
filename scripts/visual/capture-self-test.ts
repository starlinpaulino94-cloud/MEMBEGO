import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { chromium } from '@playwright/test';
import { captureSchema, VisualError } from './contracts.js';
import { createEvidenceDirectory } from './evidence.js';
import { sha256 } from './reference.js';

const fixture = `<!doctype html><html lang="en"><meta charset="utf-8">
<title>TOOLING_SELF_TEST</title><style>
body{margin:0;padding:24px;background:white;color:#111;font:16px Arial,sans-serif}
h1{font-size:18px;margin:0 0 16px}p{margin:16px 0}#sample{width:100px;height:40px;background:rgb(0,96,144)}
</style><h1>TOOLING_SELF_TEST</h1><div id="sample"></div><p>Isolated pixel comparator fixture.</p></html>`;

async function main(): Promise<void> {
  const { values } = parseArgs({ options: {
    browser: { type: 'string' }, out: { type: 'string' }, help: { type: 'boolean' },
  }, strict: true, allowPositionals: false });
  if (values.help) {
    console.log('node node_modules/tsx/dist/cli.mjs scripts/visual/capture-self-test.ts --browser EXISTING_EXECUTABLE --out NEW_EVIDENCE_DIRECTORY');
    return;
  }
  if (!values.browser || !existsSync(values.browser)) throw new VisualError('BROWSER_UNAVAILABLE', 'Provide an existing browser executable; no installation is attempted');
  if (!values.out) throw new VisualError('INVALID_ARGUMENT', '--out is required');
  const output = await createEvidenceDirectory(values.out);
  const browser = await chromium.launch({ executablePath: values.browser, headless: true, timeout: 20_000 });
  try {
    const context = await browser.newContext({ locale: 'en-US', timezoneId: 'UTC', deviceScaleFactor: 1,
      colorScheme: 'light', reducedMotion: 'reduce', offline: true, serviceWorkers: 'block' });
    await context.route('**/*', (route) => route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    for (const width of [390, 768, 1280]) {
      await page.setViewportSize({ width, height: 240 });
      await page.setContent(fixture);
      await page.evaluate(async () => { await document.fonts.ready; });
      for (const variant of ['reference', 'actual', 'changed']) {
        if (variant === 'changed') await page.locator('#sample').evaluate((element) => { element.style.background = 'rgb(192,32,48)'; });
        const bytes = await page.screenshot({ animations: 'disabled', caret: 'hide', scale: 'css', fullPage: false });
        const png = join(output, `${width}-${variant}.png`);
        await writeFile(png, bytes, { flag: 'wx' });
        const metadata = captureSchema.parse({ label: 'TOOLING_SELF_TEST', sha256: sha256(bytes),
          browser: 'chromium', version: browser.version(), viewport: { width, height: 240 }, dpr: 1,
          locale: 'en-US', timezone: 'UTC', fontsReady: await page.evaluate(() => document.fonts.status === 'loaded'),
          animationPolicy: 'disabled', scale: 'css', fullPage: false, capturedAt: new Date().toISOString() });
        await writeFile(join(output, `${width}-${variant}.json`), JSON.stringify({ ...metadata,
          fixtureHash: sha256(Buffer.from(fixture)), captureScriptHash: sha256(await readFile('scripts/visual/capture-self-test.ts')),
          networkPolicy: 'offline; all routes aborted', browserExecutable: values.browser,
        }, null, 2), { flag: 'wx' });
      }
      for (const variant of ['actual', 'changed']) {
        const result = spawnSync(process.execPath, [createRequire(import.meta.url).resolve('tsx/cli'), 'scripts/visual/compare.ts',
          '--self-test-reference', join(output, `${width}-reference.png`),
          '--actual', join(output, `${width}-${variant}.png`), '--metadata', join(output, `${width}-${variant}.json`),
          '--out', join(output, `${width}-${variant}-comparison`)], { encoding: 'utf8', timeout: 30_000 });
        await writeFile(join(output, `${width}-${variant}.log`), `${result.stdout}\n${result.stderr}`, { flag: 'wx' });
        if (result.status !== (variant === 'actual' ? 0 : 1)) {
          throw new VisualError('SELF_TEST_FAILED', `Unexpected comparator exit for ${width}/${variant}: ${result.status}`);
        }
      }
    }
    console.log(JSON.stringify({ label: 'TOOLING_SELF_TEST', output, viewports: [390, 768, 1280],
      comparisons: 6, fidelityApproval: 'NOT_GRANTED' }));
  } finally {
    await browser.close();
    await writeFile(join(output, 'cleanup.json'), JSON.stringify({ browserClosed: true,
      appServerStarted: false, databaseTouched: false, networkFixtures: false,
      retained: 'Nine synthetic PNGs, metadata and six comparisons; no product baselines',
    }, null, 2), { flag: 'wx' });
  }
}

main().catch((error: unknown) => {
  if (!(error instanceof Error)) throw error;
  console.error(JSON.stringify({ reason: error instanceof VisualError ? error.code : 'CAPTURE_FAILED', detail: error.message }));
  process.exitCode = 2;
});
