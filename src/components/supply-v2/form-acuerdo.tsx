'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { crearAcuerdoAction, type AcuerdoResumen, type EstadoAccion } from '@/modules/supply-v2/actions'
import { AGREEMENT_TYPES_SLICE5, AGREEMENT_TYPE_EXPLICACION, AGREEMENT_TYPE_LABELS, COMMISSION_BASE_LABELS, MONEDAS_SUPPLY_V2, PAYABLE_RECOGNITION_LABELS } from '@/modules/supply-v2/core/catalogo'

export interface ProductoParaAcuerdo {
  id: string
  name: string
  category?: string | null
}

const ALCANCES = [
  { v: 'ITEM', label: 'Por producto', ayuda: 'Solo este producto. Gana sobre categoría y catálogo.' },
  { v: 'CATEGORY', label: 'Por categoría', ayuda: 'Todos los productos del proveedor con esa categoría.' },
  { v: 'CATALOG', label: 'Todo el catálogo', ayuda: 'Cualquier producto del proveedor sin regla más específica.' },
] as const

/**
 * MEMBEGO SUPPLY · CREAR ACUERDO (§31). Solo compra anticipada y pagar
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
  const [alcance, setAlcance] = useState<'ITEM' | 'CATEGORY' | 'CATALOG'>('ITEM')
  const comision = tipo === 'COMMISSION'
  const categorias = Array.from(new Set(productos.map((p) => p.category?.trim()).filter((c): c is string => Boolean(c))))
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
        {comision && (
          <div className="sm:col-span-2">
            <Label>Alcance de la comisión</Label>
            <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Alcance" data-testid="acuerdo-alcance">
              {ALCANCES.map((a) => (
                <label key={a.v} className={`cursor-pointer rounded-lg border p-3 text-sm ${alcance === a.v ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted'}`}>
                  <input type="radio" name="scope" value={a.v} checked={alcance === a.v} onChange={() => setAlcance(a.v)} className="mr-2" />
                  <span className="font-medium">{a.label}</span>
                  <span className="block pl-5 text-caption text-muted-foreground">{a.ayuda}</span>
                </label>
              ))}
            </div>
          </div>
        )}
        {comision && alcance === 'CATEGORY' && (
          <div>
            <Label htmlFor="acuerdoCategoria">Categoría</Label>
            <Input id="acuerdoCategoria" name="category" list="acuerdo-categorias" required maxLength={120} placeholder="Tours" data-testid="acuerdo-categoria" />
            <datalist id="acuerdo-categorias">{categorias.map((c) => <option key={c} value={c} />)}</datalist>
          </div>
        )}
        <div className={comision && alcance !== 'ITEM' ? 'hidden' : undefined}>
          <Label htmlFor="acuerdoProducto">Producto</Label>
          {productoId ? (
            <>
              <input type="hidden" name="catalogItemId" value={productoId} />
              <p className="h-9 rounded-lg border border-border bg-muted/40 px-3 text-sm leading-9">
                {productos.find((p) => p.id === productoId)?.name ?? 'Producto elegido'}
              </p>
            </>
          ) : (
            <select id="acuerdoProducto" name={comision && alcance !== 'ITEM' ? undefined : 'catalogItemId'} required={!comision || alcance === 'ITEM'} className={select} defaultValue={productos[0]?.id ?? ''}>
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
            {AGREEMENT_TYPES_SLICE5.map((t) => (
              <label
                key={t}
                className={`cursor-pointer rounded-lg border p-3 text-sm ${tipo === t ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted'}`}
                data-testid={`acuerdo-tipo-${t}`}
              >
                <input type="radio" name="type" value={t} checked={tipo === t} onChange={() => setTipo(t)} className="mr-2" />
                <span className="font-medium">{AGREEMENT_TYPE_LABELS[t]}</span>
                <span className="block pl-5 text-caption text-muted-foreground">{AGREEMENT_TYPE_EXPLICACION[t]}</span>
              </label>
            ))}
          </div>
        </div>
        {comision ? (
          <>
            <div>
              <Label htmlFor="commissionPercentage">Comisión de Membego (%)</Label>
              <Input id="commissionPercentage" name="commissionPercentage" type="number" min={0} max={100} step="0.01" required placeholder="10" data-testid="acuerdo-comision" />
              <p className="text-caption text-muted-foreground">El resto es el neto del proveedor, que se liquida al entregar.</p>
            </div>
            {/* Slice 6 (§14): con beneficios, «lo que paga el cliente» y «el valor
                contractual» dejan de ser lo mismo. Sobre cuál se calcula la comisión
                lo decide el ACUERDO y queda congelado en su versión. */}
            <div>
              <Label htmlFor="commissionBase">Base de la comisión</Label>
              <select id="commissionBase" name="commissionBase" defaultValue="CONTRACTUAL_SALE_VALUE" className={select} data-testid="acuerdo-base-comision">
                {(['CONTRACTUAL_SALE_VALUE', 'CUSTOMER_PAID_AMOUNT'] as const).map((b) => (
                  <option key={b} value={b}>
                    {COMMISSION_BASE_LABELS[b]}
                  </option>
                ))}
              </select>
              <p className="text-caption text-muted-foreground">
                Sin beneficios las dos dan lo mismo. Con un bono de Membego, el valor contractual mantiene la comisión y el neto del proveedor como si no hubiera bono; sobre lo pagado por el cliente, Membego cobra menos.
              </p>
            </div>
          </>
        ) : (
          <div>
            <Label htmlFor="negotiatedUnitCost">Costo negociado por unidad</Label>
            <Input id="negotiatedUnitCost" name="negotiatedUnitCost" type="number" min={0} step="0.01" required placeholder="300" />
          </div>
        )}
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
        <div>
          <Label htmlFor="payableRecognition">Cuándo nace la deuda</Label>
          {comision ? (
            <>
              <input type="hidden" name="payableRecognition" value="ON_REDEMPTION" />
              <p className="h-9 rounded-lg border border-border bg-muted/40 px-3 text-sm leading-9" data-testid="acuerdo-politica-fija">{PAYABLE_RECOGNITION_LABELS.ON_REDEMPTION}</p>
              <p className="text-caption text-muted-foreground">A comisión Membego no debe nada hasta que el proveedor entrega.</p>
            </>
          ) : (
            <>
              <select id="payableRecognition" name="payableRecognition" className={select} defaultValue="ON_INVOICE" data-testid="acuerdo-politica">
                {(['ON_INVOICE', 'ON_RECEIPT', 'ON_REDEMPTION'] as const).filter((p) => tipo !== 'PREPAID_PURCHASE' || p !== 'ON_REDEMPTION').map((p) => (
                  <option key={p} value={p}>{PAYABLE_RECOGNITION_LABELS[p]}</option>
                ))}
              </select>
              <p className="text-caption text-muted-foreground">Se congela en cada versión del acuerdo: las compras históricas no cambian.</p>
            </>
          )}
        </div>
        <div>
          <Label htmlFor="allowDepositApplication">Cubrir facturas con depósito</Label>
          <select id="allowDepositApplication" name="allowDepositApplication" className={select} defaultValue="si">
            <option value="si">Sí, se puede aplicar depósito</option>
            <option value="no">No</option>
          </select>
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
