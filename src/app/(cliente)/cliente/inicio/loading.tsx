import { Skeleton } from '@/components/ui/skeleton'

/** Skeleton que calca el Home real: saludo+avatar → hero → wallet. */
export default function Loading() {
  return (
    <main className="container max-w-5xl py-8 xl:max-w-6xl">
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
      <Skeleton className="mb-6 h-44 rounded-2xl" />

      {/* Wallet stack */}
      <Skeleton className="mb-3 h-6 w-32" />
      <div className="mx-auto w-full max-w-md space-y-3">
        <Skeleton className="h-[4.5rem] rounded-[1.4rem]" />
        <Skeleton className="aspect-[1.586/1] min-h-[196px] rounded-[1.4rem]" />
      </div>
    </main>
  )
}
