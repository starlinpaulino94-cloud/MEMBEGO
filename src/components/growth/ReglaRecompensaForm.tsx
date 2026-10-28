'use client'

import { useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { StatusBanner } from '@/components/ui/status-banner'
import { Campo } from '@/components/ui/campo'
import { FormActions, FormSection } from '@/components/ui/form-section'
import { SelectNativo } from '@/components/ui/select-nativo'
import {
  TRIGGER_LABEL,
  TIPO_LABEL,
  BENEFICIARIO_LABEL,
} from '@/modules/growth/reglas'
import {
  crearGrowthRuleAction,
  actualizarGrowthRuleAction,
  type ReglaState,
} from '@/modules/growth/actions'

export interface ReglaEditable {
  id: string
  nombre: string
  trigger: string
  valorCondicion: number
  planId: string | null
  beneficiario: string
  recompensaTipo: string
  recompensaValor: number
  recompensaPromocionId: string | null
}

/**
 * Formulario de una regla de recompensa, en su propia página.
 *
 * Dos detalles que solo se pueden hacer aquí y no en el formulario embebido de
 * antes: los campos que no aplican al tipo elegido se ocultan (un beneficio
 * digital no lleva "valor", un disparador que no sea "N referidos" no lleva
 * umbral), y los errores se ven — antes la acción hacía `return` en silencio.
 */
export function ReglaRecompensaForm({
  promos,
  plans,
  regla,
}: {
  promos: { id: string; titulo: string }[]
  plans: { id: string; nombre: string }[]
  /** Si viene, el formulario edita esa regla; si no, crea una nueva. */
  regla?: ReglaEditable
}) {
  const router = useRouter()
  const [estado, accion, enviando] = useActionState<ReglaState, FormData>(
    regla ? actualizarGrowthRuleAction : crearGrowthRuleAction,
    {}
  )
  const [trigger, setTrigger] = useState(regla?.trigger ?? 'REGISTRO')
  const [tipo, setTipo] = useState(regla?.recompensaTipo ?? 'PUNTOS')

  const esBeneficio = tipo === 'BENEFICIO'
  const pideUmbral = trigger === 'N_REFERIDOS'

  // Al guardar se vuelve a la lista: el trabajo terminó y ahí se ve el efecto.
  useEffect(() => {
    if (estado.ok) router.push('/admin/crecimiento/recompensas')
  }, [estado.ok, router])

  return (
    <form action={accion} className="space-y-8">
      {regla && <input type="hidden" name="id" value={regla.id} />}

      {estado.error && (
        <StatusBanner variant="destructive" title="No se pudo guardar">
          {estado.error}
        </StatusBanner>
      )}

      <FormSection title="La regla" description="Cómo la reconoces en la lista.">
        <Campo id="nombre" etiqueta="Nombre de la regla" ayuda="Solo lo ves tú, para reconocerla en la lista.">
          {(control) => <Input name="nombre" required maxLength={80} defaultValue={regla?.nombre} placeholder="Ej. Bono por registro" {...control} />}
        </Campo>
      </FormSection>

      <FormSection title="Cuándo se entrega" description="El hecho que dispara la recompensa y a quién se le da.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Campo id="trigger" etiqueta="Cuándo se entrega">
            {(control) => (
              <SelectNativo name="trigger" value={trigger} onChange={(e) => setTrigger(e.target.value)} {...control}>
                {Object.entries(TRIGGER_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </SelectNativo>
            )}
          </Campo>
          {pideUmbral && (
            <Campo id="valorCondicion" etiqueta="¿Cuántos referidos?">
              {(control) => <Input name="valorCondicion" type="number" min={1} step={1} defaultValue={regla?.valorCondicion ?? 3} {...control} />}
            </Campo>
          )}
          <Campo id="beneficiario" etiqueta="A quién se recompensa">
            {(control) => (
              <SelectNativo name="beneficiario" defaultValue={regla?.beneficiario ?? 'REFERENTE'} {...control}>
                {Object.entries(BENEFICIARIO_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </SelectNativo>
            )}
          </Campo>
          <Campo id="planId" etiqueta="Solo si compró este plan" opcional>
            {(control) => (
              <SelectNativo name="planId" defaultValue={regla?.planId ?? ''} {...control}>
                <option value="">Cualquier plan</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </SelectNativo>
            )}
          </Campo>
        </div>
      </FormSection>

      <FormSection title="Qué se entrega" description="El premio: puntos, un descuento o un beneficio digital.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Campo id="recompensaTipo" etiqueta="Qué se entrega">
            {(control) => (
              <SelectNativo name="recompensaTipo" value={tipo} onChange={(e) => setTipo(e.target.value)} {...control}>
                {Object.entries(TIPO_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </SelectNativo>
            )}
          </Campo>
          {esBeneficio ? (
            <Campo
              id="recompensaPromocionId"
              etiqueta="Cuál beneficio digital"
              ayuda={
                promos.length === 0 ? (
                  <span className="text-warning-ink">
                    No tienes promociones activas para entregar.{' '}
                    <Link href="/admin/promociones" className="font-medium underline">
                      Crea una primero
                    </Link>
                    .
                  </span>
                ) : undefined
              }
            >
              {(control) => (
                <SelectNativo name="recompensaPromocionId" defaultValue={regla?.recompensaPromocionId ?? ''} {...control}>
                  <option value="">Elige uno…</option>
                  {promos.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.titulo}
                    </option>
                  ))}
                </SelectNativo>
              )}
            </Campo>
          ) : (
            <Campo id="recompensaValor" etiqueta={`Cuánto${tipo === 'DESCUENTO_PORCENTAJE' ? ' (%)' : ''}`}>
              {(control) => (
                <Input
                  name="recompensaValor"
                  type="number"
                  step="0.01"
                  min={0}
                  max={tipo === 'DESCUENTO_PORCENTAJE' ? 100 : undefined}
                  defaultValue={regla?.recompensaValor || ''}
                  {...control}
                />
              )}
            </Campo>
          )}
        </div>
      </FormSection>

      <FormActions>
        <Button asChild variant="ghost">
          <Link href="/admin/crecimiento/recompensas">Cancelar</Link>
        </Button>
        <Button type="submit" loading={enviando}>
          {regla ? 'Guardar cambios' : 'Crear regla'}
        </Button>
      </FormActions>
    </form>
  )
}
