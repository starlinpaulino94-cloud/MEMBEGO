'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Heart, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { toggleGuardarPromocion } from '@/modules/social/actions'

interface SavePromoButtonProps {
  promocionId: string
  guardada: boolean
}

/** Corazón de guardar/quitar promoción; se superpone a la tarjeta. */
export function SavePromoButton({ promocionId, guardada }: SavePromoButtonProps) {
  const router = useRouter()
  const [saved, setSaved] = useState(guardada)
  const [pending, startTransition] = useTransition()

  function handleToggle() {
    startTransition(async () => {
      const res = await toggleGuardarPromocion(promocionId)
      if (res.error) {
        toast.error(res.error)
        return
      }
      setSaved(res.guardada ?? false)
      toast.success(
        res.guardada ? 'Promoción guardada.' : 'Quitada de guardadas.'
      )
      router.refresh()
    })
  }

  return (
    <button
      onClick={handleToggle}
      disabled={pending}
      aria-label={saved ? 'Quitar de guardadas' : 'Guardar promoción'}
      title={saved ? 'Quitar de guardadas' : 'Guardar promoción'}
      className={`absolute right-2 top-2 z-10 rounded-full border bg-card/95 p-2 elevation-1 backdrop-blur transition-colors duration-fast disabled:opacity-60 ${
        saved
          ? 'border-destructive/25 text-destructive'
          : 'border-border text-muted-foreground hover:text-destructive'
      }`}
    >
      {pending ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      ) : (
        <Heart className={`h-4 w-4 ${saved ? 'fill-destructive' : ''}`} aria-hidden />
      )}
    </button>
  )
}
