import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Card, CardContent } from '@/components/ui/card'
import { formatDate } from '@/lib/format'
import { NavSupplyV2 } from '@/components/supply-v2/nav'
import { ChipOferta } from '@/components/supply-v2/chips'
import { ChipModelo } from '@/components/supply-v2/finanzas/chips'
import { AccionesOferta } from '@/components/supply-v2/acciones-oferta'
import { listarOfertas } from '@/modules/supply-v2/offers/queries'
import { sinEmpresa } from '@/lib/tenant'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Ofertas · Supply 2.0' }

function dinero(n: string, moneda: string): string {
  return `${moneda === 'DOP' ? 'RD$' : `${moneda} `}${Number(n).toLocaleString('es-DO', { minimumFractionDigits: 0 })}`
}

/** MEMBEGO SUPPLY 2.0 · listado de ofertas (§42–§43). */
export default async function OfertasPage() {
  await requireRole('SUPERADMIN')
  const [ofertas, pagosPendientes] = await Promise.all([
    listarOfertas(),
    sinEmpresa('Supply 2.0: pagos por revisar', (tx) => tx.supplyV2CustomerOrder.count({ where: { status: 'AWAITING_PAYMENT' } })),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ofertas"
        description="Supply que Membego pone a la venta con precio Membego: con supply adquirido (publicar aparta unidades) o a comisión (sin lote; el proveedor entrega y Membego le liquida el neto)."
        eyebrow="Supply 2.0"
        nav={<NavSupplyV2 activa="ofertas" />}
        action={
          <>
            <Button asChild variant="outline">
              <Link href="/superadmin/supply-v2/ofertas/ventas" data-testid="link-ventas">
                Ventas y cobros{pagosPendientes > 0 ? ` (${pagosPendientes} por revisar)` : ''}
              </Link>
            </Button>
            <Button asChild>
              <Link href="/superadmin/supply-v2/ofertas/nueva" data-testid="btn-crear-oferta">+ Crear oferta</Link>
            </Button>
          </>
        }
      />

      {ofertas.length === 0 ? (
        <EmptyState
          variant="card"
          title="No hay ofertas todavía"
          description="Usa Supply disponible para crear tu primera oferta."
          action={
            <Button asChild>
              <Link href="/superadmin/supply-v2/ofertas/nueva">Crear oferta</Link>
            </Button>
          }
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="tabla-ofertas">
                <thead className="text-left text-caption text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2">Oferta</th>
                    <th className="px-4 py-2">Proveedor · Producto</th>
                    <th className="px-4 py-2">Modelo</th>
                    <th className="px-4 py-2 text-right">Asignadas</th>
                    <th className="px-4 py-2 text-right">Vendidas</th>
                    <th className="px-4 py-2 text-right">Reservadas</th>
                    <th className="px-4 py-2 text-right">Disponibles</th>
                    <th className="px-4 py-2 text-right">Precio</th>
                    <th className="px-4 py-2">Estado</th>
                    <th className="px-4 py-2">Vigencia</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {ofertas.map((o) => (
                    <tr key={o.id} className="border-t border-border align-top">
                      <td className="px-4 py-2 font-medium">
                        <Link href={`/superadmin/supply-v2/ofertas/${o.id}`} className="underline-offset-4 hover:underline">{o.title}</Link>
                        <span className="block font-mono text-caption text-muted-foreground">{o.code}</span>
                      </td>
                      <td className="px-4 py-2">{o.proveedor}<span className="block text-caption text-muted-foreground">{o.producto}</span></td>
                      <td className="px-4 py-2"><ChipModelo fuente={o.sourceType} />{o.sourceType === 'COMMISSION' && <span className="block text-caption text-muted-foreground">{o.commissionPercentage} %</span>}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{o.sourceType === 'COMMISSION' && o.disponiblesComision === null ? '∞' : o.asignadas.toLocaleString('es-DO')}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{o.vendidas.toLocaleString('es-DO')}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{o.reservadas.toLocaleString('es-DO')}</td>
                      <td className="px-4 py-2 text-right tabular-nums" data-testid="oferta-disponibles">{o.sourceType === 'COMMISSION' && o.disponiblesComision === null ? 'Sin tope' : o.disponibles.toLocaleString('es-DO')}</td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {dinero(o.salePrice, o.currency)}
                        <span className="block text-caption text-muted-foreground line-through">{dinero(o.publicPrice, o.currency)}</span>
                      </td>
                      <td className="px-4 py-2"><ChipOferta estado={o.status} /></td>
                      <td className="px-4 py-2 text-caption">{formatDate(o.startsAt)}{o.endsAt ? ` → ${formatDate(o.endsAt)}` : ''}</td>
                      <td className="px-4 py-2">
                        <div className="flex flex-col items-start gap-1">
                          <Link href={`/superadmin/supply-v2/ofertas/${o.id}`} className="text-primary underline-offset-4 hover:underline">Ver</Link>
                          <AccionesOferta offerId={o.id} estado={o.status} compacto />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
