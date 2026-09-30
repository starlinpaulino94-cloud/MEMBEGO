'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { comprarOfertaAction } from '@/modules/supply-v2/actions-cliente'
import type { EstadoAccion } from '@/modules/supply-v2/actions-util'
import type { OrdenClienteAbierta } from '@/modules/supply-v2/commerce/checkout'
import { RUTA_COMPRAS_CLIENTE } from '@/modules/supply-v2/core/catalogo'

function nuevaClave(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
}

/**
 * «Comprar» (§23, §26): abre la orden y reserva. La clave de idempotencia
 * nace con el botón: el doble clic no crea dos compras.
 */
export function BotonComprar({ offerId, href, sesion, maximo, disponible }: { offerId: string; href: string; sesion: 'cliente' | 'otro' | 'ninguna'; maximo: number; disponible: boolean }) {
  const [estado, accion, pendiente] = useActionState<EstadoAccion<OrdenClienteAbierta>, FormData>(comprarOfertaAction, {})
  const [clave] = useState(nuevaClave)
  const [cantidad, setCantidad] = useState(1)
  const router = useRouter()
  const visto = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!estado.success || !estado.id || visto.current === estado.id) return
    visto.current = estado.id
    toast.success(estado.success)
    router.push(`${RUTA_COMPRAS_CLIENTE}/${estado.id}`)
  }, [estado, router])

  if (!disponible) {
    return <Button disabled className="w-full">No disponible</Button>
  }
  if (sesion === 'ninguna') {
    return (
      <Button asChild className="w-full" data-testid="btn-comprar-login">
        <Link href={`/login?redirect=${encodeURIComponent(href)}`}>Inicia sesión para comprar</Link>
      </Button>
    )
  }
  if (sesion === 'otro') {
    return <p className="text-sm text-muted-foreground">Las ofertas Membego se compran con una cuenta de cliente.</p>
  }
  return (
    <form action={accion} className="space-y-3" data-testid="form-comprar">
      <input type="hidden" name="offerId" value={offerId} />
      <input type="hidden" name="idempotencyKey" value={clave} />
      {maximo > 1 && (
        <div>
          <Label htmlFor="cantidadCompra">Cantidad</Label>
          <select id="cantidadCompra" name="quantity" value={cantidad} onChange={(e) => setCantidad(Number(e.target.value))} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm">
            {Array.from({ length: maximo }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
      )}
      {maximo <= 1 && <input type="hidden" name="quantity" value={1} />}
      <Button type="submit" className="w-full" disabled={pendiente} loading={pendiente} data-testid="btn-comprar">Comprar</Button>
      {estado.error && <p className="text-sm text-destructive" role="alert">{estado.error}</p>}
    </form>
  )
}
