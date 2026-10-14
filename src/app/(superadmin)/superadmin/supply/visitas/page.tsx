import Link from 'next/link'
import type { MembegoVisitStatus } from '@prisma/client'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { formatDateTime } from '@/lib/format'
import { NavSupplyV2 } from '@/components/supply-v2/nav'
import { ChipVisita } from '@/components/visitas-membego/chips'
import { dineroVisita } from '@/components/visitas-membego/detalle-visita'
import { StatCard } from '@/components/ui/stat-card'
import { sinEmpresa } from '@/lib/tenant'
import { visitasDeLaPlataforma } from '@/modules/visitas-membego/queries'
import { embudoDeVisitasEnTx } from '@/modules/supply-v2/suppliers/scorecard'
import { RUTA_VISITAS } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Visitas · Supply' }

const ESTADOS: readonly MembegoVisitStatus[] = ['OPEN', 'CLOSED', 'CANCELLED']

/**
 * SUPPLIER & FULFILLMENT COMMERCE · visitas atribuidas de toda la plataforma
 * (§30, §35): filtro por estado y «solo con disputas». La comisión de
 * extras se ve aquí; la economía de Supply (costos, lotes) sigue en su sitio.
 */
export default async function VisitasPage({ searchParams }: { searchParams: Promise<{ estado?: string; disputas?: string }> }) {
  await requireRole('SUPERADMIN')
  const sp = await searchParams
  const estado = ESTADOS.find((e) => e === sp.estado)
  const soloDisputas = sp.disputas === '1'
  const [visitas, embudo] = await Promise.all([visitasDeLaPlataforma({ estado, soloDisputas }), sinEmpresa('Visitas: embudo de la plataforma', (tx) => embudoDeVisitasEnTx(tx, 30))])
  const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)} %` : '—')
  const href = (f: { estado?: MembegoVisitStatus; disputas?: boolean }) => {
    const p = new URLSearchParams()
    if (f.estado) p.set('estado', f.estado)
    if (f.disputas) p.set('disputas', '1')
    const qs = p.toString()
    return qs ? `${RUTA_VISITAS}?${qs}` : RUTA_VISITAS
  }
  const chip = (activo: boolean) => `rounded-full px-3 py-1 ${activo ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`

  return (
    <div className="space-y-6">
      <PageHeader title="Visitas" description="Visitas atribuidas a Membego: lo incluido, las compras adicionales reportadas, la comisión solo sobre extras y los reportes de los clientes." eyebrow="Membego Supply" nav={<NavSupplyV2 activa="visitas" />} />
      {/* El embudo (§52–§53): canje → visita → con extras → confirmada → disputada, últimos 30 días. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" data-testid="embudo-visitas">
        <StatCard label="Canjes (30 d)" value={embudo.redenciones} sub={`${embudo.visitas} visitas abiertas`} />
        <StatCard label="Visitas cerradas" value={embudo.cerradas} sub={pct(embudo.cerradas, embudo.visitas)} />
        <StatCard label="Con compras adicionales" value={embudo.conExtras} sub={`${pct(embudo.conExtras, embudo.cerradas)} de las cerradas · ${dineroVisita(embudo.extrasTotal)}`} />
        <StatCard label="Confirmadas por clientes" value={embudo.confirmadas} sub={`${pct(embudo.confirmadas, embudo.ventas)} de ${embudo.ventas} ventas`} />
        <StatCard label="Disputadas" value={embudo.disputadas} sub={`comisión ${dineroVisita(embudo.comisionTotal)}`} />
      </div>
      <nav className="flex flex-wrap gap-1 text-sm" aria-label="Filtros">
        <Link href={href({ disputas: soloDisputas })} className={chip(!estado)}>Todas</Link>
        {ESTADOS.map((e) => (
          <Link key={e} href={href({ estado: e, disputas: soloDisputas })} className={chip(estado === e)}>{e === 'OPEN' ? 'Abiertas' : e === 'CLOSED' ? 'Cerradas' : 'Canceladas'}</Link>
        ))}
        <Link href={href({ estado, disputas: !soloDisputas })} className={`ml-auto ${chip(soloDisputas)}`} data-testid="filtro-disputas">Con disputas abiertas</Link>
      </nav>
      <Card>
        <CardContent className="pt-6">
          {visitas.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="sin-visitas">Sin visitas con esos filtros.</p>
          ) : (
            <ul className="divide-y divide-border text-sm" data-testid="visitas">
              {visitas.map((v) => (
                <li key={v.id} className="py-3" data-testid="visita-fila">
                  <Link href={`${RUTA_VISITAS}/${v.id}`} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <span>
                      <span className="font-mono text-caption text-muted-foreground">{formatDateTime(v.openedAt)} · {v.number}</span>
                      <span className="block font-medium">{v.empresa} · {v.cliente}{v.incluido ? ` · ${v.incluido}` : ''}</span>
                      <span className="block text-caption text-muted-foreground">
                        {v.ventas} venta(s) · extras {dineroVisita(v.ancillaryTotal, v.currency)} · comisión {dineroVisita(v.commissionTotal, v.currency)}
                        {v.customerConfirmedAt ? ' · confirmada por el cliente' : ''}
                        {v.disputasAbiertas ? ` · ${v.disputasAbiertas} disputa(s) abierta(s)` : ''}
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
