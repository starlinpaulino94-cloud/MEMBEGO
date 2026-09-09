'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { cambiarEstadoConversacionAction, marcarLeidaAction } from '@/modules/mensajeria/actions'

/**
 * Lo poco que la bandeja hace en el navegador: cerrar o reabrir un hilo, y
 * marcar como leído al abrirlo. Todo termina en `router.refresh()` para que
 * la lista y el hilo —que son de servidor— vuelvan a leerse.
 */

export function AccionesConversacion({ conversacionId, estado }: { conversacionId: string; estado: string }) {
  const router = useRouter()
  const [pendiente, empezar] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const cerrada = estado === 'CERRADA'

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-destructive">{error}</span>}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pendiente}
        onClick={() =>
          empezar(async () => {
            const r = await cambiarEstadoConversacionAction(conversacionId, cerrada ? 'ABIERTA' : 'CERRADA')
            if (!r.ok) setError(r.error ?? 'No se pudo cambiar.')
            else router.refresh()
          })
        }
      >
        {pendiente ? 'Un momento…' : cerrada ? 'Reabrir' : 'Cerrar conversación'}
      </Button>
    </div>
  )
}

/** Al abrir un hilo con mensajes sin leer, se marca como leído una sola vez. */
export function MarcarLeidaAlAbrir({ conversacionId, noLeidos }: { conversacionId: string; noLeidos: number }) {
  const router = useRouter()
  const hecho = useRef<string | null>(null)
  useEffect(() => {
    if (noLeidos <= 0 || hecho.current === conversacionId) return
    hecho.current = conversacionId
    marcarLeidaAction(conversacionId).then(() => router.refresh())
  }, [conversacionId, noLeidos, router])
  return null
}
