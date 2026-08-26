import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import {
  clientesParaReserva,
  excursionesReservables,
} from '@/modules/excursiones/reservas/queries'
import { listadoVendedores } from '@/modules/excursiones/vendedores/queries'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'
import { ReservaForm } from '@/components/excursiones/ReservaForm'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Nueva reserva · Panel Administración' }

export default async function NuevaReservaPage() {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = user.metadata.companyId
  if (!companyId) return <SinEmpresaActiva seccion="las reservas de excursiones" />

  const [clientes, excursiones, vendedores] = await Promise.all([
    clientesParaReserva(companyId),
    excursionesReservables(companyId),
    listadoVendedores(companyId),
  ])

  return (
    <div className="space-y-6 w-full min-w-0 max-w-full">
      <div className="space-y-1 w-full min-w-0">
        <Link
          href="/admin/excursiones/reservas"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors mb-2"
        >
          <ArrowLeft className="h-4 w-4 shrink-0" /> Volver a reservas
        </Link>
        <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold tracking-tight text-foreground truncate">
          Nueva reserva de excursión
        </h1>
        <p className="text-xs sm:text-sm text-muted-foreground">
          Crea una reserva para un cliente existente o nuevo. Si el cliente no está registrado en el negocio, se creará su ficha y pase digital automáticamente.
        </p>
      </div>

      <ReservaForm
        clientes={clientes}
        excursiones={excursiones}
        vendedores={vendedores}
        companyId={companyId}
      />
    </div>
  )
}
