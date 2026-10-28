'use client'

import { useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  crearPost,
  actualizarPost,
  type PostState,
} from '@/modules/admin/postActions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Switch } from '@/components/ui/switch'
import { Campo } from '@/components/ui/campo'
import { FormActions, FormSection } from '@/components/ui/form-section'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface ExistingPost {
  id: string
  tipo: string
  titulo: string
  contenido: string
  imagenUrl: string | null
  fechaEvento: Date | null
  lugar: string | null
  campanaId: string | null
  activo: boolean
}

interface CampanaOption {
  id: string
  nombre: string
}

const init: PostState = {}

function toDatetimeLocal(d: Date | null) {
  if (!d) return ''
  const date = new Date(d)
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
  return date.toISOString().slice(0, 16)
}

export function PostForm({
  existing,
  campanas = [],
}: {
  existing?: ExistingPost
  campanas?: CampanaOption[]
}) {
  const router = useRouter()
  const action = existing ? actualizarPost : crearPost
  const [state, formAction, pending] = useActionState(action, init)
  const [tipo, setTipo] = useState(existing?.tipo ?? 'NOTICIA')

  useEffect(() => {
    if (state.success) {
      toast.success(existing ? 'Publicación actualizada.' : 'Publicación creada. Tus seguidores fueron notificados.')
      router.push('/admin/publicaciones')
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

      <FormSection title="La publicación" description="Qué publicas y lo que leen tus seguidores en tu perfil.">
        <Campo id="tipo" etiqueta="Tipo" className="sm:max-w-xs">
          {(control) => (
            <Select name="tipo" value={tipo} onValueChange={setTipo}>
              <SelectTrigger className="w-full" {...control}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NOTICIA">Noticia / novedad</SelectItem>
                <SelectItem value="EVENTO">Evento</SelectItem>
                <SelectItem value="BENEFICIO">Beneficio para miembros</SelectItem>
              </SelectContent>
            </Select>
          )}
        </Campo>
        <Campo id="titulo" etiqueta="Título">
          {(control) => (
            <Input
              name="titulo"
              defaultValue={existing?.titulo}
              placeholder={
                tipo === 'EVENTO'
                  ? 'Ej: Feria de aniversario'
                  : tipo === 'BENEFICIO'
                    ? 'Ej: Café gratis para miembros'
                    : 'Ej: Nuevo horario extendido'
              }
              required
              {...control}
            />
          )}
        </Campo>
        <Campo id="contenido" etiqueta="Contenido">
          {(control) => <Textarea name="contenido" defaultValue={existing?.contenido} rows={4} placeholder="Detalles para tus seguidores" required {...control} />}
        </Campo>
      </FormSection>

      {tipo === 'EVENTO' && (
        <FormSection title="El evento" description="Cuándo y dónde ocurre.">
          <Campo id="fechaEvento" etiqueta="Fecha y hora del evento">
            {(control) => (
              <Input name="fechaEvento" type="datetime-local" defaultValue={toDatetimeLocal(existing?.fechaEvento ?? null)} required {...control} />
            )}
          </Campo>
          <Campo id="lugar" etiqueta="Lugar" opcional>
            {(control) => <Input name="lugar" defaultValue={existing?.lugar ?? ''} placeholder="Ej: Sucursal principal" {...control} />}
          </Campo>
        </FormSection>
      )}

      <FormSection title="Imagen y campaña" description="Una imagen para acompañarla y, si la tienes, la campaña a la que pertenece.">
        <Campo id="imagenUrl" etiqueta="Imagen (URL)" opcional>
          {(control) => <Input name="imagenUrl" defaultValue={existing?.imagenUrl ?? ''} placeholder="https://..." {...control} />}
        </Campo>
        {campanas.length > 0 && (
          <Campo id="campanaId" etiqueta="Campaña" opcional>
            {(control) => (
              <Select name="campanaId" defaultValue={existing?.campanaId ?? 'none'}>
                <SelectTrigger className="w-full" {...control}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin campaña</SelectItem>
                  {campanas.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Campo>
        )}
      </FormSection>

      {existing && (
        <FormSection title="Estado" description="Una publicación oculta deja de verse en tu perfil sin borrarse.">
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
            <Label htmlFor="activo">Visible en el perfil público</Label>
          </div>
        </FormSection>
      )}

      <FormActions>
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          Cancelar
        </Button>
        <Button type="submit" loading={pending}>
          {existing ? 'Guardar cambios' : 'Publicar'}
        </Button>
      </FormActions>
    </form>
  )
}
