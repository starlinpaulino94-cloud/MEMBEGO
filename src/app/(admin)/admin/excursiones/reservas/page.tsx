import Link from 'next/link'
import { Plus, CalendarCheck } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { listadoReservas } from '@/modules/excursiones/reservas/queries'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/system/EmptyState'
import { ReservasLista } from '@/components/excursiones/ReservasLista'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Reservas' }

export default async function ReservasPage() {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = user.metadata.companyId
  if (!companyId) return <SinEmpresaActiva seccion="las reservas de excursiones" />

  const reservas = await listadoReservas(companyId)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Cada reserva congela su precio y su vendedor al crearse: lo que se cobre después no
          cambia lo que ya se pactó.
        </p>
        <Button asChild>
          <Link href="/admin/excursiones/reservas/nueva">
            <Plus className="mr-1.5 h-4 w-4" /> Nueva reserva
          </Link>
        </Button>
      </div>

      {reservas.length === 0 ? (
        <EmptyState
          icon={CalendarCheck}
          title="Todavía no hay reservas"
          description="Crea la primera reserva: elige el cliente, la excursión y la fecha. MembeGo calcula el total con los precios del catálogo y le pone su número."
          action={
            <Button asChild size="lg">
              <Link href="/admin/excursiones/reservas/nueva">Crear reserva</Link>
            </Button>
          }
        />
      ) : (
        <ReservasLista reservas={reservas} />
      )}
    </div>
  )
}
