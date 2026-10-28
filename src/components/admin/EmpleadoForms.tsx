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
import { Campo } from '@/components/ui/campo'
import { FormActions, FormSection } from '@/components/ui/form-section'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
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
  BODEGA: 'Bodega (mueve existencias, sin costos ni compras)',
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
    <form action={action} className="space-y-8">
      {state.error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      <FormSection title="La persona" description="Con este correo y esta contraseña entra al panel o al escáner.">
        <Campo id="nombre" etiqueta="Nombre">
          {(control) => <Input name="nombre" required autoComplete="off" placeholder="Nombre completo" {...control} />}
        </Campo>
        <Campo id="email" etiqueta="Correo electrónico">
          {(control) => <Input name="email" type="email" required autoComplete="off" placeholder="empleado@correo.com" {...control} />}
        </Campo>
        <Campo id="password" etiqueta="Contraseña" ayuda="Mínimo 6 caracteres. Compártela con la persona por un canal privado.">
          {(control) => <PasswordInput name="password" required minLength={6} autoComplete="new-password" {...control} />}
        </Campo>
      </FormSection>

      <FormSection title="Qué puede hacer" description="El rol decide qué partes del panel ve. Puedes cambiarlo después.">
        <Campo id="rol" etiqueta="Rol" ayuda="Administrador, Gerente y Cajero pueden aprobar pagos y usar todos los módulos del panel.">
          {(control) => (
            <Select name="rol" defaultValue="EMPLEADO" required>
              <SelectTrigger className="w-full" {...control}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(ROL_LABEL).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </Campo>
      </FormSection>

      <FormActions>
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          Cancelar
        </Button>
        <Button type="submit" loading={pending}>
          Crear miembro
        </Button>
      </FormActions>
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
