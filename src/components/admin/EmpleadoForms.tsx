'use client'

import { useActionState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  crearEmpleado,
  eliminarEmpleado,
  type AdminActionState,
} from '@/modules/admin/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/password-input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
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

const ROL_LABEL: Record<string, string> = {
  ADMINISTRADOR: 'Administrador (acceso total al panel)',
  GERENTE: 'Gerente (acceso total al panel)',
  CAJERO: 'Cajero (acceso total al panel)',
  SUPERVISOR: 'Supervisor (operación y monitoreo)',
  MARKETING: 'Marketing (difusión)',
  RECEPCION: 'Recepción (mostrador y escáner)',
  EMPLEADO: 'Staff / Empleado (escáner de check-in y operaciones de campo)',
}

export function NuevoEmpleadoForm() {
  const router = useRouter()
  const [state, action, pending] = useActionState(crearEmpleado, initial)

  useEffect(() => {
    if (state.success) {
      toast.success('Empleado creado.')
      router.push('/admin/empleados')
      router.refresh()
    }
  }, [state.success, router])

  return (
    <form action={action} className="space-y-4">
      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      <div className="space-y-2">
        <Label htmlFor="nombre">Nombre</Label>
        <Input id="nombre" name="nombre" required placeholder="Nombre completo" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="email">Correo electrónico</Label>
        <Input
          id="email"
          name="email"
          type="email"
          required
          placeholder="empleado@correo.com"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Contraseña</Label>
        <PasswordInput
          id="password"
          name="password"
          required
          minLength={6}
          placeholder="Mínimo 6 caracteres"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="rol">Rol</Label>
        <select
          id="rol"
          name="rol"
          defaultValue="EMPLEADO"
          required
          className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {Object.entries(ROL_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          Administrador, Gerente y Cajero pueden aprobar pagos y usar todos los
          módulos del panel.
        </p>
      </div>
      <Button type="submit" disabled={pending} className="w-full">
        {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Crear miembro
      </Button>
    </form>
  )
}

export function EliminarEmpleadoForm({ empleadoId }: { empleadoId: string }) {
  const router = useRouter()
  const [state, action, pending] = useActionState(eliminarEmpleado, initial)

  useEffect(() => {
    if (state.success) {
      toast.success('Empleado eliminado.')
      router.push('/admin/empleados')
      router.refresh()
    }
  }, [state.success, router])

  return (
    <form action={action}>
      <input type="hidden" name="empleadoId" value={empleadoId} />
      {state.error && (
        <Alert variant="destructive" className="mb-3">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button type="button" variant="destructive" disabled={pending}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Eliminar empleado
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar empleado?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. Se eliminará el acceso y la
              cuenta del empleado de forma permanente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction type="submit">Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  )
}
