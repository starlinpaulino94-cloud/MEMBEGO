import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { StatCard } from '@/components/ui/stat-card'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatDate } from '@/lib/format'
import { NavSupplyV2 } from '@/components/supply-v2/nav'
import { ChipCampana, ChipFinanciacion } from '@/components/supply-v2/chips'
import { listarCampanas, tableroCampanas } from '@/modules/supply-v2/campaigns/queries'
import { proveedoresParaFinanzas } from '@/modules/supply-v2/finance/queries'
import { CAMPAIGN_AUDIENCE_LABELS, CAMPAIGN_STATUS_LABELS, dineroSupplyV2, RUTA_CAMPANAS } from '@/modules/supply-v2/core/catalogo'
import type { SupplyV2CampaignStatus } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Campañas · Supply 2.0' }

const ESTADOS: SupplyV2CampaignStatus[] = ['DRAFT', 'PENDING_APPROVAL', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED']

function fechaDe(v: string | undefined): Date | null {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 7 · TABLERO DE CAMPAÑAS (§26).
 *
 * Las cifras salen de operaciones REALES: pedidos con la campaña congelada al
 * comprarlos. Un pedido cuenta una vez y solo los pagados son ventas; las
 * reservas en curso se informan aparte para no inflar el GMV.
 */
export default async function CampanasPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole('SUPERADMIN')
  const sp = await searchParams
  const s = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : '')
  const filtro = {
    status: (ESTADOS.includes(s('estado') as SupplyV2CampaignStatus) ? (s('estado') as SupplyV2CampaignStatus) : null),
    supplierId: s('proveedor') || null,
    desde: fechaDe(s('desde')),
    hasta: fechaDe(s('hasta')),
  }
  const [campanas, tablero, proveedores] = await Promise.all([listarCampanas(filtro), tableroCampanas(filtro), proveedoresParaFinanzas()])
  const select = 'h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm'

  return (
    <div className="space-y-6">
      <PageHeader
        title="Campañas y promociones"
        description="Campañas comerciales que agrupan ofertas de la red con una promoción común. Usan el motor económico de los beneficios: la campaña agrupa y pone el techo del presupuesto; el dinero lo mueven sus promociones."
        eyebrow="Supply 2.0"
        nav={<NavSupplyV2 activa="campanas" />}
        action={
          <Button asChild>
            <Link href={`${RUTA_CAMPANAS}/nueva`} data-testid="btn-crear-campana-nav">+ Crear campaña</Link>
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="tablero-campanas">
        <StatCard label="Campañas activas" value={<span data-testid="tablero-activas">{tablero.activas.toLocaleString('es-DO')}</span>} sub={`${tablero.enRevision} en revisión · ${tablero.programadas} programadas`} accent="brand" />
        <StatCard label="Ventas confirmadas" value={<span data-testid="tablero-ventas">{tablero.ventasConfirmadas.toLocaleString('es-DO')}</span>} sub={tablero.pedidosEnCurso > 0 ? `${tablero.pedidosEnCurso} pedido(s) en curso, que no son ventas` : 'pedidos pagados y atribuidos'} />
        <StatCard label="GMV atribuido" value={<span data-testid="tablero-gmv">{dineroSupplyV2(tablero.gmv)}</span>} sub="valor de las ventas de campaña" />
        <StatCard
          label="Contribución tras el subsidio"
          value={<span data-testid="tablero-contribucion">{dineroSupplyV2(tablero.contribucion)}</span>}
          sub={`comisión ${dineroSupplyV2(tablero.comision)} − subsidio ${dineroSupplyV2(tablero.subsidio)}`}
          accent={Number(tablero.contribucion) < 0 ? 'danger' : 'success'}
        />
      </div>

      {tablero.campanasSinTope > 0 && (
        <p className="rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-sm" data-testid="aviso-sin-tope">
          {tablero.campanasSinTope} campaña(s) sin presupuesto máximo. Van con autorización financiera registrada, pero su subsidio no tiene techo: revísalas.
        </p>
      )}

      <Card>
        <CardContent className="pt-6">
          <form method="get" className="grid gap-3 sm:grid-cols-5" data-testid="filtros-campanas">
            <div>
              <Label htmlFor="estado">Estado</Label>
              <select id="estado" name="estado" defaultValue={s('estado')} className={select}>
                <option value="">Todos</option>
                {ESTADOS.map((e) => (
                  <option key={e} value={e}>{CAMPAIGN_STATUS_LABELS[e]}</option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="proveedor">Proveedor</Label>
              <select id="proveedor" name="proveedor" defaultValue={s('proveedor')} className={select}>
                <option value="">Todos</option>
                {proveedores.map((p) => (
                  <option key={p.id} value={p.id}>{p.commercialName}</option>
                ))}
              </select>
            </div>
            <div><Label htmlFor="desde">Desde</Label><Input id="desde" name="desde" type="date" defaultValue={s('desde')} /></div>
            <div><Label htmlFor="hasta">Hasta</Label><Input id="hasta" name="hasta" type="date" defaultValue={s('hasta')} /></div>
            <div className="flex items-end gap-2">
              <Button type="submit" variant="outline">Aplicar</Button>
              <Button asChild variant="ghost"><Link href={RUTA_CAMPANAS}>Limpiar</Link></Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {campanas.length === 0 ? (
        <EmptyState
          variant="card"
          title="No hay campañas con ese filtro"
          description="Una campaña agrupa ofertas de la red con una promoción común: descuentos, cupones o bonos financiados por Membego, por el proveedor o entre los dos."
          action={<Button asChild><Link href={`${RUTA_CAMPANAS}/nueva`}>Crear campaña</Link></Button>}
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="tabla-campanas">
                <thead className="text-left text-caption text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2">Campaña</th>
                    <th className="px-4 py-2">Financia</th>
                    <th className="px-4 py-2">Público</th>
                    <th className="px-4 py-2 text-right">Ofertas</th>
                    <th className="px-4 py-2 text-right">Cupones</th>
                    <th className="px-4 py-2 text-right">Presupuesto</th>
                    <th className="px-4 py-2 text-right">Consumido</th>
                    <th className="px-4 py-2 text-right">Ventas</th>
                    <th className="px-4 py-2 text-right">GMV</th>
                    <th className="px-4 py-2">Estado</th>
                    <th className="px-4 py-2">Vigencia</th>
                  </tr>
                </thead>
                <tbody>
                  {campanas.map((c) => (
                    <tr key={c.id} className="border-t border-border align-top">
                      <td className="px-4 py-2 font-medium">
                        <Link href={`${RUTA_CAMPANAS}/${c.id}`} className="underline-offset-4 hover:underline">{c.name}</Link>
                        <span className="block font-mono text-caption text-muted-foreground">{c.code}{c.proveedor ? ` · ${c.proveedor}` : ''}</span>
                      </td>
                      <td className="px-4 py-2"><ChipFinanciacion funding={c.funding} /></td>
                      <td className="px-4 py-2 text-caption">{CAMPAIGN_AUDIENCE_LABELS[c.audience]}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{c.ofertas}<span className="block text-caption text-muted-foreground">{c.promociones} promo.</span></td>
                      <td className="px-4 py-2 text-right tabular-nums">{c.cupones}</td>
                      <td className="px-4 py-2 text-right tabular-nums" data-testid="campana-presupuesto">{c.budgetTotal ? dineroSupplyV2(c.budgetTotal, c.currency) : 'Sin tope'}</td>
                      <td className="px-4 py-2 text-right tabular-nums" data-testid="campana-consumido">
                        {dineroSupplyV2(c.budgetConsumido, c.currency)}
                        {Number(c.budgetReservado) > 0 && <span className="block text-caption text-warning">+{dineroSupplyV2(c.budgetReservado, c.currency)} reservado</span>}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums" data-testid="campana-ventas">{c.ventasConfirmadas}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{dineroSupplyV2(c.gmv, c.currency)}</td>
                      <td className="px-4 py-2"><ChipCampana estado={c.status} /></td>
                      <td className="px-4 py-2 text-caption">
                        {formatDate(c.startsAt)}{c.endsAt ? ` → ${formatDate(c.endsAt)}` : ''}
                        {c.horario && <span className="block text-muted-foreground">{c.horario}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
