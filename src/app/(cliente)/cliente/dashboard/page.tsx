import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getClienteAllMemberships } from '@/modules/cliente/queries'
import { reservasCliente } from '@/modules/excursiones/reservas/queries'
import { DashboardClient } from './DashboardClient'

export const dynamic = 'force-dynamic'

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const user = await getUser()
  if (!user) redirect('/login')

  const { tab = 'membresias' } = await searchParams

  // Fetch data for all tabs (parallel)
  const [memberships, clienteIds] = await Promise.all([
    getClienteAllMemberships(user.supabaseId),
    prisma.cliente.findMany({
      where: { supabaseId: user.supabaseId },
      select: { id: true, companyId: true },
    }),
  ])

  let allReservas: Awaited<ReturnType<typeof reservasCliente>>[] = []
  if (clienteIds.length > 0) {
    allReservas = await Promise.all(
      clienteIds.map((c) => reservasCliente(c.companyId, c.id))
    )
  }

  const now = new Date()
  const reservas = allReservas.flat().sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())
  const proximas = reservas.filter((r) => new Date(r.fecha) >= now)
  const pasadas = reservas.filter((r) => new Date(r.fecha) < now)

  return (
    <DashboardClient
      initialTab={tab as 'membresias' | 'mis-excursiones' | 'buscar'}
      memberships={memberships}
      proximas={proximas}
      pasadas={pasadas}
      now={now}
    />
  )
}