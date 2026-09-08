import { ArrowRight, Star } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import type { InicioVista } from '@/modules/home/vista'
import { RetailEmptyState } from './RetailEmptyState'

export function RetailDestacadas({ empresas }: { empresas: InicioVista['empresas'] }) {
  if (empresas.length === 0) {
    return (
      <RetailEmptyState
        title="Empresas destacadas"
        description="No hay empresas destacadas disponibles ahora."
      />
    )
  }

  return (
    <section className="bg-background py-5 md:py-6" aria-labelledby="retail-destacadas">
      <div className="mx-auto max-w-6xl px-4 md:px-6">
        <h2 id="retail-destacadas" className="text-h2 text-foreground">Empresas destacadas</h2>
        <p className="mt-0.5 text-small text-muted-foreground">Negocios con membresía Membego</p>
      </div>
      <ul className="no-scrollbar mx-auto mt-3 flex max-w-6xl gap-3 overflow-x-auto px-4 md:grid md:grid-cols-3 md:px-6">
        {empresas.map((empresa) => (
          <li key={empresa.id} className="w-64 shrink-0 md:w-auto">
            <Link
              href={empresa.href}
              className="group flex h-full flex-col rounded-xl border border-border bg-card p-2 elevation-1 transition-transform duration-base hover:-translate-y-0.5"
            >
              {empresa.imagen ? (
                <div className="relative aspect-2/1 overflow-hidden rounded-lg bg-muted">
                  <Image
                    src={empresa.imagen}
                    alt={empresa.titulo}
                    fill
                    sizes="(min-width: 768px) 33vw, 16rem"
                    className="object-cover transition-transform duration-base group-hover:scale-105"
                  />
                </div>
              ) : null}
              <div className="flex flex-1 flex-col px-1 py-2">
                <p className="text-caption font-semibold uppercase text-primary">{empresa.empresa}</p>
                <h3 className="mt-0.5 line-clamp-2 text-h4 text-foreground">{empresa.titulo}</h3>
                {empresa.descripcion ? (
                  <p className="mt-0.5 line-clamp-2 text-caption text-muted-foreground">{empresa.descripcion}</p>
                ) : null}
                <div className="mt-auto flex items-end justify-between gap-2 pt-2">
                  <div>
                    {empresa.rating !== null ? (
                      <span className="inline-flex items-center gap-1 text-caption font-semibold text-foreground">
                        <Star className="size-3.5 fill-retail-star text-retail-star" aria-hidden />
                        {empresa.rating.toFixed(1)}
                      </span>
                    ) : null}
                    {empresa.precio ? <p className="text-h4 text-primary">{empresa.precio}</p> : null}
                  </div>
                  <ArrowRight className="size-5 text-primary" aria-hidden />
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
