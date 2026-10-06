'use client'

import { useActionState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { contratarMembresiaAction } from '@/modules/supply-v2/actions-fidelizacion'
import type { EstadoAccion } from '@/modules/supply-v2/actions-util'
import type { MembresiaCreada } from '@/modules/supply-v2/loyalty/memberships'
import { RUTA_FIDELIZACION_CLIENTE } from '@/modules/supply-v2/core/catalogo'

/**
 * MEMBEGO SUPPLY · SLICE 8 · contratar un plan (§17).
 *
 * Si el plan es de pago, el servidor abre el pedido de membresía por el
 * checkout de siempre y aquí solo se navega a pagarlo. Si es gratuito, queda
 * activa en el acto.
 *
 * La clave de idempotencia se genera una vez por montaje: el doble clic manda
 * la misma clave y el servidor devuelve la misma membresía en vez de comprar
 * dos veces. El importe no viaja en el formulario: lo pone el servidor desde
 * el plan.
 */
export function BotonContratarMembresia({ planId, gratuita, precio }: { planId: string; gratuita: boolean; precio: string }) {
  const router = useRouter()
  const [estado, accion, pendiente] = useActionState<EstadoAccion<MembresiaCreada>, FormData>(contratarMembresiaAction, {})
  /**
   * La clave de idempotencia se crea AL ENVIAR, no durante el render: generar
   * un identificador aleatorio mientras se renderiza es impuro. Se guarda en
   * una ref, así que el doble clic manda la MISMA clave y el servidor devuelve
   * lo que ya hizo en vez de repetirlo.
   */
  const clave = useRef<string | null>(null)
  const enviar = (fd: FormData) => {
    clave.current ??= `mem-${planId}-${crypto.randomUUID()}`
    fd.set('idempotencyKey', clave.current)
    return accion(fd)
  }
  const visto = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (estado.error) {
      toast.error(estado.error)
      return
    }
    if (!estado.success || visto.current === estado.id) return
    visto.current = estado.id
    toast.success(estado.success)
    // Si hay pedido, se va a pagarlo; si no, la membresía ya está en su cuenta.
    router.push(estado.data?.orderId ? `/cliente/compras/${estado.data.orderId}` : RUTA_FIDELIZACION_CLIENTE)
  }, [estado, router])

  return (
    <form action={enviar} className="space-y-2">
      <input type="hidden" name="planId" value={planId} />
      <Button type="submit" className="w-full" disabled={pendiente} loading={pendiente} data-testid="btn-contratar-membresia">
        {gratuita ? 'Activar gratis' : `Contratar por ${precio}`}
      </Button>
      {estado.error && <p className="text-sm text-destructive" role="alert">{estado.error}</p>}
    </form>
  )
}
