'use client'

import { useActionState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useFormStatus } from 'react-dom'
import { Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { crearEmpresa, type ActionState } from '@/modules/empresas/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/password-input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  CategoryMultiSelect,
  type CategoryOption,
} from './CategoryMultiSelect'

const init: ActionState = {}

function SubmitBtn() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <Plus className="mr-2 h-4 w-4" />
      )}
      Crear empresa
    </Button>
  )
}

/**
 * `demo` no es una casilla dentro del formulario, es una PANTALLA distinta que
 * usa el mismo formulario. Marcar una empresa como de práctica cambia cómo se
 * comporta hacia afuera (no cobra con tarjeta, no manda correos, no sale en la
 * vitrina); eso no puede depender de una casilla que se marca o se desmarca
 * sin querer entre veinte campos. Se entra por /superadmin/demo/nueva o no se
 * entra.
 */
export function EmpresaCreateForm({
  categories,
  demo = false,
}: {
  categories: CategoryOption[]
  demo?: boolean
}) {
  const router = useRouter()
  const [state, action] = useActionState(crearEmpresa, init)

  useEffect(() => {
    if (state.success) {
      toast.success(state.message ?? 'Empresa creada.')
      router.push(demo ? '/superadmin/demo' : '/superadmin/empresas')
    }
    if (state.error) toast.error(state.error)
  }, [state.success, state.error, state.message, router, demo])

  return (
    <form action={action} className="space-y-8">
      {demo && <input type="hidden" name="esDemo" value="1" />}

      {/* Datos de la empresa */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-foreground">Datos de la empresa</h3>
        <div className="grid gap-6 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="name">Nombre de la empresa *</Label>
            <Input id="name" name="name" required placeholder="Ej: CarTown Wash" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="type">Tipo</Label>
            <Select name="type" defaultValue="carwash">
              <SelectTrigger id="type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="carwash">Car Wash</SelectItem>
                <SelectItem value="restaurante">Restaurante</SelectItem>
                <SelectItem value="gimnasio">Gimnasio</SelectItem>
                <SelectItem value="salon">Salón de Belleza</SelectItem>
                <SelectItem value="otro">Otro</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="categoria">Categoría</Label>
            <Input id="categoria" name="categoria" placeholder="Ej: Premium, Franquicia…" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="email">Correo de la empresa</Label>
            <Input id="email" name="email" type="email" placeholder="contacto@empresa.com" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="telefono">Teléfono</Label>
            <Input id="telefono" name="telefono" placeholder="+1 809 000 0000" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ciudad">Ciudad</Label>
            <Input id="ciudad" name="ciudad" placeholder="Santo Domingo" />
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="direccion">Dirección</Label>
            <Input id="direccion" name="direccion" placeholder="Calle, número, sector…" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="website">Sitio web</Label>
            <Input id="website" name="website" type="url" placeholder="https://…" />
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="description">Descripción</Label>
            <Textarea id="description" name="description" rows={3} placeholder="Breve descripción de la empresa…" />
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label>Categorías del marketplace</Label>
            <p className="text-xs text-muted-foreground">
              Determinan en qué filtros del directorio público aparece la empresa.
            </p>
            <CategoryMultiSelect categories={categories} />
          </div>
        </div>
      </div>

      {/* Administrador de la empresa */}
      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Administrador de la empresa</h3>
          <p className="text-xs text-muted-foreground">
            {demo
              ? 'Es la cuenta con la que el personal va a practicar. Puede compartirse entre varias personas del entrenamiento: dentro no hay nada real que romper.'
              : 'Se creará una cuenta con acceso al panel de la empresa. Comparte estas credenciales con el responsable del negocio.'}
          </p>
        </div>
        <div className="grid gap-6 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="adminNombre">Nombre del administrador *</Label>
            <Input id="adminNombre" name="adminNombre" required placeholder="Nombre y apellido" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="adminEmail">Correo de acceso *</Label>
            <Input id="adminEmail" name="adminEmail" type="email" required placeholder="admin@empresa.com" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="adminPassword">Contraseña *</Label>
            <PasswordInput id="adminPassword" name="adminPassword" required minLength={6} placeholder="Mínimo 6 caracteres" />
          </div>
        </div>
      </div>

      <SubmitBtn />
    </form>
  )
}
