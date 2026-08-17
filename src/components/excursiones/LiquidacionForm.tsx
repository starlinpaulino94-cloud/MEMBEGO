'use client'

/**
 * Preparar la liquidación de un vendedor. Arriba se ve a quién se le debe y
 * cuánto, para que elegir no sea adivinar; el monto no se teclea nunca: lo
 * calcula el servidor sumando las comisiones que realmente entran.
 */

import { useActionState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  crearLiquidacion,
  type LiquidacionActionState,
} from '@/modules/excursiones/liquidaciones/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { formatMoney } from '@/lib/format'

const init: LiquidacionActionState = {}

export interface PendientePorVendedor {
  id: string
  nombre: string
  codigo: string
  total: number
  cantidad: number
  moneda: string
}

export function LiquidacionForm({ pendientes }: { pendientes: PendientePorVendedor[] }) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState(crearLiquidacion, init)

  useEffect(() => {
    if (state.liquidacionId) {
      toast.success(state.success ?? 'Liquidación creada.')
      router.push(`/admin/excursiones/liquidaciones/${state.liquidacionId}`)
    }
  }, [state, router])

  if (pendientes.length === 0) {
    return (
      <Alert>
        <AlertDescription>
          No hay comisiones aprobadas sin liquidar. Una comisión entra en una liquidación
          cuando alguien la aprueba desde el módulo de Comisiones.
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <form action={formAction} className="space-y-4 rounded-2xl border border-border bg-card p-5">
      <div>
        <h2 className="text-h3 text-foreground">Preparar una liquidación</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Se incluyen las comisiones aprobadas del período que no estén ya en otra liquidación.
          El total lo calcula MembeGo.
        </p>
      </div>

      <div>
        <Label htmlFor="liq-vendedor">Vendedor *</Label>
        <select
          id="liq-vendedor"
          name="vendedorId"
          required
          className="mt-1.5 block w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground"
        >
          <option value="">Elige a quién se le va a pagar…</option>
          {pendientes.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre} ({p.codigo}) — {formatMoney(p.total, { moneda: p.moneda }, 2)} en{' '}
              {p.cantidad} comisión{p.cantidad === 1 ? '' : 'es'}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="liq-desde">Desde *</Label>
          <Input id="liq-desde" name="desde" type="date" required />
        </div>
        <div>
          <Label htmlFor="liq-hasta">Hasta *</Label>
          <Input id="liq-hasta" name="hasta" type="date" required />
        </div>
      </div>

      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      <Button type="submit" disabled={pending} className="gap-2">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Preparar liquidación
      </Button>
    </form>
  )
}
