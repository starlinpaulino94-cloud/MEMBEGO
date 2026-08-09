'use client'

/**
 * Selector obligatorio "¿Cómo nos conociste?" del registro (docs/ADQUISICION.md).
 * Se envía como `canalDeclarado`; si el visitante llegó por un enlace ?src=,
 * la cookie (más precisa: distingue campañas) tiene prioridad en el servidor.
 */

import { Label } from '@/components/ui/label'
import { OPCIONES_COMO_CONOCISTE } from '@/modules/adquisicion/shared'

export function ComoNosConociste() {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="canalDeclarado">¿Cómo nos conociste? *</Label>
      <select
        id="canalDeclarado"
        name="canalDeclarado"
        required
        defaultValue=""
        className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm [&>option]:bg-background [&>option]:text-foreground"
      >
        <option value="" disabled>
          Selecciona una opción
        </option>
        {OPCIONES_COMO_CONOCISTE.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}
