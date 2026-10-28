'use client'

import { useActionState, useEffect } from 'react'
import { Save } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Campo } from '@/components/ui/campo'
import {
  guardarUmbralesRetencion,
  type UmbralesActionState,
} from '@/modules/riesgo/actions'
import type { UmbralesRetencion } from '@/modules/riesgo/semaforo'

const init: UmbralesActionState = {}

const CAMPOS: {
  clave: keyof UmbralesRetencion
  label: string
  ayuda: string
}[] = [
  {
    clave: 'riesgoDias',
    label: 'En riesgo a los',
    ayuda: 'Días sin venir, teniendo membresía vigente, para considerarlo en riesgo.',
  },
  {
    clave: 'dormidoDias',
    label: 'Dormido a los',
    ayuda: 'Días sin venir para darlo por dormido. Siempre mayor que el anterior.',
  },
  {
    clave: 'perdidoDias',
    label: 'Perdido a los',
    ayuda: 'Días desde que le venció la membresía sin renovar.',
  },
  {
    clave: 'venceDias',
    label: 'Aviso de vencimiento',
    ayuda: 'Días antes de vencer que ponen en riesgo a quien todavía tiene usos.',
  },
]

/**
 * Los umbrales del semáforo, editables por el negocio.
 *
 * Existen configurables por una razón concreta: treinta días sin lavar el carro
 * es raro, treinta días sin cenar fuera no lo es. Con un número fijo, el mismo
 * semáforo llamaría «en riesgo» a la clientela normal de un restaurante y
 * «activa» a la de un car wash que ya se está yendo.
 */
export function UmbralesRetencionForm({ umbrales }: { umbrales: UmbralesRetencion }) {
  const [state, action, pending] = useActionState(guardarUmbralesRetencion, init)

  useEffect(() => {
    if (state.success) toast.success(state.success)
    if (state.error) toast.error(state.error)
  }, [state])

  return (
    <form action={action} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {CAMPOS.map((c) => (
          <Campo key={c.clave} id={c.clave} etiqueta={c.label} ayuda={c.ayuda}>
            {(control) => <Input type="number" name={c.clave} defaultValue={umbrales[c.clave]} min={1} max={365} {...control} />}
          </Campo>
        ))}
      </div>
      <Button type="submit" loading={pending} className="gap-2">
        {!pending && <Save className="h-4 w-4" aria-hidden />}
        Guardar umbrales
      </Button>
    </form>
  )
}
