import { z } from 'zod'

export const cardnetCaptureSessionSchema = z
  .object({
    status: z.never().optional(),
    sessionId: z.string().min(1),
    captureNonce: z.string().min(1),
    expiresAt: z.iso.datetime(),
    amount: z.number().positive(),
    currency: z.string().min(1),
    captureUrl: z.url(),
    scriptUrl: z.url(),
    publicKey: z.string().min(1),
    uniqueId: z.string().min(1),
  })
  .strip()
  .readonly()

export const cardnetProcessingSessionSchema = z
  .object({ status: z.literal('processing'), sessionId: z.string().min(1) })
  .strip()
  .readonly()

export const cardnetSessionStartSchema = z.union([
  cardnetProcessingSessionSchema,
  cardnetCaptureSessionSchema,
])

export const cardnetPaymentStatusSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('pending') }).strip().readonly(),
  z.object({ status: z.literal('approved') }).strip().readonly(),
  z.object({ status: z.literal('declined') }).strip().readonly(),
  z.object({ status: z.literal('activation_required') }).strip().readonly(),
  z.object({ status: z.literal('expired') }).strip().readonly(),
])

export const cardnetPromotionPurchaseSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('free_activated'),
      compraId: z.string().min(1),
    })
    .strip()
    .readonly(),
  z
    .object({
      status: z.literal('payment_required'),
      compraId: z.string().min(1),
      amount: z.number().positive(),
      currency: z.string().min(1),
    })
    .strip()
    .readonly(),
])

export type CardnetSessionTarget =
  | {
      readonly kind: 'membership'
      readonly membershipId: string
      readonly guardarParaRenovacion?: boolean
    }
  | {
      readonly kind: 'promotion'
      readonly compraId: string
    }

export type CardnetCaptureSession = z.infer<typeof cardnetCaptureSessionSchema>
export type CardnetSessionStartResult = z.infer<typeof cardnetSessionStartSchema>
export type CardnetPaymentStatus = z.infer<typeof cardnetPaymentStatusSchema>
export type CardnetPromotionPurchaseResult = z.infer<typeof cardnetPromotionPurchaseSchema>
