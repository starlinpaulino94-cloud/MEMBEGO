import { Skeleton, SkeletonCard } from '@/components/ui/skeleton'

/** Skeleton público: franja de encabezado + grid de tarjetas. */
export default function Loading() {
  return (
    <div className="min-h-screen bg-card">
      <div className="surface-hero px-4 pb-16 pt-14 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl space-y-4">
          <Skeleton className="h-10 w-72 max-w-full bg-white/10" />
          <Skeleton className="h-5 w-96 max-w-full bg-white/10" />
        </div>
      </div>
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      </div>
    </div>
  )
}
