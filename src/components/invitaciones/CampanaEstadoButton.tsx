'use client'

import { useTransition } from 'react'
import { Play, Pause, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { cambiarEstadoCampana } from '@/modules/invitaciones/adminActions'
import { Button } from '@/components/ui/button'
import { useRouter } from 'next/navigation'

interface Props {
  id: string
  estado: string
}

export function CampanaEstadoButton({ id, estado }: Props) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  if (estado === 'FINALIZADA') return null

  const nextEstado = estado === 'ACTIVA' ? 'PAUSADA' : 'ACTIVA'
  const Icon = estado === 'ACTIVA' ? Pause : Play
  const label = estado === 'ACTIVA' ? 'Pausar' : 'Activar'

  const handleClick = () => {
    startTransition(async () => {
      const res = await cambiarEstadoCampana(id, nextEstado)
      if (res.error) {
        toast.error(res.error)
      } else {
        toast.success(`Campaña ${nextEstado === 'ACTIVA' ? 'activada' : 'pausada'}.`)
        router.refresh()
      }
    })
  }

  return (
    <Button variant="outline" size="sm" onClick={handleClick} disabled={pending} className="gap-1">
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
      {label}
    </Button>
  )
}
