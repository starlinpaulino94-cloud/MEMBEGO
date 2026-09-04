import Link from 'next/link'
import { Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'

export const metadata = { title: 'Configuración del CRM' }

/**
 * CONFIGURACIÓN (Meta · Fase 6). Honesto: hoy el CRM no tiene nada que
 * configurar. Los prospectos nacen solos del primer mensaje de quien no es
 * cliente, y el embudo es fijo (nuevo → contactado → cotización →
 * negociación → cerrado / perdido). Cuando existan etapas propias o campos
 * personalizados, se configurarán aquí.
 */
export default function ConfiguracionCrmPage() {
  return (
    <EmptyState
      variant="card"
      icon={<Settings className="h-6 w-6" aria-hidden />}
      title="Nada que configurar por ahora"
      description="Los prospectos se crean solos con el primer mensaje de quien todavía no es cliente, y el embudo tiene seis etapas fijas: nuevo, contactado, cotización, negociación, cerrado y perdido. Lo que sí se configura son los canales por los que llegan."
      action={
        <Button asChild>
          <Link href="/admin/integraciones">Ver canales conectados</Link>
        </Button>
      }
    />
  )
}
