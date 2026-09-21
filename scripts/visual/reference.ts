import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { digestSchema, VisualError } from './contracts.js';

const assetSchema = z.object({ path: z.string().min(1), sha256: digestSchema }).readonly();
const manifestSchema = z.object({
  schema_version: z.literal(1), source_root: z.string().min(1),
  capture_metadata: z.object({ css_viewport: z.null(), device_pixel_ratio: z.null(), export_scale: z.null() }).readonly(),
  design: z.object({ path: z.string().min(1), sha256: digestSchema, source_relative_path: z.string() }).readonly(),
  screens: z.array(z.object({
    id: z.string().min(1), routes: z.array(z.string()).min(1).readonly(),
    png: z.object({ path: z.string(), sha256: digestSchema, width: z.number().int().positive(), height: z.number().int().positive() }).readonly(),
    html: assetSchema,
  }).readonly()).length(12).readonly(),
}).readonly();

export function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function verifyDigest(bytes: Buffer, expected: string): void {
  if (sha256(bytes) !== expected) throw new VisualError('REFERENCE_DRIFT', 'Reference bytes differ from the recorded SHA256; preserve both versions');
}

/**
 * El hash de los assets de TEXTO (HTML/DESIGN) se registró sobre el blob de
 * git, que usa LF. En un checkout con `core.autocrlf=true` —Windows— los
 * mismos bytes llegan con CRLF y la comprobación byte a byte los lee como
 * drift aunque el contenido no haya cambiado. Se normalizan los finales de
 * línea para que el margen mida CONTENIDO y no la plataforma.
 *
 * El PNG, que es el artefacto visual, sigue comparándose byte a byte: ahí sí
 * cualquier diferencia es una diferencia de píxeles.
 */
export function verifyTextDigest(bytes: Buffer, expected: string): void {
  const normalized = Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
  if (sha256(normalized) !== expected) throw new VisualError('REFERENCE_DRIFT', 'Reference bytes differ from the recorded SHA256; preserve both versions');
}

export async function loadReference(id: string, sourceRoot?: string) {
  const requestedSource = z.string().min(1).optional().parse(sourceRoot);
  const manifest = manifestSchema.parse(JSON.parse(await readFile('docs/transformacion-membego/stitch-manifest.json', 'utf8')));
  if (new Set(manifest.screens.map((screen) => screen.id)).size !== 12) {
    throw new VisualError('INVALID_MANIFEST', 'Screen IDs must be unique');
  }
  const screen = manifest.screens.find((candidate) => candidate.id === id);
  if (!screen) throw new VisualError('UNKNOWN_SCREEN', `Unknown screen ID: ${id}`);
  const bytes = await readFile(screen.png.path);
  verifyDigest(bytes, screen.png.sha256);
  for (const asset of [screen.html, manifest.design]) verifyTextDigest(await readFile(asset.path), asset.sha256);
  if (requestedSource !== undefined) {
    for (const asset of [
      { path: join(requestedSource, id, 'screen.png'), sha256: screen.png.sha256, text: false },
      { path: join(requestedSource, id, 'code.html'), sha256: screen.html.sha256, text: true },
      { path: join(requestedSource, manifest.design.source_relative_path), sha256: manifest.design.sha256, text: true },
    ]) {
      const sourceBytes = await readFile(asset.path);
      if (asset.text) verifyTextDigest(sourceBytes, asset.sha256);
      else verifyDigest(sourceBytes, asset.sha256);
    }
  }
  return { bytes, screen, captureMetadata: manifest.capture_metadata, sourceRoot: requestedSource ?? null,
    integrity: requestedSource === undefined ? 'REPOSITORY_VERIFIED' : 'REPOSITORY_AND_EXTERNAL_VERIFIED' };
}
