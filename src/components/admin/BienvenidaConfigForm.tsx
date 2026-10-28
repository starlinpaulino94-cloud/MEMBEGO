'use client'

import { useActionState, useEffect, useState } from 'react'
import { Gift } from 'lucide-react'
import { toast } from 'sonner'
import { guardarBienvenida } from '@/modules/admin/actions'
import type { AdminActionState } from '@/modules/admin/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Campo } from '@/components/ui/campo'
import { SelectNativo } from '@/components/ui/select-nativo'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const initial: AdminActionState = {}

/**
 * O-13: configuración del beneficio de bienvenida de la empresa. La empresa
 * decide si ofrece un descuento a clientes nuevos (lo financia ella) y de
 * cuánto: porcentaje o monto fijo sobre el primer pago de membresía.
 */
export function BienvenidaConfigForm({
  bienvenida,
}: {
  bienvenida: { activa: boolean; tipo: string; valor: number | null }
}) {
  const [state, formAction, pending] = useActionState(guardarBienvenida, initial)
  const [activa, setActiva] = useState(bienvenida.activa)
  const [tipo, setTipo] = useState(bienvenida.tipo)

  useEffect(() => {
    if (state.success) toast.success('Beneficio de bienvenida guardado.')
    if (state.error) toast.error(state.error)
  }, [state])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Gift className="h-4 w-4 text-success" />
          Beneficio de bienvenida
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-sm text-muted-foreground">
          Descuento para clientes nuevos en su <strong>primer pago</strong> de
          membresía. Lo financia tu empresa y se aplica una sola vez por
          cliente. Los clientes lo ven al elegir plan.
        </p>
        <form action={formAction} className="space-y-4">
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              name="activa"
              value="on"
              checked={activa}
              onChange={(e) => setActiva(e.target.checked)}
              className="size-4 rounded border-input"
            />
            Ofrecer beneficio de bienvenida
          </label>

          {activa && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Campo id="bienvenida-tipo" etiqueta="Tipo">
                {(control) => (
                  <SelectNativo name="tipo" value={tipo} onChange={(e) => setTipo(e.target.value)} {...control}>
                    <option value="PORCENTAJE">Porcentaje (%)</option>
                    <option value="MONTO">Monto fijo</option>
                  </SelectNativo>
                )}
              </Campo>
              <Campo id="bienvenida-valor" etiqueta={tipo === 'PORCENTAJE' ? 'Porcentaje de descuento' : 'Monto de descuento'}>
                {(control) => (
                  <Input
                    name="valor"
                    type="number"
                    min="0.01"
                    step="0.01"
                    max={tipo === 'PORCENTAJE' ? 100 : undefined}
                    defaultValue={bienvenida.valor ?? ''}
                    required
                    placeholder={tipo === 'PORCENTAJE' ? '10' : '500.00'}
                    {...control}
                  />
                )}
              </Campo>
            </div>
          )}
          {/* Si el toggle está apagado, igual enviamos tipo para no perderlo. */}
          {!activa && <input type="hidden" name="tipo" value={tipo} />}

          <Button type="submit" loading={pending} size="sm">
            Guardar
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
