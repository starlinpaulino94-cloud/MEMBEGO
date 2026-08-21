import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { redirect } from 'next/navigation'
import { requireRole } from '@/lib/auth/guards'
import { vendedorDeUsuario } from '@/modules/excursiones/panel/queries'
import { excursionesReservables } from '@/modules/excursiones/reservas/queries'
import { ReservaVendedorForm } from '@/components/vendedor/ReservaVendedorForm'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Nueva reserva' }

export default async function NuevaReservaVendedorPage() {
  const user = await requireRole(['VENDEDOR'])
  const vendedor = user.metadata.dbUserId
    ? await vendedorDeUsuario(user.metadata.dbUserId)
    : null
  if (!vendedor) redirect('/login')

  const excursiones = await excursionesReservables(vendedor.companyId)

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link
        href="/vendedor/reservas"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Mis Reservas
      </Link>
      <h2 className="text-h2 text-foreground">Nueva reserva para un cliente</h2>
      <p className="text-sm text-muted-foreground">
        Puedes ingresar el correo del cliente. Si no está registrado, se le creará una cuenta automáticamente y recibirá un enlace para acceder.
      </p>
      
      <ReservaVendedorForm excursiones={excursiones} companyId={vendedor.companyId} />
    </div>
  )
}
