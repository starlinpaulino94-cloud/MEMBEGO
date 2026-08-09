import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import type { CategoryPublic } from '@/modules/marketplace/types'

interface CategoriesSectionProps {
  categories: CategoryPublic[]
}

export function CategoriesSection({ categories }: CategoriesSectionProps) {
  if (categories.length === 0) return null

  return (
    <section className="bg-card py-16 sm:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-8 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-3xl font-bold tracking-tight text-foreground">
              Explora por categoría
            </h2>
            <p className="mt-2 text-muted-foreground">
              Encuentra el tipo de negocio que buscas.
            </p>
          </div>
          <Link
            href="/empresas"
            className="hidden items-center gap-1 text-sm font-semibold text-primary hover:text-primary sm:inline-flex"
          >
            Ver todas <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {categories.map((c) => (
            <Link
              key={c.id}
              href={`/empresas?category=${c.slug}`}
              className="group flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3.5 transition-all hover:border-primary/40 hover:bg-primary/10 hover:shadow-sm"
            >
              <span className="font-medium text-foreground group-hover:text-primary">
                {c.name}
              </span>
              {c.companyCount > 0 && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground group-hover:bg-primary/15 group-hover:text-primary">
                  {c.companyCount}
                </span>
              )}
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}
