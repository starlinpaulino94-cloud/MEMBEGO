'use client'

import { useActionState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { reclamarRecompensaAction } from '@/modules/supply-v2/actions-fidelizacion'
import type { EstadoAccion } from '@/modules/supply-v2/actions-util'
import type { ReclamacionHecha } from '@/modules/supply-v2/loyalty/rewards'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 8 · canjear puntos por una recompensa (§31).
 *
 * El botón no decide si alcanza: lo decide el servidor dentro del candado de
 * la cuenta de puntos, así que dos pestañas pidiendo la última unidad no
 * gastan los puntos dos veces. La clave de idempotencia cubre el doble clic.
 */
export function BotonReclamarRecompensa({
  rewardId,
  nombre,
  puntos,
  alcanza,
  porQueNo,
}: {
  rewardId: string
  nombre: string
  puntos: number
  alcanza: boolean
  porQueNo: string | null
}) {
  const router = useRouter()
  const [estado, accion, pendiente] = useActionState<EstadoAccion<ReclamacionHecha>, FormData>(reclamarRecompensaAction, {})
  /**
   * La clave de idempotencia se crea AL ENVIAR, no durante el render: generar
   * un identificador aleatorio mientras se renderiza es impuro. Se guarda en
   * una ref, así que el doble clic manda la MISMA clave y el servidor devuelve
   * lo que ya hizo en vez de repetirlo.
   */
  const clave = useRef<string | null>(null)
  const enviar = (fd: FormData) => {
    clave.current ??= `rec-${rewardId}-${crypto.randomUUID()}`
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
    router.refresh()
  }, [estado, router])

  if (porQueNo) {
    return (
      <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-caption text-muted-foreground" data-testid="recompensa-porque-no">
        {porQueNo}
      </p>
    )
  }

  return (
    <form action={enviar} className="space-y-2">
      <input type="hidden" name="rewardId" value={rewardId} />
      <Button type="submit" size="sm" className="w-full" disabled={pendiente || !alcanza} loading={pendiente} data-testid="btn-reclamar-recompensa">
        {alcanza ? `Canjear por ${puntos} puntos` : `Te faltan puntos para ${nombre}`}
      </Button>
      {estado.error && <p className="text-sm text-destructive" role="alert">{estado.error}</p>}
    </form>
  )
}
