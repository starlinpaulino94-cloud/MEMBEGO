'use client'

/** Apagar una meta. No se borra: su histórico explica qué se pidió y cuándo. */

import { useActionState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { archivarMeta, type MetaActionState } from '@/modules/excursiones/metricas/actions'
import { Button } from '@/components/ui/button'

const init: MetaActionState = {}

export function ArchivarMetaBoton({ metaId }: { metaId: string }) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState(archivarMeta, init)
  useEffect(() => {
    if (state.success) {
      toast.success(state.success)
      router.refresh()
    }
    if (state.error) toast.error(state.error)
  }, [state, router])

  return (
    <form action={formAction}>
      <input type="hidden" name="metaId" value={metaId} />
      <Button type="submit" size="sm" variant="ghost" disabled={pending}>
        Archivar
      </Button>
    </form>
  )
}
