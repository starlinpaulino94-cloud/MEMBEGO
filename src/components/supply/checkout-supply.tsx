'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { abrirPedidoAction, reclamarOfertaAction, type EstadoAccion } from '@/modules/supply/actions'
import { abrirVentaAction } from '@/modules/supply/actions-ventas'

export interface CheckoutVista {
  tipo: 'OFERTA' | 'VENTA'
  id: string
  producto: string
  variante: string | null
  proveedor: string
  cantidad: number
  precioOriginal: number
  descuentoMembego: number
  precioMembego: number
  subtotal: number
  bonos: { derechoId: string; producto: string; valor: number; venceAt: string }[]
  cobrable: boolean
  esGratis: boolean
  disponibles: number
}

const rd = (n: number) => `RD$${n.toLocaleString('es-DO', { minimumFractionDigits: 2 })}`

/**
 * El desglose que el cliente ve antes de confirmar: precio original, descuento
 * Membego, bono aplicado, diferencia y total. Con bono, el total baja pero la
 * venta se registra completa (GMV): es lo que le dice al proveedor y a
 * Membego cuánto valió de verdad la operación.
 */
export function CheckoutSupply({ resumen, clienteId }: { resumen: CheckoutVista; clienteId: string }) {
  const accionBase = resumen.tipo === 'VENTA' ? abrirVentaAction : resumen.esGratis ? reclamarOfertaAction : abrirPedidoAction
  const [estado, accion, pendiente] = useActionState<EstadoAccion, FormData>(accionBase, {})
  const [bonoId, setBonoId] = useState('')
  const bono = resumen.bonos.find((b) => b.derechoId === bonoId)
  const montoBono = bono ? Math.min(bono.valor, resumen.subtotal) : 0
  const total = Math.max(0, resumen.subtotal - montoBono)
  const requierePago = total > 0
  const bloqueado = requierePago && !resumen.cobrable

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div>
          <p className="font-semibold">
            {resumen.producto}
            {resumen.variante ? ` · ${resumen.variante}` : ''} {resumen.cantidad > 1 ? `× ${resumen.cantidad}` : ''}
          </p>
          <p className="text-caption text-muted-foreground">{resumen.proveedor} · {resumen.disponibles} disponibles</p>
        </div>

        <dl className="space-y-1 text-sm">
          <Fila t="Precio original" v={rd(resumen.precioOriginal * resumen.cantidad)} />
          {resumen.descuentoMembego > 0 && <Fila t="Descuento Membego" v={`− ${rd(resumen.descuentoMembego * resumen.cantidad)}`} />}
          <Fila t="Subtotal" v={rd(resumen.subtotal)} />
          {montoBono > 0 && <Fila t="Bono aplicado" v={`− ${rd(montoBono)}`} />}
          {montoBono > 0 && <Fila t="Diferencia a pagar" v={rd(total)} />}
          <div className="flex items-baseline justify-between gap-3 border-t border-border pt-2">
            <dt className="font-medium">Total a pagar a Membego</dt>
            <dd className="text-h3 font-semibold">{rd(total)}</dd>
          </div>
        </dl>

        {resumen.tipo === 'VENTA' && resumen.bonos.length > 0 && (
          <div>
            <label htmlFor="bono" className="text-sm font-medium">
              Aplicar un bono
            </label>
            <select id="bono" value={bonoId} onChange={(e) => setBonoId(e.target.value)} className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm">
              <option value="">Sin bono</option>
              {resumen.bonos.map((b) => (
                <option key={b.derechoId} value={b.derechoId}>
                  {b.producto} · vale {rd(b.valor)} · vence {new Intl.DateTimeFormat('es-DO', { dateStyle: 'medium' }).format(new Date(b.venceAt))}
                </option>
              ))}
            </select>
            <p className="mt-1 text-caption text-muted-foreground">El bono se consume cuando el negocio te entregue. La compra completa ({rd(resumen.subtotal)}) queda registrada.</p>
          </div>
        )}

        {bloqueado ? (
          <p className="rounded-lg bg-muted/40 p-3 text-caption">Membego no puede cobrar en este momento. Vuelve más tarde.</p>
        ) : estado.success ? (
          <div className="rounded-lg bg-success/10 p-3 text-sm text-success">
            <p>{estado.success}</p>
            <Link href="/cliente/beneficios" className="underline">
              Ir a Beneficios Membego
            </Link>
          </div>
        ) : (
          <form action={accion} className="space-y-2">
            <input type="hidden" name="clienteId" value={clienteId} />
            {resumen.tipo === 'VENTA' ? (
              <>
                <input type="hidden" name="acuerdoId" value={resumen.id} />
                <input type="hidden" name="cantidad" value={resumen.cantidad} />
                <input type="hidden" name="bonoDerechoId" value={bonoId} />
              </>
            ) : (
              <input type="hidden" name="asignacionId" value={resumen.id} />
            )}
            <Button type="submit" className="w-full" disabled={pendiente || !clienteId || resumen.disponibles <= 0}>
              {pendiente ? 'Procesando…' : requierePago ? `Confirmar y pagar ${rd(total)}` : resumen.esGratis ? 'Obtener gratis' : 'Confirmar con mi bono'}
            </Button>
            {requierePago && <p className="text-caption text-muted-foreground">Después de confirmar verás la cuenta de Membego para transferir y podrás subir el comprobante.</p>}
          </form>
        )}
        {estado.error && <p className="text-caption text-destructive">{estado.error}</p>}
      </CardContent>
    </Card>
  )
}

function Fila({ t, v }: { t: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{t}</dt>
      <dd className="text-right tabular-nums">{v}</dd>
    </div>
  )
}
