/**
 * Validator + renderer for the client web↔native parity inventory (Todo 2).
 *
 * Usage:
 *   node scripts/verificar-paridad-rutas.mjs            # validate (exit 1 on any problem)
 *   node scripts/verificar-paridad-rutas.mjs --update   # regenerate the markdown matrix from the manifest
 *
 * The JSON manifest is the single source of truth. This script:
 *   1. enumerates the real filesystem route sets (never a hand-written list);
 *   2. requires the manifest to classify EXACTLY those sets (missing / extra / duplicate / dangling refs fail);
 *   3. re-renders docs/design/client-web-native-parity-matrix.md from the manifest and fails if it drifted.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const MANIFEST_PATH = join(ROOT, 'docs/design/client-parity-manifest.json');
const MATRIX_PATH = join(ROOT, 'docs/design/client-web-native-parity-matrix.md');
const WEB_CLIENT_DIR = join(ROOT, 'src', 'app', '(cliente)');
const RN_APP_DIR = join(ROOT, 'apps', 'client', 'app');
const UPDATE = process.argv.includes('--update');

const errors = [];
const fail = (msg) => errors.push(msg);
const toPosix = (p) => p.split(sep).join('/');
const rel = (abs) => toPosix(relative(ROOT, abs));

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1. Enumerate the filesystem (authoritative route sets for this run)
// ---------------------------------------------------------------------------
const webFs = new Set(
  walk(WEB_CLIENT_DIR)
    .filter((f) => f.endsWith(`page.tsx`))
    .map(rel)
);
const nativeFs = new Set(
  walk(RN_APP_DIR)
    .filter((f) => f.endsWith('.tsx'))
    .map(rel)
);

// ---------------------------------------------------------------------------
// 2. Load + structurally validate the manifest
// ---------------------------------------------------------------------------
if (!existsSync(MANIFEST_PATH)) {
  console.error(`FATAL: manifest not found at ${rel(MANIFEST_PATH)}`);
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
const webRoutes = manifest.webRoutes ?? [];
const nativeRoutes = manifest.nativeRoutes ?? [];

const byWebPath = new Map();
const byNativeFile = new Map();
const seenWebFiles = new Set();
const seenNativeFiles = new Set();
const nativeFilesKnown = new Set(nativeRoutes.map((r) => r.nativeFile));

// duplicate mapping: identical web path, native file, or per-row duplicate native ref
for (const r of webRoutes) {
  if (byWebPath.has(r.webPath)) fail(`duplicate mapping: web path '${r.webPath}' appears twice`);
  byWebPath.set(r.webPath, r);
  if (seenWebFiles.has(r.file)) fail(`duplicate mapping: web file '${r.file}' appears twice`);
  seenWebFiles.add(r.file);
  const local = new Set();
  for (const n of r.nativeFiles ?? []) {
    if (local.has(n)) fail(`duplicate mapping: '${r.webPath}' lists native file '${n}' twice`);
    local.add(n);
  }
}
for (const r of nativeRoutes) {
  if (byNativeFile.has(r.nativeFile)) fail(`duplicate mapping: native file '${r.nativeFile}' appears twice`);
  byNativeFile.set(r.nativeFile, r);
  if (seenNativeFiles.has(r.nativeFile)) fail(`duplicate mapping: native file '${r.nativeFile}' classified twice`);
  seenNativeFiles.add(r.nativeFile);
}

// dangling file references + exact route-set equality against the filesystem
for (const r of webRoutes) {
  if (!existsSync(join(ROOT, r.file))) fail(`non-existent file: web route '${r.webPath}' points at '${r.file}'`);
}
for (const r of nativeRoutes) {
  if (!existsSync(join(ROOT, r.nativeFile))) fail(`non-existent file: native route '${r.nativeFile}' does not exist`);
}
for (const file of webFs) if (!seenWebFiles.has(file)) fail(`missing route: web page '${file}' is absent from the manifest`);
for (const file of seenWebFiles) if (!webFs.has(file)) fail(`stale manifest: web file '${file}' is not a real client page`);
for (const file of nativeFs) if (!seenNativeFiles.has(file)) fail(`unclassified route: native file '${file}' is not classified in the manifest`);
for (const file of seenNativeFiles) if (!nativeFs.has(file)) fail(`stale manifest: native file '${file}' is not a real app route file`);

// bidirectional cross-reference consistency
for (const r of webRoutes) {
  for (const n of r.nativeFiles ?? []) {
    if (!nativeFilesKnown.has(n)) { fail(`dangling mapping: '${r.webPath}' -> '${n}' has no nativeRoutes entry`); continue; }
    const nr = byNativeFile.get(n);
    if (!(nr.webPaths ?? []).includes(r.webPath)) fail(`asymmetric mapping: '${r.webPath}' -> '${n}' but '${n}' does not list web path '${r.webPath}'`);
  }
}
for (const r of nativeRoutes) {
  for (const w of r.webPaths ?? []) {
    if (!byWebPath.has(w)) { fail(`dangling mapping: native '${r.nativeFile}' -> '${w}' has no webRoutes entry`); continue; }
    const wr = byWebPath.get(w);
    if (!(wr.nativeFiles ?? []).includes(r.nativeFile)) fail(`asymmetric mapping: native '${r.nativeFile}' -> '${w}' but '${w}' does not list native file '${r.nativeFile}'`);
  }
}

// declared counts must reconcile with the real enumeration
const counts = manifest.counts ?? {};
if (counts.webRoutes !== webFs.size) fail(`count mismatch: manifest.counts.webRoutes=${counts.webRoutes} but filesystem has ${webFs.size} client web pages`);
if (counts.nativeRouteFiles !== nativeFs.size) fail(`count mismatch: manifest.counts.nativeRouteFiles=${counts.nativeRouteFiles} but filesystem has ${nativeFs.size} native route files`);

// ---------------------------------------------------------------------------
// 3. Render the markdown matrix from the manifest (proves no drift)
// ---------------------------------------------------------------------------
const yes = (b) => (b ? 'yes' : '-');
const states = (s = {}) => [yes(s.loading), yes(s.error), yes(s.empty), yes(s.pagination), yes(s.qr), yes(s.map)].join(' | ');
const code = (vals) => (vals && vals.length ? vals.map((v) => `\`${v}\``).join(', ') : '-');

function render() {
  const L = [];
  L.push('# Client web ↔ native parity matrix');
  L.push('');
  L.push('> **Generated file — do not edit by hand.** Source of truth: `docs/design/client-parity-manifest.json`,');
  L.push('> rendered and verified by `scripts/verificar-paridad-rutas.mjs`. Run `node scripts/verificar-paridad-rutas.mjs`');
  L.push('> to prove this file still matches the manifest.');
  L.push('');
  L.push('## Reconciliation vs the plan');
  L.push('');
  L.push(`- Client web routes found on disk (\`src/app/(cliente)/**/page.tsx\`): **${webFs.size}** (plan claims ${manifest.meta?.planClaim?.webRoutes ?? '?'}).`);
  L.push(`- Native route files found on disk (\`apps/client/app/**/*.tsx\`): **${nativeFs.size}** (plan claims ${manifest.meta?.planClaim?.nativeRouteFiles ?? '?'}).`);
  L.push(`- Manifest entries: web=${webRoutes.length}, native=${nativeRoutes.length}.`);
  L.push('');
  L.push('State columns are source-inspected per file (loading / error / empty / pagination / QR / map), not inferred from filenames.');
  L.push('');
  L.push('## Web routes → native routes');
  L.push('');
  L.push('| # | Web route | Web file | Native route file(s) | Native hooks / API | Web data source | Shared components | Auth | L | E | Em | P | QR | M | Status | Required migration action |');
  L.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  const sortedWeb = [...webRoutes].sort((a, b) => a.webPath.localeCompare(b.webPath));
  sortedWeb.forEach((r, i) => {
    const nats = (r.nativeFiles ?? []).map((n) => {
      const nr = byNativeFile.get(n);
      return nr && nr.route ? `${n} (${nr.route})` : n;
    });
    const hooks = new Set();
    const apis = new Set();
    const comps = new Set();
    for (const that of r.nativeFiles ?? []) {
      const nr = byNativeFile.get(that);
      if (!nr) continue;
      (nr.hooks ?? []).forEach((h) => hooks.add(h));
      (nr.api ?? []).forEach((a) => apis.add(a));
      (nr.components ?? []).forEach((c) => comps.add(c));
    }
    L.push(`| ${i + 1} | \`${r.webPath}\` | \`${r.file}\` | ${code(nats)} | ${code([...hooks, ...apis])} | ${code(r.webDataSource)} | ${code([...comps])} | ${r.auth} | ${states(r.states)} | ${r.status} | ${r.action} |`);
  });
  L.push('');
  L.push('## Native-only route files (layouts / auth / redirects not owned by one client web page)');
  L.push('');
  L.push('| Native file | Route | Kind | Hooks / API | Auth | L | E | Em | P | QR | M | Status | Required migration action |');
  L.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  const nativeOnly = [...nativeRoutes].filter((r) => (r.webPaths ?? []).length === 0).sort((a, b) => a.nativeFile.localeCompare(b.nativeFile));
  for (const r of nativeOnly) {
    L.push(`| \`${r.nativeFile}\` | ${r.route} | ${r.kind} | ${code([...(r.hooks ?? []), ...(r.api ?? [])])} | ${r.auth} | ${states(r.states)} | ${r.status} | ${r.action} |`);
  }
  L.push('');
  L.push('## Status legend');
  L.push('');
  for (const [k, v] of Object.entries(manifest.statusLegend ?? {})) L.push(`- **${k}**: ${v}`);
  L.push('');
  return L.join('\n');
}

