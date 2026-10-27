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
        success: 'border-success/20 bg-success/10 text-success panel:border-transparent panel:bg-success-soft panel:text-success-ink',
        warning: 'border-warning/30 bg-warning/15 text-warning panel:border-transparent panel:bg-warning-soft panel:text-warning-ink',
        danger: 'border-destructive/20 bg-destructive/10 text-destructive panel:border-transparent panel:bg-danger-soft panel:text-danger-ink',
        info: 'border-info/20 bg-info/10 text-info panel:border-transparent panel:bg-info-soft panel:text-info-ink',
        neutral: 'border-border bg-muted text-muted-foreground',
        /* Fase 4 · «Pendiente» del sistema de diseño del panel (`--pending`, docs/auditoria-admin/10 §3). Sobre `bg-card`, NO
           sobre `bg-muted`: `scripts/contraste.mjs` midió `text-pending` sobre `--muted` en 4,42:1 en el tema claro (< 4,5). */
        pending: 'border-border bg-card text-pending',
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
  pending: 'bg-pending',
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
