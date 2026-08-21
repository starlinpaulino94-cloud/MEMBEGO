'use client'

import Image from 'next/image'
import Link from 'next/link'
import { Clock, MapPin, AlertCircle, X, Tag, Users, CalendarDays } from 'lucide-react'
import { formatMoney } from '@/lib/format'

export interface ExcursionBuscada {
    id: string
    nombre: string
    slug: string
    descripcion: string | null
    portadaUrl: string | null
    categoria: string | null
    moneda: string
    duracionMin: number | null
    ubicacion: string | null
    precioDesde: number | null
    company: { id: string; slug: string; name: string; logoUrl: string | null }
    proximasSalidas: {
      fecha: string
      horaSalida: string
      cupoDisponible: number
      agotada: boolean
      fechaPasada: boolean
    }[]
    agotadaGlobal: boolean
    todasFechasPasadas: boolean
}

interface ExcursionSearchCardProps {
  excursion: ExcursionBuscada
  variant?: 'default' | 'compact'
}

export function ExcursionSearchCard({ excursion, variant = 'default' }: ExcursionSearchCardProps) {
  // Calcular próxima salida disponible
  const proximaDisponible = excursion.proximasSalidas.find(
    (s) => !s.agotada && !s.fechaPasada
  )
  const proximaFecha = proximaDisponible ? proximaDisponible.fecha : excursion.proximasSalidas[0]?.fecha
  const proximaHora = proximaDisponible ? proximaDisponible.horaSalida : excursion.proximasSalidas[0]?.horaSalida
  const cupoDisponible = proximaDisponible?.cupoDisponible ?? 0

  const isFinalizada = excursion.todasFechasPasadas
  const isAgotada = excursion.agotadaGlobal
  const tieneStock = !isFinalizada && !isAgotada && cupoDisponible > 0
  const pocosCupos = tieneStock && cupoDisponible <= 5 && cupoDisponible > 0

  // Badge de estado
  const getEstadoBadge = () => {
    if (isFinalizada) {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
          <X className="h-3 w-3" /> Finalizada
        </span>
      )
    }
    if (isAgotada) {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
          <AlertCircle className="h-3 w-3" /> Agotada
        </span>
      )
    }
    if (pocosCupos) {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
          <Users className="h-3 w-3" /> Últimos {cupoDisponible} cupos
        </span>
      )
    }
    if (tieneStock) {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
          <CalendarDays className="h-3 w-3" /> Disponible
        </span>
      )
    }
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
        Sin disponibilidad
      </span>
    )
  }

  const cardClass = variant === 'compact' 
    ? 'flex gap-4 rounded-xl border bg-card p-3 shadow-sm transition hover:shadow-md'
    : 'group overflow-hidden rounded-xl border bg-card shadow-sm transition hover:shadow-md'

  return (
    <Link
      href={`/empresas/${excursion.company.slug}/excursiones/${excursion.slug}`}
      className={cardClass}
    >
      {/* Portada */}
      <div className="relative flex-shrink-0 overflow-hidden rounded-lg bg-muted" style={{ 
        width: variant === 'compact' ? '80px' : '100%', 
        height: variant === 'compact' ? '80px' : '200px',
        aspectRatio: variant === 'compact' ? undefined : '16/10'
      }}>
        {excursion.portadaUrl ? (
          <Image
            src={excursion.portadaUrl}
            alt={excursion.nombre}
            fill
            className="object-cover transition duration-300 group-hover:scale-105"
            sizes={variant === 'compact' ? '80px' : '(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw'}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Tag className="h-10 w-10 text-muted-foreground/30" />
          </div>
        )}
        {excursion.categoria && (
          <span className="absolute left-2 top-2 rounded-full bg-background/80 px-2 py-0.5 text-xs font-medium backdrop-blur">
            {excursion.categoria}
          </span>
        )}
        {(isAgotada || isFinalizada) && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            {getEstadoBadge()}
          </div>
        )}
      </div>

      {/* Info */}
      <div className={variant === 'compact' ? 'flex-1 min-w-0 flex flex-col justify-between' : 'p-4 flex flex-col'}>
        <div>
          <div className="flex items-start justify-between gap-2">
            <h3 className={variant === 'compact' ? 'font-semibold text-sm' : 'font-semibold group-hover:text-primary'}>
              {excursion.nombre}
            </h3>
            {getEstadoBadge()}
          </div>

          {excursion.descripcion && (
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
              {excursion.descripcion}
            </p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
            {excursion.duracionMin && (
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {excursion.duracionMin} min
              </span>
            )}
            {excursion.ubicacion && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {excursion.ubicacion}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Users className="h-3 w-3" />
              {excursion.company.name}
            </span>
          </div>

          {/* Próxima salida */}
          {proximaFecha && (
            <div className="mt-2 flex items-center gap-1.5 text-xs text-primary">
              <CalendarDays className="h-3 w-3" />
              Próxima: {new Date(proximaFecha).toLocaleDateString('es-DO', { weekday: 'short', day: 'numeric', month: 'short' })}
              {proximaHora && <span>· {proximaHora}</span>}
            </div>
          )}
        </div>

        {/* Precio y CTA */}
        <div className={variant === 'compact' ? 'mt-2 flex items-end justify-between' : 'mt-auto pt-3'}>
          {excursion.precioDesde != null && (
            <p className="font-semibold text-primary">
              Desde {formatMoney(excursion.precioDesde, { moneda: excursion.moneda })}
            </p>
          )}
          {variant === 'default' && (
            <span className="text-xs text-muted-foreground">Ver detalle →</span>
          )}
        </div>
      </div>
    </Link>
  )
}