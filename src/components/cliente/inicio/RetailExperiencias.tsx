import { ArrowRight } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import type { InicioVista } from '@/modules/home/vista'
import { RetailEmptyState } from './RetailEmptyState'

export function RetailExperiencias({ excursiones }: { excursiones: InicioVista['excursiones'] }) {
  if (excursiones.length === 0) {
    return (
      <RetailEmptyState
        title="Experiencias y excursiones"
        description="No hay experiencias disponibles para reservar ahora."
      />
    )
  }

  return (
    <section className="bg-background py-5 md:py-6" aria-labelledby="retail-experiencias">
      <div className="mx-auto max-w-6xl px-4 md:px-6">
        <h2 id="retail-experiencias" className="text-h2 text-foreground">Experiencias y excursiones</h2>
        <p className="mt-0.5 text-small text-muted-foreground">Planes para disfrutar con Membego</p>
        <ul className="mt-3 grid gap-2 md:grid-cols-2">
          {excursiones.map((excursion) => (
            <li key={excursion.id}>
              <Link
                href={excursion.href}
                className="group flex min-h-28 items-center gap-3 rounded-xl border border-border bg-card p-2 elevation-1"
              >
                {excursion.imagen ? (
                  <div className="relative aspect-square w-24 shrink-0 overflow-hidden rounded-lg bg-muted">
                    <Image
                      src={excursion.imagen}
                      alt={excursion.titulo}
                      fill
                      sizes="96px"
                      className="object-cover transition-transform duration-base group-hover:scale-105"
                    />
                  </div>
                ) : null}
                <div className="min-w-0 flex-1 py-1">
                  <p className="truncate text-caption font-semibold uppercase text-primary">{excursion.empresa}</p>
                  <h3 className="mt-0.5 line-clamp-2 text-h4 text-foreground">{excursion.titulo}</h3>
                  {excursion.descripcion ? (
                    <p className="mt-0.5 line-clamp-1 text-caption text-muted-foreground">{excursion.descripcion}</p>
                  ) : null}
                  <div className="mt-2 flex items-center justify-between gap-2">
                    {excursion.precio ? <span className="text-small font-bold text-primary">{excursion.precio}</span> : <span />}
                    <ArrowRight className="size-4 shrink-0 text-primary" aria-hidden />
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
