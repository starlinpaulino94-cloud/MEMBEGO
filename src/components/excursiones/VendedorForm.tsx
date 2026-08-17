'use client'

/** Edición de los datos del vendedor (el alta tiene su wizard propio). */

import { useActionState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  actualizarVendedor,
  type VendedorActionState,
} from '@/modules/excursiones/vendedores/actions'
import { TIPOS_VENDEDOR_SEMILLA } from '@/modules/excursiones/vendedores/nucleo'
import type { SupervisorOpcion } from '@/components/excursiones/VendedorWizard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'

const init: VendedorActionState = {}

export function VendedorForm({
  vendedor,
  supervisores,
}: {
  vendedor: {
    id: string
    nombre: string
    apellido: string | null
    telefono: string | null
    whatsapp: string | null
    email: string | null
    documento: string | null
    direccion: string | null
    tipo: string | null
    supervisorId: string | null
  }
  supervisores: SupervisorOpcion[]
}) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState(actualizarVendedor, init)
  useEffect(() => {
    if (state.success) {
      toast.success(state.success)
      router.refresh()
    }
  }, [state, router])

  const tipos = TIPOS_VENDEDOR_SEMILLA.includes(vendedor.tipo as (typeof TIPOS_VENDEDOR_SEMILLA)[number]) || !vendedor.tipo
    ? TIPOS_VENDEDOR_SEMILLA
    : [...TIPOS_VENDEDOR_SEMILLA, vendedor.tipo]

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="vendedorId" value={vendedor.id} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="vf-nombre">Nombre *</Label>
          <Input id="vf-nombre" name="nombre" defaultValue={vendedor.nombre} required />
        </div>
        <div>
          <Label htmlFor="vf-apellido">Apellido</Label>
          <Input id="vf-apellido" name="apellido" defaultValue={vendedor.apellido ?? ''} />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="vf-telefono">Teléfono *</Label>
          <Input id="vf-telefono" name="telefono" type="tel" defaultValue={vendedor.telefono ?? ''} required />
        </div>
        <div>
          <Label htmlFor="vf-whatsapp">WhatsApp</Label>
          <Input id="vf-whatsapp" name="whatsapp" type="tel" defaultValue={vendedor.whatsapp ?? ''} />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="vf-email">Correo</Label>
          <Input id="vf-email" name="email" type="email" defaultValue={vendedor.email ?? ''} />
        </div>
        <div>
          <Label htmlFor="vf-documento">Documento</Label>
          <Input id="vf-documento" name="documento" defaultValue={vendedor.documento ?? ''} />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="vf-tipo">Tipo</Label>
          <select
            id="vf-tipo"
            name="tipo"
            defaultValue={vendedor.tipo ?? 'Empleado'}
            className="mt-1.5 block w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground"
          >
            {tipos.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="vf-supervisor">Supervisor</Label>
          <select
            id="vf-supervisor"
            name="supervisorId"
            defaultValue={vendedor.supervisorId ?? ''}
            className="mt-1.5 block w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground"
          >
            <option value="">Sin supervisor</option>
            {supervisores
              .filter((s) => s.id !== vendedor.id)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre} {s.apellido ?? ''} ({s.codigo})
                </option>
              ))}
          </select>
        </div>
      </div>
      <div>
        <Label htmlFor="vf-direccion">Dirección</Label>
        <Input id="vf-direccion" name="direccion" defaultValue={vendedor.direccion ?? ''} />
      </div>

      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      <Button type="submit" disabled={pending} className="gap-2">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Guardar cambios
      </Button>
    </form>
  )
}
