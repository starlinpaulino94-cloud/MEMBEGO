import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tarjeta } from './resumen/superficie'

export type TonoIndicador = 'neutral' | 'exito' | 'aviso' | 'error' | 'primario'

const TEXTO: Record<TonoIndicador, string> = {
  neutral: 'text-sv2-outline',
  exito: 'text-sv2-secondary',
  aviso: 'text-sv2-tertiary',
  error: 'text-sv2-error',
  primario: 'text-sv2-primary',
}
const PUNTO: Record<TonoIndicador, string> = {
  neutral: 'bg-sv2-outline',
  exito: 'bg-sv2-secondary',
  aviso: 'bg-sv2-tertiary',
  error: 'bg-sv2-error',
  primario: 'bg-sv2-primary',
}

const RECUADRO: Record<TonoIndicador, string> = {
  neutral: 'bg-sv2-soft text-foreground',
  exito: 'bg-sv2-secondary-container text-sv2-on-secondary-container',
  aviso: 'bg-sv2-tertiary-fixed text-sv2-on-tertiary-fixed',
  error: 'bg-sv2-error-container text-sv2-on-error-container',
  primario: 'bg-sv2-primary-fixed text-sv2-on-primary-fixed',
}

/**
 * Indicador de las pestañas de Supply (Stitch): categoría en mayúsculas
 * con su icono, cifra grande con unidad y una línea de estado al pie.
 */
export function TarjetaIndicador({
  etiqueta,
  icono: Icono,
  tonoIcono = 'neutral',
  valor,
  unidad,
  pie,
  tonoPie = 'neutral',
  iconoPie: IconoPie,
  recuadro = false,
  testId,
}: {
  etiqueta: string
  icono: LucideIcon
  tonoIcono?: TonoIndicador
  valor: string
  unidad?: string
  pie: string
  tonoPie?: TonoIndicador
  /** Icono en lugar del punto al pie (p. ej. una flecha de ingreso). */
  iconoPie?: LucideIcon
  /** Icono dentro de un recuadro de color (variante de Proveedores en Stitch). */
  recuadro?: boolean
  testId?: string
}) {
  const valorClase = cn('whitespace-nowrap text-[clamp(20px,16cqi,28px)] font-bold leading-8 tracking-[-0.025em] tabular-nums', tonoIcono === 'aviso' || tonoIcono === 'exito' ? TEXTO[tonoIcono] : 'text-foreground')
  const pieNodo = (
    <div className={cn('flex items-center gap-1 text-[12px] font-semibold leading-4 tracking-[0.04em]', TEXTO[tonoPie])}>
      {IconoPie ? <IconoPie aria-hidden className="size-3.5 shrink-0" /> : <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', PUNTO[tonoPie])} />}
      <span>{pie}</span>
    </div>
  )
  if (recuadro) {
    // Variante con el icono en recuadro a la izquierda (referencia de la dirección blanca).
    return (
      <Tarjeta className="@container flex items-start gap-3 p-3.5" data-testid={testId}>
        <span aria-hidden className={cn('flex size-10 shrink-0 items-center justify-center rounded-[10px]', RECUADRO[tonoIcono])}>
          <Icono className="size-5" strokeWidth={2} />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-[12px] font-semibold uppercase leading-4 tracking-wider text-sv2-ink-variant">{etiqueta}</span>
          <div className="flex items-baseline gap-2">
            <span className={valorClase}>{valor}</span>
            {unidad && <span className="text-[12px] font-semibold leading-4 tracking-[0.04em] text-sv2-ink-variant">{unidad}</span>}
          </div>
          {pieNodo}
        </div>
      </Tarjeta>
    )
  }
  return (
    <Tarjeta className="@container flex flex-col justify-between p-4" data-testid={testId}>
      <div className="mb-1 flex items-center justify-between gap-2 text-sv2-ink-variant">
        <span className="text-[12px] font-bold uppercase leading-4 tracking-wider">{etiqueta}</span>
        <Icono aria-hidden className={cn('size-[18px] shrink-0', TEXTO[tonoIcono])} strokeWidth={2} />
      </div>
      <div className="flex items-baseline gap-2">
        <span className={valorClase}>{valor}</span>
        {unidad && <span className="text-[12px] font-semibold leading-4 tracking-[0.04em] text-sv2-ink-variant">{unidad}</span>}
      </div>
      <div className="mt-2">{pieNodo}</div>
    </Tarjeta>
  )
}
