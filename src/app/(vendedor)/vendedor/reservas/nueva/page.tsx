import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { redirect } from 'next/navigation'
import { requireRole } from '@/lib/auth/guards'
import { vendedorDeUsuario } from '@/modules/excursiones/panel/queries'
import {
  excursionesReservables,
  clientesParaReserva,
} from '@/modules/excursiones/reservas/queries'
import { ReservaVendedorForm } from '@/components/vendedor/ReservaVendedorForm'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Nueva reserva · Panel Vendedor' }

export default async function NuevaReservaVendedorPage() {
  const user = await requireRole(['VENDEDOR'])
  const vendedor = user.metadata.dbUserId
    ? await vendedorDeUsuario(user.metadata.dbUserId)
    : null
  if (!vendedor) redirect('/login')

  const [excursiones, clientes] = await Promise.all([
    excursionesReservables(vendedor.companyId),
    clientesParaReserva(vendedor.companyId),
  ])

  return (
    <div className="space-y-6 w-full min-w-0 max-w-full">
      <div className="space-y-1 w-full min-w-0">
        <Link
          href="/vendedor/reservas"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors mb-2"
        >
          <ArrowLeft className="h-4 w-4 shrink-0" /> Volver a mis reservas
        </Link>
        <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold tracking-tight text-foreground truncate">
          Nueva reserva de excursión
        </h1>
        <p className="text-xs sm:text-sm text-muted-foreground">
          Crea una reserva rápida para un pasajero o agencia. Si el cliente no está registrado, se le creará su cuenta y pase digital automáticamente.
        </p>
      </div>

      <ReservaVendedorForm
        excursiones={excursiones}
        clientes={clientes}
        companyId={vendedor.companyId}
      />
    </div>
  )
}
