import Link from 'next/link'
import { Plus, Users } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { listadoVendedores } from '@/modules/excursiones/vendedores/queries'
import {
  ESTADO_VENDEDOR_LABEL,
  TONO_VENDEDOR,
  type EstadoVendedor,
} from '@/modules/excursiones/vendedores/nucleo'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'
import { StatusChip } from '@/components/ui/status-chip'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/system/EmptyState'

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
        <div className="overflow-x-auto rounded-2xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left text-caption uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3">Vendedor</th>
                <th className="px-4 py-3">Código</th>
                <th className="px-4 py-3">Tipo</th>
                <th className="px-4 py-3">Teléfono</th>
                <th className="px-4 py-3">Captados</th>
                <th className="px-4 py-3">Estado</th>
              </tr>
            </thead>
            <tbody>
              {vendedores.map((v) => (
                <tr key={v.id} className="border-b border-border last:border-0 hover:bg-muted/40">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/excursiones/vendedores/${v.id}`}
                      className="font-semibold text-foreground hover:text-primary hover:underline"
                    >
                      {v.nombre} {v.apellido ?? ''}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-mono text-foreground">{v.codigo}</td>
                  <td className="px-4 py-3 text-muted-foreground">{v.tipo ?? '—'}</td>
                  <td className="px-4 py-3 text-muted-foreground">{v.telefono ?? '—'}</td>
                  <td className="px-4 py-3 text-muted-foreground">{v._count.atribuciones}</td>
                  <td className="px-4 py-3">
                    <StatusChip tone={TONO_VENDEDOR[v.estado as EstadoVendedor] ?? 'neutral'}>
                      {ESTADO_VENDEDOR_LABEL[v.estado as EstadoVendedor] ?? v.estado}
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
