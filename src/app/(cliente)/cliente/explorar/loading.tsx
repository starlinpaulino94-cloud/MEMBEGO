import { Skeleton } from '@/components/ui/skeleton'

/** Skeleton del Explorar: título → buscador → chips → tarjetas de negocio. */
export default function Loading() {
  return (
    <main className="container max-w-5xl py-8">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="mt-2 h-4 w-80 max-w-full" />
      <Skeleton className="mt-5 h-13 w-full rounded-2xl" />
      <div className="mt-4 flex gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-24 rounded-full" />
        ))}
      </div>
      <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-64 rounded-2xl" />
        ))}
      </div>
    </main>
  )
}
