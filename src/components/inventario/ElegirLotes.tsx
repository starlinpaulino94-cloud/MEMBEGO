'use client'

import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { ETIQUETA_ESTADO_LOTE } from '@/modules/inventory/lotes'
import { formatearCantidad } from '@/modules/inventory/formato'
import type { LoteVista } from '@/modules/inventory/lotes-queries'
import { repartoDeTextos } from '@/modules/inventory/traslados'
import { BADGE_ESTADO_LOTE } from './LotesDeSucursal'

/**
 * INV-5b4 · Elegir de qué lotes sale lo que se transfiere: una fila por lote con lo que HAY disponible y un campo para cuánto sale de cada
 * uno. La suma de los campos es la cantidad de la línea (quien llama la enseña); esta tabla no decide nada, solo recoge lo tecleado.
 * Los lotes vienen en orden FEFO (el primero es el que sale solo si no se elige).
 */
export function ElegirLotes({
  idBase,
  producto,
  lotes,
  valores,
  alCambiar,
}: {
  idBase: string
  producto: string
  lotes: readonly LoteVista[]
  valores: Readonly<Record<string, string>>
  alCambiar: (valores: Record<string, string>) => void
}) {
  const { suma } = repartoDeTextos(valores)
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full text-sm" aria-label={`Lotes de ${producto}`}>
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
              <th scope="col" className="py-1.5 text-right font-medium">
                Sale
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {lotes.map((l) => {
              const texto = valores[l.loteId] ?? ''
              const { reparto, hayError } = repartoDeTextos({
                [l.loteId]: texto,
              })
              const pide = reparto[0]?.cantidad ?? 0
              return (
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
                  <td className="py-2 text-right">
                    <label htmlFor={`${idBase}-${l.loteId}`} className="sr-only">
                      Cuánto sale del lote {l.codigo} de {producto}
                    </label>
                    <Input
                      id={`${idBase}-${l.loteId}`}
                      inputMode="numeric"
                      autoComplete="off"
                      placeholder="0"
                      value={texto}
                      aria-invalid={hayError || pide > l.disponible}
                      onChange={(e) => alCambiar({ ...valores, [l.loteId]: e.target.value })}
                      className="ml-auto w-20 text-right tabular-nums"
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        Total de {producto}: <span className="font-medium tabular-nums">{formatearCantidad(suma)}</span> unidad{suma === 1 ? '' : 'es'}.
      </p>
    </div>
  )
}
