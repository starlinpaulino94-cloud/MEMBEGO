import { Skeleton } from '@/components/ui/skeleton'

/** Mientras el servidor decide en qué paso estamos y pregunta al proveedor. */
export default function CargandoAsistente() {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <Skeleton className="h-4 w-64" />
      <div className="flex items-center gap-3">
        <Skeleton className="h-12 w-12 rounded-xl" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-3 w-full max-w-sm" />
        </div>
      </div>
      <Skeleton className="h-72 w-full rounded-xl" />
    </div>
  )
}
