import Link from 'next/link'
import Image from 'next/image'
import { ArrowRight, Star } from 'lucide-react'
import type { InicioVista } from '@/modules/home/vista'
import { RetailEmptyState } from './RetailEmptyState'

/**
 * HÉROE del rediseño violeta (Stitch «amazon style», aprobado 2026-09-10).
 *
 * Tarjetas altas a foto completa con velo nocturno, sello «Novedad
 * destacada», titular grande, la tarjeta interior blanca con la empresa, su
 * «desde» y su valoración, y el CTA en degradado violeta→cobalto→cian. La
 * siguiente tarjeta se ASOMA (86vw + snap) y los puntos cierran abajo.
 *
 * Datos: los mismos heroes de siempre — slides publicados por el editor o,
 * por defecto, las promociones destacadas del marketplace. La tarjeta entera
 * es el enlace; el botón es visual.
 */
export function VibeHero({ heroes }: { heroes: InicioVista['heroes'] }) {
  if (heroes.length === 0) {
    return (
      <RetailEmptyState
        title="Novedades"
        description="Cuando haya beneficios destacados, aparecerán aquí."
      />
    )
  }

  return (
    <section className="pt-2" aria-label="Beneficios destacados">
      <div className="relative no-scrollbar flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 py-2">
        {heroes.map((hero, i) => (
          <Link
            key={`${hero.href}-${i}`}
            href={hero.href}
            className="relative block h-[380px] w-[86vw] max-w-[340px] shrink-0 snap-center overflow-hidden rounded-2xl elevation-2 outline-none focus-visible:ring-2 focus-visible:ring-vibe-violet"
          >
            {hero.imagen ? (
              <Image
                src={hero.imagen}
                alt=""
                fill
                sizes="(min-width: 640px) 340px, 86vw"
                className="object-cover"
                priority={i === 0}
              />
            ) : (
              <span aria-hidden className="grad-vibe-header absolute inset-0" />
            )}
            <span aria-hidden className="grad-vibe-noche absolute inset-0" />

            <div className="relative z-10 flex h-full flex-col justify-between p-5">
              <div className="space-y-1">
                <span className="grad-vibe inline-block rounded-full px-3 py-1 text-label-sm font-bold uppercase tracking-wider text-white">
                  Novedad destacada
                </span>
                <h2 className="mt-2 font-display text-4xl font-extrabold leading-tight text-white">
                  {hero.titulo}
                </h2>
                {hero.subtitulo ? (
                  <span className="block text-small font-medium text-vibe-celeste">
                    {hero.subtitulo}
                  </span>
                ) : null}
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3 rounded-xl border border-vibe-borde bg-card/95 p-3 backdrop-blur">
                  <div className="min-w-0">
                    <span className="block truncate text-label-sm font-bold text-foreground">
                      {hero.empresa}
                    </span>
                    {hero.planDesde ? (
                      <span className="block truncate text-label-sm font-bold text-vibe-ink">
                        {hero.planDesde}
                      </span>
                    ) : null}
                  </div>
                  {hero.valoracion != null && Number.isFinite(Number(hero.valoracion)) ? (
                    <span className="flex shrink-0 items-center gap-1 rounded-lg bg-vibe-niebla px-2 py-1">
                      <Star className="size-3.5 fill-vibe-violet text-vibe-violet" aria-hidden />
                      <span className="text-label-sm font-bold text-foreground tabular-nums">
                        {Number(hero.valoracion).toFixed(1)}
                      </span>
                    </span>
                  ) : null}
                </div>
                <span className="grad-vibe-cta flex w-full items-center justify-center gap-2 rounded-full py-3 text-label-md font-bold text-white">
                  {hero.cta}
                  <ArrowRight className="size-4" aria-hidden />
                </span>
              </div>
            </div>
          </Link>
        ))}
      </div>
      <div className="flex items-center justify-center gap-1.5 pt-1" aria-hidden>
        {heroes.map((_, i) => (
          <span
            key={i}
            className={i === 0 ? 'grad-vibe h-1.5 w-6 rounded-full' : 'h-1.5 w-2 rounded-full bg-vibe-lavanda'}
          />
        ))}
      </div>
    </section>
  )
}
