import { Skeleton } from '@/components/ui/skeleton'

/** Skeleton de Promociones: cabecera → secciones de tarjetas-anuncio. */
export default function Loading() {
  return (
    <main className="container max-w-5xl py-8">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="mt-2 h-4 w-80 max-w-full" />
      <div className="mt-8 space-y-10">
        {Array.from({ length: 2 }).map((_, s) => (
          <div key={s}>
            <div className="mb-4 flex items-center gap-3">
              <Skeleton className="h-9 w-9 rounded-xl" />
              <Skeleton className="h-5 w-44" />
            </div>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="overflow-hidden rounded-2xl border border-border/60">
                  <Skeleton className="h-44 w-full rounded-lg" />
                  <div className="space-y-3 p-5">
                    <Skeleton className="h-5 w-3/4" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-12 w-full rounded-2xl" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </main>
  )
}
