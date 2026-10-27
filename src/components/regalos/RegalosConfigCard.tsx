'use client'

/**
 * Regalos P2P · configuración del programa desde el panel admin: activar o
 * desactivar transferencias y regalos pagados, límite mensual de envíos por
 * cliente y vigencia (horas) de los regalos pendientes. La vigencia solo
 * aplica a regalos NUEVOS: los ya enviados conservan su fecha de expiración.
 */

import { useActionState, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Settings2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { guardarRegalosConfig, type RegaloActionState } from '@/modules/regalos/actions'
import type { RegalosConfig } from '@/modules/regalos/config'

const initial: RegaloActionState = {}

export function RegalosConfigCard({ config }: { config: RegalosConfig }) {
  const [state, formAction, pending] = useActionState(guardarRegalosConfig, initial)
  const [transferencias, setTransferencias] = useState(config.permitirTransferencias)
  const [regalos, setRegalos] = useState(config.permitirRegalos)
  const [giftCards, setGiftCards] = useState(config.permitirGiftCards)

  useEffect(() => {
    if (state.error) toast.error(state.error)
    if (state.success) toast.success(state.detalle ?? 'Configuración guardada.')
  }, [state])

  return (
    <details className="rounded-2xl border border-border/70 bg-card">
      <summary className="flex cursor-pointer items-center gap-2 p-4 text-sm font-semibold text-foreground [&::-webkit-details-marker]:hidden">
        <Settings2 className="h-4 w-4 text-muted-foreground" aria-hidden />
        Configuración del programa
        <span className="ml-auto text-xs font-normal text-muted-foreground">
          {transferencias || regalos ? 'Activo' : 'Desactivado'} · máx.{' '}
          {config.maxTransferenciasMes}/mes · vigencia {config.vigenciaHoras}h
        </span>
      </summary>
      <form action={formAction} className="space-y-4 border-t border-border/60 p-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex items-center justify-between gap-3 rounded-2xl border border-border/70 p-3">
            <span>
              <span className="block text-sm font-medium text-foreground">Transferencias de usos</span>
              <span className="block text-xs text-muted-foreground">
                Los clientes pueden enviarse usos de promociones y lavados del plan.
              </span>
            </span>
            <Switch checked={transferencias} onCheckedChange={setTransferencias} />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-2xl border border-border/70 p-3">
            <span>
              <span className="block text-sm font-medium text-foreground">Regalos pagados</span>
              <span className="block text-xs text-muted-foreground">
                Un cliente paga una promoción o membresía nueva para otro.
              </span>
            </span>
            <Switch checked={regalos} onCheckedChange={setRegalos} />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-2xl border border-border/70 p-3">
            <span>
              <span className="block text-sm font-medium text-foreground">Gift cards</span>
              <span className="block text-xs text-muted-foreground">
                Monto abierto que el destinatario consume con el código. No expiran.
              </span>
            </span>
            <Switch checked={giftCards} onCheckedChange={setGiftCards} />
          </label>
        </div>
        {transferencias && <input type="hidden" name="permitirTransferencias" value="on" />}
        {regalos && <input type="hidden" name="permitirRegalos" value="on" />}
        {giftCards && <input type="hidden" name="permitirGiftCards" value="on" />}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="maxTransferenciasMes">Transferencias por cliente al mes</Label>
            <Input
              id="maxTransferenciasMes"
              name="maxTransferenciasMes"
              type="number"
              min={0}
              max={100}
              defaultValue={config.maxTransferenciasMes}
            />
            <p className="text-xs text-muted-foreground">Anti-abuso. 0 bloquea los envíos.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vigenciaHoras">Vigencia del regalo pendiente (horas)</Label>
            <Input
              id="vigenciaHoras"
              name="vigenciaHoras"
              type="number"
              min={1}
              max={720}
              defaultValue={config.vigenciaHoras}
            />
            <p className="text-xs text-muted-foreground">
              Si nadie acepta en ese tiempo, los usos vuelven al remitente. Solo
              aplica a regalos nuevos.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="giftCardMontoMin">Gift card · monto mínimo (RD$)</Label>
            <Input
              id="giftCardMontoMin"
              name="giftCardMontoMin"
              type="number"
              min={50}
              max={1000000}
              defaultValue={config.giftCardMontoMin}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="giftCardMontoMax">Gift card · monto máximo (RD$)</Label>
            <Input
              id="giftCardMontoMax"
              name="giftCardMontoMax"
              type="number"
              min={50}
              max={1000000}
              defaultValue={config.giftCardMontoMax}
            />
          </div>
        </div>

        <div className="flex justify-end">
          <Button type="submit" disabled={pending} className="gap-2">
            {pending && <Loader2 className="h-4 w-4 animate-spin" />} Guardar configuración
          </Button>
        </div>
      </form>
    </details>
  )
}
