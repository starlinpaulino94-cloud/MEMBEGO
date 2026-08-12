'use client'

import { useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  confirmarPago,
  renovarMembresia,
  cancelarMembresia,
  crearMembresia,
  type AdminActionState,
} from '@/modules/admin/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

const initial: AdminActionState = {}

export function ConfirmPaymentForm({
  membershipId,
  precio,
}: {
  membershipId: string
  precio: string
}) {
  const router = useRouter()
  const [state, action, pending] = useActionState(confirmarPago, initial)

  useEffect(() => {
    if (state.success) {
      toast.success('Pago confirmado. Membresía activada.')
      router.refresh()
    }
  }, [state.success, router])

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="membershipId" value={membershipId} />
      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      <div className="space-y-2">
        <Label htmlFor="monto-c">Monto pagado (RD$)</Label>
        <Input id="monto-c" name="monto" type="number" step="0.01" defaultValue={precio} />
      </div>
      <Button
        type="submit"
        variant="success"
        disabled={pending}
        className="w-full"
      >
        {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Confirmar pago y activar
      </Button>
    </form>
  )
}

export function RenewForm({
  membershipId,
  precio,
}: {
  membershipId: string
  precio: string
}) {
  const router = useRouter()
  const [state, action, pending] = useActionState(renovarMembresia, initial)
  const [open, setOpen] = useState(false)

  // Cerrar el diálogo y refrescar cuando la action tenga éxito.
  // El setState en effect aquí es intencional: reacciona al resultado async
  // de useActionState y no causa cascadas (solo corre una vez por éxito).
  useEffect(() => {
    if (state.success) {
      toast.success('Membresía renovada por 30 días.')
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(false)
      router.refresh()
    }
  }, [state.success, router])

  // EL DIÁLOGO VIVE EN UN PORTAL, FUERA DEL <form> EN EL DOM. Un botón con
  // type="submit" ahí dentro no envía nada: el diálogo se cerraba y no pasaba
  // NADA, sin error — así se reportó («no hace nada»). El atributo form=
  // re-asocia el botón con el formulario por id, que es exactamente el caso
  // para el que existe en HTML.
  const formId = `renovar-membresia-${membershipId}`

  return (
    <form id={formId} action={action} className="space-y-3">
      <input type="hidden" name="membershipId" value={membershipId} />
      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      <div className="space-y-2">
        <Label htmlFor="monto-r">Monto pagado (RD$)</Label>
        <Input id="monto-r" name="monto" type="number" step="0.01" defaultValue={precio} />
      </div>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger asChild>
          <Button type="button" disabled={pending} className="w-full">
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Renovar 30 días
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Renovar membresía?</AlertDialogTitle>
            <AlertDialogDescription>
              Se reiniciará el periodo por 30 días y se restablecerán los usos
              incluidos en el plan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction type="submit" form={formId}>
              Confirmar renovación
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  )
}

export function CancelForm({ membershipId }: { membershipId: string }) {
  const router = useRouter()
  const [state, action, pending] = useActionState(cancelarMembresia, initial)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (state.success) {
      toast.success('Membresía cancelada.')
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(false)
      router.refresh()
    }
  }, [state.success, router])

  // Mismo bug del portal que en RenewForm: el submit del diálogo no llegaba
  // al formulario. Ver el comentario de arriba.
  const formId = `cancelar-membresia-${membershipId}`

  return (
    <form id={formId} action={action}>
      <input type="hidden" name="membershipId" value={membershipId} />
      {state.error && (
        <Alert variant="destructive" className="mb-3">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            className="w-full border-destructive/25 text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Cancelar membresía
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Cancelar membresía?</AlertDialogTitle>
            <AlertDialogDescription>
              La membresía pasará a estado Cancelada y el cliente perderá el
              acceso a sus beneficios. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <AlertDialogAction
              type="submit"
              form={formId}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Sí, cancelar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  )
}

export function NewMembershipForm({
  clienteId,
  companyId,
  planes,
}: {
  clienteId: string
  companyId: string
  planes: { id: string; nombre: string; precio: string }[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [planId, setPlanId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleCreate() {
    if (!planId) {
      setError('Selecciona un plan.')
      return
    }
    setPending(true)
    setError(null)
    const res = await crearMembresia(clienteId, planId, companyId)
    setPending(false)
    if (res.error) {
      setError(res.error)
      return
    }
    toast.success('Membresía creada (pendiente de pago).')
    setOpen(false)
    setPlanId('')
    router.refresh()
  }

  if (!open) {
    return (
      <Button type="button" onClick={() => setOpen(true)}>
        Nueva membresía
      </Button>
    )
  }

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <p className="font-medium text-foreground">Crear nueva membresía</p>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {planes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No hay planes activos disponibles.
        </p>
      ) : (
        <div className="space-y-2">
          <Label>Plan</Label>
          <Select value={planId} onValueChange={setPlanId}>
            <SelectTrigger>
              <SelectValue placeholder="Selecciona un plan" />
            </SelectTrigger>
            <SelectContent>
              {planes.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.nombre} · RD${p.precio}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="flex gap-2">
        <Button
          type="button"
          disabled={pending || planes.length === 0}
          onClick={handleCreate}
        >
          {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Crear membresía
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setOpen(false)
            setError(null)
          }}
        >
          Cancelar
        </Button>
      </div>
    </div>
  )
}
