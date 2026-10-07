'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ShoppingCart } from 'lucide-react'
import { toast } from 'sonner'
import { MAX_CANTIDAD_POR_LINEA } from '@/modules/checkout/domain'
import { formatearMonto } from '@/modules/orders/formato'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { OpcionVariante } from '@/components/pedidos/PedirForm'
import { useCarrito } from './useCarrito'

const campoSelector = 'h-9 w-full rounded-lg border border-input bg-background px-3 text-sm'

interface Props {
  companySlug: string
  moneda: string
  conVariantes: boolean
  variantes: OpcionVariante[]
}

/**
 * «Agregar al carrito» en la ficha pública. No pide cuenta: el carrito es del navegador. El precio que se
 * enseña es informativo; en el carrito y al pagar se vuelve a leer del catálogo.
 */
export function AgregarAlCarrito({ companySlug, moneda, conVariantes, variantes }: Props) {
  const router = useRouter()
  const { agregar } = useCarrito()
  const disponibles = variantes.filter((v) => v.available)
  const [varianteId, setVarianteId] = useState(disponibles[0]?.id ?? '')
  const [cantidad, setCantidad] = useState('1')
  if (disponibles.length === 0) return null
  const variante = disponibles.find((v) => v.id === varianteId) ?? disponibles[0]

  function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const n = Number(cantidad)
    const r = agregar(companySlug, variante.id, n)
    if (!r.ok) {
      toast.error(r.error)
      return
    }
    toast.success('Agregado al carrito.', { action: { label: 'Ver carrito', onClick: () => router.push('/carrito') } })
  }

  return (
    <form onSubmit={enviar} className="space-y-3 rounded-lg border border-border p-4" aria-label="Agregar al carrito">
      <h2 className="flex items-center gap-2 text-h3 text-foreground">
        <ShoppingCart className="h-4 w-4" aria-hidden />
        Agregar al carrito
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {conVariantes && (
          <div className="space-y-1.5">
            <Label htmlFor="ac-variante">Opción</Label>
            <select id="ac-variante" value={variante.id} onChange={(e) => setVarianteId(e.target.value)} className={campoSelector}>
              {disponibles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} · {formatearMonto(v.price, moneda)}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="ac-cantidad">Cantidad</Label>
          <Input id="ac-cantidad" name="cantidad" type="number" inputMode="numeric" min={1} max={MAX_CANTIDAD_POR_LINEA} step={1} required value={cantidad} onChange={(e) => setCantidad(e.target.value)} />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/carrito" className="text-sm text-muted-foreground underline">
          Ver mi carrito
        </Link>
        <Button type="submit" variant="outline">
          Agregar al carrito
        </Button>
      </div>
    </form>
  )
}
