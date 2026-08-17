import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import {
  clientesParaReserva,
  excursionesReservables,
} from '@/modules/excursiones/reservas/queries'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'
import { ReservaForm } from '@/components/excursiones/ReservaForm'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Nueva reserva' }

export default async function NuevaReservaPage() {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = user.metadata.companyId
  if (!companyId) return <SinEmpresaActiva seccion="las reservas de excursiones" />

  const [clientes, excursiones] = await Promise.all([
    clientesParaReserva(companyId),
    excursionesReservables(companyId),
  ])

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link
        href="/admin/excursiones/reservas"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Reservas
      </Link>
      <h2 className="text-h2 text-foreground">Nueva reserva</h2>
      <ReservaForm clientes={clientes} excursiones={excursiones} />
    </div>
  )
}
