import Link from 'next/link'
import Image from 'next/image'
import { ArrowRight, Clock, MapPin, Compass, Users, AlertCircle, X } from 'lucide-react'
import { formatMoney } from '@/lib/format'

export interface ExcursionCardData {
  id: string
  nombre: string
  slug: string
  descripcion?: string | null
  portadaUrl?: string | null
  categoria?: string | null
  duracionMin?: number | null
  ubicacion?: string | null
  precioDesde?: number | null
  moneda?: string
  agotadaGlobal?: boolean
  todasFechasPasadas?: boolean
  cupoDisponible?: number | null
  proximasSalidas?: { fecha: string; cupoDisponible: number }[]
  empresa?: {
    id?: string
    slug?: string
    name: string
    logoUrl?: string | null
  } | null
}

interface ExcursionCardProps {
  excursion: ExcursionCardData
  variant?: 'default' | 'compact'
  hrefBase?: string
  retorno?: string
}

function detalleHref(excursion: ExcursionCardData, hrefBase?: string, retorno?: string) {
  let base: string
  if (hrefBase) {
    base = `${hrefBase}/${excursion.slug}`
  } else if (excursion.empresa?.slug) {
    base = `/empresas/${excursion.empresa.slug}/excursiones/${excursion.slug}`
  } else {
    base = `/excursiones/${excursion.slug}`
  }
  return retorno ? `${base}?retorno=${encodeURIComponent(retorno)}` : base
}

