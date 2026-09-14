import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';
import sharp from 'sharp';
import { z } from 'zod';
import { createEvidenceDirectory } from './evidence.js';
import { loadReference, sha256, verifyDigest } from './reference.js';
import { comparePixels } from './pixels.js';
import { VisualError } from './contracts.js';

export async function inspectBitmap(bytes: Buffer) {
  const { data, info } = await sharp(bytes).toColourspace('srgb').removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const colorCounts = { '#006194': 0, '#0284c7': 0 };
  for (let offset = 0; offset < data.length; offset += 3) {
    const value = data.readUIntBE(offset, 3);
    if (value === 0x006194) colorCounts['#006194']++;
    if (value === 0x0284c7) colorCounts['#0284c7']++;
  }
  let leadingLeftEdgeRun = 0;
  while (leadingLeftEdgeRun < info.height && data.readUIntBE(leadingLeftEdgeRun * info.width * 3, 3) === data.readUIntBE(0, 3)) {
    leadingLeftEdgeRun++;
  }
  return { dimensions: { width: info.width, height: info.height }, colorCounts,
    topLeftColor: `#${data.readUIntBE(0, 3).toString(16).padStart(6, '0')}`, leadingLeftEdgeRun };
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { browser: { type: 'string' }, 'source-root': { type: 'string' },
    out: { type: 'string' }, help: { type: 'boolean' } }, strict: true, allowPositionals: false });
  if (values.help) {
    console.log('node node_modules/tsx/dist/cli.mjs scripts/visual/reference-geometry.ts --browser EXISTING_EXECUTABLE --source-root EXPORT_ROOT --out NEW_EVIDENCE_DIRECTORY');
    return;
  }
  if (!values.browser || !existsSync(values.browser) || !values['source-root'] || !values.out) {
    throw new VisualError('INVALID_ARGUMENT', 'Existing --browser, explicit --source-root and new --out are required');
  }
  const sourceRoot = values['source-root'];
  const manifestBytes = await readFile('docs/transformacion-membego/stitch-manifest.json');
  const manifest = z.object({ screens: z.array(z.object({ id: z.string(), audience: z.enum(['client', 'admin']) })).length(12) })
    .parse(JSON.parse(manifestBytes.toString()));
  const output = await createEvidenceDirectory(values.out);
  const browser = await chromium.launch({ executablePath: values.browser, headless: true, timeout: 20_000 });
  const measurements = [];
  const network = [];
  try {
    const cases = [...manifest.screens.map((screen) => ({ ...screen, derived: false,
      width: screen.audience === 'client' ? 390 : 1280, height: screen.audience === 'client' ? 884 : 1024 })),
      { id: 'inicio_membego', audience: 'client', width: 768, height: 1024, derived: true },
      { id: 'resumen_administrativo_membego', audience: 'admin', width: 390, height: 884, derived: true }];
    for (const entry of cases) {
      const reference = await loadReference(entry.id, sourceRoot);
      const native = await readFile(join(sourceRoot, entry.id, 'screen.png'));
      const htmlBytes = await readFile(join(sourceRoot, entry.id, 'code.html'));
      verifyDigest(native, reference.screen.png.sha256);
      verifyDigest(htmlBytes, reference.screen.html.sha256);
      const html = htmlBytes.toString();
      const context = await browser.newContext({ viewport: { width: entry.width, height: entry.height },
        deviceScaleFactor: 1, locale: 'es-DO', timezoneId: 'UTC', colorScheme: 'light', reducedMotion: 'reduce', serviceWorkers: 'block' });
      const requests: { url: string; status: string }[] = [];
      await context.route('**/*', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (request.method() === 'GET' && url.protocol === 'https:' &&
          ['cdn.tailwindcss.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'lh3.googleusercontent.com'].includes(url.hostname) &&
          ['script', 'stylesheet', 'font', 'image'].includes(request.resourceType())) await route.continue();
        else { requests.push({ url: request.url(), status: 'BLOCKED' }); await route.abort(); }
      });
      const page = await context.newPage();
      page.on('response', (response) => requests.push({ url: response.url(), status: String(response.status()) }));
      page.on('requestfailed', (request) => requests.push({ url: request.url(), status: request.failure()?.errorText ?? 'FAILED' }));
      await page.setContent(html, { waitUntil: 'networkidle', timeout: 30_000 });
      await page.waitForFunction(() => document.fonts.status === 'loaded' && Array.from(document.images).every((image) => image.complete), undefined, { timeout: 20_000 });
      const computed = await page.evaluate(() => ({
        viewport: { width: innerWidth, height: innerHeight }, dpr: devicePixelRatio,
        scroll: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
        fontsReady: document.fonts.status, fonts: Array.from(document.fonts).map((font) => ({ family: font.family, status: font.status })),
        images: Array.from(document.images).map((image) => ({ width: image.naturalWidth, height: image.naturalHeight, complete: image.complete })),
        boxes: ['html', 'body', 'header', 'header > div:first-child', 'header > div:nth-child(2)', 'aside', 'main', 'nav.fixed', 'nav.fixed > div', '.font-headline-lg', '.bg-primary'].map((selector) => {
          const element = document.querySelector(selector);
          if (!element) return { selector, present: false };
          const box = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return { selector, present: true, x: box.x, y: box.y, width: box.width, height: box.height,
            fontFamily: style.fontFamily, fontSize: style.fontSize, lineHeight: style.lineHeight, position: style.position,
            minHeight: style.minHeight, color: style.color, background: style.backgroundColor };
        }),
      }));
      const screenshot = await page.screenshot({ fullPage: false, scale: 'css', animations: 'disabled', caret: 'hide' });
      const stem = `${entry.id}-${entry.width}`;
      await writeFile(join(output, `${stem}.png`), screenshot, { flag: 'wx' });
      const { diff, ...difference } = await comparePixels(native, screenshot);
      if (diff) throw new VisualError('UNEXPECTED_COMPARABILITY', 'Native and sample viewport dimensions unexpectedly match');
      const record = { id: entry.id, label: entry.derived ? 'DERIVED_RESPONSIVE_HTML_REFERENCE' : 'RENDERED_HTML_REFERENCE',
        approval: 'NOT_APPROVED', browser: browser.version(), locale: 'es-DO', timezone: 'UTC', fullPage: false,
        animationPolicy: 'disabled', screenshotHash: sha256(screenshot), pngHash: sha256(native), htmlHash: sha256(htmlBytes),
        bitmap: await inspectBitmap(native), computed,
        literalTokens: html.match(/"(?:primary|header-location-height|bottom-nav-height|sidebar-width|header-height|headline-lg|body-md|space-base)"\s*:\s*[^,}]+/g),
        candidateNativePixelsPerCss: reference.screen.png.width / entry.width,
        candidateFullHeightCss: reference.screen.png.height * entry.width / reference.screen.png.width,
        candidateStatus: 'HYPOTHESIS_NOT_CAPTURE_METADATA', difference: { ...difference, diffArtifact: null },
        capturedAt: new Date().toISOString() };
      await writeFile(join(output, `${stem}.json`), JSON.stringify(record, null, 2), { flag: 'wx' });
      measurements.push(record);
      network.push({ id: entry.id, width: entry.width, requests });
      await context.close();
    }
    for (const screen of manifest.screens) await loadReference(screen.id, sourceRoot);
    await writeFile(join(output, 'geometry.json'), JSON.stringify({ manifestHash: sha256(manifestBytes), measurements,
      integrityAfter: 'ALL_REPOSITORY_AND_SOURCE_HASHES_VERIFIED', transformsApplied: false }, null, 2), { flag: 'wx' });
    await writeFile(join(output, 'network.json'), JSON.stringify(network, null, 2), { flag: 'wx' });
    console.log(JSON.stringify({ output, captures: measurements.length, integrity: 'VERIFIED', approval: 'NOT_APPROVED' }));
  } finally {
    await browser.close();
    await writeFile(join(output, 'cleanup.json'), JSON.stringify({ browserClosed: true, appServerStarted: false,
      dbTouched: false, network: 'Public assets only, isolated contexts, GET allowlist', completedCaptures: measurements.length }), { flag: 'wx' });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    if (!(error instanceof Error)) throw error;
    console.error(JSON.stringify({ reason: error instanceof VisualError ? error.code : 'MEASUREMENT_FAILED', detail: error.message }));
    process.exitCode = 2;
  });
}
