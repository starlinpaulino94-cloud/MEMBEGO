'use client'

import { useActionState, useEffect, useRef } from 'react'
import { useFormStatus } from 'react-dom'
import { Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'
import { actualizarEmpresa, type ActionState } from '@/modules/empresas/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { LogoUpload } from './LogoUpload'
import {
  CategoryMultiSelect,
  type CategoryOption,
} from './CategoryMultiSelect'
import { NuevaCategoriaForm } from './NuevaCategoriaForm'

interface CompanyData {
  id: string
  name: string
  type: string
  /** Vertical real (Fase 7). Manda sobre `type`, que es el valor legacy. */
  tipoNegocioCodigo?: string | null
  description: string | null
  logoUrl: string | null
  email: string | null
  telefono: string | null
  direccion: string | null
  ciudad: string | null
  categoria: string | null
  website: string | null
}

const init: ActionState = {}

function SubmitBtn() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
      Guardar cambios
    </Button>
  )
}

export function EmpresaEditForm({
  company,
  categories,
  selectedCategoryIds,
  verticales,
}: {
  company: CompanyData
  categories: CategoryOption[]
  selectedCategoryIds: string[]
  /** Verticales de `tipos_negocio` (ver `modules/empresas/verticales.ts`). */
  verticales: { codigo: string; nombre: string }[]
}) {
  const [state, action] = useActionState(actualizarEmpresa, init)
  const logoUrlRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (state.success) toast.success(state.message ?? 'Guardado.')
    if (state.error) toast.error(state.error)
  }, [state.success, state.error, state.message])

  function handleLogoUploaded(url: string) {
    if (logoUrlRef.current) {
      logoUrlRef.current.value = url
    }
  }

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="id" value={company.id} />

      <div className="grid gap-6 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="name">Nombre de la empresa *</Label>
          <Input id="name" name="name" defaultValue={company.name} required />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="type">Tipo</Label>
          {/* El vertical actual de la empresa puede no estar entre los activos
              —se desactivó después de asignarlo—. Se añade igualmente para que
              el selector no aparezca vacío ni cambie el tipo por abrir la
              pantalla de edición. */}
          <Select name="type" defaultValue={company.tipoNegocioCodigo ?? company.type}>
            <SelectTrigger id="type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {verticales.map((v) => (
                <SelectItem key={v.codigo} value={v.codigo}>
                  {v.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="categoria">Categoría</Label>
          <Input id="categoria" name="categoria" defaultValue={company.categoria ?? ''} placeholder="Ej: Premium, Franquicia…" />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="email">Correo electrónico</Label>
          <Input id="email" name="email" type="email" defaultValue={company.email ?? ''} placeholder="contacto@empresa.com" />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="telefono">Teléfono</Label>
          <Input id="telefono" name="telefono" defaultValue={company.telefono ?? ''} placeholder="+1 809 000 0000" />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ciudad">Ciudad</Label>
          <Input id="ciudad" name="ciudad" defaultValue={company.ciudad ?? ''} placeholder="Santo Domingo" />
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="direccion">Dirección</Label>
          <Input id="direccion" name="direccion" defaultValue={company.direccion ?? ''} placeholder="Calle, número, sector…" />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="website">Sitio web</Label>
          <Input id="website" name="website" type="url" defaultValue={company.website ?? ''} placeholder="https://…" />
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label>Logo de la empresa</Label>
          <LogoUpload
            companyId={company.id}
            currentUrl={company.logoUrl}
            companyName={company.name}
            onUploaded={handleLogoUploaded}
          />
          <input ref={logoUrlRef} type="hidden" name="logoUrl" defaultValue={company.logoUrl ?? ''} />
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="description">Descripción</Label>
          <Textarea id="description" name="description" rows={3} defaultValue={company.description ?? ''} placeholder="Breve descripción de la empresa…" />
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label>Categorías del marketplace</Label>
          <p className="text-xs text-muted-foreground">
            Determinan en qué filtros del directorio público aparece la empresa.
          </p>
          <CategoryMultiSelect
            categories={categories}
            defaultSelected={selectedCategoryIds}
          />
          {/* Marca única: si el rubro de la empresa nueva aún no existe como
              categoría, se crea aquí mismo (aparece al guardar/recargar). */}
          <NuevaCategoriaForm />
        </div>
      </div>

      <SubmitBtn />
    </form>
  )
}