const rendered = render();

function compareMarkdown() {
  if (!existsSync(MATRIX_PATH)) {
    fail(`matrix file '${rel(MATRIX_PATH)}' is missing; run with --update`);
    return;
  }
  const onDisk = readFileSync(MATRIX_PATH, 'utf8').replace(/\r\n/g, '\n').trimEnd();
  if (onDisk !== rendered.trimEnd()) {
    fail(`matrix drift: '${rel(MATRIX_PATH)}' does not match the manifest render; run with --update`);
  }
}

if (UPDATE) {
  writeFileSync(MATRIX_PATH, rendered.endsWith('\n') ? rendered : rendered + '\n');
  console.log(`updated ${rel(MATRIX_PATH)}`);
  if (errors.length) {
    console.error(`\nFAIL (${errors.length}):`);
    for (const e of errors) console.error(` - ${e}`);
    process.exit(1);
  }
  console.log(`OK web=${webFs.size} native=${nativeFs.size} webRoutes=${webRoutes.length} nativeRoutes=${nativeRoutes.length}`);
  process.exit(0);
}

compareMarkdown();

if (errors.length) {
  console.error(`FAIL (${errors.length} problem${errors.length === 1 ? '' : 's'}):`);
  for (const e of errors) console.error(` - ${e}`);
  process.exit(1);
}

console.log('OK: manifest is consistent with the filesystem and the rendered matrix.');
console.log(`web pages=${webFs.size} native route files=${nativeFs.size} webRows=${webRoutes.length} nativeRows=${nativeRoutes.length}`);
console.log(`counts: plan=${manifest.meta?.planClaim?.webRoutes}/${manifest.meta?.planClaim?.nativeRouteFiles} actual=${webFs.size}/${nativeFs.size}`);
process.exit(0);
