import Link from 'next/link'
import { ListChecks } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'

export const metadata = { title: 'Seguimientos' }

/**
 * SEGUIMIENTOS · vacío honesto (Meta · Fase 1). Antes: actividades y
 * prospectos inventados en el navegador. Los seguimientos reales cuelgan de
 * prospectos reales (Meta · Fase 6).
 */
export default function SeguimientosPage() {
  return (
    <EmptyState
      variant="card"
      icon={<ListChecks className="h-6 w-6" aria-hidden />}
      title="Todavía no hay seguimientos"
      description="Aquí quedarán las llamadas, notas y mensajes de cada prospecto. Aparecerán cuando existan prospectos reales."
      action={
        <Button asChild>
          <Link href="/admin/crm">Ver prospectos</Link>
        </Button>
      }
    />
  )
}
