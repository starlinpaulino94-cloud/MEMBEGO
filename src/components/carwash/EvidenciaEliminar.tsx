'use client'

import { useTransition } from 'react'
import { toast } from 'sonner'
import { Loader2, Trash2 } from 'lucide-react'
import { eliminarEvidencia } from '@/modules/carwash/evidencias-actions'

/** App Car Wash · E5 — borrar una foto de evidencia (con confirmación). */
export function EvidenciaEliminar({ id }: { id: string }) {
  const [pending, startTransition] = useTransition()

  return (
    <button
      type="button"
      disabled={pending}
      title="Eliminar foto"
      className="inline-flex items-center gap-1 rounded-full bg-black/50 px-2 py-1 text-[11px] font-semibold text-white hover:bg-black/70"
      onClick={() => {
        if (!window.confirm('¿Eliminar esta foto de evidencia?')) return
        startTransition(async () => {
          const res = await eliminarEvidencia(id)
          if (res.error) toast.error(res.error)
          else toast.success('Foto eliminada.')
        })
      }}
    >
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
    </button>
  )
}
