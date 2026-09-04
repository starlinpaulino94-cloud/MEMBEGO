import Link from 'next/link'
import { Contact } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'

export const metadata = { title: 'Prospectos' }

/**
 * PROSPECTOS · vacío honesto (Meta · Fase 1).
 *
 * Esta pantalla era un tablero de 935 líneas sobre una lista de prospectos
 * INVENTADA en el navegador: se podían arrastrar, editar y «convertir» sin
 * que nada llegara a la base. Se sustituye por la verdad hasta que exista lo
 * que la alimenta: los prospectos nacerán de las conversaciones reales
 * (Meta · Fase 6), con su canal de origen y su contacto.
 */
export default function ProspectosPage() {
  return (
    <EmptyState
      variant="card"
      icon={<Contact className="h-6 w-6" aria-hidden />}
      title="Todavía no hay prospectos"
      description="Los prospectos nacerán de las conversaciones que lleguen por WhatsApp, Messenger e Instagram, y de los formularios de tu perfil público. Mientras tanto, tus clientes viven en el directorio."
      action={
        <Button asChild>
          <Link href="/admin/clientes">Ir al directorio de clientes</Link>
        </Button>
      }
      secondaryAction={
        <Button variant="ghost" asChild>
          <Link href="/admin/integraciones">Conectar un canal</Link>
        </Button>
      }
    />
  )
}
