import { mkdir, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { VisualError } from './contracts.js';

export const evidenceRoot = resolve('.omo/start-work/r0-visual');

export async function createEvidenceDirectory(path: string): Promise<string> {
  const target = resolve(path);
  const root = await realpath(evidenceRoot);
  const parent = await realpath(dirname(target));
  const rel = relative(root, parent);
  if (root.toLowerCase() !== evidenceRoot.toLowerCase() ||
      (rel !== '' && (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`) || resolve(root, rel) !== parent)) ||
      target === evidenceRoot) {
    throw new VisualError('UNSAFE_OUTPUT', 'Output must be a new directory inside the evidence root');
  }
  await mkdir(target);
  return target;
}
