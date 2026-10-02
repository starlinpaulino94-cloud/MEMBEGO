'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { miCodigoDeReferidoAction } from '@/modules/supply-v2/actions-fidelizacion'
import type { EstadoAccion } from '@/modules/supply-v2/actions-util'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 8 · mi código de invitación (§19).
 *
 * El código lo genera el SERVIDOR y es estable: pedirlo dos veces devuelve el
 * mismo. No es un id interno ni se puede adivinar, y saberlo no salta ninguna
 * regla: quien lo use pasa por las mismas comprobaciones.
 */
export function FormMiCodigo({ programId, codigo }: { programId: string; codigo: string | null }) {
  const [estado, accion, pendiente] = useActionState<EstadoAccion, FormData>(miCodigoDeReferidoAction, {})
  const [copiado, setCopiado] = useState(false)
  const visto = useRef<string | undefined>(undefined)
  const actual = estado.id ?? codigo

  useEffect(() => {
    if (estado.error) {
      toast.error(estado.error)
      return
    }
    if (!estado.success || visto.current === estado.success) return
    visto.current = estado.success
    toast.success(estado.success)
  }, [estado])

  if (!actual) {
    return (
      <form action={accion}>
        <input type="hidden" name="programId" value={programId} />
        <Button type="submit" size="sm" disabled={pendiente} loading={pendiente} data-testid="btn-pedir-codigo">Quiero mi código</Button>
        {estado.error && <p className="text-sm text-destructive" role="alert">{estado.error}</p>}
      </form>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <code className="rounded-lg border border-border bg-muted/40 px-3 py-2 font-mono text-h3" data-testid="mi-codigo-referido">{actual}</code>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(actual)
            setCopiado(true)
            toast.success('Código copiado.')
          } catch {
            toast.error('No se pudo copiar. Cópialo a mano.')
          }
        }}
        data-testid="btn-copiar-codigo"
      >
        {copiado ? 'Copiado' : 'Copiar'}
      </Button>
    </div>
  )
}
