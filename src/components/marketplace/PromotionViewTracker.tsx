'use client'

import { useEffect, useRef } from 'react'
import { recordPromotionView } from '@/modules/marketplace/actions'

interface PromotionViewTrackerProps {
  promocionId: string
}

export function PromotionViewTracker({ promocionId }: PromotionViewTrackerProps) {
  const hasTracked = useRef(false)

  useEffect(() => {
    if (!promocionId || hasTracked.current) return
    hasTracked.current = true
    recordPromotionView(promocionId).catch(() => {})
  }, [promocionId])

  return null
}
