'use client'

import { useActionState, useEffect, useState } from 'react'
import { Loader2, Check, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  aprobarCambioPlan,
  rechazarCambioPlan,
  type AdminActionState,
} from '@/modules/admin/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

const init: AdminActionState = {}

export function AprobarCambioButton({ membershipId }: { membershipId: string }) {
  const [state, formAction, pending] = useActionState(aprobarCambioPlan, init)

  useEffect(() => {
    if (state.success) toast.success('Cambio de plan aplicado.')
    if (state.error) toast.error(state.error)
  }, [state.success, state.error])

  return (
    <form action={formAction}>
      <input type="hidden" name="membershipId" value={membershipId} />
      <Button type="submit" size="sm" variant="success" disabled={pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        Aprobar cambio
      </Button>
    </form>
  )
}

export function RechazarCambioButton({ membershipId }: { membershipId: string }) {
  const [manualOpen, setManualOpen] = useState(false)
  const [state, formAction, pending] = useActionState(rechazarCambioPlan, init)
  const open = manualOpen && !state.success

  useEffect(() => {
    if (state.success) toast.error('Cambio de plan rechazado.')
    if (state.error) toast.error(state.error)
  }, [state.success, state.error])

  return (
    <Dialog open={open} onOpenChange={setManualOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="border-destructive/30 text-destructive hover:bg-danger-soft">
          <X className="h-4 w-4" />
          Rechazar
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rechazar cambio de plan</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="membershipId" value={membershipId} />
          <div className="space-y-2">
            <Label htmlFor="motivo-cambio">Motivo (opcional)</Label>
            <Input
              id="motivo-cambio"
              name="motivo"
              placeholder="Ej: El comprobante no coincide con el monto del nuevo plan."
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setManualOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Rechazar cambio
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
