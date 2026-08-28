'use client'

import * as React from 'react'
import { cn } from '../cn'

/**
 * MUK · SegmentedControl — selector exclusivo estilo iOS.
 *
 * Para 2–5 opciones visibles a la vez (formato de impresión, período de un
 * reporte, filtro rápido). Para navegar CONTENIDO usar `Tabs`; para más de
 * 5 opciones usar `Select`.
 *
 *   <SegmentedControl
 *     value={f} onValueChange={setF}
 *     options={[{ value: '58', label: '58 mm' }, …]}
 *   />
 */
function SegmentedControl<T extends string>({
  options,
  value,
  onValueChange,
  className,
  ...props
}: Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange'> & {
  options: { value: T; label: React.ReactNode; disabled?: boolean }[]
  value: T
  onValueChange: (value: T) => void
}) {
  return (
    <div
      data-slot="segmented-control"
      role="radiogroup"
      className={cn(
        'inline-flex w-fit items-center gap-0.5 rounded-xl border border-border bg-muted p-0.5',
        className
      )}
      {...props}
    >
      {options.map((op) => {
        const activa = op.value === value
        return (
          <button
            key={op.value}
            type="button"
            role="radio"
            aria-checked={activa}
            disabled={op.disabled}
            onClick={() => onValueChange(op.value)}
            className={cn(
              'rounded-[10px] px-3 py-1.5 text-xs font-semibold transition-all duration-fast active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50',
              activa
                ? 'bg-card text-foreground shadow-card'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {op.label}
          </button>
        )
      })}
    </div>
  )
}

export { SegmentedControl }
