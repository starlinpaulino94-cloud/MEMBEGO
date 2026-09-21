'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Wraps a horizontal scroll container and shows a gradient+chevron hint
 * on the right edge ONLY when the content overflows (scrollWidth > clientWidth).
 *
 * The ref measures the FIRST CHILD (the actual scroller), not the wrapper.
 * The wrapper is just a positioning context for the absolute overlay.
 *
 * SSR-safe: renders nothing on the server (useState(false)), adds the hint
 * on the client after mount + measurement. No hydration mismatch.
 *
 * Usage:
 * <RailOverflowHint className="from-background via-background/90 to-transparent text-primary">
 *   <div className="flex gap-2 overflow-x-auto no-scrollbar">
 *     {items.map(...)}
 *   </div>
 * </RailOverflowHint>
 */
export function RailOverflowHint({
  children,
  className,
}: {
  children: React.ReactElement
  className?: string
}) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [overflows, setOverflows] = useState(false)

  const measure = useCallback(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    // The scrolling element is the first child (the div with overflow-x-auto)
    const scroller = wrapper.firstElementChild as HTMLElement | null
    if (!scroller) return
    // 1px tolerance avoids false positives from sub-pixel rounding
    setOverflows(scroller.scrollWidth > scroller.clientWidth + 1)
  }, [])

  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    const scroller = wrapper.firstElementChild as HTMLElement | null
    if (!scroller) return

    measure()

    const ro = new ResizeObserver(measure)
    ro.observe(scroller)
    // Also observe the wrapper in case its width changes (viewport resize)
    ro.observe(wrapper)

    // Re-check on scroll — hint should hide when user scrolls to the end
    scroller.addEventListener('scroll', measure, { passive: true })
    window.addEventListener('resize', measure)

    return () => {
      ro.disconnect()
      scroller.removeEventListener('scroll', measure)
      window.removeEventListener('resize', measure)
    }
  }, [measure])

  return (
    <div ref={wrapperRef} className="relative">
      {children}
      {overflows && (
        <span
          data-rail-hint
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-y-0 right-0 flex w-10 items-center justify-end bg-gradient-to-l via-90% to-transparent pr-1 lg:hidden',
            className
          )}
        >
          <ChevronRight className="size-4" />
        </span>
      )}
    </div>
  )
}
