import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { sinEmpresa } from '@/lib/tenant'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { StatusChip } from '@/components/ui/status-chip'
import { NavSupplyV2 } from '@/components/supply-v2/nav'
import { dineroVisita } from '@/components/visitas-membego/detalle-visita'
import { scorecardDeProveedoresEnTx } from '@/modules/supply-v2/suppliers/scorecard'
import { ACCESS_STATUS_LABELS } from '@/modules/supply-v2/suppliers/acceso-dominio'
import { BASE_SUPPLY_V2 } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Scorecard de proveedores · Supply' }

const VENTANAS = [7, 30, 90] as const
const pct = (f: number | null) => (f == null ? '—' : `${Math.round(f * 100)} %`)

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
      <Card>
        <CardContent className="pt-6">
          {filas.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="scorecard-vacio">Sin proveedores con acceso operativo.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="scorecard">
                <thead className="text-left text-caption uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-3">Proveedor</th>
                    <th className="py-2 pr-3">Acceso</th>
                    <th className="py-2 pr-3 text-right">Canjes</th>
                    <th className="py-2 pr-3 text-right">Reversas</th>
                    <th className="py-2 pr-3 text-right">Incidencias</th>
                    <th className="py-2 pr-3 text-right">Visitas</th>
                    <th className="py-2 pr-3 text-right">Con extras</th>
                    <th className="py-2 pr-3 text-right">Extras</th>
                    <th className="py-2 pr-3 text-right">Comisión</th>
                    <th className="py-2 pr-3 text-right">Confirmación</th>
                    <th className="py-2 pr-3 text-right">Disputas</th>
                    <th className="py-2 text-right">Min/visita</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filas.map((f) => (
                    <tr key={f.supplierId} data-testid="scorecard-fila">
                      <td className="py-2 pr-3 font-medium"><Link href={`${BASE_SUPPLY_V2}/proveedores/${f.supplierId}`} className="hover:underline">{f.proveedor}</Link></td>
                      <td className="py-2 pr-3"><StatusChip tone={f.accessStatus === 'ACTIVE' ? 'success' : f.accessStatus === 'SUSPENDED' || f.accessStatus === 'TERMINATED' ? 'danger' : 'warning'}>{ACCESS_STATUS_LABELS[f.accessStatus as keyof typeof ACCESS_STATUS_LABELS] ?? f.accessStatus}</StatusChip></td>
                      <td className="py-2 pr-3 text-right tabular-nums">{f.redenciones}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{f.reversadas}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{f.incidencias}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{f.visitas}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{f.visitasConExtras} <span className="text-caption text-muted-foreground">({pct(f.tasaDeExtras)})</span></td>
                      <td className="py-2 pr-3 text-right tabular-nums">{dineroVisita(f.extrasTotal)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{dineroVisita(f.comisionTotal)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{f.confirmadasPorCliente}/{f.ventasAdicionales} <span className="text-caption text-muted-foreground">({pct(f.tasaDeConfirmacion)})</span></td>
                      <td className="py-2 pr-3 text-right tabular-nums">{f.disputas}{f.disputasAFavorDelCliente ? <span className="text-caption text-warning"> ({f.disputasAFavorDelCliente} a favor del cliente)</span> : null}</td>
                      <td className="py-2 text-right tabular-nums">{f.minutosPromedioDeVisita ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
