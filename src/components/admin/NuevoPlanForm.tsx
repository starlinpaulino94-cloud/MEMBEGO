'use client'

import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { crearPlan } from '@/modules/admin/planActions'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { FormSection, FormActions } from '@/components/ui/form-section'
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
    <form action={action} className="space-y-8">
      {state.error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      <FormSection
        title="Información"
        description="Cómo se llama el plan y cómo se presenta a tus clientes."
      >
        {companies && (
          <div className="space-y-1.5">
            <Label htmlFor="companyId">Empresa</Label>
            <select
              id="companyId"
              name="companyId"
              required
              className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
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
          <Input
            id="nombre"
            name="nombre"
            required
            defaultValue={prefill?.nombre}
            placeholder="Ej: Silver, Gold, Premium, VIP"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="descripcion">Descripción</Label>
          <Input
            id="descripcion"
            name="descripcion"
            defaultValue={prefill?.descripcion}
            placeholder="Descripción breve del plan"
          />
          <p className="text-caption">Opcional. Se ve en la tarjeta del plan.</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="color">Color del plan</Label>
          <Input id="color" name="color" type="color" defaultValue="#2563eb" className="h-10 w-24 p-1" />
          <p className="text-caption">Distingue este plan de los demás en la vitrina.</p>
        </div>
      </FormSection>

      <FormSection title="Precio y vigencia" description="Cuánto cuesta y cuánto dura.">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="precio">Precio (RD$)</Label>
            <Input
              id="precio"
              name="precio"
              type="number"
              min="0"
              step="0.01"
              required
              defaultValue={prefill?.precio}
              placeholder="0.00"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vigenciaDias">Vigencia (días)</Label>
            <Input
              id="vigenciaDias"
              name="vigenciaDias"
              type="number"
              min="1"
              defaultValue={prefill?.vigenciaDias ?? 30}
            />
          </div>
        </div>
      </FormSection>

      <FormSection title="Usos" description="Cuántas veces se puede aprovechar.">
        <div className="space-y-1.5">
          <Label htmlFor="lavados">Usos incluidos</Label>
          <Input
            id="lavados"
            name="lavados"
            type="number"
            min="0"
            defaultValue={prefill?.lavados || undefined}
            placeholder="0"
          />
        </div>
        <label className="flex items-center gap-2.5">
          <input
            type="checkbox"
            id="esIlimitado"
            name="esIlimitado"
            defaultChecked={prefill?.esIlimitado}
            className="h-4 w-4 rounded border-input"
          />
          <span className="text-small text-foreground">
            Usos ilimitados
            <span className="block text-caption">Ignora el número de arriba.</span>
          </span>
        </label>
      </FormSection>

      <FormSection title="Beneficios" description="Lo que incluye, en palabras del cliente.">
        <div className="space-y-1.5">
          <Label htmlFor="beneficios">Beneficios</Label>
          <textarea
            id="beneficios"
            name="beneficios"
            rows={4}
            defaultValue={prefill?.beneficios}
            className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder={"Ej: Servicio completo incluido\nAtención preferencial\nDescuento en servicios extra"}
          />
          <p className="text-caption">Uno por línea.</p>
        </div>
      </FormSection>

      <FormSection title="Restricciones" description="Lo que conviene decir antes de que pregunten.">
        <div className="space-y-1.5">
          <Label htmlFor="condiciones">Condiciones</Label>
          <textarea
            id="condiciones"
            name="condiciones"
            rows={2}
            defaultValue={prefill?.condiciones}
            className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="Ej: No aplica con otras promociones. Válido solo en sucursal principal."
          />
          <p className="text-caption">Opcional.</p>
        </div>
      </FormSection>

      <FormSection title="Disponibilidad" description="Dónde aparece dentro de tu vitrina.">
        <div className="space-y-1.5">
          <Label htmlFor="orden">Orden</Label>
          <Input id="orden" name="orden" type="number" defaultValue={0} className="w-32" />
          <p className="text-caption">Menor número = aparece primero.</p>
        </div>
      </FormSection>

      <FormActions>
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          Cancelar
        </Button>
        <Button type="submit" loading={pending}>
          Crear plan
        </Button>
      </FormActions>
    </form>
  )
}
