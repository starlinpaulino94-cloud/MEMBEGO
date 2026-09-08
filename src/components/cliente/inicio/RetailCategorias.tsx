import Link from 'next/link'
import { LayoutGrid } from 'lucide-react'
import type { InicioVista } from '@/modules/home/vista'
import { RetailEmptyState } from './RetailEmptyState'

export function RetailCategorias({ categorias }: { categorias: InicioVista['categorias'] }) {
  if (categorias.length === 0) {
    return (
      <RetailEmptyState
        title="Categorías"
        description="No hay categorías disponibles para explorar ahora."
      />
    )
  }

  return (
    <section className="border-b border-border bg-card py-3" aria-label="Categorías">
      <ul className="no-scrollbar flex gap-3 overflow-x-auto px-4 md:mx-auto md:max-w-6xl md:px-6">
        {categorias.map((categoria) => (
          <li key={categoria.id} className="shrink-0">
            <Link href={`/cliente/explorar?category=${encodeURIComponent(categoria.slug)}`} className="flex min-h-16 min-w-16 flex-col items-center justify-center gap-1.5 rounded-xl px-2 text-center text-caption font-medium text-foreground">
                <span className="relative flex size-12 items-center justify-center overflow-hidden rounded-full bg-primary-soft elevation-1">
                  <LayoutGrid className="size-5 text-primary" aria-hidden />
                </span>
              <span>{categoria.name}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
