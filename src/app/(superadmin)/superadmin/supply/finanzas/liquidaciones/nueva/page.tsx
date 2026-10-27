import Link from 'next/link'
import { randomUUID } from 'crypto'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDate } from '@/lib/format'
import { NavSupplyV2 } from '@/components/supply-v2/nav'
import { TablaPrevistaLiquidacion } from '@/components/supply-v2/tablas-beneficio-campana'
import { FormLiquidacion } from '@/components/supply-v2/finanzas/form-liquidacion'
import { previsualizarLiquidacion, proveedoresParaFinanzas } from '@/modules/supply-v2/finance/queries'
import { RUTA_LIQUIDACIONES } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Generar liquidación · Supply' }

function fechaDe(v: string | undefined, porDefecto: Date): Date {
  if (!v) return porDefecto
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? porDefecto : d
}

/** Generar una liquidación (§36): con vista previa de lo que entraría para el proveedor y periodo elegidos. */
export default async function NuevaLiquidacionPage({ searchParams }: { searchParams: Promise<{ proveedor?: string; desde?: string; hasta?: string }> }) {
  await requireRole('SUPERADMIN')
  const sp = await searchParams
  const proveedores = await proveedoresParaFinanzas()
  const hoy = new Date()
  const desde = fechaDe(sp.desde, new Date(hoy.getFullYear(), hoy.getMonth(), 1))
  const hasta = fechaDe(sp.hasta, new Date(hoy.getFullYear(), hoy.getMonth() + 1, 1))
  const supplierId = sp.proveedor || proveedores[0]?.id
  const preview = supplierId ? await previsualizarLiquidacion(supplierId, desde, hasta) : null
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const select = 'h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm'
  return (
    <div className="space-y-6">
      <PageHeader title="Generar liquidación" description="Elige proveedor y periodo. Entran las entregas a comisión pendientes de pago; la liquidación nace pendiente de aprobación por otra persona." eyebrow={<Link href={RUTA_LIQUIDACIONES} className="hover:underline">Liquidaciones</Link>} nav={<NavSupplyV2 activa="finanzas" />} />
      <Card>
        <CardHeader><CardTitle>Vista previa</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <form method="get" className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div><label className="text-sm" htmlFor="pvProveedor">Proveedor</label><select id="pvProveedor" name="proveedor" defaultValue={supplierId ?? ''} className={select}>{proveedores.map((p) => <option key={p.id} value={p.id}>{p.commercialName}</option>)}</select></div>
            <div><label className="text-sm" htmlFor="pvDesde">Desde</label><input id="pvDesde" name="desde" type="date" defaultValue={iso(desde)} className={select} /></div>
            <div><label className="text-sm" htmlFor="pvHasta">Hasta (exclusivo)</label><input id="pvHasta" name="hasta" type="date" defaultValue={iso(hasta)} className={select} /></div>
            <div className="flex items-end"><button type="submit" className="h-9 rounded-lg border border-border px-3 text-sm hover:bg-muted">Previsualizar</button></div>
          </form>
          {!preview ? (
            <p className="text-sm text-muted-foreground">No hay proveedores.</p>
          ) : preview.entregas.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="preview-vacia">Sin entregas a comisión pendientes de liquidar de {preview.proveedor} entre {formatDate(desde)} y {formatDate(hasta)}.</p>
          ) : (
            <TablaPrevistaLiquidacion entregas={preview.entregas} moneda={preview.currency} bruto={preview.grossSales} comision={preview.commissionAmount} neto={preview.supplierNet} />
          )}
        </CardContent>
      </Card>
      <Card><CardContent className="pt-6"><FormLiquidacion proveedores={proveedores} supplierId={supplierId} periodStart={iso(desde)} periodEnd={iso(hasta)} idempotencyKey={`ui-liq-${randomUUID()}`} /></CardContent></Card>
    </div>
  )
}
