'use client'

import { RUTA_CARRITO, rutaDeLogin, rutaDePago } from '@/modules/comercio/rutas'
import Link from 'next/link'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { hacerCheckout } from '@/modules/checkout/actions'
import { ETIQUETA_METODO_CHECKOUT, lineasDe, type MetodoCheckout } from '@/modules/checkout/domain'
import { formatearMonto } from '@/modules/orders/formato'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useCarrito } from './useCarrito'
import { useResumen } from './useResumen'

function nuevaClave(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

const campoSelector = 'h-9 w-full rounded-lg border border-input bg-background px-3 text-sm'

interface Props {
  companySlug: string
  sucursales: { id: string; nombre: string }[]
  transferencia: boolean
}

/**
 * El pago del carrito de UN negocio. Muestra lo que el servidor dice que vale HOY, y al enviar crea el pedido
 * (que la empresa aceptará). No cobra: se paga al recoger o por transferencia que el negocio verifica.
 */
export function PagarFormulario({ companySlug, sucursales, transferencia }: Props) {
  const router = useRouter()
  const { carrito, vaciar } = useCarrito()
  const lineas = lineasDe(carrito, companySlug)
  const [pending, start] = useTransition()
  const [sucursalId, setSucursalId] = useState(sucursales.length === 1 ? sucursales[0].id : '')
  const [metodo, setMetodo] = useState<MetodoCheckout>('AL_RECOGER')
  const [notas, setNotas] = useState('')
  const [enviado, setEnviado] = useState(false)
  const r = useResumen(companySlug, lineas, sucursalId || null)

  // Un envío = una clave. Si el carrito cambia es otro envío, con otra clave.
  const llaveLineas = JSON.stringify(lineas)
  const [clave, setClave] = useState(() => ({ llave: llaveLineas, valor: nuevaClave() }))
  if (clave.llave !== llaveLineas) setClave({ llave: llaveLineas, valor: nuevaClave() })

  if (lineas.length === 0 && !enviado) {
    return (
      <div className="rounded-lg border border-border p-6 text-center text-sm text-muted-foreground">
        <p className="font-medium text-foreground">Tu carrito de este negocio está vacío.</p>
        <Button asChild variant="outline" className="mt-4">
          <Link href={RUTA_CARRITO}>Ir al carrito</Link>
        </Button>
      </div>
    )
  }

  const resumen = r.estado === 'listo' ? r.resumen : null
  const puedePagar = !!resumen && resumen.comprable && !!sucursalId && !pending && !enviado

  function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!sucursalId) {
      toast.error('Elige la sucursal donde recogerás tu pedido.')
      return
    }
    start(async () => {
      let resultado: Awaited<ReturnType<typeof hacerCheckout>>
      try {
        resultado = await hacerCheckout({ lineas, sucursalId, metodo, notas: notas.trim() || undefined, origen: 'navegacion', clave: clave.valor })
      } catch {
        // Sin red o la respuesta se perdió: reenviar usa la misma clave, así que no duplica el pedido.
        toast.error('No pudimos confirmar tu pedido. Revisa «Mis pedidos»; si no aparece, vuelve a pulsar Enviar.')
        return
      }
      if (!resultado.ok) {
        if (resultado.sinSesion) {
          router.push(rutaDeLogin(rutaDePago(companySlug)))
          return
        }
        toast.error(resultado.error)
        return
      }
      setEnviado(true)
      vaciar(companySlug)
      toast.success(`Pedido ${resultado.code} enviado.`)
      router.push(`/cliente/pedidos/${resultado.pedidoId}`)
    })
  }

  return (
    <form onSubmit={enviar} className="space-y-6" aria-label="Pagar el carrito">
      <section className="rounded-lg border border-border" aria-label="Tu pedido">
        {r.estado === 'cargando' && (
          <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground" aria-busy>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Revisando precios y existencias…
          </p>
        )}
        {r.estado === 'error' && (
          <p className="p-4 text-sm text-destructive" role="alert">
            {r.error}
          </p>
        )}
        {resumen && (
          <>
            <ul className="divide-y divide-border" aria-label="Productos del pedido">
              {resumen.renglones.map((l) => (
                <li key={l.varianteId} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3 text-sm" data-testid="pago-renglon">
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">{l.nombre}</p>
                    <p className="text-muted-foreground tabular-nums">
                      {l.cantidad} × {formatearMonto(l.precio, resumen.moneda)}
                    </p>
                    {l.problema && (
                      <p className="mt-1 font-medium text-destructive" role="alert">
                        {l.problema}
                      </p>
                    )}
                  </div>
                  <p className="tabular-nums">{l.problema ? '—' : formatearMonto(l.subtotal, resumen.moneda)}</p>
                </li>
              ))}
            </ul>
            <div className="flex items-baseline justify-between border-t border-border px-4 py-3">
              <span className="font-semibold">Total</span>
              <span className="text-xl font-semibold tabular-nums" data-testid="pago-total">
                {formatearMonto(resumen.total, resumen.moneda)}
              </span>
            </div>
            {!resumen.comprable && (
              <p className="border-t border-border px-4 py-3 text-sm text-destructive" role="alert">
                Hay productos que ya no se pueden pedir así. <Link href={RUTA_CARRITO} className="underline">Revisa tu carrito</Link>.
              </p>
            )}
          </>
        )}
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="pg-sucursal">Sucursal donde lo recogerás</Label>
          <select id="pg-sucursal" value={sucursalId} onChange={(e) => setSucursalId(e.target.value)} className={campoSelector} required>
            {sucursales.length > 1 && <option value="">Elige una sucursal</option>}
            {sucursales.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pg-metodo">Cómo vas a pagar</Label>
          <select id="pg-metodo" value={metodo} onChange={(e) => setMetodo(e.target.value as MetodoCheckout)} className={campoSelector}>
            <option value="AL_RECOGER">{ETIQUETA_METODO_CHECKOUT.AL_RECOGER}</option>
            {transferencia && <option value="TRANSFERENCIA">{ETIQUETA_METODO_CHECKOUT.TRANSFERENCIA}</option>}
          </select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="pg-notas">Nota para el negocio (opcional)</Label>
        <Input id="pg-notas" name="notas" maxLength={200} autoComplete="off" value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Ej: lo recojo después de las 5" />
      </div>

      <div className="space-y-2 rounded-lg bg-muted/50 p-4 text-sm text-muted-foreground">
        {metodo === 'TRANSFERENCIA' ? (
          <p>Al enviar el pedido verás las cuentas del negocio y tu código de pedido para usarlo como referencia. El negocio confirma tu transferencia cuando la vea en su banco.</p>
        ) : (
          <p>Pagas cuando recojas tu pedido en el negocio.</p>
        )}
        <p>El negocio revisa y acepta tu pedido. No se te cobra nada en MembeGo: el pago es entre tú y el negocio.</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href={RUTA_CARRITO} className="text-sm text-muted-foreground underline">
          Volver al carrito
        </Link>
        <Button type="submit" disabled={!puedePagar}>
          {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
          Enviar pedido
        </Button>
      </div>
    </form>
  )
}
