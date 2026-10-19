import Link from 'next/link'
import { redirect } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDate, formatDateTime } from '@/lib/format'
import { proveedorDeLaSesion } from '@/modules/supply-v2/permisos'
import { inventarioDelProveedor, movimientosDelProveedor, MOVIMIENTO_LABELS, signoDeMovimiento } from '@/modules/supply-v2/portal/inventario'
import { CATALOG_ITEM_TYPE_LABELS, FULFILLMENT_BACKING_LABELS, RUTA_PORTAL_INVENTARIO, RUTA_PORTAL_PROVEEDOR } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Productos de Membego · Proveedor Membego' }

const n = (v: number) => v.toLocaleString('es-DO')

/**
 * SUPPLIER & FULFILLMENT COMMERCE · lo que Membego le compró al proveedor
 * (§9, §10): derechos por contrato, cubetas del ledger y movimientos. Una
 * columna en el teléfono; sin costos internos de Membego.
 */
export default async function InventarioProveedorPage({ searchParams }: { searchParams: Promise<{ producto?: string }> }) {
  const proveedor = await proveedorDeLaSesion()
  if (!proveedor) redirect(RUTA_PORTAL_PROVEEDOR)
  const sp = await searchParams
  const [filas, detalle] = await Promise.all([
    inventarioDelProveedor(proveedor.supplierId),
    sp.producto ? movimientosDelProveedor(proveedor.supplierId, sp.producto) : Promise.resolve(null),
  ])

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Productos de Membego"
        description="Unidades y derechos que Membego te compró. Los clientes los canjean contigo; aquí ves cuántos quedan."
        eyebrow={<Link href={RUTA_PORTAL_PROVEEDOR} className="hover:underline">Proveedor Membego</Link>}
      />

      {detalle && (
        <Card data-testid="movimientos">
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle>Movimientos · {detalle.producto}</CardTitle>
            <Link href={RUTA_PORTAL_INVENTARIO} className="text-sm underline-offset-4 hover:underline">Cerrar</Link>
          </CardHeader>
          <CardContent>
            {detalle.movimientos.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin movimientos todavía.</p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {detalle.movimientos.map((m) => (
                  <li key={m.id} className="flex items-start justify-between gap-3 py-2" data-testid="movimiento">
                    <span>
                      <span className="font-mono text-caption text-muted-foreground">{formatDateTime(m.createdAt)} · {m.lote}</span>
                      <span className="block font-medium">{MOVIMIENTO_LABELS[m.type]}</span>
                      {m.reason && <span className="block text-caption text-muted-foreground">{m.reason}</span>}
                    </span>
                    <span className="shrink-0 text-right tabular-nums">
                      <span className="font-mono font-medium">{signoDeMovimiento(m)}{n(m.quantity)}</span>
                      <span className="block text-caption text-muted-foreground">quedan {n(m.balanceAfter)} por vender</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {filas.length === 0 ? (
        <Card><CardContent className="pt-6 text-sm text-muted-foreground">Membego todavía no te ha comprado unidades.</CardContent></Card>
      ) : (
        <div className="grid gap-4" data-testid="inventario-proveedor">
          {filas.map((f) => (
            <Card key={f.catalogItemId} data-testid="inventario-producto">
              <CardHeader>
                <CardTitle>{f.producto}</CardTitle>
                <p className="text-caption text-muted-foreground">
                  {CATALOG_ITEM_TYPE_LABELS[f.tipo]} · {FULFILLMENT_BACKING_LABELS[f.backing]}
                  {f.contratos.length > 0 ? ` · Contrato${f.contratos.length > 1 ? 's' : ''}: ${f.contratos.map((c) => c.code).join(', ')}` : ''}
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                  <Dato label="Compradas" valor={n(f.compradas)} testId="compradas" />
                  <Dato label="Por vender" valor={n(f.porVender)} testId="por-vender" />
                  <Dato label="Reservadas" valor={n(f.reservadas)} testId="reservadas" />
                  <Dato label="Pendientes de entrega" valor={n(f.pendientesDeEntrega)} testId="pendientes" />
                  <Dato label="Canjeadas" valor={n(f.canjeadas)} testId="canjeadas" />
                  <Dato label="Vencidas / cerradas" valor={n(f.cerradas)} testId="cerradas" />
                </dl>
                {f.capacidadDiaria && (
                  <p className="text-sm" data-testid="capacidad-hoy">
                    Capacidad hoy: <strong>{n(f.capacidadDiaria.total)}</strong> · Usada: <strong>{n(f.capacidadDiaria.usada)}</strong> · Disponible: <strong>{n(f.capacidadDiaria.disponible)}</strong>
                  </p>
                )}
                <p className="text-caption text-muted-foreground">
                  {f.lotes} lote{f.lotes === 1 ? '' : 's'}
                  {f.proximoVencimiento ? ` · próximo vencimiento ${formatDate(f.proximoVencimiento)}` : ''}
                </p>
                <Link href={`${RUTA_PORTAL_INVENTARIO}?producto=${f.catalogItemId}`} className="text-sm underline-offset-4 hover:underline" data-testid="link-movimientos">Movimientos</Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

function Dato({ label, valor, testId }: { label: string; valor: string; testId: string }) {
  return (
    <div className="rounded-lg bg-muted/50 p-2">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums" data-testid={testId}>{valor}</dd>
    </div>
  )
}
