import Link from 'next/link'
import { Coins, Receipt, TrendingUp, Wallet } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { StatCard } from '@/components/ui/stat-card'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatDate } from '@/lib/format'
import { NavSupplyV2 } from '@/components/supply-v2/nav'
import { calcularEconomia, opcionesDeFiltroEconomia } from '@/modules/supply-v2/economics/queries'
import type { VentanaEconomia } from '@/modules/supply-v2/economics/domain'
import { dineroSupplyV2, RUTA_ECONOMIA } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Economía · Supply 2.0' }

const VENTANAS: { v: VentanaEconomia; label: string }[] = [
  { v: 'HOY', label: 'Hoy' },
  { v: '7D', label: '7 días' },
  { v: '30D', label: '30 días' },
  { v: 'MES', label: 'Mes' },
  { v: 'RANGO', label: 'Rango' },
]

function fechaDe(v: string | undefined, finDeDia = false): Date | null {
  if (!v) return null
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return null
  if (finDeDia) d.setUTCHours(23, 59, 59, 999)
  return d
}

/**
 * MEMBEGO SUPPLY 2.0 · REPORTE ECONÓMICO (§31–§32, §68): una sola fuente
 * (`calcularEconomia`), filtros en el servidor, sin valores escritos a mano.
 *
 *   GMV = valor vendido al cliente · Revenue = ingreso reconocido por Membego
 *   Cost = costo real del supply vendido · Gross Margin = Revenue − Cost
 *   Breakage = derechos emitidos que vencieron sin redención
 */
