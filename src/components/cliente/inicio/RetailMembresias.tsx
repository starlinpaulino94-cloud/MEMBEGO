import { ArrowRight } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import type { InicioVista } from '@/modules/home/vista'
import { RetailEmptyState } from './RetailEmptyState'

export function RetailMembresias({ planes }: { planes: InicioVista['planes'] }) {
  if (planes.length === 0) {
    return (
      <RetailEmptyState
        title="Membresías recomendadas"
        description="No hay membresías disponibles para recomendar ahora."
      />
    )
  }

  return (
    <section className="bg-muted py-5 md:py-6" aria-labelledby="retail-membresias">
      <div className="mx-auto max-w-6xl px-4 md:px-6">
        <h2 id="retail-membresias" className="text-h2 text-foreground">Membresías recomendadas</h2>
        <p className="mt-0.5 text-small text-muted-foreground">Beneficios continuos en negocios asociados</p>
        <ul className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {planes.map((plan) => (
            <li key={plan.id}>
              <Link
                href={plan.href}
                className="group flex h-full flex-col rounded-xl border border-border bg-card p-2 elevation-1"
              >
                {plan.imagen ? (
                  <div className="relative aspect-square overflow-hidden rounded-lg bg-muted">
                    <Image
                      src={plan.imagen}
                      alt={plan.titulo}
                      fill
                      sizes="(min-width: 1024px) 16rem, (min-width: 768px) 33vw, 50vw"
                      className="object-cover transition-transform duration-base group-hover:scale-105"
                    />
                  </div>
                ) : null}
                <div className="flex flex-1 flex-col px-1 py-2">
                  <p className="text-caption font-semibold uppercase text-primary">{plan.empresa}</p>
                  <h3 className="mt-0.5 line-clamp-2 text-h4 text-foreground">{plan.titulo}</h3>
                  {plan.descripcion ? (
                    <p className="mt-1 line-clamp-2 text-caption text-muted-foreground">{plan.descripcion}</p>
                  ) : null}
                  <div className="mt-auto flex items-center justify-between gap-2 pt-3">
                    {plan.precio ? <span className="text-h3 text-foreground">{plan.precio}</span> : <span />}
                    <span className="flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <ArrowRight className="size-4" aria-hidden />
                    </span>
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
