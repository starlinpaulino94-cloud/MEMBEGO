import Link from 'next/link'
import { redirect } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { StatCard } from '@/components/ui/stat-card'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { formatDateTime } from '@/lib/format'
import { ChipVisita } from '@/components/visitas-membego/chips'
import { dineroVisita } from '@/components/visitas-membego/detalle-visita'
import { FUNCION_PORTAL, proveedorDeLaSesion } from '@/modules/supply-v2/permisos'
import { resumenDeExtrasDeLaEmpresa, visitasDeLaEmpresa } from '@/modules/visitas-membego/queries'
import { RUTA_PORTAL_ESCANER, RUTA_PORTAL_PROVEEDOR, RUTA_PORTAL_VENTAS_ADICIONALES } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Ventas adicionales · Proveedor Membego' }

const VENTANAS = [7, 30, 90] as const

/**
 * SUPPLIER & FULFILLMENT COMMERCE · Ventas adicionales del proveedor (§30):
 * las visitas atribuidas, lo que el cliente compró además de lo incluido
 * y la comisión de Membego solo sobre eso. Exige la función
 * `ventas_adicionales` del portal.
 */
export default async function VentasAdicionalesPage({ searchParams }: { searchParams: Promise<{ dias?: string; todas?: string }> }) {
  const proveedor = await proveedorDeLaSesion(FUNCION_PORTAL.ventas_adicionales)
  if (!proveedor) redirect(RUTA_PORTAL_PROVEEDOR)
  const sp = await searchParams
  const dias = VENTANAS.find((d) => String(d) === sp.dias) ?? 30
  const todas = sp.todas === '1'
  const [resumen, visitas] = await Promise.all([resumenDeExtrasDeLaEmpresa(proveedor.companyId, dias), visitasDeLaEmpresa(proveedor.companyId, { dias, soloConVentas: !todas })])
  const d = (n: string) => dineroVisita(n, resumen.currency)

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Ventas adicionales"
        description="Lo que los clientes de Membego te compraron además de lo incluido, visita por visita."
        eyebrow={<Link href={RUTA_PORTAL_PROVEEDOR} className="hover:underline">Proveedor Membego</Link>}
        action={<Button asChild><Link href={RUTA_PORTAL_ESCANER}>Escanear</Link></Button>}
      />
      <nav className="flex flex-wrap gap-1 text-sm" aria-label="Periodo">
        {VENTANAS.map((v) => (
          <Link key={v} href={`${RUTA_PORTAL_VENTAS_ADICIONALES}?dias=${v}${todas ? '&todas=1' : ''}`} className={`rounded-full px-3 py-1 ${v === dias ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`} aria-current={v === dias ? 'page' : undefined}>
            {v} días
          </Link>
        ))}
        <Link href={`${RUTA_PORTAL_VENTAS_ADICIONALES}?dias=${dias}${todas ? '' : '&todas=1'}`} className="ml-auto rounded-full px-3 py-1 text-muted-foreground hover:bg-muted">
          {todas ? 'Solo con compras' : 'Todas las visitas'}
        </Link>
      </nav>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Visitas" value={resumen.visitas} sub={`${resumen.conExtras} con compras`} />
        <StatCard label="Ventas adicionales" value={d(resumen.extrasTotal)} sub={`${resumen.ventas} ventas`} />
        <StatCard label="Comisión de Membego" value={d(resumen.comisionTotal)} sub="solo sobre extras" />
        <StatCard label="Confirmadas por clientes" value={resumen.confirmadas} sub={resumen.disputasAbiertas ? `${resumen.disputasAbiertas} en disputa` : 'sin disputas abiertas'} />
      </div>
      <Card>
        <CardContent className="pt-6">
          {visitas.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="sin-visitas">Sin visitas {todas ? '' : 'con compras adicionales '}en este periodo.</p>
          ) : (
            <ul className="divide-y divide-border text-sm" data-testid="visitas">
              {visitas.map((v) => (
                <li key={v.id} className="py-3" data-testid="visita-fila">
                  <Link href={`${RUTA_PORTAL_VENTAS_ADICIONALES}/${v.id}`} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <span>
                      <span className="font-mono text-caption text-muted-foreground">{formatDateTime(v.openedAt)} · {v.number}</span>
                      <span className="block font-medium">{v.cliente}{v.incluido ? ` · ${v.incluido}` : ''}</span>
                      <span className="block text-caption text-muted-foreground">
                        {v.ventas} venta(s) · extras {d(v.ancillaryTotal)} · comisión {d(v.commissionTotal)}
                        {v.customerConfirmedAt ? ' · confirmada por el cliente' : ''}
                        {v.disputasAbiertas ? ` · ${v.disputasAbiertas} reporte(s) abierto(s)` : ''}
                      </span>
                    </span>
                    <ChipVisita estado={v.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
