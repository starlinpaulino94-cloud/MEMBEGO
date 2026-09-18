import Link from 'next/link'
import Image from 'next/image'
import { Star, ChevronRight, ArrowRight, Sparkles } from 'lucide-react'
import type { InicioVista } from '@/modules/home/vista'
import { RailOverflowHint } from '@/components/ui/RailOverflowHint'
import { RetailEmptyState } from './RetailEmptyState'

/** Cinco estrellas rellenas según la valoración (violeta, como el diseño). */
function Estrellas({ valoracion }: { valoracion: number }) {
  const llenas = Math.round(valoracion)
  return (
    <span className="flex" role="img" aria-label={`${valoracion.toFixed(1)} de 5 estrellas`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          aria-hidden
          className={`size-3.5 ${n <= llenas ? 'fill-vibe-violet text-vibe-violet' : 'text-vibe-chip'}`}
        />
      ))}
    </span>
  )
}

/**
 * «Membresías recomendadas para ti» — carrusel horizontal en scroll continuo
 * (no-wrap) del rediseño violeta: imagen, «Empresa · Plan», estrellas de la
 * empresa con conteo, precio con periodo, botón «Aprovechar» y tarjeta final
 * para «Explorar todas».
 */
export function VibeRelacionado({
  planes,
  total,
}: {
  planes: InicioVista['planes']
  total: number
}) {
  if (planes.length === 0) {
    return (
      <RetailEmptyState
        title="Relacionado contigo"
        description="Cuando haya membresías publicadas, aparecerán aquí."
      />
    )
  }

  return (
    <section className="mt-6 px-4" aria-labelledby="vibe-relacionado">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="size-5 text-vibe-violet" aria-hidden />
          <h3 id="vibe-relacionado" className="min-w-0 text-h2 text-foreground">
            Membresías recomendadas para ti
          </h3>
        </div>
        <Link
          href="/cliente/planes?todos=1"
          className="flex shrink-0 items-center gap-0.5 text-label-sm font-bold text-vibe-violet hover:underline"
        >
          <span>Ver más{total > 0 ? ` (${total})` : ''}</span>
          <ChevronRight className="size-4" />
        </Link>
      </div>

      <RailOverflowHint className="from-vibe-fondo via-vibe-fondo/90 to-transparent text-vibe-violet">
        <div className="flex gap-3 overflow-x-auto pb-2 pr-10 scrollbar-none">
          {planes.map((p) => (
            <Link
              key={p.id}
              href={p.href}
              className="group flex w-56 shrink-0 flex-col justify-between rounded-xl border border-vibe-borde bg-card p-3 elevation-1 outline-none transition-transform duration-fast hover:scale-[1.01] focus-visible:ring-2 focus-visible:ring-vibe-violet active:scale-[0.99] sm:w-60 lg:w-64"
            >
              <div className="space-y-2">
                <div className="relative block h-32 w-full overflow-hidden rounded-lg bg-vibe-niebla">
                  {p.imagen ? (
                    <Image
                      src={p.imagen}
                      alt=""
                      fill
                      sizes="(min-width: 1024px) 16rem, 14rem"
                      className="object-cover transition-transform duration-normal group-hover:scale-105"
                    />
                  ) : (
                    <span aria-hidden className="flex size-full items-center justify-center text-h1 font-bold text-vibe-violet">
                      {p.empresa.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  {p.motivoRecomendacion ? (
                    <span className="absolute bottom-1.5 left-1.5 rounded-full bg-card/90 px-2 py-0.5 text-xs font-bold text-vibe-violet shadow-sm backdrop-blur-sm">
                      {p.motivoRecomendacion}
                    </span>
                  ) : null}
                </div>
                <h4 className="line-clamp-2 block text-label-md font-bold leading-tight text-foreground transition-colors group-hover:text-vibe-violet">
                  {p.empresa} · {p.nombre}
                </h4>
                {p.valoracion != null && Number.isFinite(Number(p.valoracion)) ? (
                  <div className="flex items-center gap-1">
                    <Estrellas valoracion={Number(p.valoracion)} />
                    <span className="text-label-sm font-medium tabular-nums text-muted-foreground">
                      {p.resenas.toLocaleString('es-DO')}
                    </span>
                  </div>
                ) : null}
                <div className="pt-1">
                  <span className="text-h3 tabular-nums text-foreground">{p.precio}</span>{' '}
                  <span className="text-small text-muted-foreground">{p.periodo}</span>
                </div>
              </div>
              <span className="grad-vibe mt-3 block w-full rounded-full py-2 text-center text-label-sm font-bold text-white shadow-sm">
                Aprovechar
              </span>
            </Link>
          ))}

          {/* Tarjeta de acción 'Explorar todas' */}
          <Link
            href="/cliente/planes?todos=1"
            className="flex w-36 shrink-0 flex-col items-center justify-center rounded-xl border border-dashed border-vibe-borde bg-card/40 p-4 text-center transition-colors hover:border-vibe-violet/50 hover:bg-card sm:w-40 lg:w-44"
          >
            <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-vibe-lavanda text-vibe-violet">
              <ArrowRight className="size-5" />
            </div>
            <span className="text-label-sm font-bold text-foreground">Explorar todas</span>
            <span className="text-xs text-muted-foreground">+{total} membresías</span>
          </Link>
        </div>
      </RailOverflowHint>
    </section>
  )
}
