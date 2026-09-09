import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createEvidenceDirectory, evidenceRoot } from './evidence.js';
import { sha256 } from './reference.js';

const protectedFiles = [
  'scripts/verificar-home-e2e.mts',
  'src/app/(admin)/admin/dashboard/page.tsx',
  'src/modules/admin/dashboardQueries.ts',
  'tests/definiciones-unicas.test.ts',
] as const;

async function main(): Promise<void> {
  await mkdir(evidenceRoot, { recursive: true });
  const output = await createEvidenceDirectory(join(evidenceRoot, `verification-${randomUUID()}`));
  const before = await Promise.all(protectedFiles.map(async (path) => ({ path, hash: sha256(await readFile(path)) })));
  const modules = (await readdir('scripts/visual')).filter((name) => name.endsWith('.ts')).map((name) => `scripts/visual/${name}`);
  const files = [...modules, 'tests/stitch-visual.test.ts'];
  const gates = [
    { name: 'tests', args: [createRequire(import.meta.url).resolve('tsx/cli'), '--test', 'tests/stitch-visual.test.ts'] },
    { name: 'lint', args: ['node_modules/eslint/bin/eslint.js', ...files] },
    { name: 'typecheck', args: ['node_modules/typescript/bin/tsc', '--noEmit', '--strict', '--noUncheckedIndexedAccess',
      '--exactOptionalPropertyTypes', '--verbatimModuleSyntax', '--module', 'esnext', '--moduleResolution', 'bundler',
      '--target', 'es2022', '--esModuleInterop', '--skipLibCheck', ...files] },
    { name: 'global-typecheck', args: ['node_modules/typescript/bin/tsc', '--noEmit', '--incremental', 'false'] },
  ];
  const results = [];
  for (const gate of gates) {
    const result = spawnSync(process.execPath, gate.args, { encoding: 'utf8', timeout: 180_000 });
    await writeFile(join(output, `${gate.name}.log`), `${result.stdout}\n${result.stderr}`, { flag: 'wx' });
    results.push({ name: gate.name, command: [process.execPath, ...gate.args], exit: result.status,
      error: result.error?.message ?? null });
  }
  const measurements = await Promise.all(files.map(async (path) => {
    const bytes = await readFile(path);
    return { path, sha256: sha256(bytes), pureLines: bytes.toString().split(/\r?\n/)
      .filter((line) => line.trim() !== '' && !line.trimStart().startsWith('//')).length };
  }));
  const preserved = await Promise.all(before.map(async (item) => ({ ...item,
    after: sha256(await readFile(item.path)) })));
  const pass = results.every((result) => result.exit === 0) && measurements.every((file) => file.pureLines <= 250) &&
    preserved.every((file) => file.hash === file.after);
  const report = { pass, results, measurements, preserved, label: 'TOOLING_SELF_TEST',
    applicationAcceptance: 'BLOCKED_NO_AUTHENTICATED_CAPTURE_OR_REFERENCE_SCALE',
    cleanup: 'Only bounded synchronous child processes; tests remove only their unique test directories',
    checkedAt: new Date().toISOString() };
  await writeFile(join(output, 'verification.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ pass, output, results, measurements, preserved }));
  process.exitCode = pass ? 0 : 1;
}

main().catch((error: unknown) => {
  if (!(error instanceof Error)) throw error;
  console.error(error.message);
  process.exitCode = 2;
});
