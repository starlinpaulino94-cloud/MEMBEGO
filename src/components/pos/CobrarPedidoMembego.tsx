'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Loader2, QrCode } from 'lucide-react'
import { toast } from 'sonner'
import { buscarPedidoParaCobrar, cobrarPedidoMembego } from '@/modules/pos/actions'
import type { PedidoParaCobrar, ResultadoDeCobro } from '@/modules/pos/service'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PAGO_INICIAL, PagoFormulario, type EstadoDePago } from './PagoFormulario'

const rd = (n: number | string) => `RD$${Number(n).toLocaleString('es-DO', { minimumFractionDigits: 2 })}`

/**
 * Cobrar el pedido de quien llega con su QR (del marketplace o el cupón de una oferta). Quien cobra
 * ESCANEA el QR con el lector (que teclea el código en el campo y pulsa Enter) o lo escribe: el pedido de la
 * vitrina se cierra solo con su QR. Se ve el pedido, se elige cómo paga y se cobra: el pago, el cierre y el
 * cobro de la caja ocurren juntos.
 */
export function CobrarPedidoMembego({ cajaSesionId }: { cajaSesionId: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [codigo, setCodigo] = useState('')
  const [pedido, setPedido] = useState<PedidoParaCobrar | null>(null)
  const [token, setToken] = useState('')
  const [pago, setPago] = useState<EstadoDePago>(PAGO_INICIAL)
  const [hecho, setHecho] = useState<ResultadoDeCobro | null>(null)

  function reiniciar() {
    setCodigo('')
    setPedido(null)
    setToken('')
    setPago(PAGO_INICIAL)
    setHecho(null)
  }

  function buscar(e: React.FormEvent) {
    e.preventDefault()
    const t = codigo.trim()
    if (!t) return
    start(async () => {
      const r = await buscarPedidoParaCobrar({ cajaSesionId, token: t })
      if (!r.ok) {
        setPedido(null)
        toast.error(r.error)
        return
      }
      setToken(t)
      setPedido(r.pedido)
      setHecho(null)
    })
  }

  function cobrar(entregarSinCobrar = false) {
    start(async () => {
      const r = await cobrarPedidoMembego(
        entregarSinCobrar ? { cajaSesionId, token, entregarSinCobrar: true } : { cajaSesionId, token, metodo: pago.metodo, referencia: pago.referencia, recibido: pago.recibido }
      )
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success(r.cobro.transaccion ? `Cobrado ${r.cobro.code} · ticket ${r.cobro.transaccion.ticketNumero}` : `Entregado ${r.cobro.code}`)
      setHecho(r.cobro)
      setPedido(null)
      router.refresh()
    })
  }

  return (
    <section className="space-y-4 rounded-2xl border border-border/70 bg-card p-5" aria-label="Cobrar un pedido Membego">
      <div>
        <h2 className="flex items-center gap-2 text-h3 text-foreground">
          <QrCode className="h-5 w-5 text-primary" aria-hidden /> Cobrar un pedido Membego
        </h2>
        <p className="text-sm text-muted-foreground">Escanea el QR del cliente (pedido del marketplace u oferta) para ver el pedido y cobrarlo.</p>
      </div>

      <form onSubmit={buscar} className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1 space-y-1.5">
          <Label htmlFor="pos-qr">Código del QR</Label>
          <Input id="pos-qr" value={codigo} onChange={(e) => setCodigo(e.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false} placeholder="Escanea o escribe el código" />
        </div>
        <Button type="submit" variant="outline" disabled={pending || codigo.trim() === ''}>
          {pending && !pedido ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Buscar pedido
        </Button>
      </form>

      {hecho && (
        <div className="rounded-xl border border-success/30 bg-success/5 p-4" role="status" data-testid="pos-cobro-hecho">
          <p className="flex items-center gap-2 font-semibold text-success">
            <CheckCircle2 className="h-4 w-4" aria-hidden /> Pedido {hecho.code} {hecho.transaccion ? 'cobrado y entregado' : 'entregado (ya estaba pagado)'}
          </p>
          <p className="mt-1 text-sm text-foreground">
            {rd(hecho.total)}
            {hecho.transaccion ? ` · ticket ${hecho.transaccion.ticketNumero}` : ' · no entró dinero a la caja'}
            {hecho.cambio ? ` · cambio ${rd(hecho.cambio)}` : ''}
          </p>
          <Button type="button" variant="outline" size="sm" className="mt-3" onClick={reiniciar}>
            Cobrar otro
          </Button>
        </div>
      )}

      {pedido && (
        <div className="space-y-4 rounded-xl border border-border/70 bg-muted/20 p-4" data-testid="pos-pedido">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-semibold text-foreground">
                {pedido.code} <span className="font-normal text-muted-foreground">· {pedido.clienteNombre}</span>
              </p>
              {pedido.oferta && <p className="text-sm font-medium text-primary">Oferta «{pedido.oferta}»: el precio ya trae el descuento.</p>}
              <p className="text-xs text-muted-foreground">{pedido.confirmado ? 'El cliente confirmó este monto en su teléfono.' : 'El cliente todavía no confirmó el monto.'}</p>
            </div>
            <p className="text-h3 tabular-nums text-foreground">{rd(pedido.total)}</p>
          </div>
          <ul className="divide-y divide-border/50 text-sm" aria-label="Renglones del pedido">
            {pedido.lineas.map((l, i) => (
              <li key={i} className="flex justify-between gap-3 py-1.5">
                <span>
                  {l.cantidad} × {l.descripcion}
                </span>
                <span className="tabular-nums">{rd(l.total)}</span>
              </li>
            ))}
          </ul>
          {pedido.puedeCobrar && pedido.pagoRegistrado ? (
            <div className="space-y-3" data-testid="pos-ya-pagado">
              <p className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm text-foreground">
                Este pedido <strong>ya está pagado</strong>: {pedido.pagoRegistrado.metodo}
                {pedido.pagoRegistrado.referencia ? ` · ref. ${pedido.pagoRegistrado.referencia}` : ''} · {rd(pedido.pagoRegistrado.monto)}. No se cobra otra vez: entrégalo.
              </p>
              <Button type="button" className="w-full py-5 text-base font-semibold" disabled={pending} onClick={() => cobrar(true)}>
                {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Entregar sin cobrar
              </Button>
            </div>
          ) : pedido.puedeCobrar ? (
            <>
              <PagoFormulario valor={pago} onChange={setPago} total={Number(pedido.total)} prefijo="pos-cobro" />
              <Button type="button" className="w-full py-5 text-base font-semibold" disabled={pending} onClick={() => cobrar()}>
                {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Cobrar {rd(pedido.total)} y entregar
              </Button>
            </>
          ) : (
            <p className="text-sm font-medium text-destructive" role="alert">
              {pedido.mensaje}
            </p>
          )}
        </div>
      )}
    </section>
  )
}
