import { Metadata } from 'next'
import { Suspense } from 'react'
import { SearchParams } from '@/app/(cliente)/cliente/dashboard/BuscarExcursionesSearchParams'

export const metadata: Metadata = {
  title: 'Buscar excursiones',
  description: 'Encuentra tu próxima aventura filtrando por destino, fecha, categoría y disponibilidad.',
}

export default function BuscarExcursionesPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="mb-6">
          <h1 className="text-h2 font-bold">Buscar excursiones</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Encuentra tu próxima aventura filtrando por destino, fecha, categoría y disponibilidad.
          </p>
        </div>
        <Suspense fallback={<div className="animate-pulse space-y-4"><div className="h-10 bg-muted rounded" /><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><div className="h-64 bg-muted rounded" /><div className="h-64 bg-muted rounded" /><div className="h-64 bg-muted rounded" /><div className="h-64 bg-muted rounded" /><div className="h-64 bg-muted rounded" /><div className="h-64 bg-muted rounded" /></div></div>}>
          <SearchParams />
        </Suspense>
      </div>
    </div>
  )
}