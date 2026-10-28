'use client'

import { useActionState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  crearCampana,
  actualizarCampana,
  type CampanaState,
} from '@/modules/admin/campanaActions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Switch } from '@/components/ui/switch'
import { Campo } from '@/components/ui/campo'
import { FormActions, FormSection } from '@/components/ui/form-section'

interface ExistingCampana {
  id: string
  nombre: string
  descripcion: string | null
  fechaInicio: Date | null
  fechaFin: Date | null
  activo: boolean
}

const init: CampanaState = {}

function toDateInput(d: Date | null) {
  if (!d) return ''
  return new Date(d).toISOString().slice(0, 10)
}

export function CampanaForm({ existing }: { existing?: ExistingCampana }) {
  const router = useRouter()
  const action = existing ? actualizarCampana : crearCampana
  const [state, formAction, pending] = useActionState(action, init)

  useEffect(() => {
    if (state.success) {
      toast.success(existing ? 'Campaña actualizada.' : 'Campaña creada.')
      router.push('/admin/campanas')
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

      <FormSection title="La campaña" description="Un nombre para agrupar sus promociones y publicaciones, y para qué es.">
        <Campo id="nombre" etiqueta="Nombre de la campaña">
          {(control) => <Input name="nombre" defaultValue={existing?.nombre} placeholder="Ej: Black Friday 2026" required {...control} />}
        </Campo>
        <Campo id="descripcion" etiqueta="Descripción" opcional>
          {(control) => (
            <Textarea name="descripcion" rows={3} defaultValue={existing?.descripcion ?? ''} placeholder="Objetivo de la campaña" {...control} />
          )}
        </Campo>
      </FormSection>

      <FormSection title="Fechas" description="Cuándo empieza y cuándo termina. Sin fechas, no tiene límite.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo id="fechaInicio" etiqueta="Inicio" opcional>
            {(control) => <Input name="fechaInicio" type="date" defaultValue={toDateInput(existing?.fechaInicio ?? null)} {...control} />}
          </Campo>
          <Campo id="fechaFin" etiqueta="Fin" opcional>
            {(control) => <Input name="fechaFin" type="date" defaultValue={toDateInput(existing?.fechaFin ?? null)} {...control} />}
          </Campo>
        </div>
      </FormSection>

      {existing && (
        <FormSection title="Estado" description="Desactívala para dejar de usarla sin borrarla.">
          <div className="flex items-center gap-3">
            <Switch
              id="activo"
              name="activo"
              defaultChecked={existing.activo}
              value="true"
              onCheckedChange={(checked) => {
                const el = document.querySelector<HTMLInputElement>('input[name="activo"]')
                if (el) el.value = String(checked)
              }}
            />
            <Label htmlFor="activo">Campaña activa</Label>
          </div>
        </FormSection>
      )}

      <FormActions>
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          Cancelar
        </Button>
        <Button type="submit" loading={pending}>
          {existing ? 'Guardar cambios' : 'Crear campaña'}
        </Button>
      </FormActions>
    </form>
  )
}
