import Link from 'next/link'
import { formatDateTime } from '@/lib/format'
import { dineroSupplyV2 } from '@/modules/supply-v2/core/catalogo'

export interface HitoParaTimeline {
  cuando: Date
  titulo: string
  detalle?: string | null
  monto?: string | null
  href?: string | null
  tono: 'neutral' | 'success' | 'warning' | 'info' | 'danger'
}

const COLOR: Record<HitoParaTimeline['tono'], string> = {
  neutral: 'bg-muted-foreground',
  success: 'bg-success',
  warning: 'bg-warning',
  info: 'bg-primary',
  danger: 'bg-destructive',
}

/** Timeline vertical derivado de datos reales (§34, §61, §62). Nada escrito a mano. */
export function TimelineFinanciero({ hitos, moneda = 'DOP', vacio = 'Sin movimientos todavía.', testId = 'timeline-financiero' }: { hitos: HitoParaTimeline[]; moneda?: string; vacio?: string; testId?: string }) {
  if (hitos.length === 0) return <p className="text-sm text-muted-foreground">{vacio}</p>
  return (
    <ol className="space-y-3 text-sm" data-testid={testId}>
      {hitos.map((h, i) => (
        <li key={i} className="flex gap-3">
          <span className="mt-1.5 flex flex-col items-center">
            <span aria-hidden className={`size-2.5 rounded-full ${COLOR[h.tono]}`} />
            {i < hitos.length - 1 && <span aria-hidden className="mt-1 w-px flex-1 bg-border" />}
          </span>
          <div className="min-w-0 flex-1 pb-1">
            <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between">
              {h.href ? (
                <Link href={h.href} className="font-medium underline-offset-4 hover:underline">{h.titulo}</Link>
              ) : (
                <span className="font-medium">{h.titulo}</span>
              )}
              {h.monto && <span className="tabular-nums">{dineroSupplyV2(h.monto, moneda)}</span>}
            </div>
            <p className="text-caption text-muted-foreground">
              {formatDateTime(h.cuando)}
              {h.detalle ? ` · ${h.detalle}` : ''}
            </p>
          </div>
        </li>
      ))}
    </ol>
  )
}
