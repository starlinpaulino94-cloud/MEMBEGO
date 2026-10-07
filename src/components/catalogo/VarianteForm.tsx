'use client'

import { useState, useTransition } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { agregarVarianteCatalogo, actualizarVarianteCatalogo } from '@/modules/catalog/actions'
import { ETIQUETA_ESTADO_VARIANTE } from '@/modules/catalog/formato'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export interface VarianteVista {
  id: string
  name: string
  sku: string
  barcode: string | null
  price: string
  cost: string | null
  compareAtPrice: string | null
  attributes: Record<string, string>
  isDefault: boolean
  status: 'ACTIVE' | 'OUT_OF_STOCK' | 'DISCONTINUED'
}

/** `{ talla: 'M' }` ↔ «talla: M» una por línea. */
export function atributosATexto(a: Record<string, string>): string {
  return Object.entries(a)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')
}

export function textoAAtributos(t: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const linea of t.split('\n')) {
    const i = linea.indexOf(':')
    if (i < 0) continue
    const k = linea.slice(0, i).trim()
    const v = linea.slice(i + 1).trim()
    if (k && v) out[k] = v
  }
  return out
}

/**
 * Crea (sin `variante`) o edita una variante. En un ítem simple la variante
 * automática se edita SIN campo de nombre: la persona no sabe que existe.
 */
export function VarianteForm({
  itemId,
  variante,
  ocultarNombre = false,
  onListo,
}: {
  itemId: string
  variante?: VarianteVista
  ocultarNombre?: boolean
  onListo?: () => void
}) {
  const [pending, start] = useTransition()
  const [estado, setEstado] = useState(variante?.status ?? 'ACTIVE')

  function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const datos = {
      ...(ocultarNombre ? {} : { name: String(f.get('name') ?? '') }),
      price: String(f.get('price') ?? ''),
      cost: String(f.get('cost') ?? ''),
      compareAtPrice: String(f.get('compareAtPrice') ?? ''),
      sku: String(f.get('sku') ?? ''),
      barcode: String(f.get('barcode') ?? ''),
      attributes: textoAAtributos(String(f.get('attributes') ?? '')),
      status: estado,
    }
    start(async () => {
      const r = variante
        ? await actualizarVarianteCatalogo(variante.id, datos)
        : await agregarVarianteCatalogo(itemId, datos)
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success(variante ? 'Variante guardada.' : 'Variante agregada.')
      onListo?.()
    })
  }

  const k = variante?.id ?? 'nueva'
  return (
    <form onSubmit={enviar} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {!ocultarNombre && (
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor={`name-${k}`}>Nombre de la variante *</Label>
            <Input id={`name-${k}`} name="name" defaultValue={variante?.name ?? ''} required maxLength={120} placeholder="Ej: M / Rojo" />
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor={`price-${k}`}>Precio *</Label>
          <Input id={`price-${k}`} name="price" inputMode="decimal" defaultValue={variante?.price ?? ''} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`compare-${k}`}>Precio anterior</Label>
          <Input id={`compare-${k}`} name="compareAtPrice" inputMode="decimal" defaultValue={variante?.compareAtPrice ?? ''} />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`cost-${k}`}>Costo</Label>
          <Input id={`cost-${k}`} name="cost" inputMode="decimal" defaultValue={variante?.cost ?? ''} />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`sku-${k}`}>SKU</Label>
          <Input id={`sku-${k}`} name="sku" defaultValue={variante?.sku ?? ''} maxLength={40} placeholder="Automático si lo dejas vacío" />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`barcode-${k}`}>Código de barras</Label>
          <Input id={`barcode-${k}`} name="barcode" defaultValue={variante?.barcode ?? ''} maxLength={64} />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`status-${k}`}>Estado</Label>
          <Select value={estado} onValueChange={(v) => setEstado(v as VarianteVista['status'])}>
            <SelectTrigger id={`status-${k}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(ETIQUETA_ESTADO_VARIANTE).map(([v, t]) => (
                <SelectItem key={v} value={v}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {!ocultarNombre && (
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor={`attrs-${k}`}>Atributos</Label>
            <Textarea
              id={`attrs-${k}`}
              name="attributes"
              rows={3}
              defaultValue={atributosATexto(variante?.attributes ?? {})}
              placeholder={'talla: M\ncolor: Rojo'}
            />
            <p className="text-xs text-muted-foreground">Uno por línea, con el formato «nombre: valor».</p>
          </div>
        )}
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
        {variante ? 'Guardar' : 'Agregar variante'}
      </Button>
    </form>
  )
}
