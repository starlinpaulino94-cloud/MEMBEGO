'use client'

/**
 * Activar / suspender / desactivar al vendedor con un clic. Suspender y
 * desactivar exigen su permiso propio (vendedor_desactivar) — el servidor lo
 * hace cumplir. Nunca hay botón de borrar (§99).
 */

import { useActionState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  cambiarEstadoVendedor,
  type VendedorActionState,
} from '@/modules/excursiones/vendedores/actions'
import {
  ESTADOS_VENDEDOR,
  ESTADO_VENDEDOR_LABEL,
  type EstadoVendedor,
} from '@/modules/excursiones/vendedores/nucleo'
import { Button } from '@/components/ui/button'

const init: VendedorActionState = {}

export function VendedorEstadoBotones({
  vendedorId,
  estado,
}: {
  vendedorId: string
  estado: EstadoVendedor
}) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState(cambiarEstadoVendedor, init)
  useEffect(() => {
    if (state.success) {
      toast.success(state.success)
      router.refresh()
    }
    if (state.error) toast.error(state.error)
  }, [state, router])

  return (
    <div className="flex flex-wrap gap-2">
      {ESTADOS_VENDEDOR.map((e) => (
        <form key={e} action={formAction}>
          <input type="hidden" name="vendedorId" value={vendedorId} />
          <input type="hidden" name="estado" value={e} />
          <Button type="submit" size="sm" variant={estado === e ? 'default' : 'outline'} disabled={pending || estado === e}>
            {ESTADO_VENDEDOR_LABEL[e]}
          </Button>
        </form>
      ))}
    </div>
  )
}
