import { Skeleton } from '@/components/ui/skeleton'

/** Skeleton que calca el Home real: saludo+avatar → hero → stats → wallet. */
export default function Loading() {
  return (
    <main className="container max-w-5xl py-8">
      {/* Saludo con avatar */}
      <div className="mb-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Skeleton className="h-11 w-11 rounded-full" />
          <div className="space-y-1.5">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-3 w-28" />
          </div>
        </div>
        <Skeleton className="h-9 w-24 rounded-xl" />
      </div>

      {/* Hero banner */}
      <Skeleton className="mb-8 h-44 rounded-2xl" />

      {/* Vistazo rápido */}
      <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 rounded-2xl" />
        ))}
      </div>

      {/* Wallet stack */}
      <Skeleton className="mb-2 h-6 w-32" />
      <div className="mx-auto mt-4 w-full max-w-md space-y-3">
        <Skeleton className="h-[4.5rem] rounded-[1.4rem]" />
        <Skeleton className="aspect-[1.586/1] min-h-[196px] rounded-[1.4rem]" />
      </div>
    </main>
  )
}
