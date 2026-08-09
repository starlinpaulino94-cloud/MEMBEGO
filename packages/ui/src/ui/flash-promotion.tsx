'use client'

import * as React from 'react'
import { Countdown } from './countdown'
import { Shine } from './shine'
import { cn } from '../cn'

/**
 * MMS · FlashPromotion — la promoción protagonista estilo Temu/flash sale.
 *
 * Capta la atención sin ser un popup molesto: entra con animación, tiene
 * glow que respira, barrido de shine, cuenta regresiva, barra de tiempo que
 * se agota y un CTA que pulsa suavemente. Al expirar se desvanece y llama
 * `onExpire` (para que el contenedor la retire o revalide).
 *
 * Presentacional y configurable — el negocio decide título, imagen, urgencia
 * y CTA. Pensada para alimentarse del sistema de prioridad (ver docs/MMS.md).
 *
 *   <FlashPromotion
 *     eyebrow="⚡ Oferta relámpago" titulo="2x1 en lavados premium"
 *     hasta={fin} ctaLabel="Reclamar ahora" onCta={…} tono="hot" />
 */
const TONOS = {
  hot: 'from-orange-500 to-rose-600',
  brand: 'from-blue-600 to-cyan-500',
  premium: 'from-amber-500 to-yellow-400 text-amber-950',
  celebracion: 'from-violet-600 to-fuchsia-500',
} as const

export function FlashPromotion({
  titulo,
  descripcion,
  eyebrow,
  hasta,
  ctaLabel = 'Aprovechar',
  onCta,
  media,
  tono = 'hot',
  urgente = true,
  onExpire,
  className,
  ...props
}: Omit<React.HTMLAttributes<HTMLDivElement>, 'onClick'> & {
  titulo: React.ReactNode
  descripcion?: React.ReactNode
  eyebrow?: React.ReactNode
  /** Fin de la oferta: alimenta countdown + barra de tiempo. */
  hasta: Date | string | number
  ctaLabel?: string
  onCta?: () => void
  media?: React.ReactNode
  tono?: keyof typeof TONOS
  /** Glow que respira alrededor del bloque (default true). */
  urgente?: boolean
  /** Se llama una vez cuando el contador llega a cero. */
  onExpire?: () => void
}) {
  const [expirado, setExpirado] = React.useState(false)

  // Duración total (para la barra de tiempo) fijada al montar en el cliente.
  // Diferida con setTimeout(0) para no llamar setState de forma síncrona en el
  // efecto y para no provocar desajustes de hidratación (depende de Date.now).
  const [totalMs, setTotalMs] = React.useState<number | null>(null)
  const targetMs = hasta instanceof Date ? hasta.getTime() : new Date(hasta).getTime()
  React.useEffect(() => {
    const id = setTimeout(() => setTotalMs(Math.max(1000, targetMs - Date.now())), 0)
    return () => clearTimeout(id)
  }, [targetMs])

  function alExpirar() {
    setExpirado(true)
    onExpire?.()
  }

  if (expirado) {
    // Salida: se desvanece hacia arriba y deja de ocupar espacio al terminar.
    return (
      <div
        aria-hidden
        className="animate-fade-up overflow-hidden"
        style={{ animationDirection: 'reverse', animationDuration: '350ms' }}
        onAnimationEnd={(e) => {
          ;(e.currentTarget as HTMLElement).style.display = 'none'
        }}
      />
    )
  }

  return (
    <Shine
      modo="loop"
      className={cn(
        'animate-scale-in block rounded-3xl',
        urgente && 'animate-glow-pulse',
        className
      )}
    >
      <div
        data-slot="flash-promotion"
        className={cn(
          'relative flex flex-col gap-4 overflow-hidden rounded-3xl bg-gradient-to-br p-6 text-white shadow-hero sm:flex-row sm:items-center sm:justify-between sm:p-7',
          TONOS[tono]
        )}
        {...props}
      >
        {/* Halo decorativo */}
        <div aria-hidden className="pointer-events-none absolute -right-12 -top-16 size-52 rounded-full bg-white/15 blur-3xl" />

        <div className="relative min-w-0">
          {eyebrow && (
            <p className="mb-1.5 inline-flex items-center gap-1 rounded-full bg-white/20 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-widest backdrop-blur-sm">
              {eyebrow}
            </p>
          )}
          <p className="text-h2 font-bold">{titulo}</p>
          {descripcion && <p className="mt-1 text-sm text-white/90">{descripcion}</p>}

          {/* Cuenta regresiva + barra de tiempo */}
          <div className="mt-4 flex flex-col gap-2">
            <Countdown hasta={hasta} variant="inline" onFinish={alExpirar} className="text-white" />
            <div className="h-1 w-full max-w-56 overflow-hidden rounded-full bg-white/25">
              {totalMs != null && (
                <div
                  className="time-drain h-full rounded-full bg-white"
                  style={{ ['--time-left' as string]: `${totalMs}ms` }}
                />
              )}
            </div>
          </div>
        </div>

        <div className="relative flex shrink-0 flex-col items-center gap-3">
          {media}
          {onCta && (
            <button
              type="button"
              onClick={onCta}
              className="animate-pulse-soft rounded-full bg-white px-6 py-2.5 text-sm font-bold text-neutral-900 shadow-floating transition-transform active:scale-[0.97]"
            >
              {ctaLabel}
            </button>
          )}
        </div>
      </div>
    </Shine>
  )
}
