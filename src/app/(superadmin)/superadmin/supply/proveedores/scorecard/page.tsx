import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { sinEmpresa } from '@/lib/tenant'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { NavSupplyV2 } from '@/components/supply-v2/nav'
import { TablaScorecard } from '@/components/supply-v2/proveedores/tabla-scorecard'
import { scorecardDeProveedoresEnTx } from '@/modules/supply-v2/suppliers/scorecard'
import { BASE_SUPPLY_V2 } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Scorecard de proveedores · Supply' }

const VENTANAS = [7, 30, 90] as const

/**
 * SUPPLIER & FULFILLMENT COMMERCE · scorecard (§46–§49): números para
 * conversar con cada proveedor. Sin notas, sin sanciones automáticas.
 */
export default async function ScorecardPage({ searchParams }: { searchParams: Promise<{ dias?: string }> }) {
  await requireRole('SUPERADMIN')
  const sp = await searchParams
  const dias = VENTANAS.find((d) => String(d) === sp.dias) ?? 30
  const filas = await sinEmpresa('Supply: scorecard de proveedores', (tx) => scorecardDeProveedoresEnTx(tx, dias))
  const ruta = `${BASE_SUPPLY_V2}/proveedores/scorecard`

  return (
    <div className="space-y-6">
      <PageHeader
        title="Scorecard de proveedores"
        description="Canjes, incidencias, visitas, compras adicionales, confirmaciones y disputas por proveedor. Es información para conversar, no una calificación automática."
        eyebrow={<Link href={`${BASE_SUPPLY_V2}/proveedores`} className="hover:underline">Proveedores</Link>}
        nav={<NavSupplyV2 activa="proveedores" />}
      />
      <nav className="flex gap-1 text-sm" aria-label="Periodo">
        {VENTANAS.map((v) => (
          <Link key={v} href={`${ruta}?dias=${v}`} className={`rounded-full px-3 py-1 ${v === dias ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`} aria-current={v === dias ? 'page' : undefined}>{v} días</Link>
        ))}
      </nav>
      {filas.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground" data-testid="scorecard-vacio">Sin proveedores con acceso operativo.</p>
          </CardContent>
        </Card>
      ) : (
        <TablaScorecard filas={filas} />
      )}
    </div>
  )
}
