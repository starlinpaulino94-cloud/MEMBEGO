import Link from 'next/link'
import { Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'

export const metadata = { title: 'Configuración del CRM' }

/**
 * CONFIGURACIÓN · vacío honesto (Meta · Fase 1). Antes: etapas y campos
 * «configurables» que vivían en `useState` y se perdían al recargar; el
 * «Guardado» era un toast. Una configuración que no se guarda no es
 * configuración. Llegará con el CRM real (Meta · Fase 6).
 */
export default function ConfiguracionCrmPage() {
  return (
    <EmptyState
      variant="card"
      icon={<Settings className="h-6 w-6" aria-hidden />}
      title="La configuración del CRM llegará con el CRM"
      description="Las etapas del embudo y los campos personalizados se podrán definir cuando existan prospectos reales que ordenar. Hasta entonces no hay nada que guardar."
      action={
        <Button asChild>
          <Link href="/admin/crm">Ver prospectos</Link>
        </Button>
      }
    />
  )
}
