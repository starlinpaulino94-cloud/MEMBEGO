'use server'

import { sinEmpresa } from '@/lib/tenant'
import { cookies } from 'next/headers'

const RATE_LIMIT_WINDOW = 60 * 1000 // 1 minute
const MAX_VIEWS_PER_WINDOW = 10
const MAX_SHARES_PER_WINDOW = 5

export async function recordPromotionView(promotionId: string): Promise<boolean> {
  if (!promotionId) return false

  try {
    const cookieStore = await cookies()

    // Simple client-side rate limiting via cookie
    const viewsKey = `promo_views:${promotionId}`
    const existingViews = cookieStore.get(viewsKey)
    const viewCount = existingViews ? parseInt(existingViews.value) : 0

    if (viewCount >= MAX_VIEWS_PER_WINDOW) {
      return false
    }

    // Record the view
    await sinEmpresa('marketplace: contador público de vistas de promoción', (tx) =>
      tx.promocion.update({
        where: { id: promotionId },
        data: {
          viewCount: {
            increment: 1,
          },
        },
      })
    )

    // Update rate limit cookie (will be set by response)
    ;(await cookies()).set(viewsKey, String(viewCount + 1), {
      maxAge: RATE_LIMIT_WINDOW / 1000,
      httpOnly: false,
      sameSite: 'lax',
    })

    return true
  } catch (error) {
    console.error('[recordPromotionView] Error:', error)
    return false
  }
}

export async function recordPromotionShare(promotionId: string): Promise<boolean> {
  if (!promotionId) return false

  try {
    const cookieStore = await cookies()

    // Simple client-side rate limiting via cookie
    const sharesKey = `promo_shares:${promotionId}`
    const existingShares = cookieStore.get(sharesKey)
    const shareCount = existingShares ? parseInt(existingShares.value) : 0

    if (shareCount >= MAX_SHARES_PER_WINDOW) {
      return false
    }

    // Record the share
    await sinEmpresa('marketplace: contador público de compartidos de promoción', (tx) =>
      tx.promocion.update({
        where: { id: promotionId },
        data: {
          shareCount: {
            increment: 1,
          },
        },
      })
    )

    // Update rate limit cookie
    ;(await cookies()).set(sharesKey, String(shareCount + 1), {
      maxAge: RATE_LIMIT_WINDOW / 1000,
      httpOnly: false,
      sameSite: 'lax',
    })

    return true
  } catch (error) {
    console.error('[recordPromotionShare] Error:', error)
    return false
  }
}

// Los favoritos se implementaron en FASE 3 vía CompanyFollow.esFavorita
// (src/modules/social/actions.ts).
