'use client'

import { useActionState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Gift } from 'lucide-react'
import { toast } from 'sonner'
import { crearOfertaPrivada, type OfertaActionState } from '@/modules/ofertas/actions'
import { ClientePicker, type ClienteOption } from '@/components/ofertas/ClientePicker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Campo } from '@/components/ui/campo'
import { FormActions, FormSection } from '@/components/ui/form-section'
import { SelectNativo } from '@/components/ui/select-nativo'

const init: OfertaActionState = {}

export function CrearOfertaForm({ clientes }: { clientes: ClienteOption[] }) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState(crearOfertaPrivada, init)

  useEffect(() => {
    if (state.success && state.ofertaId) {
      toast.success(state.mensaje ?? 'Oferta creada.')
      router.push(`/admin/ofertas/${state.ofertaId}`)
    }
    if (state.error) toast.error(state.error)
  }, [state, router])

  return (
    <form action={formAction} className="space-y-8">
      <FormSection title="El regalo" description="Qué recibe el cliente y lo que ve al abrirlo.">
        <Campo id="titulo" etiqueta="Título">
          {(control) => <Input name="titulo" required maxLength={120} placeholder="Ej.: 12 lavados gratis al mes" {...control} />}
        </Campo>
        <Campo id="descripcion" etiqueta="Descripción" opcional>
          {(control) => (
            <Textarea
              name="descripcion"
              rows={3}
              maxLength={500}
              placeholder="Condiciones o detalles que verá el cliente al abrir su regalo…"
              {...control}
            />
          )}
        </Campo>
      </FormSection>

      <FormSection
        title="La regla de usos"
        description="Cuántas veces se puede usar y cada cuánto se renueva. Ej.: 12 usos · cada mes · válido hasta dentro de un año = 12 lavados gratis al mes por un año."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Campo id="usosPorPeriodo" etiqueta="Cantidad de usos">
            {(control) => <Input type="number" name="usosPorPeriodo" min={1} max={500} defaultValue={12} {...control} />}
          </Campo>
          <Campo id="periodo" etiqueta="Se renuevan">
            {(control) => (
              <SelectNativo name="periodo" defaultValue="MENSUAL" {...control}>
                <option value="MENSUAL">Cada mes</option>
                <option value="SEMANAL">Cada semana</option>
                <option value="TOTAL">Nunca (cupo único)</option>
              </SelectNativo>
            )}
          </Campo>
          <Campo id="vigenciaHasta" etiqueta="Válido hasta" opcional>
            {(control) => <Input type="date" name="vigenciaHasta" {...control} />}
          </Campo>
        </div>
      </FormSection>

      <FormSection
        title="Quiénes lo reciben"
        description="Solo estas cuentas podrán reclamarlo. Si el link llega a otra persona, verá «tu cuenta no aplica para esta promoción»."
      >
        <ClientePicker clientes={clientes} />
      </FormSection>

      <FormActions>
        <Button type="submit" loading={pending}>
          {!pending && <Gift className="h-4 w-4" aria-hidden />}
          Crear regalo y generar link
        </Button>
      </FormActions>
    </form>
  )
}
