'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Ban, CheckCircle2, Loader2, PackageCheck, Receipt, Undo2, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import {
  aceptarPedido,
  ajustarMontoPedido,
  cancelarPedidoComoEmpresa,
  marcarPedidoListo,
  reembolsarPedido,
  registrarPagoPedido,
} from '@/modules/orders/actions'
import { ETIQUETA_METODO, formatearMonto } from '@/modules/orders/formato'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export interface PermisosPedido {
  gestionar: boolean
  cancelar: boolean
  reembolsar: boolean
}

/** Lo que el servidor ya decidió que se puede hacer con este pedido (el cliente no recalcula la máquina de estados). */
export interface PosibilidadesPedido {
  aceptar: boolean
  marcarListo: boolean
  ajustar: boolean
  registrarPago: boolean
  cancelar: boolean
  reembolsar: boolean
}

const METODOS = ['CASH', 'CARD', 'TRANSFER', 'MEMBEGO_CHECKOUT', 'OTHER'] as const
const campoSelector = 'h-9 w-full rounded-lg border border-input bg-background px-3 text-sm'

interface Props {
  pedidoId: string
  moneda: string
  total: string
  ajuste: string
  tieneInventario: boolean
  permisos: PermisosPedido
  puede: PosibilidadesPedido
}

/**
 * Lo que la empresa puede hacer con un pedido. Cada bloque aparece solo si el
 * estado del pedido lo permite (`puede`, decidido en el servidor) Y la persona
 * tiene la función de permiso (`permisos`); la acción de servidor lo comprueba
 * otra vez: ocultar un botón no es seguridad.
 */
