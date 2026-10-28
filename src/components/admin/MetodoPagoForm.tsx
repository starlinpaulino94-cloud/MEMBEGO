'use client'

import { useActionState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  crearMetodoPago,
  actualizarMetodoPago,
  type MetodoPagoState,
} from '@/modules/admin/metodoPagoActions'
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
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Switch } from '@/components/ui/switch'
import { Campo } from '@/components/ui/campo'
import { FormActions, FormSection } from '@/components/ui/form-section'

interface Existing {
  id: string
  tipo: string
  nombre: string
  titular: string | null
  numeroCuenta: string | null
  tipoCuenta: string | null
  instrucciones: string | null
  activo: boolean
}

interface Company {
  id: string
  name: string
}

const init: MetodoPagoState = {}

/**
 * Form de método de pago. Con `companies` (superadmin, alta) muestra el
 * selector de empresa; sin él (panel de empresa) la action usa la empresa
 * de la sesión.
 */
export function MetodoPagoForm({
  existing,
  companies,
}: {
  existing?: Existing
  companies?: Company[]
}) {
  const router = useRouter()
  const action = existing ? actualizarMetodoPago : crearMetodoPago
  const [state, formAction, pending] = useActionState(action, init)

  useEffect(() => {
    if (state.success) {
      toast.success(existing ? 'Método actualizado.' : 'Método creado.')
      router.push('/admin/metodos-pago')
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

      <FormSection title="El método" description="Cómo se llama y de qué tipo es. Así lo ve el cliente al elegir cómo pagar.">
        {!existing && companies && (
          <Campo id="companyId" etiqueta="Empresa">
            {(control) => (
              <Select name="companyId" required>
                <SelectTrigger className="w-full" {...control}>
                  <SelectValue placeholder="Selecciona la empresa" />
                </SelectTrigger>
                <SelectContent>
                  {companies.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Campo>
        )}

        {!existing && (
          <Campo id="tipo" etiqueta="Tipo de método" className="sm:max-w-xs">
            {(control) => (
              <Select name="tipo" defaultValue="TRANSFERENCIA" required>
                <SelectTrigger className="w-full" {...control}>
                  <SelectValue placeholder="Selecciona tipo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TRANSFERENCIA">Transferencia bancaria</SelectItem>
                  <SelectItem value="PRESENCIAL">Pago presencial</SelectItem>
                </SelectContent>
              </Select>
            )}
          </Campo>
        )}

        <Campo id="nombre" etiqueta="Nombre del método">
          {(control) => <Input name="nombre" defaultValue={existing?.nombre} placeholder="Ej: BHD León · Transferencia" required {...control} />}
        </Campo>
      </FormSection>

      {(!existing || existing.tipo === 'TRANSFERENCIA') && (
        <FormSection title="Datos de la cuenta" description="Solo para transferencias: a dónde envía el dinero el cliente.">
          <Campo id="titular" etiqueta="Titular de la cuenta" opcional>
            {(control) => <Input name="titular" defaultValue={existing?.titular ?? ''} placeholder="Ej: CARTOWN WASH SRL" {...control} />}
          </Campo>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo id="numeroCuenta" etiqueta="Número de cuenta" opcional>
              {(control) => (
                <Input name="numeroCuenta" inputMode="numeric" defaultValue={existing?.numeroCuenta ?? ''} placeholder="Ej: 27190123456" {...control} />
              )}
            </Campo>
            <Campo id="tipoCuenta" etiqueta="Tipo de cuenta" opcional>
              {(control) => <Input name="tipoCuenta" defaultValue={existing?.tipoCuenta ?? ''} placeholder="Ej: Corriente" {...control} />}
            </Campo>
          </div>
        </FormSection>
      )}

      <FormSection title="Instrucciones" description="Lo que el cliente debe hacer para que su pago se identifique.">
        <Campo id="instrucciones" etiqueta="Instrucciones adicionales" opcional>
          {(control) => (
            <Textarea
              name="instrucciones"
              defaultValue={existing?.instrucciones ?? ''}
              rows={3}
              placeholder="Ej: Incluye tu nombre y número de cédula en el concepto de la transferencia."
              {...control}
            />
          )}
        </Campo>
      </FormSection>

      {existing && (
        <FormSection title="Estado" description="Un método inactivo no se ofrece a los clientes al pagar.">
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
            <Label htmlFor="activo">Método activo</Label>
          </div>
        </FormSection>
      )}

      <FormActions>
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          Cancelar
        </Button>
        <Button type="submit" loading={pending}>
          {existing ? 'Guardar cambios' : 'Crear método'}
        </Button>
      </FormActions>
    </form>
  )
}
