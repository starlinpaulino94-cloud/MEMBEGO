import Link from 'next/link'
import type { InicioVista } from '@/modules/home/vista'
import { RetailEmptyState } from './RetailEmptyState'
import { PieBanner, TarjetaBanner, llevaPie } from './TarjetaBanner'

/**
 * HÉROE del rediseño violeta (Stitch «amazon style», aprobado 2026-09-10) con
 * los tres formatos de banner (aprobado 2026-10-29).
 *
 * Tarjetas altas a foto completa; la siguiente se ASOMA (86vw + snap) y los
 * puntos cierran abajo. Cómo va el texto sobre cada foto lo decide el negocio
 * banner a banner (`TarjetaBanner`): si la imagen ya lo dice todo, no se le
 * pone nada encima.
 *
 * Datos: los banners configurados en Personalizar inicio van primero y las
 * promociones destacadas rellenan. La tarjeta entera es el enlace; el botón y
 * el pie son visuales.
 */
export function VibeHero({
  heroes,
  categoriaActiva,
}: {
  heroes: InicioVista['heroes']
  categoriaActiva?: string | null
}) {
  if (heroes.length === 0) {
    if (categoriaActiva) return null
    return (
      <RetailEmptyState
        title="Novedades"
        description="Cuando haya beneficios destacados, aparecerán aquí."
      />
    )
  }

  return (
    <section className="pt-2" aria-label="Beneficios destacados">
      <div className="relative no-scrollbar flex snap-x snap-mandatory items-start gap-3 overflow-x-auto px-4 py-2">
        {heroes.map((hero, i) => (
          <Link
            key={`${hero.href}-${i}`}
            href={hero.href}
            aria-label={`${hero.titulo || hero.cta} · ${hero.empresa}`}
            className="block w-[86vw] max-w-[340px] shrink-0 snap-center rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-vibe-violet"
          >
            <TarjetaBanner hero={hero} className="aspect-[4/5] w-full" prioridad={i === 0} />
            {llevaPie(hero) ? <PieBanner hero={hero} /> : null}
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
