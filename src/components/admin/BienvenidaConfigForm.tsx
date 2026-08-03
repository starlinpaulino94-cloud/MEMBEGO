'use client'

import { useActionState, useEffect, useState } from 'react'
import { Loader2, Gift } from 'lucide-react'
import { toast } from 'sonner'
import { guardarBienvenida } from '@/modules/admin/actions'
import type { AdminActionState } from '@/modules/admin/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
              className="h-4 w-4 rounded border-border"
            />
            Ofrecer beneficio de bienvenida
          </label>

          {activa && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="bienvenida-tipo">Tipo</Label>
                <select
                  id="bienvenida-tipo"
                  name="tipo"
                  value={tipo}
                  onChange={(e) => setTipo(e.target.value)}
                  className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
                >
                  <option value="PORCENTAJE">Porcentaje (%)</option>
                  <option value="MONTO">Monto fijo</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="bienvenida-valor">
                  {tipo === 'PORCENTAJE' ? 'Porcentaje de descuento' : 'Monto de descuento'}
                </Label>
                <Input
                  id="bienvenida-valor"
                  name="valor"
                  type="number"
                  min="0.01"
                  step="0.01"
                  max={tipo === 'PORCENTAJE' ? 100 : undefined}
                  defaultValue={bienvenida.valor ?? ''}
                  required
                  placeholder={tipo === 'PORCENTAJE' ? '10' : '500.00'}
                />
              </div>
            </div>
          )}
          {/* Si el toggle está apagado, igual enviamos tipo para no perderlo. */}
          {!activa && <input type="hidden" name="tipo" value={tipo} />}

          <Button type="submit" disabled={pending} size="sm">
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Guardar
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
