'use client'

import { useActionState, useEffect, useState } from 'react'
import { Loader2, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { actualizarPerfil, type ProfileState } from '@/modules/cliente/profileActions'
import { AvatarUpload } from '@/components/cliente/AvatarUpload'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'

interface Props {
  clienteId: string
  nombre: string
  email: string
  telefono: string | null
  avatarUrl: string | null
  fechaNacimiento: string | null // YYYY-MM-DD
  ciudad: string | null
  genero: string | null
  notifPromos: boolean
  notifRecordatorios: boolean
}

const init: ProfileState = {}

export function ProfileForm({
  clienteId,
  nombre,
  email,
  telefono,
  avatarUrl,
  fechaNacimiento,
  ciudad,
  genero,
  notifPromos,
  notifRecordatorios,
}: Props) {
  const [state, formAction, pending] = useActionState(actualizarPerfil, init)
  const [uploadedAvatarUrl, setUploadedAvatarUrl] = useState<string | null>(null)

  useEffect(() => {
    if (state.success) toast.success('Perfil actualizado.')
    if (state.error) toast.error(state.error)
  }, [state.success, state.error])

  return (
    <form action={formAction} className="space-y-6">
      <input
        type="hidden"
        name="avatarUrl"
        value={uploadedAvatarUrl ?? avatarUrl ?? ''}
      />

      {/* Avatar */}
      <div className="flex justify-center">
        <AvatarUpload
          clienteId={clienteId}
          currentUrl={avatarUrl}
          nombre={nombre}
          onUploaded={setUploadedAvatarUrl}
        />
      </div>

      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      {state.success && (
        <div className="flex items-center gap-2 rounded-xl bg-success/10 px-4 py-3 text-sm text-success">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          Perfil actualizado.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="nombre">Nombre completo *</Label>
          <Input
            id="nombre"
            name="nombre"
            defaultValue={nombre}
            placeholder="Tu nombre"
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="telefono">Teléfono</Label>
          <Input
            id="telefono"
            name="telefono"
            defaultValue={telefono ?? ''}
            placeholder="809-555-0000"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="fechaNacimiento">Fecha de nacimiento</Label>
          <Input
            id="fechaNacimiento"
            name="fechaNacimiento"
            type="date"
            defaultValue={fechaNacimiento ?? ''}
            max={new Date().toISOString().slice(0, 10)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="ciudad">Ciudad</Label>
          <Input
            id="ciudad"
            name="ciudad"
            defaultValue={ciudad ?? ''}
            placeholder="Tu ciudad"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="genero">Género (opcional)</Label>
          <select
            id="genero"
            name="genero"
            defaultValue={genero ?? ''}
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm"
          >
            <option value="">Prefiero no decir</option>
            <option value="M">Masculino</option>
            <option value="F">Femenino</option>
            <option value="otro">Otro</option>
          </select>
        </div>
      </div>

      {/* Preferencias de notificaciones */}
      <div className="space-y-2">
        <Label>Preferencias de notificaciones</Label>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="hidden" name="notifPromos" value="off" />
          <input
            type="checkbox"
            name="notifPromos"
            value="on"
            defaultChecked={notifPromos}
            className="h-4 w-4 rounded border-border"
          />
          Recibir promociones y novedades
        </label>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="hidden" name="notifRecordatorios" value="off" />
          <input
            type="checkbox"
            name="notifRecordatorios"
            value="on"
            defaultChecked={notifRecordatorios}
            className="h-4 w-4 rounded border-border"
          />
          Recibir recordatorios (vencimiento de membresía, etc.)
        </label>
      </div>

      <div className="space-y-2">
        <Label htmlFor="perfil-email">Correo electrónico</Label>
        <Input id="perfil-email" value={email} disabled className="bg-muted/40 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">
          El correo no se puede modificar desde aquí.
        </p>
      </div>

      <Button
        type="submit"
        disabled={pending}
        className="bg-primary hover:bg-primary/90"
      >
        {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Guardar cambios
      </Button>
    </form>
  )
}
