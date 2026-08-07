import Link from 'next/link'
import { Gift } from 'lucide-react'
import type { PromotionPublic } from '@/modules/marketplace/types'
import { PromotionCard } from './PromotionCard'
import { EmptyState } from '@/components/ui/empty-state'
import { SkeletonCard } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'

interface PromotionGridProps {
  promotions: PromotionPublic[]
  isLoading?: boolean
  variant?: 'default' | 'compact'
  emptyMessage?: string
  /** Base de la ruta del detalle (se propaga a cada PromotionCard). */
  hrefBase?: string
  /** Destino del CTA del estado vacío (depende del contexto: landing vs app). */
  exploreHref?: string
  /** Ruta de regreso desde el detalle (se añade como `?retorno=`). */
  retorno?: string
}

export function PromotionGrid({
  promotions,
  isLoading = false,
  variant = 'default',
  emptyMessage = 'No se encontraron promociones',
  hrefBase,
  exploreHref = '/empresas',
  retorno,
}: PromotionGridProps) {
  const cols =
    variant === 'compact'
      ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6'
      : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'

  if (isLoading) {
    return (
      <div className={`grid ${cols} gap-5`}>
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonCard key={i} className={variant === 'compact' ? 'h-32' : 'h-80'} />
        ))}
      </div>
    )
  }

  if (!promotions || promotions.length === 0) {
    return (
      <EmptyState
        icon={<Gift className="h-7 w-7" />}
        title={emptyMessage}
        description="Vuelve pronto o explora las empresas afiliadas: publican nuevas ofertas con frecuencia."
        action={
          <Button asChild variant="outline">
            <Link href={exploreHref}>Explorar empresas</Link>
          </Button>
        }
      />
    )
  }

  return (
    <div className={`grid ${cols} gap-5`}>
      {promotions.map((promotion) => (
        <PromotionCard key={promotion.id} promotion={promotion} variant={variant} hrefBase={hrefBase} retorno={retorno} />
      ))}
    </div>
  )
}
