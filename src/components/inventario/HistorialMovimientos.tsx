'use client'

import { useState, useTransition } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { cargarMasHistorialInventario, type SerializableHistorial } from '@/modules/inventory/actions'
import { ETIQUETA_MOVIMIENTO, describirReferencia, efectoLegible, formatearCantidad } from '@/modules/inventory/formato'
import { formatDateTimeExacto } from '@/lib/format'
import { Button } from '@/components/ui/button'

/** El historial (ledger) de una variante, del más reciente al más antiguo, con «Cargar más». */
export function HistorialMovimientos({ varianteId, inicial }: { varianteId: string; inicial: SerializableHistorial }) {
  const [filas, setFilas] = useState(inicial.filas)
  const [siguiente, setSiguiente] = useState(inicial.siguiente)
  const [pending, start] = useTransition()

  function cargarMas() {
    start(async () => {
      const r = await cargarMasHistorialInventario(varianteId, siguiente)
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      setFilas((actuales) => {
        const vistos = new Set(actuales.map((f) => f.id))
        return [...actuales, ...r.pagina.filas.filter((f) => !vistos.has(f.id))]
      })
      setSiguiente(r.pagina.siguiente)
    })
  }

  if (filas.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">Todavía no hay movimientos.</p>

  return (
    <div>
      <ul className="divide-y rounded-lg border" aria-label="Historial de movimientos">
        {filas.map((f) => {
          const ref = describirReferencia(f.referenciaTipo, f.referenciaId)
          return (
            <li key={f.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 p-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {ETIQUETA_MOVIMIENTO[f.tipo]} <span className="font-normal text-muted-foreground">· {f.sucursalNombre}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatDateTimeExacto(f.creadoEn)} · {f.usuarioNombre ?? 'Sistema'}
                  {ref && ` · ${ref}`}
                </p>
                {f.motivo && <p className="mt-0.5 break-words text-xs">{f.motivo}</p>}
              </div>
              <div className="text-right tabular-nums">
                <p className={f.efectoOnHand > 0 ? 'font-semibold text-green-700 dark:text-green-400' : f.efectoOnHand < 0 ? 'font-semibold text-red-700 dark:text-red-400' : 'text-muted-foreground'}>
                  {efectoLegible(f.efectoOnHand)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatearCantidad(f.previousOnHand)} → {formatearCantidad(f.newOnHand)}
                </p>
              </div>
            </li>
          )
        })}
      </ul>
      {siguiente && (
        <div className="mt-3 text-center">
          <Button variant="outline" size="sm" onClick={cargarMas} disabled={pending}>
            {pending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
            Cargar más
          </Button>
        </div>
      )}
    </div>
  )
}
