import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { getFicha } from '@/modules/carwash/mostrador'
import { getTiposVehiculo } from '@/modules/carwash/catalogo'
import { FichaCliente } from '@/components/carwash/FichaCliente'
import { PageHeader } from '@/components/ui/page-header'
import { ArrowLeft } from 'lucide-react'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Ficha del cliente' }

/** App Car Wash — ficha de un cliente con su historial de lavados. */
export default async function FichaClientePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = user.metadata.companyId as string | undefined
  const { id } = await params
  if (!companyId) {
    return <p className="text-muted-foreground">Tu cuenta no está vinculada a una empresa.</p>
  }

  // getFicha filtra por companyId: un cliente de otra empresa da 404.
  const [ficha, tipos] = await Promise.all([
    getFicha(companyId, id),
    getTiposVehiculo(companyId).catch(() => []),
  ])
  if (!ficha) notFound()

  return (
    <div className="space-y-6">
      <Link
        href="/admin/app/carwash/clientes"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Clientes
      </Link>

      <PageHeader
        title={ficha.nombre}
        description={
          [
            ficha.telefono,
            ficha.esLocal ? 'Cliente de mostrador (sin cuenta)' : 'Tiene cuenta en la plataforma',
          ]
            .filter(Boolean)
            .join(' · ')
        }
      />

      <FichaCliente ficha={ficha} tipos={tipos.map((t) => ({ id: t.id, nombre: t.nombre }))} />
    </div>
  )
}
