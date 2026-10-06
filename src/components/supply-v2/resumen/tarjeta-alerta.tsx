import { ArrowRight, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { EnlaceSuave, Tarjeta } from './superficie'

export type TonoAlerta = 'tertiary' | 'error' | 'primary' | 'secondary'

const TONO: Record<TonoAlerta, { barra: string; texto: string; chip: string }> = {
  tertiary: { barra: 'bg-sv2-tertiary', texto: 'text-sv2-tertiary', chip: 'bg-sv2-tertiary-fixed text-sv2-on-tertiary-fixed' },
  error: { barra: 'bg-sv2-error', texto: 'text-sv2-error', chip: 'bg-sv2-error-container text-sv2-on-error-container' },
  primary: { barra: 'bg-sv2-primary', texto: 'text-sv2-primary', chip: 'bg-sv2-primary-fixed text-sv2-on-primary-fixed' },
  secondary: { barra: 'bg-sv2-secondary', texto: 'text-sv2-secondary', chip: 'bg-sv2-secondary-container text-sv2-on-secondary-container' },
}

/**
 * Tarjeta del centro de atención: franja de color a la izquierda, categoría,
 * insignia, qué pasa y un botón a la pantalla donde se resuelve.
 */
export function TarjetaAlerta({
  tono,
  icono: Icono,
  categoria,
  insignia,
  titulo,
  descripcion,
  accion,
  href,
  testId,
}: {
  tono: TonoAlerta
  icono: LucideIcon
  categoria: string
  insignia: string
  titulo: string
  descripcion: string
  accion: string
  href: string
  testId?: string
}) {
  const t = TONO[tono]
  return (
    <Tarjeta className="relative flex flex-col justify-between gap-2 overflow-hidden p-3" data-testid={testId}>
      <span aria-hidden className={cn('absolute inset-y-0 left-0 w-1', t.barra)} />
      <div className="flex items-start justify-between gap-1 pl-1">
        <div className="flex min-w-0 items-center gap-1">
          <Icono aria-hidden className={cn('size-[18px] shrink-0', t.texto)} strokeWidth={2} />
          <span className={cn('truncate text-[12px] font-bold uppercase leading-4 tracking-wider', t.texto)}>{categoria}</span>
        </div>
        <span className={cn('shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[12px] font-semibold leading-4 tracking-[0.04em]', t.chip)}>{insignia}</span>
      </div>
      <div className="min-w-0 pl-1">
        <h3 className="text-[15px] font-semibold leading-5 tracking-[-0.005em] text-foreground">{titulo}</h3>
        <p className="line-clamp-2 text-[13px] leading-[18px] text-sv2-ink-variant">{descripcion}</p>
      </div>
      <div className="pl-1 pt-1">
        <EnlaceSuave href={href} className="h-7 w-full px-2 text-[12px] leading-4 tracking-[0.04em]">
          <span>{accion}</span>
          <ArrowRight aria-hidden className="size-3.5" />
        </EnlaceSuave>
      </div>
    </Tarjeta>
  )
}
