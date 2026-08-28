import { Infinity as InfinityIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface UsageMeterProps {
  esIlimitado: boolean
  /** Usos que le quedan al cliente. */
  restantes: number
  /** Usos incluidos en el plan. 0/null = desconocido (planes antiguos). */
  total: number | null
  /** 'dark' = sobre tarjeta de marca (texto blanco) · 'light' = sobre fondo claro. */
  tone?: 'dark' | 'light'
  className?: string
}

/**
 * Medidor de consumo de la membresía: reemplaza el texto plano
 * "N usos restantes" por una barra de progreso minimalista.
 *
 * - Ilimitado → símbolo ∞ con gradiente animado (shimmer).
 * - 0 restantes → barra vacía en tono de alerta sutil: "Límite alcanzado".
 * - Normal → barra redondeada con micro-gradiente y "X de Y disponibles".
 */
export function UsageMeter({
  esIlimitado,
  restantes,
  total,
  tone = 'dark',
  className,
}: UsageMeterProps) {
  const dark = tone === 'dark'

  if (esIlimitado) {
    return (
      <div className={cn('flex items-center gap-2', className)}>
        <InfinityIcon
          aria-hidden
          className={cn('h-5 w-5', dark ? 'text-white' : 'text-primary')}
        />
        <span
          className={cn(
            'animate-shimmer bg-clip-text text-sm font-semibold text-transparent [background-size:200%_auto]',
            dark
              ? 'bg-gradient-to-r from-white via-sky-200 to-white'
              : 'bg-gradient-to-r from-primary via-sky-500 to-primary'
          )}
        >
          Usos ilimitados
        </span>
      </div>
    )
  }

  // Planes antiguos sin total conocido: al menos el total nunca es menor que
  // lo que queda, para que la barra no mienta.
  const max = Math.max(total ?? 0, restantes, 1)
  const usados = Math.max(0, max - Math.max(0, restantes))
  const pct = Math.round((Math.max(0, restantes) / max) * 100)
  const agotado = restantes <= 0

  return (
    <div className={cn('space-y-1.5', className)}>
      <div
        role="progressbar"
        aria-label="Usos restantes de la membresía"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={Math.max(0, restantes)}
        aria-valuetext={
          agotado
            ? 'Límite alcanzado, requiere renovación'
            : `${restantes} de ${max} usos disponibles`
        }
        className={cn(
          'h-2 w-full overflow-hidden rounded-full',
          dark ? 'bg-white/20' : 'bg-muted',
          agotado && (dark ? 'bg-destructive/25' : 'bg-destructive/15')
        )}
      >
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-hero',
            dark
              ? 'bg-gradient-to-r from-white/85 to-white'
              : 'bg-gradient-to-r from-primary/80 to-primary'
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p
        className={cn(
          'text-xs font-medium',
          agotado
            ? dark
              ? 'text-destructive'
              : 'text-destructive'
            : dark
              ? 'text-white/85'
              : 'text-muted-foreground'
        )}
      >
        {agotado
          ? 'Límite alcanzado · renueva para seguir disfrutando'
          : `${restantes} de ${max} disponibles · ${usados} consumido${usados !== 1 ? 's' : ''}`}
      </p>
    </div>
  )
}
