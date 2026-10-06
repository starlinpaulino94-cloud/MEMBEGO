import { Skeleton, SkeletonCard } from '@/components/ui/skeleton'

/** Esqueleto de las pantallas de Supply: cabecera, cifras y una tarjeta. */
export default function Loading() {
  return (
    <div className="space-y-8" aria-busy="true" aria-label="Cargando Supply">
      <div className="space-y-2">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
        <Skeleton className="h-9 w-72 max-w-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-2xl" />
        ))}
      </div>
      <SkeletonCard />
    </div>
  )
}
