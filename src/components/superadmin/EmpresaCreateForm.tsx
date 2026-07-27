'use client'

import { useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useFormStatus } from 'react-dom'
import { Loader2, Plus, UserPlus, Users } from 'lucide-react'
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
import type { AdminVinculable } from '@/modules/empresas/accesos'

const init: ActionState = {}

/** Botón de las dos formas de poner administrador. */
function ModoBtn({
  activo,
  onClick,
  disabled,
  icon,
  titulo,
  detalle,
}: {
  activo: boolean
  onClick: () => void
  disabled?: boolean
  icon: React.ReactNode
  titulo: string
  detalle: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={activo}
      className={`flex min-w-[210px] flex-1 items-start gap-2.5 rounded-xl border p-3 text-left transition disabled:opacity-50 ${
        activo ? 'border-primary bg-primary/5' : 'border-border/70 hover:border-primary/40'
      }`}
    >
      <span className={activo ? 'text-primary' : 'text-muted-foreground'}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">{titulo}</span>
        <span className="block text-xs text-muted-foreground">{detalle}</span>
      </span>
    </button>
  )
}

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
  admins = [],
  demo = false,
}: {
  categories: CategoryOption[]
  /** Administradores existentes a los que se les puede dar esta empresa. */
  admins?: AdminVinculable[]
  demo?: boolean
}) {
  const router = useRouter()
  const [state, action] = useActionState(crearEmpresa, init)
  // En una empresa de práctica lo normal es que la administre alguien que ya
  // tiene cuenta: se entra al modo de prueba y se sale, sin una segunda
  // contraseña que aprender. Por eso ahí arranca en "existente".
  const [modo, setModo] = useState<'nuevo' | 'existente'>(
    demo && admins.length > 0 ? 'existente' : 'nuevo'
  )

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
          <h3 className="text-sm font-semibold text-foreground">Quién la administra</h3>
          <p className="text-xs text-muted-foreground">
            Se puede crear una cuenta nueva o darle esta empresa a un administrador que ya usa la
            plataforma.
          </p>
        </div>

        {/* El modo va en el formulario: el servidor decide por este campo, no
            por qué inputs vinieron llenos. */}
        <input type="hidden" name="adminModo" value={modo} />

        <div className="flex flex-wrap gap-2">
          <ModoBtn
            activo={modo === 'existente'}
            onClick={() => setModo('existente')}
            disabled={admins.length === 0}
            icon={<Users className="h-4 w-4" />}
            titulo="Cuenta existente"
            detalle={
              admins.length === 0
                ? 'Todavía no hay administradores'
                : 'Entra desde su panel, sin otra contraseña'
            }
          />
          <ModoBtn
            activo={modo === 'nuevo'}
            onClick={() => setModo('nuevo')}
            icon={<UserPlus className="h-4 w-4" />}
            titulo="Cuenta nueva"
            detalle="Correo y contraseña propios"
          />
        </div>

        {modo === 'existente' ? (
          <div className="space-y-1.5">
            <Label htmlFor="adminExistenteId">Administrador *</Label>
            <select
              id="adminExistenteId"
              name="adminExistenteId"
              required
              defaultValue=""
              className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="" disabled>
                Elige a quién le toca…
              </option>
              {admins.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {a.email}
                  {a.empresa ? ` (${a.empresa})` : ''}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              {demo
                ? 'No se le cambia su empresa: sigue en su negocio y entra a la de práctica cuando quiera, con el selector de empresas de arriba del panel. Ahí entra al modo de prueba y ahí sale.'
                : 'No se le cambia su empresa activa. Esta se le suma al selector de empresas de arriba del panel y cambia cuando quiera.'}
            </p>
          </div>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              {demo
                ? 'Se creará una cuenta aparte solo para practicar. Puede compartirse entre varias personas del entrenamiento: dentro no hay nada real que romper.'
                : 'Se creará una cuenta con acceso al panel de la empresa. Comparte estas credenciales con el responsable del negocio.'}
            </p>
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
          </>
        )}
      </div>

      <SubmitBtn />
    </form>
  )
}
