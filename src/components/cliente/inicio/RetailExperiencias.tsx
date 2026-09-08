import Image from 'next/image'
import Link from 'next/link'
import type { InicioVista } from '@/modules/home/vista'
import { RetailEmptyState } from './RetailEmptyState'
import { RetailSeccionHeader } from './RetailSeccion'

/**
 * Experiencias y excursiones — lista vertical, no retícula.
 *
 * El diseño las presenta como filas anchas con miniatura a la izquierda, el
 * sello de duración encima, y precio y acción a la derecha. Tiene sentido: una
 * excursión se elige leyendo qué incluye y cuánto dura, y eso no cabe en una
 * tarjeta de media columna.
 *
 * El sello de duración sale de `duracionMin`, que ya existía en el modelo.
 */
export function RetailExperiencias({
  experiencias,
}: {
  experiencias: InicioVista['experiencias']
}) {
  if (experiencias.length === 0) {
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
        <RetailSeccionHeader
          id="retail-experiencias"
          titulo="Experiencias y excursiones"
          bajada="Reserva paseos de fin de semana con tarifa Membego"
          enlace={{ href: '/cliente/excursiones', texto: 'Ver más' }}
        />

        <ul className="mt-3 space-y-2">
          {experiencias.map((experiencia) => (
            <li key={experiencia.id}>
              <div className="flex gap-3 rounded-lg border border-border bg-card p-2 elevation-1">
                <div className="relative aspect-square w-24 shrink-0 overflow-hidden rounded-lg bg-muted sm:w-28">
                  {experiencia.imagen ? (
                    <Image
                      src={experiencia.imagen}
                      alt=""
                      fill
                      sizes="7rem"
                      className="object-cover"
                    />
                  ) : null}
                  {experiencia.duracion ? (
                    <span className="absolute bottom-1 left-1 rounded-full bg-foreground/85 px-2 py-0.5 text-label-sm font-semibold text-background">
                      {experiencia.duracion}
                    </span>
                  ) : null}
                </div>

                <div className="flex min-w-0 flex-1 flex-col py-0.5">
                  <p className="line-clamp-1 text-label-sm font-semibold uppercase text-muted-foreground">
                    {experiencia.empresa}
                  </p>
                  <h3 className="mt-0.5 line-clamp-1 text-h4 text-foreground">
                    {experiencia.nombre}
                  </h3>
                  {experiencia.descripcion ? (
                    <p className="mt-0.5 line-clamp-2 text-caption text-muted-foreground">
                      {experiencia.descripcion}
                    </p>
                  ) : null}

                  <div className="mt-auto flex flex-wrap items-end justify-between gap-2 pt-2">
                    <div className="min-w-0">
                      {experiencia.precio ? (
                        <>
                          <span className="block text-price-lg text-foreground">
                            {experiencia.precio}
                          </span>
                          <span className="block text-label-sm text-muted-foreground">
                            Precio socio Membego
                          </span>
                        </>
                      ) : null}
                    </div>
                    <Link
                      href={experiencia.href}
                      className="inline-flex min-h-9 shrink-0 items-center rounded-full bg-primary px-4 text-label-lg text-primary-foreground outline-none transition-colors duration-fast hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 active:scale-[0.98]"
                    >
                      Reservar cupo
                      <span className="sr-only"> · {experiencia.nombre}</span>
                    </Link>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
