'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { crearItemCatalogo } from '@/modules/catalog/actions'
import { ETIQUETA_TIPO } from '@/modules/catalog/formato'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const TIPOS = Object.keys(ETIQUETA_TIPO)

/**
 * Alta de un producto o servicio SIMPLE: nombre, tipo y precio. La variante
 * única (la «default») la crea el servidor en la misma transacción; las
 * variantes reales se agregan después, desde la edición.
 */
export function ItemNuevoForm({ monedaPorDefecto = 'DOP' }: { monedaPorDefecto?: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [tipo, setTipo] = useState('SERVICE')

  function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    setError(null)
    start(async () => {
      const r = await crearItemCatalogo({
        name: String(f.get('name') ?? ''),
        description: String(f.get('description') ?? ''),
        type: tipo as never,
        currency: String(f.get('currency') ?? monedaPorDefecto),
        price: String(f.get('price') ?? ''),
        cost: String(f.get('cost') ?? ''),
        compareAtPrice: String(f.get('compareAtPrice') ?? ''),
        sku: String(f.get('sku') ?? ''),
        barcode: String(f.get('barcode') ?? ''),
      })
      if (!r.ok) {
        setError(r.error)
        return
      }
      toast.success('Creado como borrador. Revísalo y publícalo cuando esté listo.')
      router.push(`/admin/catalogo/${r.id}`)
      router.refresh()
    })
  }

  return (
    <form onSubmit={enviar} className="max-w-lg space-y-5">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <Label htmlFor="name">Nombre *</Label>
        <Input id="name" name="name" required maxLength={160} placeholder="Ej: Lavado completo" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="tipo">Tipo *</Label>
        <Select value={tipo} onValueChange={setTipo}>
          <SelectTrigger id="tipo">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIPOS.map((t) => (
              <SelectItem key={t} value={t}>
                {ETIQUETA_TIPO[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Descripción</Label>
        <Textarea id="description" name="description" rows={3} maxLength={4000} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="price">Precio *</Label>
          <Input id="price" name="price" inputMode="decimal" required placeholder="0.00" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="currency">Moneda</Label>
          <Input id="currency" name="currency" defaultValue={monedaPorDefecto} maxLength={3} className="uppercase" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="compareAtPrice">Precio anterior</Label>
          <Input id="compareAtPrice" name="compareAtPrice" inputMode="decimal" placeholder="Para mostrar el descuento" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="cost">Costo</Label>
          <Input id="cost" name="cost" inputMode="decimal" placeholder="Solo lo ves tú" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="sku">SKU</Label>
          <Input id="sku" name="sku" maxLength={40} placeholder="Automático si lo dejas vacío" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="barcode">Código de barras</Label>
          <Input id="barcode" name="barcode" maxLength={64} />
        </div>
      </div>

      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Crear
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancelar
        </Button>
      </div>
    </form>
  )
}
