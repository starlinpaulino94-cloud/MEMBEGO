import { Skeleton } from '@/components/ui/skeleton'

/** Skeleton de Planes: saludo contextual → selector de vehículo → 3 tarjetas. */
export default function Loading() {
  return (
    <main className="container max-w-5xl py-8">
      <Skeleton className="h-3 w-40" />
      <Skeleton className="mt-3 h-9 w-80 max-w-full" />
      <Skeleton className="mt-2 h-4 w-64 max-w-full" />
      <Skeleton className="mt-6 h-5 w-56" />
      <div className="mt-5 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="space-y-4 rounded-2xl border border-border/70 p-6">
            <Skeleton className="h-6 w-36" />
            <Skeleton className="h-10 w-40" />
            <div className="flex gap-2">
              <Skeleton className="h-8 flex-1 rounded-full" />
              <Skeleton className="h-8 flex-1 rounded-full" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-4/6" />
            </div>
            <Skeleton className="h-12 w-full rounded-xl" />
          </div>
        ))}
      </div>
    </main>
  )
}
