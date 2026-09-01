import { Skeleton } from '@/components/ui/skeleton'

/**
 * El esqueleto del catálogo. Sin él, la primera pintura de una página que
 * consulta la base y el entorno es una franja en blanco, y una pantalla vacía
 * durante medio segundo se lee como «no tengo nada» y no como «estoy
 * cargando».
 */
export default function CargandoIntegraciones() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <Skeleton className="h-10 w-full" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-40 w-full rounded-xl" />
        ))}
      </div>
    </div>
  )
}
