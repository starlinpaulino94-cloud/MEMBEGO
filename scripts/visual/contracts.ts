import { z } from 'zod';

export class VisualError extends Error {
  readonly code: string;
  constructor(code: string, detail: string) {
    super(detail);
    this.name = 'VisualError';
    this.code = code;
  }
}

export const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const dimensionsSchema = z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).readonly();
export const toleranceSchema = z.number().finite().min(0).max(0.01).brand<'PixelRatio'>();
export const captureSchema = z.object({
  label: z.enum(['TOOLING_SELF_TEST', 'APPLICATION_CAPTURE']),
  sha256: digestSchema,
  browser: z.string().min(1), version: z.string().min(1),
  viewport: dimensionsSchema,
  dpr: z.number().positive().finite(),
  locale: z.string().min(1), timezone: z.string().min(1),
  fontsReady: z.literal(true),
  animationPolicy: z.literal('disabled'),
  scale: z.literal('css'), fullPage: z.literal(false),
  capturedAt: z.iso.datetime(),
}).readonly();
