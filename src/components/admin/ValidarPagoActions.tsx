'use client'

import { useActionState, useEffect, useState } from 'react'
import { Loader2, Check, X, RefreshCw, StickyNote } from 'lucide-react'
import { toast } from 'sonner'
import {
  confirmarPago,
  rechazarPago,
  solicitarNuevaEvidencia,
  guardarNotaInterna,
  type AdminActionState,
} from '@/modules/admin/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { BotonConfirmado } from '@/components/ui/boton-confirmado'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

const init: AdminActionState = {}

export function ConfirmarPagoButton({ membershipId }: { membershipId: string }) {
  return (
    <BotonConfirmado
      accion={confirmarPago}
      estadoInicial={init}
      campos={{ membershipId }}
      size="sm"
      variant="success"
      mensajeExito="Pago confirmado. Membresía activada."
      confirmacion={{
        titulo: '¿Aprobar este pago?',
        descripcion: 'Se activará la membresía del cliente.',
        textoConfirmar: 'Aprobar',
      }}
    >
      <Check className="h-4 w-4" aria-hidden />
      Aprobar
    </BotonConfirmado>
  )
}

export function RechazarPagoButton({ membershipId }: { membershipId: string }) {
  const [manualOpen, setManualOpen] = useState(false)
  const [state, formAction, pending] = useActionState(rechazarPago, init)
  // El diálogo se cierra solo al tener éxito (estado derivado), evitando
  // setState dentro del efecto.
  const open = manualOpen && !state.success

  useEffect(() => {
    if (state.success) toast.success('Pago rechazado. El cliente fue notificado.')
    if (state.error) toast.error(state.error)
  }, [state.success, state.error])

  return (
    <Dialog open={open} onOpenChange={setManualOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive">
          <X className="h-4 w-4" />
          Rechazar
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rechazar pago</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="membershipId" value={membershipId} />
          <div className="space-y-2">
            <Label htmlFor="motivo">Motivo del rechazo *</Label>
            <Input
              id="motivo"
              name="motivo"
              placeholder="Ej: El monto no coincide con el plan seleccionado."
              required
            />
          </div>
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={() => setManualOpen(false)}>
              Cancelar
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={pending}
            >
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Rechazar
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function SolicitarEvidenciaButton({ membershipId }: { membershipId: string }) {
  const [manualOpen, setManualOpen] = useState(false)
  const [state, formAction, pending] = useActionState(solicitarNuevaEvidencia, init)
  // Cierre derivado al tener éxito (evita setState dentro del efecto).
  const open = manualOpen && !state.success

  useEffect(() => {
    if (state.success) toast.success('Se solicitó nueva evidencia al cliente.')
    if (state.error) toast.error(state.error)
  }, [state.success, state.error])

  return (
    <Dialog open={open} onOpenChange={setManualOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="border-warning/30 text-warning hover:bg-warning/15 hover:text-warning">
          <RefreshCw className="h-4 w-4" />
          Nueva evidencia
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Solicitar nueva evidencia</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="membershipId" value={membershipId} />
          <div className="space-y-2">
            <Label htmlFor="motivo-ev">Motivo *</Label>
            <Input
              id="motivo-ev"
              name="motivo"
              placeholder="Ej: La imagen está borrosa, necesitamos una más clara."
              required
            />
          </div>
          <p className="text-xs text-muted-foreground">
            El cliente recibirá una notificación y deberá subir un nuevo comprobante.
          </p>
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={() => setManualOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Solicitar
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function NotaInternaForm({
  membershipId,
  notaActual,
}: {
  membershipId: string
  notaActual: string | null
}) {
  const [state, formAction, pending] = useActionState(guardarNotaInterna, init)

  useEffect(() => {
    if (state.success) toast.success('Nota interna guardada.')
    if (state.error) toast.error(state.error)
  }, [state.success, state.error])

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="membershipId" value={membershipId} />
      <div className="flex items-center gap-2">
        <StickyNote className="h-4 w-4 text-muted-foreground/70" />
        <span className="text-sm font-medium text-muted-foreground">Nota interna</span>
        <span className="text-xs text-muted-foreground/70">(no visible al cliente)</span>
      </div>
      <Textarea
        name="nota"
        defaultValue={notaActual ?? ''}
        placeholder="Observaciones internas del equipo..."
        rows={2}
        className="text-sm"
      />
      <div className="flex justify-end">
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          {pending && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
          Guardar nota
        </Button>
      </div>
    </form>
  )
}
