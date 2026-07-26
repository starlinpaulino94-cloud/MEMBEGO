import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { tieneCapacidad } from '@/modules/capacidades/resolver'
import {
  getInventario,
  getMovimientosRecientes,
  esStockBajo,
  MOV_TIPO_LABELS,
  type MovTipo,
} from '@/modules/carwash/inventario'
import { ProductoForm } from '@/components/carwash/ProductoForm'
import { MovimientoForm } from '@/components/carwash/MovimientoForm'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { ArrowLeft, PackageSearch, Pencil, TriangleAlert } from 'lucide-react'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Inventario' }

function fmtCant(n: number) {
  return new Intl.NumberFormat('es-DO', { maximumFractionDigits: 2 }).format(n)
}

/**
 * App Car Wash · E5 — INVENTARIO: productos con stock, alerta de mínimos y
 * movimientos auditados. Capacidad INVENTARIO (nace apagada).
 */
export default async function InventarioPage({
  searchParams,
}: {
  searchParams: Promise<{ editar?: string }>
}) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = user.metadata.companyId as string | undefined
  const { editar } = await searchParams
  if (!companyId) {
    return <p className="text-muted-foreground">Tu cuenta no está vinculada a una empresa.</p>
  }

  const volver = (
    <Link
      href="/admin/app/carwash"
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" /> Car Wash
    </Link>
  )

  if (!(await tieneCapacidad(companyId, 'INVENTARIO'))) {
    return (
      <div className="space-y-6">
        {volver}
        <EmptyState
          icon={<PackageSearch className="h-7 w-7" />}
          title="El inventario está apagado"
          description="Este módulo se activa por empresa desde el panel de capacidades (superadmin)."
        />
      </div>
    )
  }

  let productos: Awaited<ReturnType<typeof getInventario>> | null = null
  let movimientos: Awaited<ReturnType<typeof getMovimientosRecientes>> = []
  try {
    ;[productos, movimientos] = await Promise.all([
      getInventario(companyId),
      getMovimientosRecientes(companyId),
    ])
  } catch (e) {
    console.error('[inventario] cargar:', e)
  }

  if (!productos) {
    return (
      <div className="space-y-6">
        {volver}
        <EmptyState
          icon={<PackageSearch className="h-7 w-7" />}
          title="No se pudo cargar el inventario"
          description="Si acabas de instalar esta versión, corre la migración 20260759_e5_carwash en la base de datos."
        />
      </div>
    )
  }

  const activos = productos.filter((p) => p.activo)
  const bajos = activos.filter((p) => esStockBajo(p.stock, p.stockMinimo))
  const productoEditar = editar ? productos.find((p) => p.id === editar) : undefined

  return (
    <div className="space-y-6">
      {volver}
      <PageHeader
        title="Inventario"
        description="Productos e insumos del negocio: cada movimiento queda registrado con su motivo."
      />

      <dl className="grid grid-cols-2 gap-3 sm:max-w-md">
        <div className="rounded-2xl border border-border/70 bg-card p-4">
          <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Productos activos
          </dt>
          <dd className="mt-1 text-lg font-bold tabular-nums text-foreground">{activos.length}</dd>
        </div>
        <div className="rounded-2xl border border-border/70 bg-card p-4">
          <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Stock bajo</dt>
          <dd
            className={`mt-1 text-lg font-bold tabular-nums ${
              bajos.length > 0 ? 'text-destructive' : 'text-foreground'
            }`}
          >
            {bajos.length}
          </dd>
        </div>
      </dl>

      {productoEditar ? <ProductoForm producto={productoEditar} /> : <ProductoForm />}

      {productos.length === 0 ? (
        <EmptyState
          icon={<PackageSearch className="h-7 w-7" />}
          title="Aún no hay productos"
          description="Crea el primero con «Nuevo producto»: químicos, ceras, toallas, lo que uses en pista."
        />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border/70 bg-card">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-semibold">Producto</th>
                <th className="px-4 py-3 font-semibold">Stock</th>
                <th className="px-4 py-3 font-semibold">Mínimo</th>
                <th className="px-4 py-3 font-semibold">Movimiento rápido</th>
                <th className="px-4 py-3 font-semibold"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {productos.map((p) => {
                const bajo = p.activo && esStockBajo(p.stock, p.stockMinimo)
                return (
                  <tr key={p.id} className={p.activo ? '' : 'opacity-50'}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-foreground">
                        {p.nombre}
                        {!p.activo && (
                          <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">
                            inactivo
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {p.categoria ?? 'Sin categoría'}
                        {p.costo != null ? ` · RD$${fmtCant(p.costo)}` : ''}
                      </p>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span
                        className={`font-bold tabular-nums ${bajo ? 'text-destructive' : 'text-foreground'}`}
                      >
                        {fmtCant(p.stock)}
                      </span>{' '}
                      <span className="text-xs text-muted-foreground">{p.unidad}</span>
                      {bajo && (
                        <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-bold uppercase text-destructive">
                          <TriangleAlert className="h-3 w-3" /> bajo
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums text-muted-foreground">
                      {fmtCant(p.stockMinimo)}
                    </td>
                    <td className="px-4 py-3">
                      {p.activo && <MovimientoForm productoId={p.id} />}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/admin/app/carwash/inventario?editar=${p.id}`}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                      >
                        <Pencil className="h-3.5 w-3.5" /> Editar
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {movimientos.length > 0 && (
        <section className="rounded-2xl border border-border/70 bg-card p-4">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted-foreground">
            Últimos movimientos
          </h2>
          <ul className="divide-y divide-border/50">
            {movimientos.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="font-medium text-foreground">
                    {MOV_TIPO_LABELS[m.tipo as MovTipo] ?? m.tipo} · {m.producto}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {new Intl.DateTimeFormat('es-DO', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    }).format(m.createdAt)}
                    {m.registradoPor ? ` · ${m.registradoPor}` : ''}
                    {m.motivo ? ` · ${m.motivo}` : ''}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-bold tabular-nums text-foreground">
                  {m.tipo === 'SALIDA' ? '−' : m.tipo === 'ENTRADA' ? '+' : '='}
                  {fmtCant(m.cantidad)} → {fmtCant(m.stockResultante)} {m.unidad}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
