import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Piezas base del rediseño Stitch de Supply 2.0: la tarjeta blanca con borde
 * sutil y sombra mínima, la tarjeta con encabezado separado por una línea y el botón suave de
 * acciones secundarias. Todas las tarjetas del Resumen salen de aquí para no
 * repetir cinco variantes locales del mismo contenedor.
 */

export const MONO = 'font-sv2-mono text-[12px] leading-4'

export function Tarjeta({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('rounded-[12px] border border-sv2-border bg-card shadow-sm', className)} {...props} />
}

/** Tarjeta con encabezado separado por una línea fina (Inventario, Órdenes). */
export function TarjetaSeccion({
  icono: Icono,
  titulo,
  extra,
  children,
  className,
  ...props
}: {
  icono: LucideIcon
  titulo: string
  extra?: React.ReactNode
  children: React.ReactNode
} & Omit<React.ComponentProps<'section'>, 'children'>) {
  return (
    <section className={cn('flex flex-col overflow-hidden rounded-[12px] border border-sv2-border bg-card shadow-sm', className)} {...props}>
      <div className="flex items-center justify-between gap-3 border-b border-sv2-divider p-3">
        <div className="flex min-w-0 items-center gap-1">
          <Icono aria-hidden className="size-5 shrink-0 text-sv2-primary" strokeWidth={2} />
          <h2 className="text-[15px] font-bold leading-5 tracking-[-0.005em] text-foreground">{titulo}</h2>
        </div>
        {extra}
      </div>
      {children}
    </section>
  )
}

const SUAVE = 'inline-flex items-center justify-center gap-1 rounded-[8px] bg-sv2-soft font-semibold text-foreground transition-colors hover:bg-sv2-soft-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sv2-accent'

/** Botón suave (gris neutro) para acciones secundarias, como enlace. */
export function EnlaceSuave({ href, className, children, ...props }: React.ComponentProps<typeof Link>) {
  return (
    <Link href={href} className={cn(SUAVE, className)} {...props}>
      {children}
    </Link>
  )
}

export const claseBotonSuave = SUAVE

/** Recuadro de icono (7×7 u 8×8 según el sitio). */
export function RecuadroIcono({ icono: Icono, className, tamanoIcono = 'size-[18px]' }: { icono: LucideIcon; className?: string; tamanoIcono?: string }) {
  return (
    <span aria-hidden className={cn('flex shrink-0 items-center justify-center rounded-[8px]', className)}>
      <Icono className={tamanoIcono} strokeWidth={2} />
    </span>
  )
}
