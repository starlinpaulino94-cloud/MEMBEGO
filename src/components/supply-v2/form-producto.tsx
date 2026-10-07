'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { crearProductoAction, type EstadoAccion } from '@/modules/supply-v2/actions'
import type { ItemCreado } from '@/modules/supply-v2/catalog/service'
import { CATALOG_ITEM_TYPE_LABELS, MONEDAS_SUPPLY_V2, UNIT_LABELS } from '@/modules/supply-v2/core/catalogo'

export interface VinculoExistente {
  id: string
  nombre: string
  tipo: 'SERVICIO' | 'PRODUCTO'
}

/**
 * MEMBEGO SUPPLY · CREAR PRODUCTO del catálogo del proveedor (§30).
 * Puede vincularse a un producto o servicio que la empresa ya vende; nunca
 * obliga.
 */
export function FormProducto({
  supplierId,
  moneda = 'DOP',
  existentes = [],
  onCreado,
}: {
  supplierId: string
  moneda?: string
  existentes?: VinculoExistente[]
  onCreado?: (i: ItemCreado) => void
}) {
  const [estado, accion, pendiente] = useActionState<EstadoAccion<ItemCreado>, FormData>(crearProductoAction, {})
  const router = useRouter()
  const visto = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!estado.success || !estado.data || visto.current === estado.id) return
    visto.current = estado.id
    toast.success(estado.success)
    if (onCreado) onCreado(estado.data)
    else router.refresh()
  }, [estado, onCreado, router])
  const select = 'h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm'

  return (
    <form action={accion} className="space-y-3" data-testid="form-producto">
      <input type="hidden" name="supplierId" value={supplierId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="productoNombre">Nombre</Label>
          <Input id="productoNombre" name="name" required maxLength={160} placeholder="Pizza Grande Pepperoni" autoFocus />
        </div>
        <div>
          <Label htmlFor="productoTipo">Tipo</Label>
          <select id="productoTipo" name="type" defaultValue="PRODUCT" className={select}>
            {Object.entries(CATALOG_ITEM_TYPE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="productoSku">SKU</Label>
          <Input id="productoSku" name="sku" maxLength={60} placeholder="PIZ-PEP-G" />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="productoDescripcion">Descripción</Label>
          <Textarea id="productoDescripcion" name="description" rows={2} maxLength={2000} />
        </div>
        <div>
          <Label htmlFor="productoCategoria">Categoría</Label>
          <Input id="productoCategoria" name="category" maxLength={80} placeholder="Pizzas" />
        </div>
        <div>
          <Label htmlFor="productoUnidad">Unidad</Label>
          <select id="productoUnidad" name="unit" defaultValue="UNIT" className={select}>
            {Object.entries(UNIT_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="productoPrecio">Precio público</Label>
          <Input id="productoPrecio" name="publicPrice" type="number" min={0} step="0.01" placeholder="600" />
        </div>
        <div>
          <Label htmlFor="productoMoneda">Moneda</Label>
          <select id="productoMoneda" name="currency" defaultValue={moneda} className={select}>
            {MONEDAS_SUPPLY_V2.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        {existentes.length > 0 && (
          <div className="sm:col-span-2">
            <Label htmlFor="productoVinculo">Vincular con algo que la empresa ya vende (opcional)</Label>
            <VinculoSelect existentes={existentes} />
          </div>
        )}
      </div>
      {estado.error && <p className="text-sm text-destructive" role="alert">{estado.error}</p>}
      <Button type="submit" disabled={pendiente} loading={pendiente}>
        {onCreado ? 'Guardar y continuar' : 'Agregar producto'}
      </Button>
    </form>
  )
}

function VinculoSelect({ existentes }: { existentes: VinculoExistente[] }) {
  const [valor, setValor] = useState('')
  const [tipo, id] = valor.split(':')
  return (
    <>
      <select
        id="productoVinculo"
        className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm"
        value={valor}
        onChange={(e) => setValor(e.target.value)}
      >
        <option value="">Sin vínculo</option>
        {existentes.map((x) => (
          <option key={`${x.tipo}:${x.id}`} value={`${x.tipo}:${x.id}`}>
            {x.tipo === 'SERVICIO' ? 'Servicio' : 'Producto'} · {x.nombre}
          </option>
        ))}
      </select>
      <input type="hidden" name="existingServiceId" value={tipo === 'SERVICIO' ? id ?? '' : ''} />
      <input type="hidden" name="existingProductId" value={tipo === 'PRODUCTO' ? id ?? '' : ''} />
    </>
  )
}
