'use client'

/**
 * Gift cards · acciones del panel admin según el estado:
 *  - PENDIENTE_PAGO → Confirmar pago (elige método; registra la VENTA) o Cancelar.
 *  - ACTIVA → Redimir (consume saldo con comprobante).
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Ban, BadgeCheck, Loader2, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  confirmarPagoGiftCard,
  redimirGiftCard,
  cancelarGiftCardAdmin,
} from '@/modules/regalos/giftcard-actions'
import { formatRD } from '@/lib/format'

export function GiftCardAdminActions({
  giftCardId,
  codigo,
  estado,
  monto,
  saldo,
}: {
  giftCardId: string
  codigo: string
  estado: string
  monto: number
  saldo: number
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const [openConfirmar, setOpenConfirmar] = useState(false)
  const [metodo, setMetodo] = useState<'EFECTIVO' | 'TRANSFERENCIA' | 'OTRO'>('EFECTIVO')

  const [openRedimir, setOpenRedimir] = useState(false)
  const [montoConsumo, setMontoConsumo] = useState('')
  const [nota, setNota] = useState('')

  const [openCancelar, setOpenCancelar] = useState(false)
  const [motivo, setMotivo] = useState('')

  function confirmar() {
    startTransition(async () => {
      const res = await confirmarPagoGiftCard(giftCardId, metodo)
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success(res.detalle ?? 'Pago confirmado.')
      setOpenConfirmar(false)
      router.refresh()
    })
  }

  function redimir() {
    const valor = Number(montoConsumo)
    startTransition(async () => {
      const res = await redimirGiftCard(giftCardId, valor, nota)
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success(res.detalle ?? 'Consumo aplicado.')
      setOpenRedimir(false)
      setMontoConsumo('')
      setNota('')
      router.refresh()
    })
  }

  function cancelar() {
    startTransition(async () => {
      const res = await cancelarGiftCardAdmin(giftCardId, motivo)
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success(res.detalle ?? 'Gift card cancelada.')
      setOpenCancelar(false)
      setMotivo('')
      router.refresh()
    })
  }

  if (estado === 'PENDIENTE_PAGO') {
    return (
      <div className="flex items-center justify-end gap-1">
        <Dialog open={openConfirmar} onOpenChange={setOpenConfirmar}>
          <DialogTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1.5 text-success hover:text-success">
              <BadgeCheck className="h-3.5 w-3.5" /> Confirmar pago
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Confirmar pago de {codigo}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Se activa la gift card de <strong>{formatRD(monto)}</strong> y el cobro
                queda registrado como venta con su factura. Ambas partes reciben la
                notificación.
              </p>
              <div className="space-y-1.5">
                <Label htmlFor={`metodo-${giftCardId}`}>¿Cómo pagó?</Label>
                <select
                  id={`metodo-${giftCardId}`}
                  value={metodo}
                  onChange={(e) => setMetodo(e.target.value as typeof metodo)}
                  className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
                >
                  <option value="EFECTIVO">Efectivo</option>
                  <option value="TRANSFERENCIA">Transferencia</option>
                  <option value="OTRO">Otro</option>
                </select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpenConfirmar(false)} disabled={pending}>
                Volver
              </Button>
              <Button onClick={confirmar} disabled={pending} className="gap-2">
                {pending && <Loader2 className="h-4 w-4 animate-spin" />} Confirmar {formatRD(monto)}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={openCancelar} onOpenChange={setOpenCancelar}>
          <DialogTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1.5 text-destructive hover:text-destructive">
              <Ban className="h-3.5 w-3.5" /> Cancelar
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Cancelar {codigo}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Solo se cancelan gift cards <strong>sin pagar</strong>. El comprador
                recibirá la notificación con el motivo.
              </p>
              <div className="space-y-1.5">
                <Label htmlFor={`motivo-${giftCardId}`}>Motivo</Label>
                <Textarea
                  id={`motivo-${giftCardId}`}
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  rows={3}
                  maxLength={300}
                  placeholder="Ej. El cliente desistió, se creó por error…"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpenCancelar(false)} disabled={pending}>
                Volver
              </Button>
              <Button
                variant="destructive"
                onClick={cancelar}
                disabled={pending || motivo.trim().length < 3}
                className="gap-2"
              >
                {pending && <Loader2 className="h-4 w-4 animate-spin" />} Cancelar gift card
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    )
  }

  if (estado === 'ACTIVA') {
    return (
      <div className="flex items-center justify-end">
        <Dialog open={openRedimir} onOpenChange={setOpenRedimir}>
          <DialogTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1.5 text-primary hover:text-primary">
              <Wallet className="h-3.5 w-3.5" /> Redimir
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Redimir {codigo}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Saldo disponible: <strong>{formatRD(saldo)}</strong>. Ingresa el monto del
                consumo; queda el comprobante y el cliente ve su saldo restante.
              </p>
              <div className="space-y-1.5">
                <Label htmlFor={`consumo-${giftCardId}`}>Monto del consumo</Label>
                <Input
                  id={`consumo-${giftCardId}`}
                  type="number"
                  min={1}
                  max={saldo}
                  step="0.01"
                  value={montoConsumo}
                  onChange={(e) => setMontoConsumo(e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`nota-${giftCardId}`}>Detalle (opcional)</Label>
                <Textarea
                  id={`nota-${giftCardId}`}
                  value={nota}
                  onChange={(e) => setNota(e.target.value)}
                  rows={2}
                  maxLength={300}
                  placeholder="Ej. Lavado premium + aromatizante"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpenRedimir(false)} disabled={pending}>
                Volver
              </Button>
              <Button
                onClick={redimir}
                disabled={pending || !(Number(montoConsumo) > 0) || Number(montoConsumo) > saldo}
                className="gap-2"
              >
                {pending && <Loader2 className="h-4 w-4 animate-spin" />} Aplicar consumo
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    )
  }

  return null
}
