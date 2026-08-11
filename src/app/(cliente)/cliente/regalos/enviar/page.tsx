import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { getFuentesTransferencia } from '@/modules/regalos/queries'
import { getRegalosConfig } from '@/modules/regalos/config'
import { EnviarRegaloForm } from '@/components/regalos/EnviarRegaloForm'
import { EmptyState } from '@/components/ui/empty-state'
import { Gift } from 'lucide-react'
import { SinEmpresaTodavia } from '@/components/cliente/SinEmpresaTodavia'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Enviar regalo' }

/**
 * Regalos P2P · Fase R2 — enviar una transferencia de usos: destinatario
 * (@ID o búsqueda), fuente (wallet o lavados del plan) y dedicatoria.
 */
export default async function EnviarRegaloPage() {
  const user = await requireRole('CLIENTE')
  const clienteId = user.metadata.clienteId
  // Una cuenta de Membego que todavía no es cliente de ningún negocio. No
  // es un error ni una falta de permiso: es el primer día. Ver
  // `SinEmpresaTodavia`.
  if (!clienteId) {
    return <SinEmpresaTodavia que="beneficios que regalar"
      detalle="Para regalar necesitas tener beneficios con usos disponibles." />
  }
  const companyId = user.metadata.companyId
  if (!clienteId || !companyId) {
    return <p className="text-muted-foreground">Tu cuenta no está vinculada a una empresa.</p>
  }

  const [fuentes, config] = await Promise.all([
    getFuentesTransferencia(clienteId).catch(() => []),
    getRegalosConfig(companyId),
  ])

  return (
    <div className="mx-auto max-w-xl space-y-6 animate-fade-up">
      <header>
        <Link href="/cliente/regalos" className="text-sm text-primary hover:underline">
          ← Regalos
        </Link>
        <h1 className="mt-2 text-h1 text-foreground">Enviar un regalo</h1>
      </header>

      {!config.permitirTransferencias ? (
        <EmptyState
          icon={<Gift className="h-7 w-7" />}
          title="Transferencias desactivadas"
          description="El negocio no tiene activadas las transferencias entre usuarios por ahora."
        />
      ) : fuentes.length === 0 ? (
        <EmptyState
          icon={<Gift className="h-7 w-7" />}
          title="No tienes usos para transferir"
          description="Necesitas una promoción activa con usos disponibles o lavados en tu membresía. Los beneficios gratis de campañas no son transferibles."
        />
      ) : (
        <EnviarRegaloForm fuentes={fuentes} />
      )}
    </div>
  )
}
