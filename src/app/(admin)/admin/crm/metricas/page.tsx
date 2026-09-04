import Link from 'next/link'
import { BarChart3 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'

export const metadata = { title: 'Métricas del CRM' }

/**
 * MÉTRICAS · vacío honesto (Meta · Fase 1). Antes: «12 leads hoy», «45 % por
 * WhatsApp» y un ranking de vendedores, todo escrito a mano. Un número que
 * no sale de la base no se pinta.
 */
export default function MetricasPage() {
  return (
    <EmptyState
      variant="card"
      icon={<BarChart3 className="h-6 w-6" aria-hidden />}
      title="Sin métricas todavía"
      description="Las métricas del CRM se calculan sobre conversaciones y prospectos reales. En cuanto haya datos, aquí verás de dónde llegan tus prospectos y cuánto tardan en convertirse."
      action={
        <Button asChild>
          <Link href="/admin/reportes">Ver reportes del negocio</Link>
        </Button>
      }
    />
  )
}
