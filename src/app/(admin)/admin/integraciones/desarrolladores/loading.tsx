import { Skeleton } from '@/components/ui/skeleton'

/**
 * Esqueleto del hub. Cubre las cuatro rutas: en el App Router un `loading.tsx`
 * sirve a su segmento y a todos sus hijos, así que las sub-páginas heredan
 * este sin repetirlo.
 */
export default function CargandoDesarrolladores() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-9 w-full max-w-md" />
      <Skeleton className="h-56 w-full rounded-xl" />
      <Skeleton className="h-40 w-full rounded-xl" />
    </div>
  )
}
