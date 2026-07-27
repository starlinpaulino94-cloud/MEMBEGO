'use client'

import { useTransition } from 'react'
import { toast } from 'sonner'
import { Archive, Loader2, Send } from 'lucide-react'
import {
  aplicarCampanaGlobal,
  archivarCampanaGlobal,
} from '@/modules/superadmin/campanasActions'
import { Button } from '@/components/ui/button'

/**
 * Aplicar (repartir a las empresas) y archivar una campaña global.
 * Ambas piden confirmación: tocan la base de datos de varias empresas a la vez.
 */
export function CampanaGlobalAcciones({
  campanaId,
  estado,
  pendientes,
}: {
  campanaId: string
  estado: string
  /** Empresas que aún no han recibido su copia. */
  pendientes: number
}) {
  const [pending, startTransition] = useTransition()

  function aplicar() {
    const msg =
      pendientes === 0
        ? 'Todas las empresas ya recibieron esta campaña. ¿Volver a revisar por si entraron empresas nuevas?'
        : `Se va a crear la oferta en ${pendientes} empresa${pendientes !== 1 ? 's' : ''}. ¿Continuar?`
    if (!window.confirm(msg)) return
    startTransition(async () => {
      const res = await aplicarCampanaGlobal(campanaId)
      if (res.error) {
        toast.error(res.error)
        return
      }
      const partes = [`${res.creadas ?? 0} creada${res.creadas === 1 ? '' : 's'}`]
      if (res.fallos) partes.push(`${res.fallos} con error`)
      toast.success(`Campaña aplicada: ${partes.join(', ')}.`)
    })
  }

  function archivar() {
    if (
      !window.confirm(
        'Archivar desactiva la oferta en TODAS las empresas participantes. El historial de canjes y compras se conserva. ¿Continuar?'
      )
    ) {
      return
    }
    startTransition(async () => {
      const res = await archivarCampanaGlobal(campanaId)
      if (res.error) toast.error(res.error)
      else toast.success('Campaña archivada y desactivada en todas las empresas.')
    })
  }

  if (estado === 'ARCHIVADA') {
    return <span className="text-sm text-muted-foreground">Campaña archivada.</span>
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" onClick={aplicar} disabled={pending} className="gap-1.5">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        {estado === 'BORRADOR' ? 'Aplicar a las empresas' : 'Volver a aplicar'}
      </Button>
      <Button
        type="button"
        variant="ghost"
        onClick={archivar}
        disabled={pending}
        className="gap-1.5 text-muted-foreground hover:text-destructive"
      >
        <Archive className="h-4 w-4" /> Archivar
      </Button>
    </div>
  )
}
