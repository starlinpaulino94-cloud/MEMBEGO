'use client'

import * as React from 'react'
import { useCountdown } from '../hooks/use-countdown'
import { cn } from '../cn'

/**
 * MUK · Countdown — cuenta regresiva de urgencia.
 *
 * Para promociones/campañas que expiran. Dos variantes:
 * - `segmentos` (default): cajas DD HH MM SS — para landings y héroes.
 * - `inline`: "2d 04:31:09" compacto — para tarjetas y banners.
 *
 * Muestra "--" hasta el primer tick del cliente (sin errores de hidratación)
 * y llama `onFinish` al llegar a cero.
 */
function dosDigitos(n: number): string {
  return String(n).padStart(2, '0')
}

function Countdown({
  hasta,
  variant = 'segmentos',
  onFinish,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  hasta: Date | string | number
  variant?: 'segmentos' | 'inline'
  onFinish?: () => void
}) {
  const t = useCountdown(hasta, onFinish)

  if (variant === 'inline') {
    return (
      <span
        data-slot="countdown"
        role="timer"
        className={cn('font-mono text-sm font-semibold tabular-nums', className)}
        {...props}
      >
        {t
          ? `${t.dias > 0 ? `${t.dias}d ` : ''}${dosDigitos(t.horas)}:${dosDigitos(t.minutos)}:${dosDigitos(t.segundos)}`
          : '--:--:--'}
      </span>
    )
  }

  const segmentos: { valor: string; etiqueta: string }[] = [
    { valor: t ? dosDigitos(t.dias) : '--', etiqueta: 'días' },
    { valor: t ? dosDigitos(t.horas) : '--', etiqueta: 'hrs' },
    { valor: t ? dosDigitos(t.minutos) : '--', etiqueta: 'min' },
    { valor: t ? dosDigitos(t.segundos) : '--', etiqueta: 'seg' },
  ]

  return (
    <div data-slot="countdown" role="timer" className={cn('flex items-start gap-2', className)} {...props}>
      {segmentos.map((s) => (
        <div key={s.etiqueta} className="flex flex-col items-center">
          <span className="min-w-11 rounded-xl bg-foreground px-2 py-1.5 text-center font-mono text-lg font-bold tabular-nums text-background">
            {s.valor}
          </span>
          <span className="mt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {s.etiqueta}
          </span>
        </div>
      ))}
    </div>
  )
}

export { Countdown }
