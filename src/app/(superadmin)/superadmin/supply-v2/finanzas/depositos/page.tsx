import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { TablaPaginacion } from '@/components/tablas/TablaPaginacion'
import { formatDate } from '@/lib/format'
import { leerPaginacion } from '@/lib/paginacion'
import { NavSupplyV2 } from '@/components/supply-v2/nav'
import { ChipDeposito } from '@/components/supply-v2/finanzas/chips'
import { listarDepositos } from '@/modules/supply-v2/finance/queries'
import { dineroSupplyV2, RUTA_FINANZAS } from '@/modules/supply-v2/core/catalogo'
import type { SupplyV2DepositStatus } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Depósitos · Supply 2.0' }

/** MEMBEGO SUPPLY 2.0 · depósitos a proveedores (§36). Un depósito nace de un pago confirmado marcado como anticipo. */
export default async function DepositosPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole('SUPERADMIN')
  const sp = await searchParams
  const proveedor = typeof sp.proveedor === 'string' ? sp.proveedor : ''
  const paginacion = leerPaginacion(sp)
  const { filas, total } = await listarDepositos({ supplierId: proveedor || null }, paginacion)
  return (
    <div className="space-y-6">
      <PageHeader
        title="Depósitos"
        description="Dinero adelantado a un proveedor a cuenta de compras futuras. Cada aplicación deja un movimiento; la suma de movimientos reconstruye el saldo."
        eyebrow={<Link href={RUTA_FINANZAS} className="hover:underline">Finanzas</Link>}
        nav={<NavSupplyV2 activa="finanzas" />}
        action={<Button asChild><Link href={`${RUTA_FINANZAS}/pagos/nuevo?destino=DEPOSITO`} data-testid="btn-nuevo-deposito">+ Registrar anticipo</Link></Button>}
      />
      {filas.length === 0 ? (
        <EmptyState variant="card" title="Sin depósitos" description="Registra un pago marcado como anticipo; al confirmarse nace el depósito." action={<Button asChild><Link href={`${RUTA_FINANZAS}/pagos/nuevo?destino=DEPOSITO`}>Registrar anticipo</Link></Button>} />
      ) : (
        <Card>
          <CardContent className="pt-6">
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="tabla-depositos">
                <thead className="text-left text-caption text-muted-foreground">
                  <tr><th className="py-1 pr-3">Depósito</th><th className="py-1 pr-3">Proveedor</th><th className="py-1 pr-3 text-right">Original</th><th className="py-1 pr-3 text-right">Disponible</th><th className="py-1 pr-3 text-right">Aplicado</th><th className="py-1 pr-3">Estado</th><th className="py-1">Fecha</th></tr>
                </thead>
                <tbody>
                  {filas.map((d) => (
                    <tr key={d.id} className="border-t border-border" data-testid="deposito">
                      <td className="py-2 pr-3 font-medium"><Link href={`${RUTA_FINANZAS}/depositos/${d.id}`} className="underline-offset-4 hover:underline">{d.number}</Link>{d.paymentNumber && <span className="block text-caption text-muted-foreground">de {d.paymentNumber}</span>}</td>
                      <td className="py-2 pr-3">{d.proveedor}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{dineroSupplyV2(d.originalAmount, d.currency)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums" data-testid="deposito-disponible">{dineroSupplyV2(d.availableAmount, d.currency)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{dineroSupplyV2(d.appliedAmount, d.currency)}</td>
                      <td className="py-2 pr-3"><ChipDeposito estado={d.status as SupplyV2DepositStatus} /></td>
                      <td className="py-2">{formatDate(d.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <TablaPaginacion paginacion={paginacion} total={total} params={sp} etiqueta="depósitos" />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