export function ExcursionCard({
  excursion,
  variant = 'default',
  hrefBase,
  retorno,
}: ExcursionCardProps) {
  const targetHref = detalleHref(excursion, hrefBase, retorno)
  const isAgotada = excursion.agotadaGlobal ?? false
  const isPasada = excursion.todasFechasPasadas ?? false
  const disabled = isAgotada || isPasada
  const cupos = excursion.cupoDisponible

  if (variant === 'compact') {
    return (
      <Link href={targetHref} className={`group block ${disabled ? 'opacity-60' : ''}`}>
        <div className="card-interactive overflow-hidden rounded-xl border border-border bg-card">
          <div className="relative h-24 w-full overflow-hidden bg-gradient-brand">
            {excursion.portadaUrl ? (
              <Image
                src={excursion.portadaUrl}
                alt={excursion.nombre}
                fill
                className="object-cover transition-transform duration-500 group-hover:scale-105"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center">
                <Compass className="h-6 w-6 text-white/70" aria-hidden />
              </div>
            )}
            {excursion.categoria && (
              <span className="absolute left-2 top-2 rounded-full bg-card/90 px-2 py-0.5 text-caption font-bold text-primary backdrop-blur elevation-1">
                {excursion.categoria}
              </span>
            )}
          </div>
          <div className="p-3">
            <p className="line-clamp-1 text-small font-semibold text-foreground">
              {excursion.nombre}
            </p>
            {excursion.empresa?.name && (
              <p className="mt-0.5 line-clamp-1 text-caption text-muted-foreground">
                {excursion.empresa.name}
              </p>
            )}
          </div>
        </div>
      </Link>
    )
  }

  return (
    <Link href={targetHref} className={`group block h-full ${disabled ? 'opacity-70' : ''}`}>
      <div className="card-interactive relative flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card">
        {/* Imagen protagonista */}
        <div className="relative h-44 w-full overflow-hidden bg-gradient-brand">
          {excursion.portadaUrl ? (
            <Image
              src={excursion.portadaUrl}
              alt={excursion.nombre}
              fill
              className="object-cover transition-transform duration-500 group-hover:scale-105"
            />
          ) : (
            <>
              <div className="absolute inset-0 bg-grid-light opacity-50" />
              <div className="absolute inset-0 flex items-center justify-center">
                <Compass className="h-10 w-10 text-white/60" aria-hidden />
              </div>
            </>
          )}

          {/* Gradiente para legibilidad del chip de empresa */}
          <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/40 to-transparent" />

          {/* Categoría: badge arriba a la izquierda */}
          {excursion.categoria && !disabled && (
            <span className="absolute left-3 top-3 rounded-lg bg-card/95 px-2.5 py-1 text-caption font-bold tracking-tight text-primary shadow-sm backdrop-blur">
              {excursion.categoria}
            </span>
          )}

          {/* Badges de estado (derecha) */}
          <div className="absolute right-3 top-3 flex flex-col items-end gap-1.5">
            {isPasada && (
              <span className="rounded-full bg-destructive px-2.5 py-1 text-caption font-bold uppercase tracking-wide text-white">
                Finalizada
              </span>
            )}
            {isAgotada && !isPasada && (
              <span className="rounded-full bg-foreground/85 px-2.5 py-1 text-caption font-bold uppercase tracking-wide text-background">
                Agotada
              </span>
            )}
            {!disabled && cupos != null && cupos > 0 && cupos <= 5 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-warning px-2.5 py-1 text-caption font-bold uppercase tracking-wide text-warning-foreground">
                <Users className="h-3 w-3" aria-hidden /> Últimos {cupos} cupos
              </span>
            )}
          </div>

          {/* Empresa: chip glass sobre la imagen */}
          {excursion.empresa?.name && (
            <div className="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-full bg-card/90 py-1 pl-1 pr-3 backdrop-blur elevation-1">
              {excursion.empresa.logoUrl ? (
                <span className="relative block h-5 w-5 overflow-hidden rounded-full">
                  <Image src={excursion.empresa.logoUrl} alt="" fill className="object-cover" />
                </span>
              ) : (
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[12px] font-bold leading-none text-primary-foreground">
                  {excursion.empresa.name.slice(0, 1).toUpperCase()}
                </span>
              )}
              <span className="max-w-36 truncate text-caption font-medium text-foreground">
                {excursion.empresa.name}
              </span>
            </div>
          )}

          {/* Estado deshabilitado overlay */}
          {disabled && (
            <div className="absolute inset-0 flex items-center justify-center bg-foreground/50 backdrop-blur-[2px]">
              <span className="rounded-full border border-white/40 px-4 py-1.5 text-small font-semibold text-white">
                {isPasada ? 'Excursión finalizada' : 'Cupos agotados'}
              </span>
            </div>
          )}
        </div>

        {/* Contenido */}
        <div className="flex flex-1 flex-col p-5">
          <h3 className="line-clamp-2 text-h3 text-foreground">
            {excursion.nombre}
          </h3>

          {excursion.descripcion && (
            <p className="mt-1.5 line-clamp-2 text-small text-muted-foreground">
              {excursion.descripcion}
            </p>
          )}

          {/* Meta tags: Duración y Ubicación */}
          <div className="mt-3 flex flex-wrap items-center gap-3 text-caption text-muted-foreground">
            {excursion.ubicacion && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5 text-primary" aria-hidden />
                <span className="truncate max-w-[140px]">{excursion.ubicacion}</span>
              </span>
            )}
            {excursion.duracionMin && (
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3.5 w-3.5 text-primary" aria-hidden />
                {excursion.duracionMin} min
              </span>
            )}
          </div>

          {/* Precio Desde */}
          {excursion.precioDesde != null && !disabled && (
            <div className="mt-3">
              <span className="text-caption text-muted-foreground">Desde</span>
              <p className="text-h1 tabular-nums text-foreground">
                {formatMoney(excursion.precioDesde, { moneda: excursion.moneda || 'DOP' })}
              </p>
            </div>
          )}

          {/* CTA gigante, siempre visible */}
          <div className="mt-auto pt-4">
            <span
              className={`inline-flex min-h-12 w-full items-center justify-center gap-1.5 rounded-lg text-small font-bold transition group-hover:opacity-90 group-active:scale-[0.99] ${
                disabled
                  ? 'bg-muted text-muted-foreground'
                  : 'bg-primary text-primary-foreground'
              }`}
            >
              {disabled ? 'Ver detalles' : 'Reservar ahora'}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </span>
          </div>
        </div>
      </div>
    </Link>
  )
}
