'use client'

import { useActionState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  crearSucursal,
  actualizarSucursal,
  type SucursalState,
} from '@/modules/admin/sucursalActions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Switch } from '@/components/ui/switch'
import { Campo } from '@/components/ui/campo'
import { FormActions, FormSection } from '@/components/ui/form-section'

interface Existing {
  id: string
  nombre: string
  direccion: string | null
  telefono: string | null
  activa: boolean
}

const init: SucursalState = {}

export function SucursalForm({ existing }: { existing?: Existing }) {
  const router = useRouter()
  const action = existing ? actualizarSucursal : crearSucursal
  const [state, formAction, pending] = useActionState(action, init)

  useEffect(() => {
    if (state.success) {
      toast.success(existing ? 'Sucursal actualizada.' : 'Sucursal creada.')
      router.push('/admin/sucursales')
      router.refresh()
    }
  }, [state.success, existing, router])

  return (
    <form action={formAction} className="space-y-8">
      {existing && <input type="hidden" name="id" value={existing.id} />}

      {state.error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      <FormSection title="La sucursal" description="El nombre con que la reconoce tu equipo.">
        <Campo id="nombre" etiqueta="Nombre">
          {(control) => <Input name="nombre" defaultValue={existing?.nombre} placeholder="Ej: Sucursal Norte" required {...control} />}
        </Campo>
      </FormSection>

      <FormSection title="Contacto" description="Dónde está y cómo contactarla.">
        <Campo id="direccion" etiqueta="Dirección" opcional>
          {(control) => (
            <Input
              name="direccion"
              defaultValue={existing?.direccion ?? ''}
              placeholder="Ej: Av. Winston Churchill #45, Santo Domingo"
              {...control}
            />
          )}
        </Campo>
        <Campo id="telefono" etiqueta="Teléfono" opcional className="sm:max-w-xs">
          {(control) => (
            <Input name="telefono" type="tel" defaultValue={existing?.telefono ?? ''} placeholder="Ej: 809-555-1234" {...control} />
          )}
        </Campo>
      </FormSection>

      {existing && (
        <FormSection title="Estado" description="Solo las sucursales activas aparecen en el escáner del empleado.">
          <div className="flex items-center gap-3">
            <Switch
              id="activa"
              name="activa"
              defaultChecked={existing.activa}
              onCheckedChange={(checked) => {
                const el = document.querySelector<HTMLInputElement>('input[name="activa"]')
                if (el) el.value = String(checked)
              }}
            />
            <Label htmlFor="activa">Sucursal activa</Label>
            <input type="hidden" name="activa" defaultValue={String(existing.activa)} />
          </div>
        </FormSection>
      )}

      <FormActions>
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          Cancelar
        </Button>
        <Button type="submit" loading={pending}>
          {existing ? 'Guardar cambios' : 'Crear sucursal'}
        </Button>
      </FormActions>
    </form>
  )
}
