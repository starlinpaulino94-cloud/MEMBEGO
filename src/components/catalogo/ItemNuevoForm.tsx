'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { crearItemCatalogo } from '@/modules/catalog/actions'
import { ETIQUETA_TIPO } from '@/modules/catalog/formato'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Campo } from '@/components/ui/campo'
import { FormActions, FormSection } from '@/components/ui/form-section'

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
    <form onSubmit={enviar} className="space-y-8">
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <FormSection title="Qué es" description="El nombre y el tipo con que aparece en tu catálogo.">
        <Campo id="name" etiqueta="Nombre">
          {(control) => <Input name="name" required maxLength={160} placeholder="Ej: Lavado completo" {...control} />}
        </Campo>
        <Campo id="tipo" etiqueta="Tipo" className="sm:max-w-xs">
          {(control) => (
            <Select value={tipo} onValueChange={setTipo}>
              <SelectTrigger className="w-full" {...control}>
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
          )}
        </Campo>
        <Campo id="description" etiqueta="Descripción" opcional>
          {(control) => <Textarea name="description" rows={3} maxLength={4000} {...control} />}
        </Campo>
      </FormSection>

      <FormSection title="Precio" description="Lo que paga el cliente. El precio anterior muestra el descuento; el costo solo lo ves tú.">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_7rem]">
          <Campo id="price" etiqueta="Precio">
            {(control) => <Input name="price" inputMode="decimal" required placeholder="0.00" {...control} />}
          </Campo>
          <Campo id="currency" etiqueta="Moneda">
            {(control) => <Input name="currency" defaultValue={monedaPorDefecto} maxLength={3} className="uppercase" {...control} />}
          </Campo>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo id="compareAtPrice" etiqueta="Precio anterior" opcional>
            {(control) => <Input name="compareAtPrice" inputMode="decimal" placeholder="Para mostrar el descuento" {...control} />}
          </Campo>
          <Campo id="cost" etiqueta="Costo" opcional>
            {(control) => <Input name="cost" inputMode="decimal" placeholder="Solo lo ves tú" {...control} />}
          </Campo>
        </div>
      </FormSection>

      <FormSection title="Códigos" description="Para encontrarlo en el inventario y leerlo con el escáner.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo id="sku" etiqueta="SKU" opcional>
            {(control) => <Input name="sku" maxLength={40} placeholder="Automático si lo dejas vacío" {...control} />}
          </Campo>
          <Campo id="barcode" etiqueta="Código de barras" opcional>
            {(control) => <Input name="barcode" maxLength={64} {...control} />}
          </Campo>
        </div>
      </FormSection>

      <FormActions>
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          Cancelar
        </Button>
        <Button type="submit" loading={pending}>
          Crear borrador
        </Button>
      </FormActions>
    </form>
  )
}
