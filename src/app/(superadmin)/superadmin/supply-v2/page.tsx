import Link from 'next/link'
import { Boxes, Coins, Handshake, ShoppingCart } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { StatCard } from '@/components/ui/stat-card'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { formatDateTime, formatMoneyRD } from '@/lib/format'
import { NavSupplyV2 } from '@/components/supply-v2/nav'
import { actividadRecienteSupplyV2, resumenSupplyV2 } from '@/modules/supply-v2/pool/queries'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Membego Supply 2.0' }

/**
 * MEMBEGO SUPPLY 2.0 · tablero (§24). Cuatro cifras y la actividad reciente.
 * Todo sale de la base; nada está escrito a mano.
 */
export default async function SupplyV2ResumenPage() {
  await requireRole('SUPERADMIN')
  const [resumen, actividad] = await Promise.all([resumenSupplyV2(), actividadRecienteSupplyV2(10)])
  const hayAlgo = resumen.proveedoresActivos > 0 || resumen.comprasAbiertas > 0 || resumen.unidadesRecibidas > 0

  return (
    <div className="space-y-6">
      <PageHeader
        title="Membego Supply 2.0"
        description="Proveedores, acuerdos, compras y recepciones: el supply que Membego adquiere, desde el proveedor hasta la unidad disponible."
        eyebrow="Plataforma"
        nav={<NavSupplyV2 activa="" />}
        action={
          <Button asChild size="lg">
            <Link href="/superadmin/supply-v2/compras/nueva" data-testid="btn-nueva-compra">+ Nueva compra</Link>
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Valor Supply disponible" value={<span data-testid="kpi-valor">{formatMoneyRD(resumen.valorDisponible)}</span>} sub="unidades disponibles × costo de compra" icon={Coins} accent="brand" />
        <StatCard label="Unidades disponibles" value={<span data-testid="kpi-unidades">{resumen.unidadesDisponibles.toLocaleString('es-DO')}</span>} sub={`${resumen.unidadesAsignadas.toLocaleString('es-DO')} en ofertas · ${resumen.unidadesEmitidas.toLocaleString('es-DO')} vendidas · ${resumen.unidadesRecibidas.toLocaleString('es-DO')} recibidas`} icon={Boxes} href="/superadmin/supply-v2/supply" hrefLabel="Ver el supply" />
        <StatCard label="Compras abiertas" value={<span data-testid="kpi-compras">{resumen.comprasAbiertas.toLocaleString('es-DO')}</span>} sub="borrador, pendientes o en recepción" icon={ShoppingCart} href="/superadmin/supply-v2/compras" hrefLabel="Ver las compras" />
        <StatCard label="Proveedores activos" value={<span data-testid="kpi-proveedores">{resumen.proveedoresActivos.toLocaleString('es-DO')}</span>} sub={`${resumen.ofertasActivas.toLocaleString('es-DO')} ofertas activas`} icon={Handshake} href="/superadmin/supply-v2/proveedores" hrefLabel="Ver los proveedores" />
      </div>

      {!hayAlgo ? (
        <EmptyState
          variant="card"
          title="Todavía no hay supply"
          description="Registra un proveedor, lo que vende y un acuerdo; compra una cantidad y recíbela. Todo empieza en «Nueva compra»."
          action={
            <Button asChild>
              <Link href="/superadmin/supply-v2/compras/nueva">Nueva compra</Link>
            </Button>
          }
          secondaryAction={
            <Link href="/superadmin/supply-v2/proveedores" className="text-sm font-medium underline-offset-4 hover:underline">
              Agregar primer proveedor
            </Link>
          }
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Actividad reciente</CardTitle>
          </CardHeader>
          <CardContent>
            {actividad.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin movimientos todavía.</p>
            ) : (
              <ul className="divide-y divide-border text-sm" data-testid="actividad-reciente">
                {actividad.map((a) => (
                  <li key={a.id} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-baseline sm:justify-between">
                    <Link href={a.href} className="font-medium underline-offset-4 hover:underline">
                      {a.titulo}
                    </Link>
                    <span className="text-caption text-muted-foreground">
                      {a.detalle && <>{a.detalle} · </>}
                      {formatDateTime(a.cuando)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
