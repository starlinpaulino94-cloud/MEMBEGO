export const dynamic = 'force-dynamic'

import { requireRole } from '@/lib/auth/guards'
import { sinEmpresa } from '@/lib/tenant'
import { leerPaginacion } from '@/lib/paginacion'
import { TablaPaginacion } from '@/components/tablas/TablaPaginacion'
import { EstadoBadge } from '@/components/EstadoBadge'
import { membresiaEstadoUi } from '@/lib/estados'
import { formatDate } from '@/lib/format'
import { MembershipAdminActions } from '@/components/admin/MembershipAdminActions'
import { AjustarLavados } from '@/components/superadmin/AjustarLavados'
import type { MembershipEstado } from '@/types'

function fmtDate(d: Date | null) {
  if (!d) return '—'
  return formatDate(d)
}

const ESTADOS = ['PENDIENTE', 'PENDIENTE_PAGO', 'RECHAZADA', 'ACTIVA', 'VENCIDA', 'CANCELADA'] as const


export default async function SuperadminMembresiasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  await requireRole('SUPERADMIN')
  const sp = await searchParams
  const { estado, empresa, q } = sp
  const paginacion = leerPaginacion(sp)

  let companies: { id: string; name: string }[] = []
  let total = 0
  let membresias: {
    id: string
    estado: string
    fechaInicio: Date | null
    fechaVencimiento: Date | null
    lavadosRestantes: number
    clienteId: string
    cliente: { nombre: string; email: string; company: { name: string } }
    plan: { nombre: string; precio: unknown; lavadosIncluidos: number; esIlimitado: boolean }
  }[] = []

  try {
    companies = await sinEmpresa(
      'membresías globales: el superadmin las revisa a través de todas las empresas',
      (tx) => tx.company.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      })
    )
  } catch (e) {
    console.error('[superadmin-membresias] companies', e)
  }

  const where = {
    ...(estado ? { estado: estado as MembershipEstado } : {}),
    cliente: {
      ...(empresa ? { companyId: empresa } : {}),
      ...(q ? { OR: [{ nombre: { contains: q, mode: 'insensitive' as const } }, { email: { contains: q, mode: 'insensitive' as const } }] } : {}),
    },
  }

  try {
    const [data, cuenta] = await sinEmpresa(
      'membresías globales: el superadmin las revisa a través de todas las empresas',
      (tx) => Promise.all([
        tx.membership.findMany({
        where,
        select: {
          id: true,
          estado: true,
          fechaInicio: true,
          fechaVencimiento: true,
          lavadosRestantes: true,
          clienteId: true,
          plan: { select: { nombre: true, precio: true, lavadosIncluidos: true, esIlimitado: true } },
          cliente: {
            select: {
              nombre: true,
              email: true,
              company: { select: { name: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: paginacion.saltar,
        take: paginacion.tomar,
        }),
        tx.membership.count({ where }),
      ])
    )
    membresias = data
    total = cuenta
  } catch (e) {
    console.error('[superadmin-membresias]', e)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-h1 text-foreground">Solicitudes de membresía</h1>
        <p className="text-muted-foreground">Gestiona el estado de las membresías de clientes.</p>
      </div>

      {/* Filters */}
      <form className="flex flex-wrap gap-3">
        <input
          name="q"
          defaultValue={q}
          placeholder="Buscar cliente..."
          className="rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <select
          name="estado"
          defaultValue={estado ?? ''}
          className="rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">Todos los estados</option>
          {ESTADOS.map((e) => (
            <option key={e} value={e}>{membresiaEstadoUi(e).label}</option>
          ))}
        </select>
        <select
          name="empresa"
          defaultValue={empresa ?? ''}
          className="rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">Todas las empresas</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Filtrar
        </button>
      </form>

      <p className="text-small text-muted-foreground">{total.toLocaleString('es-DO')} resultado(s)</p>

      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted text-caption text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left">Cliente</th>
              <th className="px-4 py-3 text-left">Empresa</th>
              <th className="px-4 py-3 text-left">Plan</th>
              <th className="px-4 py-3 text-left">Lavados</th>
              <th className="px-4 py-3 text-left">Estado</th>
              <th className="px-4 py-3 text-left">Inicio</th>
              <th className="px-4 py-3 text-left">Vencimiento</th>
              <th className="px-4 py-3 text-left">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {membresias.map((m) => (
              <tr key={m.id} className="hover:bg-muted">
                <td className="px-4 py-3 font-medium text-foreground">
                  <div>{m.cliente.nombre}</div>
                  <div className="text-caption text-muted-foreground">{m.cliente.email}</div>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{m.cliente.company.name}</td>
                <td className="px-4 py-3 text-muted-foreground">{m.plan.nombre}</td>
                <td className="whitespace-nowrap px-4 py-3">
                  <AjustarLavados
                    membershipId={m.id}
                    lavados={m.lavadosRestantes}
                    esIlimitado={m.plan.esIlimitado}
                  />
                </td>
                <td className="px-4 py-3">
                  <EstadoBadge estado={m.estado as MembershipEstado} />
                </td>
                <td className="px-4 py-3 text-muted-foreground">{fmtDate(m.fechaInicio)}</td>
                <td className="px-4 py-3 text-muted-foreground">{fmtDate(m.fechaVencimiento)}</td>
                <td className="px-4 py-3">
                  <MembershipAdminActions
                    membershipId={m.id}
                    estado={m.estado as MembershipEstado}
                    clienteId={m.clienteId}
                    planPrecio={Number(m.plan.precio)}
                    planLavados={m.plan.lavadosIncluidos}
                    planEsIlimitado={m.plan.esIlimitado}
                  />
                </td>
              </tr>
            ))}
            {membresias.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                  No hay membresías.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {membresias.length > 0 && (
        <TablaPaginacion
          paginacion={paginacion}
          total={total}
          params={sp}
          etiqueta="membresías"
        />
      )}
    </div>
  )
}
