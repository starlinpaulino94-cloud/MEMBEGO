import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MONO, RecuadroIcono, Tarjeta } from './superficie'

/**
 * Los tres pilares del Resumen (¿Qué tengo? / ¿Qué compro? / ¿Qué vendo?):
 * encabezado con icono, una cifra principal sobre un pozo gris claro y dos
 * mini-métricas debajo.
 */
export function TarjetaPilar({
  icono,
  iconoSecundario: IconoSecundario,
  pilar,
  pregunta,
  principal,
  children,
  testId,
}: {
  icono: LucideIcon
  iconoSecundario: LucideIcon
  pilar: string
  pregunta: string
  principal: React.ReactNode
  children: React.ReactNode
  testId?: string
}) {
  return (
    <Tarjeta className="flex flex-col gap-3 p-4" data-testid={testId}>
      <div className="flex items-center justify-between gap-2 pb-1">
        <div className="flex min-w-0 items-center gap-1">
          <RecuadroIcono icono={icono} className="size-7 bg-sv2-soft text-sv2-primary" />
          <div className="flex min-w-0 flex-col">
            <span className="text-[12px] font-bold uppercase leading-4 tracking-wider text-sv2-outline">{pilar}</span>
            <span className="truncate text-[15px] font-semibold leading-5 tracking-[-0.005em] text-foreground">{pregunta}</span>
          </div>
        </div>
        <IconoSecundario aria-hidden className="size-[18px] shrink-0 text-sv2-outline" strokeWidth={2} />
      </div>
      {principal}
      <div className="grid grid-cols-2 gap-2 pt-1">{children}</div>
    </Tarjeta>
  )
}

export type TonoCirculo = 'primary' | 'neutral' | 'secondary'

const CIRCULO: Record<TonoCirculo, string> = {
  primary: 'bg-sv2-primary-fixed text-sv2-on-primary-fixed',
  neutral: 'bg-sv2-track text-sv2-ink-variant',
  secondary: 'bg-sv2-secondary-container text-sv2-on-secondary-container',
}

/** Cifra principal del pilar, con su círculo de icono a la derecha. */
export function CifraPilar({
  etiqueta,
  valor,
  unidad,
  nota,
  icono: Icono,
  tono,
  testId,
}: {
  etiqueta: string
  valor: string
  unidad?: string
  nota: string
  icono: LucideIcon
  tono: TonoCirculo
  testId?: string
}) {
  return (
    <div className="flex items-start justify-between gap-2 rounded-[8px] bg-sv2-well p-3">
      <div className="flex min-w-0 flex-col">
        <span className="text-[12px] font-semibold leading-4 tracking-[0.04em] text-sv2-ink-variant">{etiqueta}</span>
        <span className="text-[28px] font-bold leading-8 tracking-[-0.025em] text-foreground tabular-nums">
          <span data-testid={testId}>{valor}</span>
          {unidad && <span className="ml-1.5 text-base font-normal tracking-normal text-sv2-ink-variant">{unidad}</span>}
        </span>
        <span className="text-[13px] leading-[18px] text-sv2-ink-variant">{nota}</span>
      </div>
      <span aria-hidden className={cn('flex size-10 shrink-0 items-center justify-center rounded-full', CIRCULO[tono])}>
        <Icono className="size-5" strokeWidth={2} />
      </span>
    </div>
  )
}

/** Mini-métrica bajo la cifra principal. */
export function MiniMetrica({
  etiqueta,
  valor,
  complemento,
  pie,
  tonoPie = 'neutral',
  testId,
}: {
  etiqueta: string
  valor: string
  complemento?: string
  pie: string
  tonoPie?: 'exito' | 'aviso' | 'neutral' | 'tenue'
  testId?: string
}) {
  return (
    <div className="flex min-w-0 flex-col rounded-[8px] bg-sv2-well p-2">
      <span className="text-[12px] font-semibold leading-4 tracking-[0.04em] text-sv2-ink-variant">{etiqueta}</span>
      <div className="mt-0.5 flex flex-wrap items-baseline gap-1">
        <span className="text-[18px] font-bold leading-6 tracking-[-0.01em] text-foreground tabular-nums" data-testid={testId}>{valor}</span>
        {complemento && <span className="text-[13px] leading-[18px] text-sv2-outline">{complemento}</span>}
      </div>
      <span
        className={cn(
          MONO,
          'mt-1',
          tonoPie === 'exito' && 'font-semibold text-sv2-secondary',
          tonoPie === 'aviso' && 'font-semibold text-sv2-tertiary',
          tonoPie === 'neutral' && 'text-sv2-ink-variant',
          tonoPie === 'tenue' && 'text-sv2-outline'
        )}
      >
        {pie}
      </span>
    </div>
  )
}
