'use client'

import Link from 'next/link'
import Image from 'next/image'
import { CalendarDays, Clock, Users } from 'lucide-react'
import { formatMoney, formatDate } from '@/lib/format'
import { ESTADO_RESERVA_LABEL, TONO_RESERVA } from '@/modules/excursiones/reservas/nucleo'

const TONO_CLASE: Record<string, string> = {
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  info: 'bg-info/10 text-info',
  neutral: 'bg-muted text-muted-foreground',
  danger: 'bg-destructive/10 text-destructive' }

interface ReservaCardProps {
  reserva: {
    id: string
    numero: string
    estado: string
    fecha: Date
    hora: string | null
    adultos: number
    ninos: number
    total: number
    moneda: string
    excursion: { 
      id: string; 
      nombre: string; 
      slug: string; 
      portadaUrl: string | null 
    }
  }
  ahora: Date
}

export function ReservaCard({ reserva, ahora }: ReservaCardProps) {
  const esPasada = new Date(reserva.fecha) < ahora
  const tono = TONO_RESERVA[reserva.estado as keyof typeof TONO_RESERVA] ?? 'neutral'

  return (
    <Link
      href={`/cliente/mis-excursiones/${reserva.id}`}
      className="group flex items-center gap-4 rounded-xl border bg-card p-4 shadow-sm transition hover:shadow-md hover:border-primary/50"
    >
      <div className="relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-lg bg-muted">
        {reserva.excursion.portadaUrl ? (
          <Image
            src={reserva.excursion.portadaUrl}
            alt={reserva.excursion.nombre}
            fill
            className="object-cover transition group-hover:scale-105"
            sizes="80px"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <CalendarDays className="h-8 w-8 text-muted-foreground/40" />
          </div>
        )}
        {esPasada && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
            <span className="rounded-full bg-background/80 px-2 py-0.5 text-xs font-medium text-muted-foreground">
              Finalizada
            </span>
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="font-semibold truncate">{reserva.excursion.nombre}</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Reserva: {reserva.numero}
            </p>
          </div>
          <span
            className={`flex-shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONO_CLASE[tono] ?? TONO_CLASE.neutral}`}
          >
            {ESTADO_RESERVA_LABEL[reserva.estado as keyof typeof ESTADO_RESERVA_LABEL] ?? reserva.estado}
          </span>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <CalendarDays className="h-3.5 w-3.5" />
            {formatDate(reserva.fecha, { moneda: reserva.moneda })}
          </span>
          {reserva.hora && (
            <span className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              {reserva.hora}
            </span>
          )}
          <span className="flex items-center gap-1">
            <Users className="h-3.5 w-3.5" />
            {reserva.adultos} adulto{reserva.adultos !== 1 ? 's' : ''}
            {reserva.ninos > 0 && `, ${reserva.ninos} niño${reserva.ninos !== 1 ? 's' : ''}`}
          </span>
        </div>

        <p className="mt-2 text-sm font-semibold text-primary">
          {formatMoney(reserva.total, { moneda: reserva.moneda })}
        </p>
      </div>

      <div className="flex-shrink-0 text-muted-foreground/50">
        <span className="text-xs">Ver detalle</span>
      </div>
    </Link>
  )
}