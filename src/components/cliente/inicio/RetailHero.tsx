import { ArrowRight } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import type { InicioVista } from '@/modules/home/vista'
import { RetailEmptyState } from './RetailEmptyState'

type HeroInicio = InicioVista['heroes'][number]

function RetailHeroCard({ hero, priority }: { hero: HeroInicio; priority: boolean }) {
  return (
    <Link
      href={hero.href}
      className="group flex w-5/6 max-w-sm shrink-0 snap-center flex-col overflow-hidden rounded-xl border border-border bg-card elevation-1 md:w-88"
    >
      <div className="flex flex-1 flex-col p-4">
        <span className="text-overline text-primary">Beneficio destacado</span>
        <h2 className="mt-2 text-h2 text-foreground">{hero.titulo}</h2>
        <p className="mt-1 text-small font-semibold text-primary">{hero.empresa}</p>
        {hero.subtitulo ? (
          <p className="mt-1 line-clamp-2 text-small text-muted-foreground">{hero.subtitulo}</p>
        ) : null}
      </div>

      {hero.imagen ? (
        <div className="relative aspect-video overflow-hidden bg-muted">
          <Image
            src={hero.imagen}
            alt={hero.titulo}
            fill
            priority={priority}
            sizes="(min-width: 768px) 22rem, 84vw"
            className="object-cover transition-transform duration-base group-hover:scale-105"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-foreground/30 to-transparent" />
        </div>
      ) : null}

      <div className="flex min-h-14 items-center justify-end border-t border-border px-4 py-2">
        <span className="inline-flex min-h-9 items-center gap-2 rounded-full bg-primary px-4 text-small font-semibold text-primary-foreground transition-colors duration-fast group-hover:bg-brand-primary-hover">
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
    <section className="bg-muted py-4 md:py-5" aria-label="Beneficios destacados">
      <div className="no-scrollbar flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 md:mx-auto md:max-w-6xl md:px-6">
        {heroes.map((hero, index) => (
          <RetailHeroCard key={`${hero.href}-${hero.titulo}`} hero={hero} priority={index === 0} />
        ))}
      </div>
    </section>
  )
}
