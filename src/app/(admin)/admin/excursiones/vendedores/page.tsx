import Link from 'next/link'
import { Plus, Users } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { listadoVendedores } from '@/modules/excursiones/vendedores/queries'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/system/EmptyState'
import { VendedoresLista } from '@/components/excursiones/VendedoresLista'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Vendedores' }

export default async function VendedoresPage() {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = user.metadata.companyId
  if (!companyId) return <SinEmpresaActiva seccion="los vendedores de excursiones" />

  const vendedores = await listadoVendedores(companyId)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Tu equipo comercial: cada vendedor con su código, su enlace y su QR. Los clientes
          que se registren por su QR quedan atribuidos a él.
        </p>
        <Button asChild>
          <Link href="/admin/excursiones/vendedores/nuevo">
            <Plus className="mr-1.5 h-4 w-4" /> Nuevo vendedor
          </Link>
        </Button>
      </div>

      {vendedores.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Todavía no tienes vendedores"
          description="Crea tu primer vendedor para comenzar a medir registros, ventas y comisiones. Al crearlo, MembeGo le genera su código, su enlace y su QR."
          action={
            <Button asChild size="lg">
              <Link href="/admin/excursiones/vendedores/nuevo">Crear vendedor</Link>
            </Button>
          }
        />
      ) : (
        <VendedoresLista vendedores={vendedores} />
      )}
    </div>
  )
}
