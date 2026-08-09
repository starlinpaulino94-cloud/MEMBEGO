import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../cn'

/**
 * MUK · StatusChip — estado del sistema con punto de color.
 *
 * Para estados de NEGOCIO (activa, pendiente, pagada, rechazada…) en tablas
 * y tarjetas. Complementa al `Badge` (etiqueta genérica) y NO sustituye al
 * `PromoBadge` (marketing). Tonos semánticos que cambian con el tema.
 *
 *   <StatusChip tone="success">Activa</StatusChip>
 *   <StatusChip tone="warning" pulso>Pendiente</StatusChip>
 */
const statusChipVariants = cva(
  'inline-flex w-fit shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold',
  {
    variants: {
      tone: {
        success: 'border-success/20 bg-success/10 text-success',
        warning: 'border-warning/30 bg-warning/15 text-warning',
        danger: 'border-destructive/20 bg-destructive/10 text-destructive',
        info: 'border-info/20 bg-info/10 text-info',
        neutral: 'border-border bg-muted text-muted-foreground',
      },
    },
    defaultVariants: { tone: 'neutral' },
  }
)

const DOT: Record<NonNullable<VariantProps<typeof statusChipVariants>['tone']>, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-destructive',
  info: 'bg-info',
  neutral: 'bg-muted-foreground',
}

function StatusChip({
  className,
  tone = 'neutral',
  pulso = false,
  children,
  ...props
}: React.ComponentProps<'span'> &
  VariantProps<typeof statusChipVariants> & {
    /** Punto con pulso — solo para estados VIVOS (caja abierta, en línea). */
    pulso?: boolean
  }) {
  return (
    <span data-slot="status-chip" className={cn(statusChipVariants({ tone }), className)} {...props}>
      <span
        aria-hidden
        className={cn('size-1.5 rounded-full', DOT[tone ?? 'neutral'], pulso && 'animate-pulse')}
      />
      {children}
    </span>
  )
}

export { StatusChip, statusChipVariants }
