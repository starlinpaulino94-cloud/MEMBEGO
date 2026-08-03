'use client'

import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { actualizarPlan } from '@/modules/admin/planActions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface Plan {
  id: string
  nombre: string
  precio: unknown
  lavadosIncluidos: number
  esIlimitado: boolean
  descripcion: string | null
  beneficios: string[]
  activo: boolean
  vigenciaDias: number
  condiciones: string | null
  color: string | null
  orden: number
}

export function EditarPlanForm({
  plan,
  redirectTo = '/superadmin/planes',
}: {
  plan: Plan
  redirectTo?: string
}) {
  const [state, action, pending] = useActionState(actualizarPlan, {})
  const router = useRouter()

  useEffect(() => {
    if (state.success) router.push(redirectTo)
  }, [state.success, router, redirectTo])

  return (
    <form action={action} className="space-y-5 rounded-xl border bg-card p-6 shadow-sm">
      <input type="hidden" name="planId" value={plan.id} />

      {state.error && (
        <p className="rounded-lg bg-destructive/10 px-4 py-2 text-sm text-destructive">{state.error}</p>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="nombre">Nombre del plan</Label>
        <Input id="nombre" name="nombre" required defaultValue={plan.nombre} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="precio">Precio (RD$)</Label>
          <Input id="precio" name="precio" type="number" min="0" step="0.01" required defaultValue={String(plan.precio)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="vigenciaDias">Vigencia (días)</Label>
          <Input id="vigenciaDias" name="vigenciaDias" type="number" min="1" defaultValue={plan.vigenciaDias} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="lavados">Usos incluidos</Label>
          <Input id="lavados" name="lavados" type="number" min="0" defaultValue={plan.lavadosIncluidos} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="orden">Orden</Label>
          <Input id="orden" name="orden" type="number" defaultValue={plan.orden} />
          <p className="text-xs text-muted-foreground">Menor número = primero.</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input type="checkbox" id="esIlimitado" name="esIlimitado" defaultChecked={plan.esIlimitado} className="h-4 w-4 rounded border-border" />
        <Label htmlFor="esIlimitado">Usos ilimitados</Label>
      </div>

      <div className="flex items-center gap-2">
        <input type="checkbox" id="activo" name="activo" defaultChecked={plan.activo} className="h-4 w-4 rounded border-border" />
        <Label htmlFor="activo">Plan activo (visible para clientes)</Label>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="color">Color del plan</Label>
          <Input id="color" name="color" type="color" defaultValue={plan.color ?? '#0ea5e9'} className="h-10 w-full p-1" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="descripcion">Descripción (opcional)</Label>
          <Input id="descripcion" name="descripcion" defaultValue={plan.descripcion ?? ''} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="beneficios">Beneficios (uno por línea)</Label>
        <textarea
          id="beneficios"
          name="beneficios"
          rows={4}
          defaultValue={plan.beneficios.join('\n')}
          className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="condiciones">Restricciones / condiciones (opcional)</Label>
        <textarea
          id="condiciones"
          name="condiciones"
          rows={2}
          defaultValue={plan.condiciones ?? ''}
          className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Guardando…' : 'Guardar cambios'}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancelar
        </Button>
      </div>
    </form>
  )
}
