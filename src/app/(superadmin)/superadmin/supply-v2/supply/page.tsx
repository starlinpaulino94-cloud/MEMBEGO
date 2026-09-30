import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { formatDate, formatMoneyRD } from '@/lib/format'
import { NavSupplyV2 } from '@/components/supply-v2/nav'
import { supplyPorProducto } from '@/modules/supply-v2/pool/queries'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Supply · Supply 2.0' }

/**
 * MEMBEGO SUPPLY 2.0 · el pool agrupado por producto (§37). Los lotes
 * técnicos están un clic más adentro.
 */
export default async function SupplyPoolPage() {
  await requireRole('SUPERADMIN')
  const productos = await supplyPorProducto()

  return (
    <div className="space-y-6">
      <PageHeader
        title="Supply"
        description="Lo que Membego ya recibió y tiene disponible, agrupado por producto."
        eyebrow="Supply 2.0"
        nav={<NavSupplyV2 activa="supply" />}
        action={
          productos.length > 0 ? (
            <Button asChild>
              <Link href="/superadmin/supply-v2/ofertas/nueva" data-testid="btn-crear-oferta">Crear oferta</Link>
            </Button>
          ) : undefined
        }
      />

      {productos.length === 0 ? (
        <EmptyState
          variant="card"
          title="No hay Supply recibido todavía"
          description="Crea una compra y registra una recepción: cada recepción confirmada se convierte en supply disponible."
          action={
            <Button asChild>
              <Link href="/superadmin/supply-v2/compras/nueva">Nueva compra</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="pool-productos">
          {productos.map((p) => (
            <Card key={p.catalogItemId} data-testid="pool-producto">
              <CardContent className="space-y-3 pt-6">
                <div>
                  <p className="text-h4">{p.producto}</p>
                  <p className="text-caption text-muted-foreground">Proveedor: {p.proveedor}</p>
                </div>
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <dt className="text-muted-foreground">Disponibles</dt>
                    <dd className="text-h3 tabular-nums" data-testid="pool-disponibles">{p.disponibles.toLocaleString('es-DO')}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Valor adquirido disponible</dt>
                    <dd className="font-medium tabular-nums">{p.moneda === 'DOP' ? formatMoneyRD(p.valorDisponible) : `${p.moneda} ${p.valorDisponible.toLocaleString('es-DO')}`}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Recibidas</dt>
                    <dd className="tabular-nums">{p.recibidas.toLocaleString('es-DO')}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Asignadas</dt>
                    <dd className="tabular-nums" data-testid="pool-asignadas">{p.asignadas.toLocaleString('es-DO')}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Reservadas</dt>
                    <dd className="tabular-nums" data-testid="pool-reservadas">{p.reservadas.toLocaleString('es-DO')}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Emitidas</dt>
                    <dd className="tabular-nums" data-testid="pool-emitidas">{p.emitidas.toLocaleString('es-DO')}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Redimidas</dt>
                    <dd className="tabular-nums" data-testid="pool-redimidas">{p.redimidas.toLocaleString('es-DO')}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Lotes</dt>
                    <dd className="tabular-nums">{p.lotes}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Próximo vencimiento</dt>
                    <dd>{p.proximoVencimiento ? formatDate(p.proximoVencimiento) : '—'}</dd>
                  </div>
                </dl>
                <div className="flex flex-wrap gap-2">
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/superadmin/supply-v2/supply/${p.catalogItemId}`}>Ver lotes</Link>
                  </Button>
                  {p.disponibles > 0 && (
                    <Button asChild size="sm">
                      <Link href={`/superadmin/supply-v2/ofertas/nueva?producto=${p.catalogItemId}`} data-testid="btn-crear-oferta-producto">Crear oferta</Link>
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