export default async function EconomiaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole('SUPERADMIN')
  const sp = await searchParams
  const s = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : '')
  const ventana = (VENTANAS.some((x) => x.v === s('ventana')) ? s('ventana') : '30D') as VentanaEconomia
  const [e, opciones] = await Promise.all([
    calcularEconomia({ ventana, desde: fechaDe(s('desde')), hasta: fechaDe(s('hasta'), true), supplierId: s('proveedor') || null, catalogItemId: s('producto') || null }),
    opcionesDeFiltroEconomia(),
  ])
  const select = 'h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm'
  const qs = (v: VentanaEconomia) => {
    const p = new URLSearchParams()
    p.set('ventana', v)
    if (s('proveedor')) p.set('proveedor', s('proveedor'))
    if (s('producto')) p.set('producto', s('producto'))
    return `${RUTA_ECONOMIA}?${p.toString()}`
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Economía del supply"
        description="Cuánto se vendió, cuánto ingresó Membego, cuánto costó cada unidad y cuál fue el margen real. Costo reconocido una sola vez, al vender; nunca desde precios actuales."
        eyebrow="Supply 2.0"
        nav={<NavSupplyV2 activa="economia" />}
      />
      <Card>
        <CardContent className="space-y-3 pt-6">
          <div className="flex flex-wrap gap-2" data-testid="ventanas-economia">
            {VENTANAS.map((v) => (
              <Button key={v.v} asChild size="sm" variant={ventana === v.v ? 'default' : 'outline'}>
                <Link href={qs(v.v)} aria-current={ventana === v.v ? 'page' : undefined}>{v.label}</Link>
              </Button>
            ))}
          </div>
          <form method="get" className="grid gap-3 sm:grid-cols-5" data-testid="filtros-economia">
            <input type="hidden" name="ventana" value={ventana === 'RANGO' || s('desde') || s('hasta') ? 'RANGO' : ventana} />
            <div><Label htmlFor="proveedor">Proveedor</Label><select id="proveedor" name="proveedor" defaultValue={s('proveedor')} className={select}><option value="">Todos</option>{opciones.proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></div>
            <div><Label htmlFor="producto">Producto</Label><select id="producto" name="producto" defaultValue={s('producto')} className={select}><option value="">Todos</option>{opciones.productos.map((p) => <option key={p.id} value={p.id}>{p.nombre} · {p.proveedor}</option>)}</select></div>
            <div><Label htmlFor="desde">Desde</Label><Input id="desde" name="desde" type="date" defaultValue={s('desde')} /></div>
            <div><Label htmlFor="hasta">Hasta</Label><Input id="hasta" name="hasta" type="date" defaultValue={s('hasta')} /></div>
            <div className="flex items-end gap-2"><Button type="submit" variant="outline">Aplicar</Button><Button asChild variant="ghost"><Link href={RUTA_ECONOMIA}>Limpiar</Link></Button></div>
          </form>
          <p className="text-caption text-muted-foreground">Periodo: {formatDate(e.desde)} – {formatDate(e.hasta)}</p>
        </CardContent>
      </Card>

      {!e.hayDatos ? (
        <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground" data-testid="economia-sin-datos">Sin datos todavía para este periodo y filtro.</p></CardContent></Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="GMV" value={<span data-testid="eco-gmv">{dineroSupplyV2(e.gmv)}</span>} sub="valor vendido al cliente" icon={Coins} />
            <StatCard label="Ingreso (revenue)" value={<span data-testid="eco-revenue">{dineroSupplyV2(e.revenue)}</span>} sub="reconocido por Membego" icon={Wallet} accent="brand" />
            <StatCard label="Costo" value={<span data-testid="eco-cost">{dineroSupplyV2(e.cost)}</span>} sub="costo real del supply vendido" icon={Receipt} />
            <StatCard label="Margen bruto" value={<span data-testid="eco-margen">{dineroSupplyV2(e.grossMargin)}</span>} sub={e.marginPct != null ? `${e.marginPct.toLocaleString('es-DO')} % del ingreso` : '—'} icon={TrendingUp} accent="success" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Unidades vendidas" value={<span data-testid="eco-vendidas">{e.unitsSold.toLocaleString('es-DO')}</span>} />
            <StatCard label="Unidades redimidas" value={<span data-testid="eco-redimidas">{e.unitsRedeemed.toLocaleString('es-DO')}</span>} sub="entregas vivas en el periodo" />
            <StatCard label="Unidades vencidas (breakage)" value={<span data-testid="eco-vencidas">{e.unitsExpired.toLocaleString('es-DO')}</span>} sub={e.breakageRate != null ? `${e.breakageRate.toLocaleString('es-DO')} % de lo vendido` : '—'} accent={e.unitsExpired > 0 ? 'warning' : undefined} />
            <StatCard label="Supply vencido sin vender" value={<span data-testid="eco-supply-vencido">{dineroSupplyV2(e.expiredSupplyCost)}</span>} sub={`${e.expiredSupplyUnits.toLocaleString('es-DO')} unidades · costo histórico`} accent={e.expiredSupplyUnits > 0 ? 'danger' : undefined} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card data-testid="eco-prepago">
              <CardHeader><CardTitle>Supply adquirido (prepago / pagar después)</CardTitle></CardHeader>
              <CardContent>
                <dl className="grid gap-2 text-sm sm:grid-cols-2">
                  <div><dt className="text-muted-foreground">GMV</dt><dd className="font-medium tabular-nums" data-testid="eco-prepago-gmv">{dineroSupplyV2(e.prepurchase.gmv)}</dd></div>
                  <div><dt className="text-muted-foreground">Ingreso (= GMV)</dt><dd className="font-medium tabular-nums" data-testid="eco-prepago-revenue">{dineroSupplyV2(e.prepurchase.revenue)}</dd></div>
                  <div><dt className="text-muted-foreground">Costo real del supply</dt><dd className="font-medium tabular-nums" data-testid="eco-prepago-cost">{dineroSupplyV2(e.prepurchase.cost)}</dd></div>
                  <div><dt className="text-muted-foreground">Unidades vendidas</dt><dd className="font-medium tabular-nums">{e.prepurchase.unitsSold.toLocaleString('es-DO')}</dd></div>
                </dl>
              </CardContent>
            </Card>
            <Card data-testid="eco-comision">
              <CardHeader><CardTitle>Venta a comisión (sin inventario de Membego)</CardTitle></CardHeader>
              <CardContent>
                <dl className="grid gap-2 text-sm sm:grid-cols-2">
                  <div><dt className="text-muted-foreground">GMV (lo que pagó el cliente)</dt><dd className="font-medium tabular-nums" data-testid="eco-comision-gmv">{dineroSupplyV2(e.commission.gmv)}</dd></div>
                  <div><dt className="text-muted-foreground">Ingreso de Membego (comisión)</dt><dd className="font-medium tabular-nums" data-testid="eco-comision-revenue">{dineroSupplyV2(e.commission.revenue)}</dd></div>
                  <div><dt className="text-muted-foreground">Neto de proveedores (no es ingreso ni costo)</dt><dd className="font-medium tabular-nums" data-testid="eco-comision-neto">{dineroSupplyV2(e.commission.supplierNet)}</dd></div>
                  <div><dt className="text-muted-foreground">Unidades vendidas</dt><dd className="font-medium tabular-nums" data-testid="eco-comision-unidades">{e.commission.unitsSold.toLocaleString('es-DO')}</dd></div>
                </dl>
              </CardContent>
            </Card>
          </div>
        </>
      )}

      <Card>
        <CardHeader><CardTitle>Definiciones</CardTitle></CardHeader>
        <CardContent>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div><dt className="font-medium">GMV</dt><dd className="text-muted-foreground">Valor vendido al cliente (lo que pagó).</dd></div>
            <div><dt className="font-medium">Ingreso</dt><dd className="text-muted-foreground">Ingreso reconocido por Membego. En compra anticipada coincide con el GMV; a comisión es SOLO la comisión (cliente paga 1 000 al 10 % → ingreso 100, neto del proveedor 900).</dd></div>
            <div><dt className="font-medium">Costo</dt><dd className="text-muted-foreground">Costo real del lote de cada unidad vendida, congelado en el derecho. Nunca el precio público.</dd></div>
            <div><dt className="font-medium">Margen bruto</dt><dd className="text-muted-foreground">Ingreso − costo. Se reconoce al vender; redimir, reversar o vencer no lo cambian.</dd></div>
            <div><dt className="font-medium">Breakage</dt><dd className="text-muted-foreground">Derechos vendidos que vencieron sin redimirse. El ingreso se conserva y el costo no se duplica.</dd></div>
            <div><dt className="font-medium">Supply vencido sin vender</dt><dd className="text-muted-foreground">Unidades compradas que caducaron sin venderse: pérdida a costo histórico real.</dd></div>
          </dl>
        </CardContent>
      </Card>
    </div>
  )
}
