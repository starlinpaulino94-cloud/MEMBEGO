'use server'

import { sinEmpresa } from '@/lib/tenant'
import { cookies } from 'next/headers'

const RATE_LIMIT_WINDOW = 60 * 1000 // 1 minute
const MAX_VIEWS_PER_WINDOW = 10
const MAX_SHARES_PER_WINDOW = 5

export async function recordPromotionView(promotionId: string): Promise<boolean> {
  if (!promotionId) return false

  try {
    let viewCount = 0
    const viewsKey = `promo_views:${promotionId}`

    try {
      const cookieStore = await cookies()
      const existingViews = cookieStore.get(viewsKey)
      viewCount = existingViews ? parseInt(existingViews.value, 10) : 0

      if (viewCount >= MAX_VIEWS_PER_WINDOW) {
        return false
      }
    } catch {
      // Cookies not accessible or disabled
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

    // Update rate limit cookie if in an action/handler context
    try {
      const cookieStore = await cookies()
      cookieStore.set(viewsKey, String(viewCount + 1), {
        maxAge: RATE_LIMIT_WINDOW / 1000,
        httpOnly: false,
        sameSite: 'lax',
      })
    } catch {
      // Cookies can only be modified in a Server Action or Route Handler.
      // Silently ignore if invoked outside an action context.
    }

    return true
  } catch (error) {
    console.error('[recordPromotionView] Error:', error)
    return false
  }
}

export async function recordPromotionShare(promotionId: string): Promise<boolean> {
  if (!promotionId) return false

  try {
    let shareCount = 0
    const sharesKey = `promo_shares:${promotionId}`

    try {
      const cookieStore = await cookies()
      const existingShares = cookieStore.get(sharesKey)
      shareCount = existingShares ? parseInt(existingShares.value, 10) : 0

      if (shareCount >= MAX_SHARES_PER_WINDOW) {
        return false
      }
    } catch {
      // Cookies not accessible or disabled
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
    try {
      const cookieStore = await cookies()
      cookieStore.set(sharesKey, String(shareCount + 1), {
        maxAge: RATE_LIMIT_WINDOW / 1000,
        httpOnly: false,
        sameSite: 'lax',
      })
    } catch {
      // Silently ignore if cookies cannot be modified
    }

    return true
  } catch (error) {
    console.error('[recordPromotionShare] Error:', error)
    return false
  }
}

// Los favoritos se implementaron en FASE 3 vía CompanyFollow.esFavorita
// (src/modules/social/actions.ts).
