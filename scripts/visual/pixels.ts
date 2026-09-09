import sharp from 'sharp';
import { toleranceSchema, VisualError } from './contracts.js';
import { sha256 } from './reference.js';

async function decode(bytes: Buffer) {
  try {
    if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      throw new VisualError('INVALID_IMAGE', 'Expected a PNG signature');
    }
    const image = sharp(bytes, { failOn: 'warning', limitInputPixels: 40_000_000 });
    const metadata = await image.metadata();
    if ((metadata.pages ?? 1) !== 1 || metadata.depth !== 'uchar') {
      throw new VisualError('INVALID_IMAGE', 'Only single-frame 8-bit PNG screenshots are supported');
    }
    return await image.toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  } catch (error) {
    if (error instanceof Error) throw new VisualError('INVALID_IMAGE', error.message);
    throw error;
  }
}

export async function comparePixels(reference: Buffer, actual: Buffer, maxRatio = 0) {
  const tolerance = toleranceSchema.parse(maxRatio);
  const ref = await decode(reference);
  const act = await decode(actual);
  const dimensions = {
    reference: { width: ref.info.width, height: ref.info.height },
    actual: { width: act.info.width, height: act.info.height },
  };
  const shared = { dimensions, referenceHash: sha256(reference), actualHash: sha256(actual), tolerance,
    totalPixels: ref.info.width * ref.info.height, actualTotalPixels: act.info.width * act.info.height };
  if (ref.info.width !== act.info.width || ref.info.height !== act.info.height) {
    return { ...shared, pass: false, reason: 'DIMENSION_MISMATCH', dimensionsMatch: false,
      changedPixels: null, ratio: null, diff: null };
  }
  const diff = Buffer.alloc(ref.data.length);
  let changedPixels = 0;
  for (let i = 0; i < ref.data.length; i += 4) {
    const changed = !ref.data.subarray(i, i + 4).equals(act.data.subarray(i, i + 4));
    if (changed) {
      changedPixels++;
      diff[i] = 255;
      diff[i + 2] = 255;
      diff[i + 3] = 255;
    }
  }
  const ratio = changedPixels / shared.totalPixels;
  const pass = ratio <= tolerance;
  const reason = changedPixels === 0 ? 'PIXELS_EQUAL' : pass ? 'WITHIN_EXPLICIT_TOLERANCE' : 'PIXEL_MISMATCH';
  return { ...shared, pass, reason, dimensionsMatch: true, changedPixels, ratio,
    diff: await sharp(diff, { raw: { width: ref.info.width, height: ref.info.height, channels: 4 } }).png().toBuffer() };
}
