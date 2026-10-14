'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { corregirCostoInventario } from '@/modules/inventory/actions'
import { MAX_MOTIVO_COSTO, parsearCosto } from '@/modules/inventory/costos'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * Corregir (o fijar por primera vez) el costo promedio de UN producto. Pide el costo nuevo y un motivo escrito; el
 * servidor lo vuelve a validar y deja una fila inmutable en el historial. No toca los movimientos que ya ocurrieron.
 */
export function CorregirCostoForm({ varianteId, costoActual }: { varianteId: string; costoActual: string | null }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [costo, setCosto] = useState('')
  const [motivo, setMotivo] = useState('')

  function corregir(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const c = parsearCosto(costo)
    if (!c.ok) {
      toast.error(c.error)
      return
    }
    if (motivo.trim() === '') {
      toast.error('Escribe el motivo de la corrección: cambiar el costo cambia el valor del inventario.')
      return
    }
    start(async () => {
      const r = await corregirCostoInventario({ varianteId, costo: costo.trim(), motivo })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success(`Costo corregido a ${r.costoNuevo}${r.costoAnterior ? ` (antes ${r.costoAnterior})` : ''}. Afecta a ${r.unidades.toLocaleString('es-DO')} unidades en existencia.`)
      setCosto('')
      setMotivo('')
      router.refresh()
    })
  }

  return (
    <form onSubmit={corregir} className="grid gap-3 sm:grid-cols-[10rem_1fr_auto] sm:items-end" aria-label="Corregir el costo">
      <div className="space-y-1.5">
        <Label htmlFor="cc-costo">{costoActual ? 'Costo nuevo' : 'Costo del producto'}</Label>
        <Input id="cc-costo" name="costo" inputMode="decimal" autoComplete="off" value={costo} onChange={(e) => setCosto(e.target.value)} placeholder="Ej: 12.50" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="cc-motivo">Motivo *</Label>
        <Input id="cc-motivo" name="motivo" maxLength={MAX_MOTIVO_COSTO} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Qué estás corrigiendo y por qué" />
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden />}
        {costoActual ? 'Corregir costo' : 'Fijar costo'}
      </Button>
    </form>
  )
}
