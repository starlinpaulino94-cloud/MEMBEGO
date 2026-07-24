import Link from 'next/link'
import Form from 'next/form'
import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { prisma } from '@/lib/prisma'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Car, Search } from 'lucide-react'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Vehículos' }

/**
 * App Car Wash · E3 — módulo VEHÍCULOS: la flota de los clientes con
 * búsqueda por placa/marca/modelo/dueño. Cada fila lleva a la ficha del
 * cliente (donde ya vive el CRM completo). Sin esquema nuevo: los vehículos
 * existen desde el registro; aquí ganan pantalla propia.
 */
export default async function VehiculosPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = user.metadata.companyId as string | undefined
  const { q } = await searchParams

  if (!companyId) {
    return <p className="text-muted-foreground">Tu cuenta no está vinculada a una empresa.</p>
  }

  const texto = (q ?? '').trim()
  const vehiculos = await prisma.vehiculo.findMany({
    where: {
      cliente: { companyId },
      ...(texto
        ? {
            OR: [
              { placa: { contains: texto, mode: 'insensitive' } },
              { marca: { contains: texto, mode: 'insensitive' } },
              { modelo: { contains: texto, mode: 'insensitive' } },
              { cliente: { nombre: { contains: texto, mode: 'insensitive' } } },
            ],
          }
        : {}),
    },
    include: {
      cliente: { select: { id: true, nombre: true, telefono: true } },
      _count: { select: { visits: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  return (
    <div className="space-y-6">
      <Link
        href="/admin/app/carwash"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Car Wash
      </Link>

      <PageHeader
        title="Vehículos"
        description="La flota de tus clientes: busca por placa, marca, modelo o dueño."
      />

      <Form
        action="/admin/app/carwash/vehiculos"
        className="flex flex-wrap items-center gap-3 rounded-2xl border border-border/70 bg-card p-4"
      >
        <div className="relative min-w-64 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input name="q" defaultValue={texto} placeholder="Placa, marca, modelo o cliente…" className="pl-9" />
        </div>
        <Button type="submit" variant="secondary">Buscar</Button>
        {texto && (
          <Button asChild variant="ghost">
            <Link href="/admin/app/carwash/vehiculos">Limpiar</Link>
          </Button>
        )}
      </Form>

      {vehiculos.length === 0 ? (
        <EmptyState
          icon={<Car className="h-7 w-7" />}
          title={texto ? 'Sin resultados' : 'Aún no hay vehículos registrados'}
          description="Los vehículos se registran con la cuenta del cliente o desde su ficha."
        />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border/70 bg-card">
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-semibold">Placa</th>
                <th className="px-4 py-3 font-semibold">Vehículo</th>
                <th className="px-4 py-3 font-semibold">Dueño</th>
                <th className="px-4 py-3 font-semibold">Visitas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {vehiculos.map((v) => (
                <tr key={v.id}>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs font-bold uppercase text-foreground">
                    {v.placa || '—'}
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-foreground">
                      {v.marca} {v.modelo}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {v.anio} · {v.color}
                    </p>
                  </td>
                  <td className="max-w-52 px-4 py-3">
                    <Link
                      href={`/admin/clientes/${v.cliente.id}`}
                      className="truncate font-medium text-primary hover:underline"
                    >
                      {v.cliente.nombre}
                    </Link>
                    <p className="truncate text-xs text-muted-foreground">
                      {v.cliente.telefono ?? '—'}
                    </p>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-muted-foreground">{v._count.visits}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {vehiculos.length === 100
          ? 'Mostrando los primeros 100 — usa el buscador para afinar.'
          : `${vehiculos.length} vehículo${vehiculos.length !== 1 ? 's' : ''}.`}
      </p>
    </div>
  )
}
