import Link from 'next/link'
import { redirect } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { StatCard } from '@/components/ui/stat-card'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDateTime } from '@/lib/format'
import { proveedorDeLaSesion } from '@/modules/supply-v2/permisos'
import { resumenVentasProveedor, ventasDelProveedor } from '@/modules/supply-v2/redemption/queries'
import { dineroSupplyV2, RUTA_PORTAL_LIQUIDACIONES, RUTA_PORTAL_PROVEEDOR, RUTA_PORTAL_VENTAS } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Ventas Membego' }

const FILTROS = [
  { v: 'TODAS', label: 'Todas' },
  { v: 'PENDIENTES', label: 'Pendientes de entregar' },
  { v: 'ENTREGADAS', label: 'Entregadas' },
] as const
const COBRO: Record<string, string> = { PENDIENTE: 'Pendiente de liquidar', LIQUIDADA: 'En liquidación', PARCIAL: 'Pagada en parte', PAGADA: 'Pagada' }
const ESTADO: Record<string, string> = { ACTIVE: 'Vendida, pendiente de entregar', REDEEMED: 'Entregada', EXPIRED: 'Venció sin entregarse', CANCELLED: 'Cancelada' }

/**
 * MEMBEGO SUPPLY · SLICE 5 · portal del proveedor: VENTAS MEMBEGO (§58–§60).
 * Lo que Membego vendió por su cuenta: valor contractual, neto que recibirá,
 * estado de entrega y de cobro. Nunca la comisión como margen de Membego ni
 * economía interna. Slice 6 (§32): si hubo beneficio, se separa lo que el
 * proveedor descontó (suyo) de lo que financió Membego (que no le rebaja nada).
 */
export default async function VentasProveedorPage({ searchParams }: { searchParams: Promise<{ filtro?: string }> }) {
  const proveedor = await proveedorDeLaSesion()
  if (!proveedor) redirect('/admin/dashboard')
  const sp = await searchParams
  const filtro = (FILTROS.find((f) => f.v === sp.filtro)?.v ?? 'TODAS') as 'TODAS' | 'PENDIENTES' | 'ENTREGADAS'
  const [r, ventas] = await Promise.all([resumenVentasProveedor(proveedor.supplierId), ventasDelProveedor(proveedor.supplierId, filtro)])
  return (
    <div className="space-y-6">
      <PageHeader
        title="Ventas Membego"
        description={`Lo que Membego vendió de ${proveedor.supplierName} a comisión: tú entregas, Membego te liquida el neto.`}
        eyebrow={<Link href={RUTA_PORTAL_PROVEEDOR} className="hover:underline">Entregas Membego</Link>}
        action={<Button asChild variant="outline"><Link href={RUTA_PORTAL_LIQUIDACIONES} data-testid="link-liquidaciones">Liquidaciones y pagos</Link></Button>}
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Pendientes de entregar" value={<span data-testid="ventas-pendientes">{r.pendientesDeEntrega.toLocaleString('es-DO')}</span>} sub="beneficios vendidos que aún no entregaste" accent="warning" />
        <StatCard label="Entregadas" value={<span data-testid="ventas-entregadas">{r.entregadas.toLocaleString('es-DO')}</span>} accent="success" />
        <StatCard label="Monto pendiente de pago" value={<span data-testid="ventas-monto-pendiente">{dineroSupplyV2(r.montoPendienteDePago, r.currency)}</span>} sub="neto por entregas hechas, aún no pagado" />
        <StatCard label="Pagado" value={<span data-testid="ventas-pagado">{dineroSupplyV2(r.montoPagado, r.currency)}</span>} sub={r.liquidacionesAbiertas > 0 ? `${r.liquidacionesAbiertas} liquidación(es) en curso` : 'histórico'} />
      </div>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Ventas</CardTitle>
          <nav className="flex flex-wrap gap-1 text-sm" aria-label="Filtro">
            {FILTROS.map((f) => (
              <Link key={f.v} href={f.v === 'TODAS' ? RUTA_PORTAL_VENTAS : `${RUTA_PORTAL_VENTAS}?filtro=${f.v}`} className={`rounded-full px-3 py-1 ${f.v === filtro ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`} aria-current={f.v === filtro ? 'page' : undefined}>{f.label}</Link>
            ))}
          </nav>
        </CardHeader>
        <CardContent>
          {ventas.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="ventas-vacias">Sin ventas a comisión en esta vista.</p>
          ) : (
            <ul className="divide-y divide-border text-sm" data-testid="ventas">
              {ventas.map((v) => (
                <li key={v.id} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between" data-testid="venta-proveedor">
                  <span>
                    <span className="font-mono text-caption text-muted-foreground">{formatDateTime(v.vendidoEl)} · {v.ofertaCodigo}</span>
                    <span className="block font-medium">{v.producto}</span>
                    <span className="block text-caption text-muted-foreground">{v.cliente} · {ESTADO[v.status]}{v.entregadaEl ? ` el ${formatDateTime(v.entregadaEl)}` : ''}{v.cobro ? ` · ${COBRO[v.cobro]}` : ''}{v.liquidacionNumero ? ` (${v.liquidacionNumero})` : ''}</span>
                  </span>
                  <span className="text-right tabular-nums">
                    <span className="block font-medium" data-testid="venta-neto">{dineroSupplyV2(v.neto, r.currency)}</span>
                    <span className="block text-caption text-muted-foreground" data-testid="venta-contractual">valor contractual {dineroSupplyV2(v.valorContractual, r.currency)}</span>
                    {Number(v.descuentoProveedor) > 0 && (
                      <span className="block text-caption text-muted-foreground" data-testid="venta-descuento-proveedor">incluye tu descuento de {dineroSupplyV2(v.descuentoProveedor, r.currency)}</span>
                    )}
                    {Number(v.bonoMembego) > 0 && (
                      <span className="block text-caption text-muted-foreground" data-testid="venta-bono-membego">Membego financió {dineroSupplyV2(v.bonoMembego, r.currency)}: no sale de tu neto</span>
                    )}
                    <span className="block text-caption text-muted-foreground">cliente pagó {dineroSupplyV2(v.bruto, r.currency)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
