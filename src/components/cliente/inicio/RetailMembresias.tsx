import Image from 'next/image'
import Link from 'next/link'
import type { InicioVista } from '@/modules/home/vista'
import { RetailEmptyState } from './RetailEmptyState'
import { RetailSeccionHeader, RetailSeccionPie } from './RetailSeccion'

/**
 * Membresías recomendadas — retícula de dos columnas sobre banda tintada.
 *
 * El diseño remata cada tarjeta con un botón «Unirme» en píldora y a todo el
 * ancho. Antes había una flecha en un círculo: la misma acción, pero mucho más
 * pequeña que el gesto que se le pide a alguien —contratar un plan— y sin
 * decir qué hace al pulsarla.
 */
export function RetailMembresias({
  planes,
  total,
}: {
  planes: InicioVista['planes']
  total: number
}) {
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
        <RetailSeccionHeader
          id="retail-membresias"
          titulo="Membresías recomendadas"
          bajada="Paga mensual y disfruta beneficios continuos"
        />

        <ul className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {planes.map((plan) => (
            <li key={plan.id} className="flex">
              <div className="flex w-full flex-col overflow-hidden rounded-lg border border-border bg-card elevation-1">
                {/* Sin arte no se reserva el hueco: un cuadro gris vacío ocupa
                    la mitad de la tarjeta y no dice nada. */}
                {plan.imagen ? (
                  <div className="relative aspect-square bg-muted">
                    <Image
                      src={plan.imagen}
                      alt=""
                      fill
                      sizes="(min-width: 1024px) 16rem, (min-width: 768px) 33vw, 50vw"
                      className="object-cover"
                    />
                  </div>
                ) : null}

                <div className="flex flex-1 flex-col p-3">
                  <p className="line-clamp-1 text-label-sm font-semibold uppercase text-muted-foreground">
                    {plan.empresa}
                  </p>
                  <h3 className="mt-0.5 line-clamp-2 text-h4 text-foreground">{plan.nombre}</h3>
                  {plan.descripcion ? (
                    <p className="mt-1 line-clamp-2 text-caption text-muted-foreground">
                      {plan.descripcion}
                    </p>
                  ) : null}

                  <p className="mt-2 flex flex-wrap items-baseline gap-1">
                    <span className="text-price-lg text-foreground">{plan.precio}</span>
                    <span className="text-caption text-muted-foreground">{plan.periodo}</span>
                  </p>

                  <Link
                    href={plan.href}
                    className="mt-3 flex min-h-10 w-full items-center justify-center rounded-full bg-primary px-4 text-label-lg text-primary-foreground outline-none transition-colors duration-fast hover:bg-brand-primary-hover focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 active:scale-[0.98]"
                  >
                    Unirme
                    <span className="sr-only"> a {plan.nombre} de {plan.empresa}</span>
                  </Link>
                </div>
              </div>
            </li>
          ))}
        </ul>

        {total > planes.length ? (
          <RetailSeccionPie href="/cliente/planes">
            Ver todas las {total} membresías activas
          </RetailSeccionPie>
        ) : null}
      </div>
    </section>
  )
}
