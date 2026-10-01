import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ScanLine } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { StatCard } from '@/components/ui/stat-card'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDateTime } from '@/lib/format'
import { ChipRedencion } from '@/components/supply-v2/chips'
import { proveedorDeLaSesion } from '@/modules/supply-v2/permisos'
import { entregasDelProveedor, incidenciasDelProveedor, resumenProveedor, resumenVentasProveedor, type VentanaDias } from '@/modules/supply-v2/redemption/queries'
import { dineroSupplyV2, INCIDENT_TYPE_LABELS, RUTA_PORTAL_LIQUIDACIONES, RUTA_PORTAL_PROVEEDOR, RUTA_PORTAL_VENTAS } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Entregas Membego' }

const VENTANAS: { dias: VentanaDias; label: string }[] = [
  { dias: 0, label: 'Hoy' },
  { dias: 7, label: '7 días' },
  { dias: 30, label: '30 días' },
]

/**
 * MEMBEGO SUPPLY 2.0 · portal del proveedor (§14, §35, §66). Sin finanzas
 * internas de Membego: entregas, pendientes e incidencias, nada más.
 */
export default async function PortalProveedorPage({ searchParams }: { searchParams: Promise<{ dias?: string }> }) {
  const proveedor = await proveedorDeLaSesion()
  if (!proveedor) redirect('/admin/dashboard')
  const sp = await searchParams
  const dias = (([0, 7, 30] as VentanaDias[]).find((d) => String(d) === sp.dias) ?? 0) as VentanaDias
  const [resumen, entregas, incidencias, ventas] = await Promise.all([
    resumenProveedor(proveedor.supplierId),
    entregasDelProveedor(proveedor.supplierId, dias),
    incidenciasDelProveedor(proveedor.supplierId, dias),
    resumenVentasProveedor(proveedor.supplierId),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Entregas Membego"
        description={`Beneficios que los clientes compraron a Membego y ${proveedor.supplierName} entrega. Escanea el QR del cliente y confirma.`}
        eyebrow="Membego Supply"
        action={
          <Button asChild size="lg">
            <Link href={`${RUTA_PORTAL_PROVEEDOR}/escaner`} data-testid="btn-escanear">
              <ScanLine className="mr-2 size-4" aria-hidden />
              Escanear beneficio
            </Link>
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Entregas de hoy" value={<span data-testid="entregas-hoy">{resumen.entregasHoy.toLocaleString('es-DO')}</span>} accent="success" />
        <StatCard label="Pendientes de entregar" value={<span data-testid="pendientes">{resumen.pendientes.toLocaleString('es-DO')}</span>} sub="beneficios vendidos que aún no se han usado" />
        <StatCard label="Incidencias de hoy" value={<span data-testid="incidencias-hoy">{resumen.incidenciasHoy.toLocaleString('es-DO')}</span>} />
      </div>

      <Card data-testid="portal-ventas-membego">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Ventas Membego (a comisión)</CardTitle>
          <div className="flex gap-2 text-sm">
            <Link href={RUTA_PORTAL_VENTAS} className="underline-offset-4 hover:underline" data-testid="link-portal-ventas">Ver ventas</Link>
            <Link href={RUTA_PORTAL_LIQUIDACIONES} className="underline-offset-4 hover:underline" data-testid="link-portal-liquidaciones">Liquidaciones</Link>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Pendientes de entregar" value={<span data-testid="portal-ventas-pendientes">{ventas.pendientesDeEntrega.toLocaleString('es-DO')}</span>} />
            <StatCard label="Entregadas" value={<span data-testid="portal-ventas-entregadas">{ventas.entregadas.toLocaleString('es-DO')}</span>} />
            <StatCard label="Monto pendiente de pago" value={<span data-testid="portal-ventas-pendiente-pago">{dineroSupplyV2(ventas.montoPendienteDePago, ventas.currency)}</span>} sub="neto por entregas hechas" />
            <StatCard label="Pagado" value={<span data-testid="portal-ventas-pagado">{dineroSupplyV2(ventas.montoPagado, ventas.currency)}</span>} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Entregas</CardTitle>
          <nav className="flex gap-1 text-sm" aria-label="Periodo">
            {VENTANAS.map((v) => (
              <Link
                key={v.dias}
                href={v.dias === 0 ? RUTA_PORTAL_PROVEEDOR : `${RUTA_PORTAL_PROVEEDOR}?dias=${v.dias}`}
                className={`rounded-full px-3 py-1 ${v.dias === dias ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
                aria-current={v.dias === dias ? 'page' : undefined}
              >
                {v.label}
              </Link>
            ))}
          </nav>
        </CardHeader>
        <CardContent>
          {entregas.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin entregas en este periodo.</p>
          ) : (
            <ul className="divide-y divide-border text-sm" data-testid="entregas">
              {entregas.map((e) => (
                <li key={e.id} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between" data-testid="entrega">
                  <span>
                    <span className="font-mono text-caption text-muted-foreground">{formatDateTime(e.redeemedAt)}</span>
                    <span className="block font-medium">{e.producto}</span>
                    <span className="block text-caption text-muted-foreground">
                      {e.cliente} · entregado por {e.empleado}
                      {e.sucursal ? ` · ${e.sucursal}` : ''}
                    </span>
                  </span>
                  <ChipRedencion reversada={e.reversada} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Incidencias</CardTitle></CardHeader>
        <CardContent>
          {incidencias.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin incidencias en este periodo.</p>
          ) : (
            <ul className="divide-y divide-border text-sm" data-testid="incidencias">
              {incidencias.map((i) => (
                <li key={i.id} className="py-2">
                  <span className="font-mono text-caption text-muted-foreground">{formatDateTime(i.createdAt)}</span>
                  <span className="block font-medium">{INCIDENT_TYPE_LABELS[i.type as keyof typeof INCIDENT_TYPE_LABELS] ?? i.type}</span>
                  <span className="block text-caption text-muted-foreground">
                    {i.empleado}
                    {i.sucursal ? ` · ${i.sucursal}` : ''}
                    {i.notes ? ` · ${i.notes}` : ''}
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
