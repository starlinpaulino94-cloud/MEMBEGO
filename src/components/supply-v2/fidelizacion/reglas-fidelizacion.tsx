import { Network, TimerReset } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MONO, Tarjeta } from '../resumen/superficie'

/**
 * Pie de Fidelización (Stitch, propuesta A) con texto VERDADERO: cuándo un
 * punto se vuelve costo y cómo vencen los puntos en cada programa. Informa; la
 * política se cambia en el programa, no aquí.
 */
export function ReglasFidelizacion({ conVencimiento, sinVencimiento, dias }: { conVencimiento: number; sinVencimiento: number; dias: number[] }) {
  const hechos = [
    { titulo: 'Costo realizado', texto: 'Al entregar', clase: 'text-foreground' },
    { titulo: 'Lo pendiente', texto: 'Estimación', clase: 'text-sv2-secondary' },
    { titulo: 'Los puntos', texto: 'No son dinero', clase: 'text-foreground' },
  ]
  const plazos = [...new Set(dias)].sort((a, b) => a - b)
  return (
    <div className="grid grid-cols-1 gap-3 @5xl:grid-cols-2" data-testid="reglas-fidelizacion">
      <Tarjeta className="flex flex-col gap-3 p-5">
        <div className="flex items-center gap-2">
          <Network aria-hidden className="size-5 text-sv2-primary" />
          <h3 className="text-[15px] font-bold leading-5 text-sv2-primary">Cuándo un punto se vuelve costo</h3>
        </div>
        <p className="text-[14px] leading-6 text-sv2-ink-variant">
          Los puntos no son dinero ni una deuda: el costo solo se realiza cuando se entrega la recompensa o se paga un referido. Lo que falta por canjear se estima, y siempre se rotula como estimación.
        </p>
        <div className="grid grid-cols-1 gap-2 @xl:grid-cols-3">
          {hechos.map((h) => (
            <div key={h.titulo} className="flex flex-col rounded-[8px] border border-sv2-border bg-sv2-well px-3 py-2">
              <span className={cn(MONO, 'text-sv2-outline')}>{h.titulo}</span>
              <span className={cn('text-[14px] font-semibold leading-5', h.clase)}>{h.texto}</span>
            </div>
          ))}
        </div>
      </Tarjeta>
      <Tarjeta className="flex flex-col justify-between gap-3 p-5">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] font-bold uppercase leading-4 tracking-wider text-sv2-outline">Política de puntos</span>
            <span className="rounded-full bg-sv2-secondary-container px-2 py-0.5 text-[12px] font-semibold leading-4 text-sv2-on-secondary-container">Por programa</span>
          </div>
          <h3 className="flex items-center gap-2 text-[15px] font-bold leading-5">
            <TimerReset aria-hidden className="size-5 text-sv2-primary" />
            Vencimiento de puntos
          </h3>
          <p className="text-[13px] leading-[18px] text-sv2-ink-variant">
            Cada programa define si sus puntos vencen y cuándo.{' '}
            {plazos.length > 0 ? `Hoy vencen a los ${plazos.join(' y a los ')} días.` : 'Hoy ningún programa los vence.'}
          </p>
        </div>
        <span className="rounded-[8px] border border-sv2-border bg-sv2-well px-3 py-2 text-[13px] font-semibold leading-4" data-testid="reglas-vencimiento">
          {conVencimiento} {conVencimiento === 1 ? 'programa con vencimiento' : 'programas con vencimiento'} · {sinVencimiento} sin vencimiento
        </span>
      </Tarjeta>
    </div>
  )
}
