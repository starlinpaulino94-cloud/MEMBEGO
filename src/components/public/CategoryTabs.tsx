'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import type { CategoryPublic } from '@/modules/marketplace/types'

interface CategoryTabsProps {
  categories: CategoryPublic[]
  isLoading?: boolean
}

const CHIP_BASE =
  'flex-shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-all duration-150'
const CHIP_ACTIVE = 'bg-primary text-primary-foreground shadow-glow'
const CHIP_IDLE =
  'bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground'

export function CategoryTabs({ categories, isLoading = false }: CategoryTabsProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const activeCategory = searchParams.get('category')

  const handleCategoryChange = (slug: string | null) => {
    const params = new URLSearchParams(searchParams)
    if (slug) {
      params.set('category', slug)
    } else {
      params.delete('category')
    }
    router.push(`?${params.toString()}`)
  }

  if (isLoading) {
    return (
      <div className="flex gap-2 overflow-x-auto pb-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="skeleton-shimmer h-9 w-24 flex-shrink-0 rounded-full" />
        ))}
      </div>
    )
  }

  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
      <button
        onClick={() => handleCategoryChange(null)}
        className={`${CHIP_BASE} ${!activeCategory ? CHIP_ACTIVE : CHIP_IDLE}`}
      >
        Todas
      </button>

      {categories.map((category) => (
        <button
          key={category.id}
          onClick={() => handleCategoryChange(category.slug)}
          className={`${CHIP_BASE} flex items-center gap-1.5 ${
            activeCategory === category.slug ? CHIP_ACTIVE : CHIP_IDLE
          }`}
        >
          {category.name}
          {category.companyCount > 0 && (
            <span
              className={`rounded-full px-1.5 text-caption tabular-nums ${
                activeCategory === category.slug
                  ? 'bg-white/20 text-white'
                  : 'bg-background text-muted-foreground'
              }`}
            >
              {category.companyCount}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}
