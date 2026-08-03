'use client'

import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { crearPlan } from '@/modules/admin/planActions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface Company {
  id: string
  name: string
}

/**
 * Valores iniciales copiados de una plantilla (Fase E3). Editables antes de
 * guardar; la plantilla original nunca cambia.
 */
export interface PlanPrefillValues {
  nombre: string
  descripcion: string
  precio: number
  vigenciaDias: number
  lavados: number
  esIlimitado: boolean
  beneficios: string
  condiciones: string
}

/**
 * Form de creación de plan. Con `companies` (superadmin) muestra el selector
 * de empresa; sin él (panel de empresa) la action usa la empresa de la sesión.
 */
export function NuevoPlanForm({
  companies,
  prefill,
  redirectTo = '/superadmin/planes',
}: {
  companies?: Company[]
  prefill?: PlanPrefillValues
  redirectTo?: string
}) {
  const [state, action, pending] = useActionState(crearPlan, {})
  const router = useRouter()

  useEffect(() => {
    if (state.success) router.push(redirectTo)
  }, [state.success, router, redirectTo])

  return (
    <form action={action} className="space-y-5 rounded-xl border bg-card p-6 shadow-sm">
      {state.error && (
        <p className="rounded-lg bg-destructive/10 px-4 py-2 text-sm text-destructive">{state.error}</p>
      )}

      {companies && (
        <div className="space-y-1.5">
          <Label htmlFor="companyId">Empresa</Label>
          <select
            id="companyId"
            name="companyId"
            required
            className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">Seleccionar empresa…</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="nombre">Nombre del plan</Label>
        <Input id="nombre" name="nombre" required defaultValue={prefill?.nombre} placeholder="Ej: Silver, Gold, Premium, VIP" />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="precio">Precio (RD$)</Label>
          <Input id="precio" name="precio" type="number" min="0" step="0.01" required defaultValue={prefill?.precio} placeholder="0.00" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="vigenciaDias">Vigencia (días)</Label>
          <Input id="vigenciaDias" name="vigenciaDias" type="number" min="1" defaultValue={prefill?.vigenciaDias ?? 30} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="lavados">Usos incluidos</Label>
          <Input id="lavados" name="lavados" type="number" min="0" defaultValue={prefill?.lavados || undefined} placeholder="0" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="orden">Orden</Label>
          <Input id="orden" name="orden" type="number" defaultValue={0} />
          <p className="text-xs text-muted-foreground">Menor número = primero.</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input type="checkbox" id="esIlimitado" name="esIlimitado" defaultChecked={prefill?.esIlimitado} className="h-4 w-4 rounded border-border" />
        <Label htmlFor="esIlimitado">Usos ilimitados</Label>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="color">Color del plan</Label>
          <Input id="color" name="color" type="color" defaultValue="#0ea5e9" className="h-10 w-full p-1" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="descripcion">Descripción (opcional)</Label>
          <Input id="descripcion" name="descripcion" defaultValue={prefill?.descripcion} placeholder="Descripción breve del plan" />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="beneficios">Beneficios (uno por línea)</Label>
        <textarea
          id="beneficios"
          name="beneficios"
          rows={4}
          defaultValue={prefill?.beneficios}
          className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          placeholder={"Ej: Servicio completo incluido\nAtención preferencial\nDescuento en servicios extra"}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="condiciones">Restricciones / condiciones (opcional)</Label>
        <textarea
          id="condiciones"
          name="condiciones"
          rows={2}
          defaultValue={prefill?.condiciones}
          className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          placeholder="Ej: No aplica con otras promociones. Válido solo en sucursal principal."
        />
      </div>

      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Creando…' : 'Crear plan'}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancelar
        </Button>
      </div>
    </form>
  )
}
