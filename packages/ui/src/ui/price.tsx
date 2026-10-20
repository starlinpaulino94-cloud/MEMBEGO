import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../cn'

/**
 * MUK · Price — el ÚNICO formato de dinero de la plataforma.
 *
 * RD$ + es-DO + tabular-nums, con precio tachado opcional (oferta) y modo
 * "GRATIS" cuando el precio vale cero.
 *
 *   <Price value={1500} />                        → RD$1,500.00
 *   <Price value={990} original={1500} size="lg"/> → RD$990.00  ~RD$1,500.00~
 *   <Price value={0} />                            → GRATIS
 */
const priceVariants = cva('font-semibold tabular-nums text-foreground', {
  variants: {
    size: {
      sm: 'text-small',
      md: 'text-[15px]',
      lg: 'text-lg',
      xl: 'text-2xl font-bold',
    },
  },
  defaultVariants: { size: 'md' },
})

export function formatearRD(n: number): string {
  return `RD$${n.toLocaleString('es-DO', { minimumFractionDigits: 2 })}`
}

function Price({
  value,
  original,
  className,
  size,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof priceVariants> & {
    value: number
    /** Precio anterior (se muestra tachado al lado). */
    original?: number
  }) {
  return (
    <span data-slot="price" className={cn('inline-flex items-baseline gap-1.5', className)} {...props}>
      <span className={cn(priceVariants({ size }), value === 0 && 'text-success')}>{value === 0 ? 'GRATIS' : formatearRD(value)}</span>
      {original != null && original > value && (
        <s className="text-caption font-normal text-muted-foreground">{formatearRD(original)}</s>
      )}
    </span>
  )
}

export { Price }
