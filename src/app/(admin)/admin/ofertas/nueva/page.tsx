import Link from 'next/link'
import { conEmpresaOTodas } from '@/lib/tenant'
import { ArrowLeft } from 'lucide-react'
import { ADMIN_ROLES } from '@/types'
import { requireRole } from '@/lib/auth/guards'
import { companyFilter } from '@/modules/admin/queries'
import { CrearOfertaForm } from '@/components/ofertas/CrearOfertaForm'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Crear regalo VIP' }

export default async function NuevaOfertaPage() {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = companyFilter(user) ?? user.metadata.companyId ?? null

  if (!companyId) {
    return <SinEmpresaActiva seccion="tus regalos VIP" />
  }

  const clientes = await conEmpresaOTodas(
    companyId,
    'ofertas · nueva: sin empresa activa es el superadmin, que cruza empresas a propósito',
    (tx) => tx.cliente.findMany({
      where: { companyId },
      select: { id: true, nombre: true, email: true, telefono: true },
      orderBy: { nombre: 'asc' },
      take: 1000,
    })
  )

  return (
    <div className="max-w-3xl space-y-6">
      <Link
        href="/admin/ofertas/vip"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Regalos VIP
      </Link>

      <div>
        <h1 className="text-2xl font-bold text-foreground">Crear regalo VIP</h1>
        <p className="text-muted-foreground">
          Define el regalo, su regla de usos y la lista cerrada de clientes.
          Al crearlo obtendrás el link privado para compartir.
        </p>
      </div>

      <CrearOfertaForm clientes={clientes} />
    </div>
  )
}
