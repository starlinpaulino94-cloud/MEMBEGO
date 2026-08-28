import Link from 'next/link'
import {
  Megaphone,
  CalendarDays,
  Newspaper,
  BadgeCheck,
  ArrowRight,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { NovedadInicio } from '@/modules/social/queries'

interface TipoMeta {
  label: string
  icon: LucideIcon
  /** Fondo de la tarjeta rica (gradiente de marca por tipo). */
  bg: string
  /** Chip de categoría sobre el fondo oscuro. */
  chip: string
  cta: string
}

const TIPO_META: Record<string, TipoMeta> = {
  PROMOCION: {
    label: 'Promoción',
    icon: Megaphone,
    bg: 'bg-gradient-to-br from-rose-500 via-orange-500 to-amber-500',
    chip: 'bg-white/20 text-white',
    cta: 'Obtener beneficio',
  },
  EVENTO: {
    label: 'Evento',
    icon: CalendarDays,
    bg: 'bg-gradient-to-br from-violet-600 via-violet-500 to-fuchsia-500',
    chip: 'bg-white/20 text-white',
    cta: 'Ver evento',
  },
  NOTICIA: {
    label: 'Noticia',
    icon: Newspaper,
    bg: 'bg-gradient-to-br from-slate-700 via-slate-600 to-slate-500',
    chip: 'bg-white/20 text-white',
    cta: 'Leer más',
  },
  BENEFICIO: {
    label: 'Beneficio',
    icon: BadgeCheck,
    bg: 'bg-gradient-to-br from-blue-600 via-blue-500 to-cyan-500',
    chip: 'bg-white/20 text-white',
    cta: 'Obtener beneficio',
  },
}

function fmtFecha(d: Date) {
  return new Intl.DateTimeFormat('es-DO', {
    timeZone: 'America/Santo_Domingo',
    day: 'numeric',
    month: 'short',
  }).format(new Date(d))
}

/**
 * Novedades de las empresas que el cliente sigue, como carrusel horizontal de
 * tarjetas ricas (estilo Airbnb): fondo con gradiente por categoría, icono
 * de marca de agua, badge del tipo y CTA de un toque.
 */
export function FeedNovedades({ novedades }: { novedades: NovedadInicio[] }) {
  if (novedades.length === 0) return null

  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            Novedades de tus empresas
          </h2>
          <p className="text-sm text-muted-foreground">
            Lo último para ti: eventos, noticias y beneficios.
          </p>
        </div>
        <Link
          href="/cliente/promociones"
          className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-sm font-semibold text-primary transition hover:bg-primary/10"
        >
          Ver todo <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      <div className="no-scrollbar -mx-1 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-px-1 px-1 pb-2">
        {novedades.map((n) => {
          const meta = TIPO_META[n.tipo] ?? TIPO_META.NOTICIA
          const Icon = meta.icon
          return (
            <Link
              key={`${n.tipo}-${n.id}`}
              href={n.href}
              className={`group relative flex w-[240px] shrink-0 snap-start flex-col justify-between overflow-hidden rounded-2xl p-4 text-white shadow-card transition hover:-translate-y-0.5 hover:shadow-premium sm:w-[264px] ${meta.bg}`}
            >
              {/* Icono de marca de agua */}
              <Icon
                aria-hidden
                className="pointer-events-none absolute -bottom-5 -right-4 h-24 w-24 text-white/10 transition-transform duration-hero group-hover:scale-110"
              />
              <div className="relative flex items-center justify-between gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${meta.chip}`}
                >
                  {meta.label}
                </span>
                {n.tipo === 'EVENTO' && (
                  <span className="text-xs font-medium text-white/80">
                    {fmtFecha(n.fecha)}
                  </span>
                )}
              </div>
              <div className="relative mt-6 min-h-[3.75rem]">
                <p className="line-clamp-2 text-[15px] font-bold leading-snug">
                  {n.titulo}
                </p>
                <p className="mt-1 truncate text-xs text-white/70">{n.companyName}</p>
              </div>
              {/* CTA de un toque (≥48px con el padding de la tarjeta) */}
              <span className="relative mt-4 inline-flex min-h-10 w-fit items-center gap-1.5 rounded-full bg-white px-4 text-xs font-bold text-foreground shadow-sm transition group-hover:gap-2.5">
                {meta.cta} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </span>
            </Link>
          )
        })}
      </div>
    </section>
  )
}
