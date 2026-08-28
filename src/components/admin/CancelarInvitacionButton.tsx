'use client'

import { useTransition } from 'react'
import { X } from 'lucide-react'
import { toast } from 'sonner'
import { cancelarInvitacion } from '@/modules/admin/invitacionActions'

export function CancelarInvitacionButton({ id }: { id: string }) {
  const [pending, start] = useTransition()

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await cancelarInvitacion(id)
          if (res.error) toast.error(res.error)
          else toast.success('Invitación cancelada.')
        })
      }
      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground transition hover:bg-muted hover:text-destructive disabled:opacity-50"
      aria-label="Cancelar invitación"
    >
      <X className="h-3.5 w-3.5" /> Cancelar
    </button>
  )
}
