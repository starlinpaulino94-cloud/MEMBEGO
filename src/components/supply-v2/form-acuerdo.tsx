'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { crearAcuerdoAction, type AcuerdoResumen, type EstadoAccion } from '@/modules/supply-v2/actions'
import { AGREEMENT_TYPES_SLICE1, AGREEMENT_TYPE_EXPLICACION, AGREEMENT_TYPE_LABELS, MONEDAS_SUPPLY_V2 } from '@/modules/supply-v2/core/catalogo'

export interface ProductoParaAcuerdo {
  id: string
  name: string
}

/**
 * MEMBEGO SUPPLY 2.0 · CREAR ACUERDO (§31). Solo compra anticipada y pagar
 * después: lo que el Slice 1 construye de verdad. Nace vigente (versión 1).
 */
export function FormAcuerdo({
  supplierId,
  proveedorNombre,
  productos,
  productoId,
  moneda = 'DOP',
  onCreado,
}: {
  supplierId: string
  proveedorNombre: string
  productos: ProductoParaAcuerdo[]
  productoId?: string
  moneda?: string
  onCreado?: (a: AcuerdoResumen) => void
}) {
  const [estado, accion, pendiente] = useActionState<EstadoAccion<AcuerdoResumen>, FormData>(crearAcuerdoAction, {})
  const [tipo, setTipo] = useState<string>('PREPAID_PURCHASE')
  const router = useRouter()
  const visto = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!estado.success || !estado.data || visto.current === estado.id) return
    visto.current = estado.id
    toast.success(estado.success)
    if (onCreado) onCreado(estado.data)
    else router.refresh()
  }, [estado, onCreado, router])
  const hoy = new Date().toISOString().slice(0, 10)
  const select = 'h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm'

  return (
    <form action={accion} className="space-y-3" data-testid="form-acuerdo">
      <input type="hidden" name="supplierId" value={supplierId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>Proveedor</Label>
          <p className="h-9 rounded-lg border border-border bg-muted/40 px-3 text-sm leading-9">{proveedorNombre}</p>
        </div>
        <div>
          <Label htmlFor="acuerdoProducto">Producto</Label>
          {productoId ? (
            <>
              <input type="hidden" name="catalogItemId" value={productoId} />
              <p className="h-9 rounded-lg border border-border bg-muted/40 px-3 text-sm leading-9">
                {productos.find((p) => p.id === productoId)?.name ?? 'Producto elegido'}
              </p>
            </>
          ) : (
            <select id="acuerdoProducto" name="catalogItemId" required className={select} defaultValue={productos[0]?.id ?? ''}>
              {productos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="acuerdoTipo">Tipo de acuerdo</Label>
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Tipo de acuerdo">
            {AGREEMENT_TYPES_SLICE1.map((t) => (
              <label
                key={t}
                className={`cursor-pointer rounded-lg border p-3 text-sm ${tipo === t ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted'}`}
              >
                <input type="radio" name="type" value={t} checked={tipo === t} onChange={() => setTipo(t)} className="mr-2" />
                <span className="font-medium">{AGREEMENT_TYPE_LABELS[t]}</span>
                <span className="block pl-5 text-caption text-muted-foreground">{AGREEMENT_TYPE_EXPLICACION[t]}</span>
              </label>
            ))}
          </div>
        </div>
        <div>
          <Label htmlFor="negotiatedUnitCost">Costo negociado por unidad</Label>
          <Input id="negotiatedUnitCost" name="negotiatedUnitCost" type="number" min={0} step="0.01" required placeholder="300" />
        </div>
        <div>
          <Label htmlFor="acuerdoMoneda">Moneda</Label>
          <select id="acuerdoMoneda" name="currency" defaultValue={moneda} className={select}>
            {MONEDAS_SUPPLY_V2.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="startsAt">Fecha de inicio</Label>
          <Input id="startsAt" name="startsAt" type="date" required defaultValue={hoy} />
        </div>
        <div>
          <Label htmlFor="endsAt">Fecha de fin</Label>
          <Input id="endsAt" name="endsAt" type="date" />
        </div>
        <div>
          <Label htmlFor="paymentTermsDays">Días de pago</Label>
          <Input id="paymentTermsDays" name="paymentTermsDays" type="number" min={0} step={1} placeholder={tipo === 'PAY_LATER' ? '30' : '0'} />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="acuerdoNotas">Notas</Label>
          <Textarea id="acuerdoNotas" name="notes" rows={2} maxLength={2000} />
        </div>
      </div>
      {estado.error && <p className="text-sm text-destructive" role="alert">{estado.error}</p>}
      <Button type="submit" disabled={pendiente || productos.length === 0} loading={pendiente}>
        {onCreado ? 'Crear acuerdo y continuar' : 'Crear acuerdo'}
      </Button>
    </form>
  )
}
