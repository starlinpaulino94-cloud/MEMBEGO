import Link from 'next/link'
import Image from 'next/image'
import { ChevronRight, Clock, Timer } from 'lucide-react'
import type { InicioVista } from '@/modules/home/vista'
import { VibeCountdown } from './VibeCountdown'

function fechaCorta(d: string) {
  return new Intl.DateTimeFormat('es-DO', {
    timeZone: 'America/Santo_Domingo',
    day: 'numeric',
    month: 'short',
  }).format(new Date(d))
}

/**
 * El bloque relámpago del rediseño violeta: cabecera de sección con salida a
 * las excursiones y, dentro, la tarjeta lavanda «Ofertas Relámpago» con el
 * countdown de la oferta más urgente y sus filas.
 *
 * Adaptaciones honestas sobre el export de Stitch (que traía excursiones de
 * maqueta): las filas son las promociones COMPRABLES vigentes reales, la
 * línea del cronómetro dice «Hasta el {fecha}» (una promoción no tiene
 * «duración») y el sello solo aparece cuando la promoción declara descuento.
 * Sin oferta vigente, el bloque no existe: un relámpago sin reloj miente.
 */
export function VibeRelampago({ relampago }: { relampago: InicioVista['relampago'] }) {
  if (!relampago || relampago.promos.length === 0) return null

  return (
    <section className="mt-6 px-4" aria-labelledby="vibe-relampago">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="min-w-0 text-h2 text-foreground">Experiencias y excursiones</h3>
        <Link
          href="/cliente/excursiones"
          aria-label="Ver excursiones"
          className="shrink-0 rounded-full p-1 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-vibe-violet"
        >
          <ChevronRight className="size-5" aria-hidden />
        </Link>
      </div>

      <div className="space-y-3 rounded-2xl bg-vibe-lavanda p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Timer className="size-5 shrink-0 text-vibe-violet" aria-hidden />
            <h4 id="vibe-relampago" className="truncate text-h3 text-foreground">
              Ofertas Relámpago
            </h4>
          </div>
          <span className="shrink-0 rounded-full border border-vibe-chip bg-card px-2.5 py-1 text-label-sm font-bold tracking-tight text-vibe-violet">
            <VibeCountdown hasta={relampago.hasta} />
          </span>
        </div>

        {relampago.promos.map((p, i) => (
          <Link
            key={p.id}
            href={p.href}
            className="flex gap-2 rounded-xl border border-vibe-borde bg-card p-2 elevation-1 outline-none transition-transform duration-fast focus-visible:ring-2 focus-visible:ring-vibe-violet active:scale-[0.99]"
          >
            <span className="relative block size-28 shrink-0 overflow-hidden rounded-lg bg-vibe-niebla">
              {p.imagen ? (
                <Image src={p.imagen} alt="" fill sizes="7rem" className="object-cover" />
              ) : (
                <span aria-hidden className="flex size-full items-center justify-center text-h1 text-vibe-violet">
                  {p.titulo.slice(0, 1).toUpperCase()}
                </span>
              )}
              {p.descuento ? (
                <span
                  className={`absolute bottom-1 left-1 rounded px-1.5 py-0.5 text-label-sm font-bold text-white ${
                    i % 2 === 0 ? 'grad-vibe' : 'grad-vibe-cyan'
                  }`}
                >
                  {p.descuento}
                </span>
              ) : null}
            </span>
            <span className="flex min-w-0 flex-1 flex-col justify-between">
              <span>
                <span className="flex items-center gap-1 text-label-sm font-medium text-muted-foreground">
                  <Clock className="size-3.5 text-vibe-violet" aria-hidden />
                  Hasta el {fechaCorta(p.hasta)}
                </span>
                <span className="block truncate text-h4 text-foreground">{p.titulo}</span>
                <span className="block truncate text-small text-muted-foreground">{p.empresa}</span>
              </span>
              <span className="flex items-end justify-between gap-2 pt-1">
                {p.precio ? (
                  <span className="text-label-lg font-bold tabular-nums text-vibe-violet">
                    {p.precio}
                  </span>
                ) : (
                  <span />
                )}
                <span className="grad-vibe rounded-full px-3 py-1.5 text-label-sm font-bold text-white">
                  Canjear
                </span>
              </span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  )
}
