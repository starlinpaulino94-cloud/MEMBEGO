'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { actualizarItemCatalogo } from '@/modules/catalog/actions'
import { ETIQUETA_CAPACIDAD } from '@/modules/catalog/formato'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'

interface Props {
  itemId: string
  name: string
  description: string | null
  capabilities: Record<string, boolean>
  /** false = archivado o de Supply: se muestra pero no se edita. */
  editable: boolean
}

export function ItemDetalleForm({ itemId, name, description, capabilities, editable }: Props) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [caps, setCaps] = useState(capabilities)

  function guardar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    start(async () => {
      const r = await actualizarItemCatalogo(itemId, {
        name: String(f.get('name') ?? ''),
        description: String(f.get('description') ?? ''),
        capabilities: caps,
      })
      if (!r.ok) toast.error(r.error)
      else {
        toast.success('Cambios guardados.')
        router.refresh()
      }
    })
  }

  return (
    <form onSubmit={guardar} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="name">Nombre</Label>
        <Input id="name" name="name" defaultValue={name} required maxLength={160} disabled={!editable} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="description">Descripción</Label>
        <Textarea id="description" name="description" defaultValue={description ?? ''} rows={4} maxLength={4000} disabled={!editable} />
      </div>

      <fieldset className="space-y-3" disabled={!editable}>
        <legend className="text-sm font-medium">Cómo se comporta</legend>
        {Object.keys(ETIQUETA_CAPACIDAD).map((clave) => (
          <div key={clave} className="flex items-center gap-3">
            <Switch
              id={`cap-${clave}`}
              checked={!!caps[clave]}
              onCheckedChange={(v) => setCaps((c) => ({ ...c, [clave]: v }))}
            />
            <Label htmlFor={`cap-${clave}`} className="font-normal">
              {ETIQUETA_CAPACIDAD[clave]}
            </Label>
          </div>
        ))}
      </fieldset>

      {editable && (
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Guardar cambios
        </Button>
      )}
    </form>
  )
}
