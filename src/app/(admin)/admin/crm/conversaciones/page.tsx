import Link from 'next/link'
import { MessageSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'

export const metadata = { title: 'Conversaciones' }

/**
 * BANDEJA DE CONVERSACIONES · vacío honesto (Meta · Fase 1).
 *
 * Hasta hoy esta pantalla enseñaba ocho conversaciones INVENTADAS —«María
 * García», «Carlos Rodríguez»— con un botón de enviar que solo cambiaba un
 * estado en el navegador. Un administrador podía creer que sus clientes le
 * escribían por WhatsApp y que él les respondía. No pasaba nada de eso.
 *
 * Se sustituye por la verdad: todavía no hay mensajería. Cuando la haya
 * (Meta · Fase 5), aquí se leen las conversaciones REALES de WhatsApp,
 * Messenger e Instagram de la empresa, desde `modules/mensajeria`.
 */
export default function ConversacionesPage() {
  return (
    <EmptyState
      variant="card"
      icon={<MessageSquare className="h-6 w-6" aria-hidden />}
      title="Todavía no hay conversaciones"
      description="Aquí verás los mensajes de WhatsApp, Messenger e Instagram de tu negocio y podrás responder desde Membego. La bandeja está en construcción: primero se conectan los canales, después empiezan a llegar los mensajes."
      action={
        <Button asChild>
          <Link href="/admin/integraciones">Ver integraciones</Link>
        </Button>
      }
    />
  )
}
