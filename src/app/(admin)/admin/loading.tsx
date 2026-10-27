import { Skeleton, SkeletonCard } from '@/components/ui/skeleton'

/**
 * Estado de carga por defecto del panel de empresa (Auditoría · Fase B).
 *
 * Next usa el `loading.tsx` más cercano: los módulos con un skeleton propio
 * (clientes, membresías, pagos) siguen usando el suyo; el resto cae aquí en
 * lugar de mostrar el área de contenido en blanco mientras cargan sus queries
 * `force-dynamic`. Calca la forma real: encabezado (título + descripción) y
 * una rejilla de tarjetas.
 */
export default function Loading() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <Skeleton className="h-8 w-52" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    </div>
  )
}
