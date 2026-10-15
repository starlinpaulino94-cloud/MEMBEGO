import { Badge } from '@/components/ui/badge'
import { ETIQUETA_ESTADO_LOTE, type EstadoLote } from '@/modules/inventory/lotes'
import { formatearCantidad } from '@/modules/inventory/formato'
import type { LoteVista } from '@/modules/inventory/lotes-queries'

const BADGE_ESTADO_LOTE: Record<EstadoLote, 'destructive' | 'warning' | 'success' | 'outline'> = {
  VENCIDO: 'destructive',
  POR_VENCER: 'warning',
  VIGENTE: 'success',
  SIN_VENCIMIENTO: 'outline',
}

/**
 * INV-5a · Los lotes de un producto en UNA sucursal: de lo que antes vence a lo que no vence (el orden en que se vende, FEFO), con su
 * vencimiento y lo que hay de cada uno. Lo VENCIDO se marca: no se vende ni se aparta, y el barrido diario lo pasa a dañado.
 */
export function LotesDeSucursal({ lotes, sucursal }: { lotes: readonly LoteVista[]; sucursal: string }) {
  if (lotes.length === 0) return <p className="text-sm text-muted-foreground">No hay existencias de ningún lote en esta sucursal.</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" aria-label={`Lotes en ${sucursal}`}>
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th scope="col" className="py-1.5 pr-3 font-medium">
              Lote
            </th>
            <th scope="col" className="py-1.5 pr-3 font-medium">
              Vencimiento
            </th>
            <th scope="col" className="py-1.5 pr-3 text-right font-medium">
              Disponible
            </th>
            <th scope="col" className="py-1.5 pr-3 text-right font-medium">
              Apartado
            </th>
            <th scope="col" className="py-1.5 text-right font-medium">
              Dañado
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {lotes.map((l) => (
            <tr key={l.loteId} data-lote={l.codigo} data-estado={l.estado}>
              <th scope="row" className="py-2 pr-3 text-left font-medium">
                {l.codigo}
              </th>
              <td className="py-2 pr-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={BADGE_ESTADO_LOTE[l.estado]}>{ETIQUETA_ESTADO_LOTE[l.estado]}</Badge>
                  {l.vencimiento !== null && (
                    <span className="text-xs text-muted-foreground">
                      {l.vencimiento} · {l.textoVencimiento}
                    </span>
                  )}
                </div>
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">{formatearCantidad(l.disponible)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{formatearCantidad(l.reserved)}</td>
              <td className="py-2 text-right tabular-nums">{formatearCantidad(l.damaged)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
