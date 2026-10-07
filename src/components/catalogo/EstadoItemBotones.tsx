'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { cambiarEstadoItemCatalogo } from '@/modules/catalog/actions'
import { Button } from '@/components/ui/button'

type Estado = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED'

const ACCION: Record<Estado, { texto: string; ok: string; variante: 'default' | 'outline' | 'destructive' }> = {
  ACTIVE: { texto: 'Publicar', ok: 'Publicado.', variante: 'default' },
  PAUSED: { texto: 'Pausar', ok: 'Pausado.', variante: 'outline' },
  ARCHIVED: { texto: 'Archivar', ok: 'Archivado.', variante: 'destructive' },
  DRAFT: { texto: 'Restaurar como borrador', ok: 'Restaurado como borrador.', variante: 'outline' },
}

/**
 * Ofrece SOLO las transiciones que le pasa la página (que las toma de la tabla
 * del dominio). El dominio no se importa aquí: arrastraría Prisma al navegador.
 */
export function EstadoItemBotones({
  itemId,
  siguientes,
  soloLectura,
}: {
  itemId: string
  siguientes: readonly Estado[]
  soloLectura: boolean
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  if (soloLectura) return null

  function ir(a: Estado) {
    start(async () => {
      const r = await cambiarEstadoItemCatalogo(itemId, a)
      if (!r.ok) toast.error(r.error)
      else {
        toast.success(ACCION[a].ok)
        router.refresh()
      }
    })
  }

  return (
    <div className="flex flex-wrap gap-2">
      {siguientes.map((a) => (
        <Button key={a} variant={ACCION[a].variante} size="sm" disabled={pending} onClick={() => ir(a)}>
          {pending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
          {ACCION[a].texto}
        </Button>
      ))}
    </div>
  )
}
