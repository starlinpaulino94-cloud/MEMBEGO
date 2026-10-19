'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { corregirVencimientoLote } from '@/modules/inventory/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * INV-5b5 · Corregir el vencimiento de UN lote. El lote es del producto, no de la sucursal: la corrección vale en todas. Pide siempre un
 * motivo (queda en la historia del lote) y, si el producto exige fecha en cada lote, no deja quitarla. Vacío = el lote no vence.
 */
export function CorregirVencimientoLote({ loteId, codigo, vencimiento, exigeVencimiento }: { loteId: string; codigo: string; vencimiento: string | null; exigeVencimiento: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [abierto, setAbierto] = useState(false)
  const [fecha, setFecha] = useState(vencimiento ?? '')
  const [motivo, setMotivo] = useState('')

  function guardar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    start(async () => {
      const r = await corregirVencimientoLote({ loteId, vencimiento: fecha, motivo })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success(r.repetido ? `El lote ${r.codigo} ya vencía esa fecha.` : `Vencimiento del lote ${r.codigo} corregido: ${r.anterior ?? 'no vencía'} → ${r.nuevo ?? 'no vence'}.`)
      setAbierto(false)
      setMotivo('')
      router.refresh()
    })
  }

  if (!abierto) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setAbierto(true)} aria-label={`Corregir el vencimiento del lote ${codigo}`}>
        Corregir vencimiento
      </Button>
    )
  }
  return (
    <form onSubmit={guardar} className="space-y-2 rounded-lg border p-3 text-left" aria-label={`Corregir el vencimiento del lote ${codigo}`}>
      <div className="space-y-1">
        <Label htmlFor={`cv-fecha-${loteId}`}>Vence el {exigeVencimiento ? '*' : '(vacío = no vence)'}</Label>
        <Input id={`cv-fecha-${loteId}`} type="date" value={fecha} required={exigeVencimiento} onChange={(e) => setFecha(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`cv-motivo-${loteId}`}>Motivo *</Label>
        <Input id={`cv-motivo-${loteId}`} value={motivo} required maxLength={300} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej: se leyó mal la fecha del empaque" />
      </div>
      <p className="text-xs text-muted-foreground">Vale para todas las sucursales y queda en la historia del lote. No mueve existencias.</p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden />}
          Guardar corrección
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setAbierto(false)} disabled={pending}>
          Cancelar
        </Button>
      </div>
    </form>
  )
}
