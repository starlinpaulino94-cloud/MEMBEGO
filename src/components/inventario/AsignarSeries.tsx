'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { asignarSeriesInventario } from '@/modules/inventory/actions'
import { MAX_SERIES_A_ASIGNAR, separarSeries } from '@/modules/inventory/lotes'
import { formatearCantidad } from '@/modules/inventory/formato'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { nuevaClave } from './clave'

/**
 * INV-5c · Ponerle número de serie a lo que ya había. Al activar las series, lo que había queda «SIN SERIE»; aquí se escriben (o pegan) las
 * series, una por renglón, y salen del «SIN SERIE» de ESTA sucursal. Cada serie es una unidad y no puede existir ya con unidades en otro sitio.
 */
export function AsignarSeries({ varianteId, sucursalId, sucursal, sinSerie }: { varianteId: string; sucursalId: string; sucursal: string; sinSerie: number }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [texto, setTexto] = useState('')
  const clave = useRef(nuevaClave())
  const series = separarSeries(texto)

  function asignar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (series.length === 0) {
      toast.error('Escribe al menos un número de serie.')
      return
    }
    start(async () => {
      const r = await asignarSeriesInventario({ varianteId, sucursalId, series, clave: clave.current })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success(r.repetido ? 'Esas series ya estaban asignadas.' : `${formatearCantidad(r.asignadas)} serie${r.asignadas === 1 ? '' : 's'} asignada${r.asignadas === 1 ? '' : 's'}.`)
      clave.current = nuevaClave()
      setTexto('')
      router.refresh()
    })
  }

  return (
    <form onSubmit={asignar} className="space-y-2 border-t pt-4" aria-label={`Asignar series en ${sucursal}`}>
      <p className="text-sm font-medium">Asignar series a lo que ya había</p>
      <p className="text-xs text-muted-foreground">
        Hay {formatearCantidad(sinSerie)} unidad{sinSerie === 1 ? '' : 'es'} «SIN SERIE» disponible{sinSerie === 1 ? '' : 's'} aquí. Escribe el número de serie de cada una, uno por renglón (hasta {MAX_SERIES_A_ASIGNAR} por vez).
      </p>
      <Label htmlFor={`asig-${sucursalId}`} className="sr-only">
        Números de serie a asignar en {sucursal}
      </Label>
      <Textarea id={`asig-${sucursalId}`} rows={4} autoComplete="off" spellCheck={false} placeholder={'SN-0001\nSN-0002'} value={texto} onChange={(e) => setTexto(e.target.value)} />
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending || series.length === 0}>
          {pending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden />}
          Asignar series
        </Button>
        <span className="text-xs tabular-nums text-muted-foreground">
          {series.length} {series.length === 1 ? 'serie' : 'series'}
        </span>
      </div>
    </form>
  )
}
