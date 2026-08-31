import type { LineaProgreso } from '@/modules/excursiones/metricas/nucleo'
import { formatMoney } from '@/lib/format'

/**
 * Las barras de una meta. Se usa en el panel del administrador y en el del
 * vendedor: la misma cifra, con la misma cara, para que nadie discuta si «en
 * mi pantalla decía otra cosa».
 */
export function MetaProgreso({ lineas, moneda, beneficio }: { lineas: LineaProgreso[]; moneda: string; beneficio?: string | null }) {
  if (lineas.length === 0) return null
  const cifra = (n: number, esDinero: boolean) =>
    esDinero ? formatMoney(n, { moneda }, 2) : String(n)

  return (
    <div>
      {beneficio && (
        <p className="text-sm text-muted-foreground mb-3">
          Beneficio: {beneficio}
        </p>
      )}
      <ul className="space-y-3">
      {lineas.map((l) => (
        <li key={l.clave}>
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="text-foreground">{l.label}</span>
            <span className={l.cumplida ? 'font-semibold text-success' : 'text-muted-foreground'}>
              {cifra(l.real, l.esDinero)} / {cifra(l.meta, l.esDinero)}
            </span>
          </div>
          <div
            className="mt-1 h-2 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label={`${l.label}: ${l.pct}%`}
            aria-valuenow={l.pct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className={l.cumplida ? 'h-full rounded-full bg-success' : 'h-full rounded-full bg-primary'}
              style={{ width: `${l.pct}%` }}
            />
          </div>
        </li>
      ))}
      </ul>
    </div>
  )
}
