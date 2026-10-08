'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Loader2, Minus, Plus, Search, ShoppingCart, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { buscarClientesCaja, buscarProductosCaja, venderEnMostrador } from '@/modules/pos/actions'
import type { ClienteDeCaja, ProductoDeCaja, ResultadoDeVenta } from '@/modules/pos/service'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PAGO_INICIAL, PagoFormulario, type EstadoDePago } from './PagoFormulario'

const rd = (n: number | string) => `RD$${Number(n).toLocaleString('es-DO', { minimumFractionDigits: 2 })}`
const nuevaClave = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

interface Renglon {
  producto: ProductoDeCaja
  cantidad: number
}

/**
 * Venta de mostrador: se buscan productos del catálogo, se arma el carrito, se identifica al cliente (o se deja
 * «sin registro») y se cobra. El precio que se enseña es informativo: el servidor lo vuelve a tomar del catálogo.
 * Cada envío lleva su propia clave: pulsar «Cobrar» dos veces no vende dos veces.
 */
export function VentaMostrador({ cajaSesionId }: { cajaSesionId: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [q, setQ] = useState('')
  const [resultados, setResultados] = useState<ProductoDeCaja[]>([])
  const [carrito, setCarrito] = useState<Renglon[]>([])
  const [qCliente, setQCliente] = useState('')
  const [clientes, setClientes] = useState<ClienteDeCaja[]>([])
  const [cliente, setCliente] = useState<ClienteDeCaja | null>(null)
  const [pago, setPago] = useState<EstadoDePago>(PAGO_INICIAL)
  const [hecha, setHecha] = useState<ResultadoDeVenta | null>(null)
  const clave = useRef(nuevaClave())

  const total = carrito.reduce((t, r) => t + Number(r.producto.precio) * r.cantidad, 0)

  function buscarProductos(e?: React.FormEvent) {
    e?.preventDefault()
    start(async () => {
      const r = await buscarProductosCaja({ cajaSesionId, q })
      if (!r.ok) return void toast.error(r.error)
      setResultados(r.productos)
    })
  }

  // Cada cambio del carrito o del cliente es otra venta: lleva otra clave. Reintentar SIN cambiar nada reutiliza la clave
  // (si la respuesta se perdió, el servidor devuelve la venta que ya hizo en vez de repetirla).
  const otraVenta = () => {
    clave.current = nuevaClave()
  }

  function agregar(p: ProductoDeCaja) {
    otraVenta()
    setCarrito((c) => {
      const i = c.findIndex((x) => x.producto.varianteId === p.varianteId)
      if (i >= 0) return c.map((x, j) => (j === i ? { ...x, cantidad: Math.min(999, x.cantidad + 1) } : x))
      return [...c, { producto: p, cantidad: 1 }]
    })
  }
  const cambiar = (id: string, delta: number) => (otraVenta(), setCarrito((c) => c.map((x) => (x.producto.varianteId === id ? { ...x, cantidad: Math.max(1, Math.min(999, x.cantidad + delta)) } : x))))
  const quitar = (id: string) => (otraVenta(), setCarrito((c) => c.filter((x) => x.producto.varianteId !== id)))

  function buscarClientes(e: React.FormEvent) {
    e.preventDefault()
    start(async () => {
      const r = await buscarClientesCaja({ q: qCliente })
      if (!r.ok) return void toast.error(r.error)
      setClientes(r.clientes)
      if (r.clientes.length === 0) toast.message('No hay clientes con ese dato. Puedes vender «sin registro».')
    })
  }

  function reiniciar() {
    setCarrito([])
    setResultados([])
    setQ('')
    setQCliente('')
    setClientes([])
    setCliente(null)
    setPago(PAGO_INICIAL)
    setHecha(null)
    clave.current = nuevaClave()
  }

  function cobrar() {
    start(async () => {
      try {
        const r = await venderEnMostrador({
          cajaSesionId,
          lineas: carrito.map((x) => ({ varianteId: x.producto.varianteId, cantidad: x.cantidad })),
          clienteId: cliente?.id ?? null,
          metodo: pago.metodo,
          referencia: pago.referencia,
          recibido: pago.recibido,
          clave: clave.current,
        })
        if (!r.ok) return void toast.error(r.error)
        toast.success(`Venta ${r.venta.code} · ticket ${r.venta.transaccion.ticketNumero}`)
        setHecha(r.venta)
        router.refresh()
      } catch {
        // La respuesta se perdió: pudo o no cobrarse. Reintentar con la misma clave no vende dos veces.
        toast.error('No se pudo confirmar la venta. Revisa «Últimos cobros» antes de cobrar de nuevo; si no aparece, vuelve a pulsar Cobrar.')
      }
    })
  }

  if (hecha) {
    return (
      <section className="rounded-2xl border border-success/30 bg-success/5 p-5" aria-label="Venta de mostrador" data-testid="pos-venta-hecha">
        <p className="flex items-center gap-2 font-semibold text-success">
          <CheckCircle2 className="h-4 w-4" aria-hidden /> Venta {hecha.code} cobrada
        </p>
        <p className="mt-1 text-sm text-foreground">
          {rd(hecha.total)} · ticket {hecha.transaccion.ticketNumero}
          {hecha.cambio ? ` · cambio ${rd(hecha.cambio)}` : ''}
          {hecha.repetido ? ' · (ya estaba registrada)' : ''}
        </p>
        <Button type="button" variant="outline" size="sm" className="mt-3" onClick={reiniciar}>
          Nueva venta
        </Button>
      </section>
    )
  }

  return (
    <section className="space-y-4 rounded-2xl border border-border/70 bg-card p-5" aria-label="Venta de mostrador">
      <div>
        <h2 className="flex items-center gap-2 text-h3 text-foreground">
          <ShoppingCart className="h-5 w-5 text-primary" aria-hidden /> Venta de mostrador
        </h2>
        <p className="text-sm text-muted-foreground">Vende productos y servicios de tu catálogo. Las existencias bajan al cobrar.</p>
      </div>

      <form onSubmit={buscarProductos} className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1 space-y-1.5">
          <Label htmlFor="pos-producto">Buscar producto o servicio</Label>
          <Input id="pos-producto" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre (vacío = todos)" autoComplete="off" />
        </div>
        <Button type="submit" variant="outline" disabled={pending}>
          <Search className="mr-2 h-4 w-4" aria-hidden /> Buscar
        </Button>
      </form>

      {resultados.length > 0 && (
        <ul className="divide-y divide-border/50 rounded-xl border border-border/60 text-sm" aria-label="Resultados de la búsqueda">
          {resultados.map((p) => (
            <li key={p.varianteId} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="min-w-0">
                <span className="block truncate font-medium text-foreground">{p.etiqueta}</span>
                <span className="text-xs text-muted-foreground">{p.disponible === null ? 'Servicio' : p.disponible > 0 ? `${p.disponible} disponibles` : 'Agotado'}</span>
              </span>
              <span className="flex shrink-0 items-center gap-3">
                <span className="tabular-nums">{rd(p.precio)}</span>
                <Button type="button" size="sm" variant="outline" disabled={p.disponible !== null && p.disponible <= 0} onClick={() => agregar(p)} aria-label={`Agregar ${p.etiqueta}`}>
                  <Plus className="h-4 w-4" aria-hidden />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div aria-label="Carrito">
        {carrito.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border/70 p-4 text-center text-sm text-muted-foreground">El carrito está vacío.</p>
        ) : (
          <ul className="divide-y divide-border/50 rounded-xl border border-border/60 text-sm" data-testid="pos-carrito">
            {carrito.map((r) => (
              <li key={r.producto.varianteId} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="min-w-0 truncate font-medium text-foreground">{r.producto.etiqueta}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => cambiar(r.producto.varianteId, -1)} aria-label={`Una menos de ${r.producto.etiqueta}`}>
                    <Minus className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                  <span className="w-8 text-center tabular-nums" aria-label={`Cantidad de ${r.producto.etiqueta}`}>
                    {r.cantidad}
                  </span>
                  <Button type="button" size="sm" variant="outline" onClick={() => cambiar(r.producto.varianteId, 1)} aria-label={`Una más de ${r.producto.etiqueta}`}>
                    <Plus className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                  <span className="w-24 text-right tabular-nums">{rd(Number(r.producto.precio) * r.cantidad)}</span>
                  <Button type="button" size="sm" variant="ghost" onClick={() => quitar(r.producto.varianteId)} aria-label={`Quitar ${r.producto.etiqueta}`}>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">Cliente</p>
        {cliente ? (
          <p className="flex items-center justify-between rounded-xl border border-border/60 px-3 py-2 text-sm">
            <span>{cliente.nombre}</span>
            <Button type="button" size="sm" variant="ghost" onClick={() => (otraVenta(), setCliente(null))}>
              Quitar
            </Button>
          </p>
        ) : (
          <>
            <form onSubmit={buscarClientes} className="flex flex-wrap items-end gap-2">
              <div className="min-w-0 flex-1">
                <Label htmlFor="pos-cliente" className="sr-only">
                  Buscar cliente
                </Label>
                <Input id="pos-cliente" value={qCliente} onChange={(e) => setQCliente(e.target.value)} placeholder="Nombre, teléfono o correo (opcional)" autoComplete="off" />
              </div>
              <Button type="submit" variant="outline" disabled={pending || qCliente.trim().length < 2}>
                Buscar cliente
              </Button>
            </form>
            {clientes.length > 0 && (
              <ul className="divide-y divide-border/50 rounded-xl border border-border/60 text-sm" aria-label="Clientes encontrados">
                {clientes.map((c) => (
                  <li key={c.id}>
                    <button type="button" className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-muted/40" onClick={() => (otraVenta(), setCliente(c))}>
                      <span>{c.nombre}</span>
                      <span className="text-xs text-muted-foreground">{c.telefono ?? ''}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">Sin elegir a nadie, la venta queda «sin registro».</p>
          </>
        )}
      </div>

      {carrito.length > 0 && (
        <>
          <p className="flex items-baseline justify-between border-t border-border/60 pt-3 text-h3 text-foreground">
            <span>Total</span>
            <span className="tabular-nums" data-testid="pos-total">
              {rd(total)}
            </span>
          </p>
          <PagoFormulario valor={pago} onChange={setPago} total={total} prefijo="pos-venta" />
          <Button type="button" className="w-full py-5 text-base font-semibold" disabled={pending} onClick={cobrar}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Cobrar {rd(total)}
          </Button>
        </>
      )}
    </section>
  )
}
