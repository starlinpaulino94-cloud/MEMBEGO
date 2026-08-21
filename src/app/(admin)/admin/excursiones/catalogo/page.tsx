import Link from 'next/link'
import { Plus, Map } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { listadoExcursiones } from '@/modules/excursiones/catalogo/queries'
import {
  ESTADO_EXCURSION_LABEL,
  TONO_EXCURSION,
  type EstadoExcursion,
} from '@/modules/excursiones/catalogo/nucleo'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'
import { StatusChip } from '@/components/ui/status-chip'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/system/EmptyState'
import { formatMoney } from '@/lib/format'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Catálogo de excursiones' }

export default async function CatalogoPage() {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = user.metadata.companyId
  if (!companyId) return <SinEmpresaActiva seccion="el catálogo de excursiones" />

  const excursiones = await listadoExcursiones(companyId)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Lo que tu empresa vende: cada excursión con sus variantes, precios y horarios.
        </p>
        <Button asChild>
          <Link href="/admin/excursiones/catalogo/nueva">
            <Plus className="mr-1.5 h-4 w-4" /> Nueva excursión
          </Link>
        </Button>
      </div>

      {excursiones.length === 0 ? (
        <EmptyState
          icon={Map}
          title="Todavía no tienes excursiones"
          description="Crea tu primera excursión con su precio y sus horarios: es el catálogo sobre el que venderán tus vendedores."
          action={
            <Button asChild size="lg">
              <Link href="/admin/excursiones/catalogo/nueva">Crear excursión</Link>
            </Button>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left text-caption uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3">Excursión</th>
                <th className="px-4 py-3">Categoría</th>
                <th className="px-4 py-3">Desde</th>
                <th className="px-4 py-3">Variantes</th>
                <th className="px-4 py-3">Horarios</th>
                <th className="px-4 py-3">Estado</th>
              </tr>
            </thead>
            <tbody>
              {excursiones.map((e) => (
                <tr key={e.id} className="border-b border-border last:border-0 hover:bg-muted/40">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/excursiones/catalogo/${e.id}`}
                      className="font-semibold text-foreground hover:text-primary hover:underline"
                    >
                      {e.nombre}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{e.categoria ?? '—'}</td>
                  <td className="px-4 py-3 font-medium text-foreground">
                    {e.variantes[0] ? formatMoney(Number(e.variantes[0].precioAdulto), { moneda: e.moneda }, 2) : '—'}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{e._count.variantes}</td>
                  <td className="px-4 py-3 text-muted-foreground">{e._count.horarios}</td>
                  <td className="px-4 py-3">
                    <StatusChip tone={TONO_EXCURSION[e.estado as EstadoExcursion] ?? 'neutral'}>
                      {ESTADO_EXCURSION_LABEL[e.estado as EstadoExcursion] ?? e.estado}
                    </StatusChip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
