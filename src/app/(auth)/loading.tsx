import { Skeleton } from '@/components/ui/skeleton'

/** Skeleton de las pantallas de acceso (layout oscuro centrado). */
export default function Loading() {
  return (
    <div className="w-full space-y-4 rounded-2xl border border-border bg-card p-6">
      <Skeleton className="h-7 w-40" />
      <Skeleton className="h-4 w-64 max-w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-11 w-full rounded-xl" />
    </div>
  )
}
