'use client'

import { cn } from '@/lib/utils'

export interface PlanTab {
  id: string
  label: string
}

/**
 * Pestañas móviles del grid de planes: en teléfono, tres tarjetas largas
 * apiladas obligan a demasiado scroll; con las tabs se ve UNA tarjeta a la
 * vez y comparar es un toque. En md+ el grid muestra todo y esto se oculta.
 */
export function MobilePlanTabs({
  tabs,
  activeId,
  onChange,
}: {
  tabs: PlanTab[]
  activeId: string
  onChange: (id: string) => void
}) {
  if (tabs.length < 2) return null

  return (
    <div
      role="tablist"
      aria-label="Planes disponibles"
      className="no-scrollbar mb-5 flex gap-1.5 overflow-x-auto rounded-2xl bg-muted/60 p-1.5 md:hidden"
    >
      {tabs.map((tab) => {
        const active = tab.id === activeId
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.id)}
            className={cn(
              'min-h-10 flex-1 whitespace-nowrap rounded-xl px-3 text-xs font-semibold transition-all duration-base',
              active
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
