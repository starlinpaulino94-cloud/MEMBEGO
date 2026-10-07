'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { revisarFacturacionAhora } from '@/modules/billing/actions'
import { Button } from '@/components/ui/button'

/** «Revisar ahora»: el mismo barrido que hace el cron (comisiones que faltan, gracias vencidas, estados de cuenta). */
export function BarridoAcciones() {
  const router = useRouter()
  const [pending, start] = useTransition()
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await revisarFacturacionAhora()
          if (!r.ok) {
            toast.error(r.error)
            return
          }
          const x = r.resultado
          toast.success(`Revisado: ${x.comisionesCreadas} comisiones nuevas, ${x.suspendidas} suspensiones, ${x.cortes} estados de cuenta${x.errores ? `, ${x.errores} con error` : ''}.`)
          router.refresh()
        })
      }
    >
      {pending ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-2 h-3.5 w-3.5" />}
      Revisar ahora
    </Button>
  )
}
