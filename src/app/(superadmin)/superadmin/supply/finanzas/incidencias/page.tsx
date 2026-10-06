import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { TablaPaginacion } from '@/components/tablas/TablaPaginacion'
import { formatDateTime } from '@/lib/format'
import { leerPaginacion } from '@/lib/paginacion'
import { NavSupplyV2 } from '@/components/supply-v2/nav'
import { ResolverIncidencia } from '@/components/supply-v2/finanzas/form-liquidacion'
import { listarIncidenciasFinancieras } from '@/modules/supply-v2/finance/queries'
import { puedeSupplyV2 } from '@/modules/supply-v2/permisos'
import { dineroSupplyV2, FINANCE_INCIDENT_STATUS_LABELS, FINANCE_INCIDENT_TYPE_LABELS, RUTA_FINANZAS, RUTA_LIQUIDACIONES } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Incidencias financieras · Supply' }

/** MEMBEGO SUPPLY · SLICE 5 · incidencias financieras (§33): lo que no se deshace en silencio. */
export default async function IncidenciasPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole('SUPERADMIN')
  const sp = await searchParams
  const estado = sp.estado === 'RESOLVED' ? 'RESOLVED' : sp.estado === 'TODAS' ? null : 'OPEN'
  const paginacion = leerPaginacion(sp)
  const [{ filas, total }, puedo] = await Promise.all([listarIncidenciasFinancieras({ status: estado }, paginacion), puedeSupplyV2('SUPPLY_V2_SETTLEMENT_APPROVE')])
  return (
    <div className="space-y-6">
      <PageHeader title="Incidencias financieras" description="Una entrega reversada cuyo neto ya se había pagado no se deshace sola: queda aquí hasta que alguien explique cómo se resolvió (nota de crédito, descuento en la próxima liquidación…)." eyebrow={<Link href={RUTA_FINANZAS} className="hover:underline">Finanzas</Link>} nav={<NavSupplyV2 activa="finanzas" />} />
      <nav className="flex gap-2 text-sm" aria-label="Estado">
        {[['OPEN', 'Abiertas'], ['RESOLVED', 'Resueltas'], ['TODAS', 'Todas']].map(([v, l]) => (
          <Link key={v} href={`${RUTA_FINANZAS}/incidencias?estado=${v}`} className={`rounded-full border px-3 py-1 ${(estado ?? 'TODAS') === v ? 'border-primary bg-primary/10 text-primary' : 'border-border'}`}>{l}</Link>
        ))}
      </nav>
      {filas.length === 0 ? (
        <EmptyState variant="card" title="Sin incidencias" description={estado === 'OPEN' ? 'No hay nada pendiente de resolver.' : 'Ninguna incidencia con este filtro.'} />
      ) : (
        <Card>
          <CardContent className="pt-6">
            <ul className="divide-y divide-border text-sm" data-testid="incidencias-financieras">
              {filas.map((i) => (
                <li key={i.id} className="space-y-2 py-3" data-testid="incidencia-financiera">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="font-medium">{FINANCE_INCIDENT_TYPE_LABELS[i.type]} · {dineroSupplyV2(i.amount, i.currency)}</p>
                      <p className="text-caption text-muted-foreground">
                        {i.proveedor} · {formatDateTime(i.createdAt)}
                        {i.obligationId ? <> · <Link href={`${RUTA_FINANZAS}/obligaciones`} className="underline-offset-4 hover:underline">{i.obligationNumber}</Link></> : null}
                        {i.settlementId ? <> · <Link href={`${RUTA_LIQUIDACIONES}/${i.settlementId}`} className="underline-offset-4 hover:underline">liquidación</Link></> : null}
                        {i.redemptionId ? <> · <Link href={`/superadmin/supply/redenciones/${i.redemptionId}`} className="underline-offset-4 hover:underline">entrega</Link></> : null}
                      </p>
                      <p className="text-sm">{i.notes}</p>
                      {i.status === 'RESOLVED' && <p className="text-caption text-muted-foreground">Resuelta por {i.resueltoPor ?? '—'}{i.resolvedAt ? ` el ${formatDateTime(i.resolvedAt)}` : ''}: {i.resolutionNotes}</p>}
                    </div>
                    <span className="text-caption">{FINANCE_INCIDENT_STATUS_LABELS[i.status]}</span>
                  </div>
                  {puedo && i.status === 'OPEN' && <ResolverIncidencia incidentId={i.id} />}
                </li>
              ))}
            </ul>
            <TablaPaginacion paginacion={paginacion} total={total} params={sp} etiqueta="incidencias" />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
