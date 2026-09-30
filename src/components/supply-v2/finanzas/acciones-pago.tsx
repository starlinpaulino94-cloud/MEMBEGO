'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cancelarPagoProveedorAction, confirmarPagoProveedorAction, convertirEnDepositoAction, reversarAplicacionAction } from '@/modules/supply-v2/actions-finanzas'
import type { EstadoAccion } from '@/modules/supply-v2/actions-util'
import type { PagoConfirmadoProveedor } from '@/modules/supply-v2/finance/payments'
import type { DepositoCreado } from '@/modules/supply-v2/finance/deposits'
import type { ReversaAplicacion } from '@/modules/supply-v2/finance/applications'
import { dineroSupplyV2 } from '@/modules/supply-v2/core/catalogo'

function useRefrescoAlExito(estado: EstadoAccion<unknown>) {
  const router = useRouter()
  const visto = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (estado.success && visto.current !== estado.success) {
      visto.current = estado.success
      toast.success(estado.success)
      router.refresh()
    }
  }, [estado, router])
}

/** Confirmar un pago (§41): lo hace OTRA persona; el servidor lo impone. */
export function ConfirmarPago({ paymentId, soyElCreador, compacto = false }: { paymentId: string; soyElCreador: boolean; compacto?: boolean }) {
  const [estado, enviar, pendiente] = useActionState<EstadoAccion<PagoConfirmadoProveedor>, FormData>(confirmarPagoProveedorAction, {})
  useRefrescoAlExito(estado)
  return (
    <form action={enviar} className={compacto ? 'flex flex-wrap items-center gap-2' : 'space-y-2'}>
      <input type="hidden" name="paymentId" value={paymentId} />
      <Button type="submit" size={compacto ? 'sm' : 'default'} disabled={pendiente} loading={pendiente} data-testid="btn-confirmar-pago-proveedor">Confirmar pago</Button>
      {soyElCreador && !compacto && <p className="text-caption text-muted-foreground">Registraste este pago: si hay otra persona autorizada, le toca a ella confirmarlo.</p>}
      {estado.error && <p className="text-sm text-destructive" role="alert">{estado.error}</p>}
    </form>
  )
}

export function CancelarPago({ paymentId }: { paymentId: string }) {
  const [estado, enviar, pendiente] = useActionState<EstadoAccion, FormData>(cancelarPagoProveedorAction, {})
  const [abierto, setAbierto] = useState(false)
  useRefrescoAlExito(estado)
  if (!abierto) return <Button type="button" variant="ghost" onClick={() => setAbierto(true)}>Cancelar pago</Button>
  return (
    <form action={enviar} className="space-y-2 rounded-lg border border-border p-3">
      <input type="hidden" name="paymentId" value={paymentId} />
      <Label htmlFor="motivoCancelPago">Motivo (obligatorio)</Label>
      <Textarea id="motivoCancelPago" name="motivo" rows={2} maxLength={500} required autoFocus />
      {estado.error && <p className="text-sm text-destructive" role="alert">{estado.error}</p>}
      <div className="flex gap-2">
        <Button type="submit" variant="destructive" disabled={pendiente} loading={pendiente}>Confirmar cancelación</Button>
        <Button type="button" variant="ghost" onClick={() => setAbierto(false)}>Volver</Button>
      </div>
    </form>
  )
}

/** El excedente de un pago se convierte en depósito de forma EXPLÍCITA (§56). */
export function ConvertirEnDeposito({ paymentId, sinAplicar, moneda, idempotencyKey }: { paymentId: string; sinAplicar: string; moneda: string; idempotencyKey: string }) {
  const [estado, enviar, pendiente] = useActionState<EstadoAccion<DepositoCreado>, FormData>(convertirEnDepositoAction, {})
  const [abierto, setAbierto] = useState(false)
  useRefrescoAlExito(estado)
  if (!abierto) return <Button type="button" variant="outline" onClick={() => setAbierto(true)} data-testid="btn-convertir-deposito">Convertir {dineroSupplyV2(sinAplicar, moneda)} en depósito</Button>
  return (
    <form action={enviar} className="space-y-2 rounded-lg border border-border p-3">
      <input type="hidden" name="paymentId" value={paymentId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <Label htmlFor="montoDepositoNuevo">Monto del depósito (máximo {dineroSupplyV2(sinAplicar, moneda)})</Label>
      <Input id="montoDepositoNuevo" name="amount" type="number" min="0.01" max={sinAplicar} step="0.01" defaultValue={sinAplicar} required />
      <Label htmlFor="notasDepositoNuevo">Notas</Label>
      <Input id="notasDepositoNuevo" name="notes" maxLength={500} />
      {estado.error && <p className="text-sm text-destructive" role="alert">{estado.error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={pendiente} loading={pendiente} data-testid="btn-convertir-deposito-confirmar">Crear depósito</Button>
        <Button type="button" variant="ghost" onClick={() => setAbierto(false)}>Cancelar</Button>
      </div>
    </form>
  )
}

/** Reversar una aplicación por error administrativo (§57). No borra: crea la reversa. */
export function ReversarAplicacion({ applicationId, monto, moneda }: { applicationId: string; monto: string; moneda: string }) {
  const [estado, enviar, pendiente] = useActionState<EstadoAccion<ReversaAplicacion>, FormData>(reversarAplicacionAction, {})
  const [abierto, setAbierto] = useState(false)
  useRefrescoAlExito(estado)
  if (!abierto) return <Button type="button" size="sm" variant="ghost" onClick={() => setAbierto(true)} data-testid="btn-reversar-aplicacion">Reversar</Button>
  return (
    <form action={enviar} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="applicationId" value={applicationId} />
      <div className="min-w-56 flex-1">
        <Label htmlFor={`motivo-${applicationId}`}>Motivo de la reversa de {dineroSupplyV2(monto, moneda)}</Label>
        <Input id={`motivo-${applicationId}`} name="motivo" maxLength={500} required autoFocus data-testid="motivo-reversa-aplicacion" />
      </div>
      <Button type="submit" size="sm" variant="destructive" disabled={pendiente} loading={pendiente} data-testid="btn-reversar-aplicacion-confirmar">Reversar</Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setAbierto(false)}>Cancelar</Button>
      {estado.error && <p className="w-full text-sm text-destructive" role="alert">{estado.error}</p>}
    </form>
  )
}
