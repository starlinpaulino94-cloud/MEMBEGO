'use client'

import { useActionState, useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { beneficiosParaOfertaAction, comprarOfertaAction } from '@/modules/supply-v2/actions-cliente'
import type { EstadoAccion } from '@/modules/supply-v2/actions-util'
import type { BeneficioAplicable } from '@/modules/supply-v2/benefits/queries'
import type { OrdenClienteAbierta } from '@/modules/supply-v2/commerce/checkout'
import { RUTA_BENEFICIOS_CLIENTE, RUTA_COMPRAS_CLIENTE } from '@/modules/supply-v2/core/catalogo'

function nuevaClave(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
}

function dinero(n: string, moneda: string): string {
  return `${moneda === 'DOP' ? 'RD$' : `${moneda} `}${Number(n).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/**
 * «Comprar» (§23, §26; Slice 6 §17): abre la orden y reserva. La clave de
 * idempotencia nace con el botón: el doble clic no crea dos compras.
 *
 * Slice 6: si el cliente tiene beneficios aplicables a esta oferta, elige uno
 * y ve antes de comprar lo que rebaja y lo que quedaría por pagar. La cifra
 * se recalcula en el servidor cada vez que cambia la cantidad, y el checkout
 * la vuelve a calcular con la oferta bloqueada: lo de aquí nunca decide.
 */
export function BotonComprar({
  offerId,
  href,
  sesion,
  maximo,
  disponible,
  moneda = 'DOP',
  precio = '0.00',
  beneficios = [],
  beneficioPreseleccionado,
}: {
  offerId: string
  href: string
  sesion: 'cliente' | 'otro' | 'ninguna'
  maximo: number
  disponible: boolean
  moneda?: string
  precio?: string
  /** Beneficios del cliente aplicables a esta oferta, simulados para una unidad. */
  beneficios?: BeneficioAplicable[]
  /** Beneficio que llega preseleccionado desde «Mis beneficios» (?beneficio=…). */
  beneficioPreseleccionado?: string
}) {
  const [estado, accion, pendiente] = useActionState<EstadoAccion<OrdenClienteAbierta>, FormData>(comprarOfertaAction, {})
  const [clave] = useState(nuevaClave)
  const [cantidad, setCantidad] = useState(1)
  const [lista, setLista] = useState<BeneficioAplicable[]>(beneficios)
  const [elegido, setElegido] = useState<string>(() =>
    beneficioPreseleccionado && beneficios.some((b) => b.customerBenefitId === beneficioPreseleccionado) ? beneficioPreseleccionado : ''
  )
  const [recalculando, recalcular] = useTransition()
  const router = useRouter()
  const visto = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!estado.success || !estado.id || visto.current === estado.id) return
    visto.current = estado.id
    toast.success(estado.success)
    router.push(`${RUTA_COMPRAS_CLIENTE}/${estado.id}`)
  }, [estado, router])

  const cambiarCantidad = (n: number) => {
    setCantidad(n)
    if (beneficios.length === 0) return
    recalcular(async () => {
      const nuevos = await beneficiosParaOfertaAction(offerId, n)
      setLista(nuevos)
      setElegido((actual) => (nuevos.some((b) => b.customerBenefitId === actual) ? actual : ''))
    })
  }

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

  const beneficio = lista.find((b) => b.customerBenefitId === elegido) ?? null
  const totalSinBeneficio = (Number(precio) * cantidad).toFixed(2)
  const aPagar = beneficio ? beneficio.aPagar : totalSinBeneficio

  return (
    <form action={accion} className="space-y-3" data-testid="form-comprar">
      <input type="hidden" name="offerId" value={offerId} />
      <input type="hidden" name="idempotencyKey" value={clave} />
      <input type="hidden" name="customerBenefitId" value={elegido} />
      {maximo > 1 && (
        <div>
          <Label htmlFor="cantidadCompra">Cantidad</Label>
          <select id="cantidadCompra" name="quantity" value={cantidad} onChange={(e) => cambiarCantidad(Number(e.target.value))} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm">
            {Array.from({ length: maximo }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
      )}
      {maximo <= 1 && <input type="hidden" name="quantity" value={1} />}

      {lista.length > 0 && (
        <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3" data-testid="selector-beneficio">
          <Label htmlFor="beneficioCompra">Tus beneficios para esta oferta</Label>
          <select
            id="beneficioCompra"
            value={elegido}
            onChange={(e) => setElegido(e.target.value)}
            className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
            data-testid="select-beneficio"
          >
            <option value="">Comprar sin usar un beneficio</option>
            {lista.map((b) => (
              <option key={b.customerBenefitId} value={b.customerBenefitId}>
                {b.name} · −{dinero(b.beneficioTotal, moneda)}
              </option>
            ))}
          </select>
          {beneficio && (
            <dl className="space-y-1 text-sm" data-testid="desglose-beneficio">
              <div className="flex items-baseline justify-between"><dt className="text-muted-foreground">Precio Membego</dt><dd className="tabular-nums">{dinero(totalSinBeneficio, moneda)}</dd></div>
              {Number(beneficio.descuentoProveedor) > 0 && (
                <div className="flex items-baseline justify-between"><dt className="text-muted-foreground">Descuento del proveedor</dt><dd className="tabular-nums text-success">−{dinero(beneficio.descuentoProveedor, moneda)}</dd></div>
              )}
              {Number(beneficio.bonoMembego) > 0 && (
                <div className="flex items-baseline justify-between"><dt className="text-muted-foreground">Beneficio Membego</dt><dd className="tabular-nums text-success" data-testid="beneficio-bono">−{dinero(beneficio.bonoMembego, moneda)}</dd></div>
              )}
              <div className="flex items-baseline justify-between border-t border-border pt-1"><dt className="font-medium">A pagar</dt><dd className="text-h3 tabular-nums" data-testid="beneficio-a-pagar">{dinero(aPagar, moneda)}</dd></div>
            </dl>
          )}
          {beneficio?.cubreTodo && <p className="text-caption text-success" data-testid="beneficio-cubre-todo">Tu beneficio cubre el total: no pagarás nada.</p>}
          {recalculando && <p className="text-caption text-muted-foreground">Recalculando tu beneficio…</p>}
          <Link href={RUTA_BENEFICIOS_CLIENTE} className="block text-caption text-primary underline-offset-4 hover:underline">Ver todos mis beneficios</Link>
        </div>
      )}

      <Button type="submit" className="w-full" disabled={pendiente} loading={pendiente} data-testid="btn-comprar">
        {beneficio?.cubreTodo ? 'Comprar con mi beneficio' : 'Comprar'}
      </Button>
      {estado.error && <p className="text-sm text-destructive" role="alert">{estado.error}</p>}
    </form>
  )
}
