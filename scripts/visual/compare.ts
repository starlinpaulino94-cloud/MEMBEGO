import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { captureSchema, toleranceSchema, VisualError } from './contracts.js';
import { createEvidenceDirectory } from './evidence.js';
import { loadReference, sha256 } from './reference.js';
import { comparePixels } from './pixels.js';

const help = `Usage: node node_modules/tsx/dist/cli.mjs scripts/visual/compare.ts --screen ID --actual capture.png --metadata capture.json --out NEW_DIRECTORY
Tooling only: --self-test-reference reference.png --actual actual.png --out NEW_DIRECTORY
Options: --source-root DIRECTORY (explicit strict source recheck; --screen only), --max-ratio NUMBER (0..0.01; default 0), --help
Default reference integrity: pinned repository PNG/HTML/DESIGN hashes; source_root in the manifest is provenance only.
Output must be new and beneath .omo/start-work/r0-visual/. No baseline updates.
Exit: 0 pixel comparison passes, 1 image/size mismatch, 2 invalid input/integrity failure.
Pixel equality is NOT application fidelity approval.`;

async function main(): Promise<void> {
  const { values } = parseArgs({ options: {
    help: { type: 'boolean' }, screen: { type: 'string' }, actual: { type: 'string' },
    metadata: { type: 'string' }, out: { type: 'string' }, 'source-root': { type: 'string' },
    'self-test-reference': { type: 'string' }, 'max-ratio': { type: 'string' },
  }, strict: true, allowPositionals: false });
  if (values.help && process.argv.length === 3) { console.log(help); return; }
  const screenId = values.screen;
  const selfTest = values['self-test-reference'];
  if (values['source-root'] !== undefined && !screenId) {
    throw new VisualError('INVALID_ARGUMENT', '--source-root requires --screen');
  }
  if (Boolean(screenId) === Boolean(selfTest) || !values.actual || !values.out || values.help) {
    throw new VisualError('INVALID_ARGUMENT', 'Choose exactly one reference mode and provide --actual and --out');
  }
  const ratioText = values['max-ratio'];
  if (ratioText !== undefined && !/^(?:0|0?\.\d+)$/.test(ratioText)) {
    throw new VisualError('INVALID_ARGUMENT', 'max-ratio must be a decimal from 0 through 0.01');
  }
  const tolerance = toleranceSchema.parse(Number(ratioText ?? '0'));
  const reference = screenId ? await loadReference(screenId, values['source-root']) : null;
  const referenceBytes = reference ? reference.bytes : await readFile(z.string().min(1).parse(selfTest));
  const actualBytes = await readFile(values.actual);
  const metadata = values.metadata ? captureSchema.parse(JSON.parse(await readFile(values.metadata, 'utf8'))) : null;
  if (screenId && (!metadata || metadata.label !== 'APPLICATION_CAPTURE')) {
    throw new VisualError('INVALID_METADATA', 'Application comparison requires APPLICATION_CAPTURE metadata');
  }
  if (metadata && (metadata.sha256 !== sha256(actualBytes) ||
      (!screenId && metadata.label !== 'TOOLING_SELF_TEST'))) {
    throw new VisualError('INVALID_METADATA', 'Capture metadata does not match the image or comparison mode');
  }
  const { diff, ...comparison } = await comparePixels(referenceBytes, actualBytes, tolerance);
  if (metadata && (metadata.viewport.width !== comparison.dimensions.actual.width ||
      metadata.viewport.height !== comparison.dimensions.actual.height)) {
    throw new VisualError('INVALID_METADATA', 'CSS-scale viewport capture dimensions differ from metadata');
  }
  if (reference && (reference.screen.png.width !== comparison.dimensions.reference.width ||
      reference.screen.png.height !== comparison.dimensions.reference.height)) {
    throw new VisualError('INVALID_MANIFEST', 'Reference dimensions differ from manifest');
  }
  const output = await createEvidenceDirectory(values.out);
  const diffArtifact = diff ? join(output, 'diff.png') : null;
  if (diff && diffArtifact) await writeFile(diffArtifact, diff, { flag: 'wx' });
  const report = { ...comparison, label: screenId ? 'APPLICATION_BITMAP_COMPARISON' : 'TOOLING_SELF_TEST',
    fidelityApproval: 'NOT_GRANTED', screenId: screenId ?? null, routes: reference?.screen.routes ?? [],
    referenceCaptureMetadata: reference?.captureMetadata ?? null, actualCaptureMetadata: metadata,
    referencePath: reference?.screen.png.path ?? selfTest, actualPath: values.actual, diffArtifact,
    referenceIntegrity: reference?.integrity ?? 'SELF_TEST_ONLY', referenceSourceRoot: reference?.sourceRoot ?? null,
    comparedAt: new Date().toISOString() };
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
  console.log(JSON.stringify(report));
  process.exitCode = comparison.pass ? 0 : 1;
}

main().catch((error: unknown) => {
  if (!(error instanceof Error)) throw error;
  const reason = error instanceof VisualError ? error.code :
    error instanceof z.ZodError || error instanceof TypeError ? 'INVALID_ARGUMENT' : 'INPUT_OUTPUT_ERROR';
  console.log(JSON.stringify({ pass: false, reason, detail: error.message, fidelityApproval: 'NOT_GRANTED' }));
  process.exitCode = 2;
});
