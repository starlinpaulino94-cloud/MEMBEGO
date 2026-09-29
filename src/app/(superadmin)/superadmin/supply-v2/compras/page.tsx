import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Card, CardContent } from '@/components/ui/card'
import { formatDate } from '@/lib/format'
import { NavSupplyV2 } from '@/components/supply-v2/nav'
import { ChipOrden } from '@/components/supply-v2/chips'
import { listarOrdenes } from '@/modules/supply-v2/procurement/queries'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Compras · Supply 2.0' }

function dinero(total: string, moneda: string): string {
  return `${moneda === 'DOP' ? 'RD$' : `${moneda} `}${Number(total).toLocaleString('es-DO', { minimumFractionDigits: 0 })}`
}

export default async function ComprasPage() {
  await requireRole('SUPERADMIN')
  const ordenes = await listarOrdenes()

  return (
    <div className="space-y-6">
      <PageHeader
        title="Compras"
        description="Órdenes de compra de Membego a sus proveedores, de la creación a la recepción."
        eyebrow="Supply 2.0"
        nav={<NavSupplyV2 activa="compras" />}
        action={
          <Button asChild>
            <Link href="/superadmin/supply-v2/compras/nueva" data-testid="btn-nueva-compra">+ Nueva compra</Link>
          </Button>
        }
      />

      {ordenes.length === 0 ? (
        <EmptyState
          variant="card"
          title="No hay compras"
          description="La primera compra crea el proveedor, el producto y el acuerdo por el camino si hace falta."
          action={
            <Button asChild>
              <Link href="/superadmin/supply-v2/compras/nueva">Nueva compra</Link>
            </Button>
          }
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-border" data-testid="lista-compras">
              {ordenes.map((o) => (
                <li key={o.id}>
                  <Link href={`/superadmin/supply-v2/compras/${o.id}`} className="flex flex-col gap-1 px-4 py-3 hover:bg-muted/50 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="font-medium">
                        {o.number} <span className="text-muted-foreground">· {o.proveedor}</span>
                      </p>
                      <p className="truncate text-caption text-muted-foreground">
                        {o.producto} · {o.recibidas.toLocaleString('es-DO')} / {o.compradas.toLocaleString('es-DO')} recibidas · {formatDate(o.createdAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-medium tabular-nums">{dinero(o.total, o.currency)}</span>
                      <ChipOrden estado={o.status} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
