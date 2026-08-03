import Link from 'next/link'
import { ADMIN_ROLES } from '@/types'
import { requireRole } from '@/lib/auth/guards'
import { companyFilter } from '@/modules/admin/queries'
import { prisma } from '@/lib/prisma'
import { MembresíasTable, type MembershipRow } from '@/components/admin/MembresíasTable'
import type { PlanOption } from '@/components/admin/CambiarPlanDialog'
import { PageHeader } from '@/components/ui/page-header'
import { formatMoney } from '@/lib/format'
import type { MembershipEstado } from '@/types'

export const dynamic = 'force-dynamic'

const ESTADOS: MembershipEstado[] = ['ACTIVA', 'PENDIENTE', 'VENCIDA', 'CANCELADA']

const MAP_LABEL: Record<MembershipEstado, string> = {
  ACTIVA: 'Activas',
  PENDIENTE: 'Pendientes',
  PENDIENTE_PAGO: 'Pend. pago',
  RECHAZADA: 'Rechazadas',
  VENCIDA: 'Vencidas',
  CANCELADA: 'Canceladas',
}

function FilterLink({
  label,
  href,
  active,
}: {
  label: string
  href: string
  active: boolean
}) {
  return (
    <Link
      href={href}
      className={
        active
          ? 'rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground'
          : 'rounded-full border border-border bg-card px-4 py-1.5 text-sm text-muted-foreground hover:bg-muted'
      }
    >
      {label}
    </Link>
  )
}

export default async function MembresiasPage({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string }>
}) {
  const user = await requireRole(ADMIN_ROLES)
  const { estado } = await searchParams
  const companyId = companyFilter(user)

  const estadoFilter =
    estado && ESTADOS.includes(estado as MembershipEstado)
      ? (estado as MembershipEstado)
      : undefined

  let memberships: MembershipRow[] = []
  let planes: PlanOption[] = []
  try {
    const [data, planesData] = await Promise.all([
      prisma.membership.findMany({
        where: {
          ...(companyId ? { cliente: { companyId } } : {}),
          ...(estadoFilter ? { estado: estadoFilter } : {}),
        },
        include: { plan: true, cliente: true },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
      // Planes activos de la empresa para el cambio de plan directo por el
      // admin (política: el cliente no puede cambiar su plan desde la app).
      prisma.plan.findMany({
        where: { ...(companyId ? { companyId } : {}), activo: true },
        orderBy: [{ orden: 'asc' }, { precio: 'asc' }],
        select: { id: true, nombre: true, precio: true },
      }),
    ])
    memberships = data as unknown as MembershipRow[]
    planes = planesData.map((p) => ({
      id: p.id,
      nombre: p.nombre,
      precioLabel: formatMoney(Number(p.precio)),
    }))
  } catch (e) {
    console.error('[admin-membresias]', e)
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Membresías" description={`${memberships.length} registros`} />

      <div className="flex flex-wrap gap-2">
        <FilterLink label="Todas" href="/admin/membresias" active={!estadoFilter} />
        {ESTADOS.map((e) => (
          <FilterLink
            key={e}
            label={MAP_LABEL[e]}
            href={`/admin/membresias?estado=${e}`}
            active={estadoFilter === e}
          />
        ))}
      </div>

      <MembresíasTable data={memberships} planes={planes} />
    </div>
  )
}
