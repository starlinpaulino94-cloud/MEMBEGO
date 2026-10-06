import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tarjeta } from './resumen/superficie'

const RECUADRO = {
  primario: 'bg-sv2-primary-fixed text-sv2-on-primary-fixed',
  exito: 'bg-sv2-secondary-container text-sv2-on-secondary-container',
  aviso: 'bg-sv2-tertiary-fixed text-sv2-on-tertiary-fixed',
  neutral: 'bg-sv2-soft text-foreground',
} as const

/** Tarjeta informativa del pie de las pestañas (Stitch): icono en recuadro, título y una explicación. */
export function TarjetaInfo({ icono: Icono, tono, titulo, children }: { icono: LucideIcon; tono: keyof typeof RECUADRO; titulo: string; children: React.ReactNode }) {
  return (
    <Tarjeta className="flex items-start gap-2 p-3">
      <span aria-hidden className={cn('flex size-10 shrink-0 items-center justify-center rounded-[8px]', RECUADRO[tono])}>
        <Icono className="size-[22px]" strokeWidth={2} />
      </span>
      <div className="flex flex-col gap-0.5">
        <span className="text-[15px] font-semibold leading-5 tracking-[-0.005em] text-foreground">{titulo}</span>
        <p className="text-[13px] leading-[18px] text-sv2-ink-variant">{children}</p>
      </div>
    </Tarjeta>
  )
}
