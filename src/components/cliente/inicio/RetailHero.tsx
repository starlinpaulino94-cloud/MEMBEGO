import { ArrowRight, MapPin } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import type { InicioVista } from '@/modules/home/vista'
import { RetailEmptyState } from './RetailEmptyState'

type Hero = InicioVista['heroes'][number]

/**
 * Carrusel hero — la tarjeta que abre el Inicio.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Tres cosas del diseño que faltaban:
 *
 *  · La ciudad como sello junto al sobretítulo: quien mira necesita saber si
 *    esa oferta le queda cerca antes de leerla entera.
 *  · La fila «Planes desde …» bajo el texto. Es el gancho comercial de la
 *    tarjeta, y sale del plan más barato de esa empresa.
 *  · Que la siguiente tarjeta ASOME por el borde. No es un adorno: es lo que
 *    dice que hay más de una y que se desliza. Sin eso, un carrusel de tres
 *    banners se lee como uno solo.
 *
 * El ancho de la tarjeta (85 %) es lo que deja ese asomo en móvil. En pantalla
 * grande el asomo deja de hacer falta y las tarjetas se reparten la fila: con
 * una sola diapositiva, un ancho fijo dejaba dos tercios de pantalla vacíos,
 * que es lo que el rediseño vino a quitar.
 */
function HeroCard({ hero, priority }: { hero: Hero; priority: boolean }) {
  return (
    <Link
      href={hero.href}
      className="group flex w-[85%] shrink-0 snap-start flex-col overflow-hidden rounded-lg border border-border bg-card elevation-1 outline-none transition-colors duration-fast hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary sm:w-96 lg:w-auto lg:min-w-0 lg:flex-1"
    >
      {/* El tinte sale del color de marca del negocio, como Amazon tiñe cada
          campaña con su arte: dato real, 9% de opacidad para no comerse el
          texto. Sin color declarado, la tarjeta queda blanca. */}
      <div
        className="flex flex-col gap-1 p-4 pb-3"
        style={hero.color ? { backgroundColor: `${hero.color}17` } : undefined}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-overline text-primary">Beneficio destacado</span>
          {hero.ciudad ? (
            <span className="inline-flex items-center gap-1 text-label-md text-muted-foreground">
              <MapPin className="size-3.5 text-primary" aria-hidden />
              {hero.ciudad}
            </span>
          ) : null}
        </div>

        <h2 className="text-h2 text-balance text-foreground">{hero.titulo}</h2>
        <p className="text-label-lg text-primary">{hero.empresa}</p>
        {hero.subtitulo ? (
          <p className="line-clamp-2 text-caption text-muted-foreground">{hero.subtitulo}</p>
        ) : null}
      </div>

      {hero.imagen ? (
        <div className="relative aspect-video bg-muted">
          <Image
            src={hero.imagen}
            alt=""
            fill
            priority={priority}
            sizes="(min-width: 640px) 24rem, 85vw"
            className="object-cover transition-transform duration-base group-hover:scale-105"
          />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 p-4 pt-3">
        {hero.planDesde ? (
          <span className="min-w-0 text-label-lg text-foreground">{hero.planDesde}</span>
        ) : (
          <span />
        )}
        <span className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full bg-primary px-5 text-label-lg text-primary-foreground transition-colors duration-fast group-hover:bg-brand-primary-hover">
          {hero.cta}
          <ArrowRight className="size-4" aria-hidden />
        </span>
      </div>
    </Link>
  )
}

export function RetailHero({ heroes }: { heroes: InicioVista['heroes'] }) {
  if (heroes.length === 0) {
    return (
      <RetailEmptyState
        title="Beneficios destacados"
        description="No hay beneficios destacados disponibles ahora."
      />
    )
  }

  return (
    <section className="bg-retail-mist py-4 md:py-5" aria-label="Beneficios destacados">
      <div className="relative no-scrollbar mx-auto flex max-w-6xl snap-x snap-mandatory gap-3 overflow-x-auto px-4 md:px-6">
        {heroes.map((hero, index) => (
          <HeroCard key={`${hero.href}-${hero.titulo}`} hero={hero} priority={index === 0} />
        ))}
      </div>
    </section>
  )
}