export function PedidoAcciones({ pedidoId, moneda, total, ajuste, tieneInventario, permisos, puede }: Props) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [ajusteNuevo, setAjusteNuevo] = useState(ajuste === '0.00' ? '' : ajuste)
  const [motivoAjuste, setMotivoAjuste] = useState('')
  const [metodo, setMetodo] = useState<(typeof METODOS)[number]>('TRANSFER')
  const [montoPago, setMontoPago] = useState(total)
  const [referencia, setReferencia] = useState('')
  const [motivoCancelar, setMotivoCancelar] = useState('')
  const [motivoReembolso, setMotivoReembolso] = useState('')
  const [devolverStock, setDevolverStock] = useState(false)

  function ejecutar(accion: () => Promise<{ ok: true } | { ok: false; error: string }>, exito: string, despues?: () => void) {
    start(async () => {
      const r = await accion()
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success(exito)
      despues?.()
      router.refresh()
    })
  }

  const hayAlgo =
    (permisos.gestionar && (puede.aceptar || puede.marcarListo || puede.ajustar || puede.registrarPago)) ||
    (permisos.cancelar && puede.cancelar) ||
    (permisos.reembolsar && puede.reembolsar)
  if (!hayAlgo) return null

  const spinner = pending ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null

  return (
    <div className="space-y-4" aria-label="Acciones del pedido">
      {permisos.gestionar && (puede.aceptar || puede.marcarListo) && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 p-4">
            {puede.aceptar && (
              <Button disabled={pending} onClick={() => ejecutar(() => aceptarPedido(pedidoId), 'Pedido aceptado.')}>
                {spinner}
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Aceptar pedido
              </Button>
            )}
            {puede.marcarListo && (
              <Button variant={puede.aceptar ? 'outline' : 'default'} disabled={pending} onClick={() => ejecutar(() => marcarPedidoListo(pedidoId), 'Pedido listo: el cliente ya puede ver su QR.')}>
                {spinner}
                <PackageCheck className="mr-2 h-4 w-4" />
                Marcar listo
              </Button>
            )}
            <p className="text-xs text-muted-foreground">
              {puede.aceptar ? 'Aceptar confirma que lo atenderás. ' : ''}Al marcarlo listo, el cliente recibe un QR para recogerlo; cuando lo escanees, el pedido se cierra.
            </p>
          </CardContent>
        </Card>
      )}

      {permisos.gestionar && puede.ajustar && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Receipt className="h-4 w-4" />
              Ajustar el monto
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-3"
              aria-label="Ajustar el monto del pedido"
              onSubmit={(e) => {
                e.preventDefault()
                const n = ajusteNuevo.trim() === '' ? 0 : Number(ajusteNuevo.replace(',', '.'))
                if (!Number.isFinite(n)) {
                  toast.error('Escribe el ajuste como número, por ejemplo -50 o 25.')
                  return
                }
                ejecutar(() => ajustarMontoPedido({ pedidoId, ajuste: n, motivo: motivoAjuste }), 'Monto ajustado. El cliente debe confirmarlo de nuevo.', () => setMotivoAjuste(''))
              }}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="aj-valor">Ajuste ({moneda})</Label>
                  <Input id="aj-valor" name="ajuste" inputMode="decimal" autoComplete="off" placeholder="-50 (rebaja) o 25 (recargo)" value={ajusteNuevo} onChange={(e) => setAjusteNuevo(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="aj-motivo">Motivo</Label>
                  <Input id="aj-motivo" name="motivo" maxLength={300} autoComplete="off" value={motivoAjuste} onChange={(e) => setMotivoAjuste(e.target.value)} placeholder="Ej: cliente frecuente" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Es el ajuste TOTAL sobre lo pedido (no se suma al anterior); 0 lo quita. Hoy el pedido suma {formatearMonto(total, moneda)}. El cliente tendrá que volver a confirmar el monto.
              </p>
              <Button type="submit" size="sm" variant="outline" disabled={pending}>
                {spinner}
                Guardar ajuste
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {permisos.gestionar && puede.registrarPago && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Wallet className="h-4 w-4" />
              Registrar el pago
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-3"
              aria-label="Registrar el pago del pedido"
              onSubmit={(e) => {
                e.preventDefault()
                const n = Number(montoPago.replace(',', '.'))
                if (montoPago.trim() === '' || !Number.isFinite(n) || n < 0) {
                  toast.error('Escribe el monto cobrado como número.')
                  return
                }
                ejecutar(() => registrarPagoPedido({ pedidoId, metodo, monto: n, referencia: referencia.trim() || null }), 'Pago registrado.', () => setReferencia(''))
              }}
            >
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="pg-metodo">Método</Label>
                  <select id="pg-metodo" value={metodo} onChange={(e) => setMetodo(e.target.value as (typeof METODOS)[number])} className={campoSelector}>
                    {METODOS.map((m) => (
                      <option key={m} value={m}>
                        {ETIQUETA_METODO[m]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pg-monto">Monto cobrado ({moneda})</Label>
                  <Input id="pg-monto" name="monto" inputMode="decimal" autoComplete="off" required value={montoPago} onChange={(e) => setMontoPago(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pg-ref">Referencia</Label>
                  <Input id="pg-ref" name="referencia" maxLength={80} autoComplete="off" value={referencia} onChange={(e) => setReferencia(e.target.value)} placeholder="N.º de transferencia o voucher" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Esto deja constancia de un pago hecho fuera de MembeGo; no mueve dinero. Con tarjeta o transferencia, una referencia y el monto del pedido, el pedido queda con el pago verificado. En efectivo solo queda anotado.
              </p>
              <Button type="submit" size="sm" variant="outline" disabled={pending}>
                {spinner}
                Registrar pago
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {permisos.cancelar && puede.cancelar && (
        <Card className="border-destructive/30">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Ban className="h-4 w-4 text-destructive" />
              Cancelar el pedido
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-3"
              aria-label="Cancelar el pedido"
              onSubmit={(e) => {
                e.preventDefault()
                ejecutar(() => cancelarPedidoComoEmpresa({ pedidoId, motivo: motivoCancelar }), 'Pedido cancelado.', () => setMotivoCancelar(''))
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="ca-motivo">Motivo (el cliente lo verá)</Label>
                <Input id="ca-motivo" name="motivo" maxLength={300} autoComplete="off" required value={motivoCancelar} onChange={(e) => setMotivoCancelar(e.target.value)} placeholder="Ej: ya no tenemos ese producto" />
              </div>
              <p className="text-xs text-muted-foreground">{tieneInventario ? 'Lo apartado del inventario vuelve a estar disponible. ' : ''}El QR deja de valer.</p>
              <Button type="submit" size="sm" variant="destructive" disabled={pending || motivoCancelar.trim() === ''}>
                {spinner}
                Cancelar pedido
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {permisos.reembolsar && puede.reembolsar && (
        <Card className="border-warning/40">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Undo2 className="h-4 w-4 text-warning" />
              Reembolsar
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-3"
              aria-label="Reembolsar el pedido"
              onSubmit={(e) => {
                e.preventDefault()
                ejecutar(() => reembolsarPedido({ pedidoId, motivo: motivoReembolso, devolverAlInventario: devolverStock }), 'Pedido reembolsado.', () => setMotivoReembolso(''))
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="re-motivo">Motivo</Label>
                <Input id="re-motivo" name="motivo" maxLength={300} autoComplete="off" required value={motivoReembolso} onChange={(e) => setMotivoReembolso(e.target.value)} placeholder="Ej: el producto llegó defectuoso" />
              </div>
              {tieneInventario && (
                <div className="flex items-center gap-2">
                  <input id="re-stock" type="checkbox" checked={devolverStock} onChange={(e) => setDevolverStock(e.target.checked)} className="h-4 w-4 rounded border-input" />
                  <Label htmlFor="re-stock">Devolver lo vendido al inventario</Label>
                </div>
              )}
              <p className="text-xs text-muted-foreground">Esto deja constancia del reembolso; el dinero lo devuelves tú, fuera de MembeGo.</p>
              <Button type="submit" size="sm" variant="outline" disabled={pending || motivoReembolso.trim() === ''}>
                {spinner}
                Reembolsar
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
