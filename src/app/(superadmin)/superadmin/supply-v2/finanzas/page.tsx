import Link from 'next/link'
import { AlertTriangle, Banknote, Coins, FileText, Landmark, Percent, PiggyBank, Receipt, TrendingUp, Wallet } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { StatCard } from '@/components/ui/stat-card'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { NavSupplyV2 } from '@/components/supply-v2/nav'
import { resumenFinanzas } from '@/modules/supply-v2/finance/queries'
import { dineroSupplyV2, RUTA_ECONOMIA, RUTA_FINANZAS, RUTA_LIQUIDACIONES } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Finanzas · Supply 2.0' }

const SECCIONES = [
  { href: `${RUTA_FINANZAS}/facturas`, label: 'Facturas', icon: FileText, texto: 'Documentos del proveedor: registrar, aprobar, aplicar depósito, pagar.' },
  { href: `${RUTA_FINANZAS}/depositos`, label: 'Depósitos', icon: PiggyBank, texto: 'Dinero adelantado a proveedores y su saldo disponible.' },
  { href: `${RUTA_FINANZAS}/pagos`, label: 'Pagos', icon: Banknote, texto: 'Dinero que sale. Quien registra no confirma.' },
  { href: `${RUTA_FINANZAS}/obligaciones`, label: 'Obligaciones', icon: Landmark, texto: 'Lo que Membego debe y por qué nació cada deuda.' },
  { href: `${RUTA_FINANZAS}/conciliaciones`, label: 'Conciliaciones', icon: Receipt, texto: 'Membego frente al estado de cuenta del proveedor (supply y comisión).' },
  { href: RUTA_LIQUIDACIONES, label: 'Liquidaciones', icon: Percent, texto: 'Ventas a comisión entregadas: bruto, comisión y neto a pagar por periodo.' },
  { href: `${RUTA_FINANZAS}/incidencias`, label: 'Incidencias', icon: AlertTriangle, texto: 'Lo que no se deshace en silencio: entregas reversadas ya pagadas.' },
  { href: RUTA_ECONOMIA, label: 'Economía', icon: TrendingUp, texto: 'GMV, ingreso, costo, margen, breakage.' },
] as const

/**
 * MEMBEGO SUPPLY 2.0 · TABLERO DE FINANZAS (§33). Cada cifra sale de la base;
 * sin datos se dice «Sin datos todavía», nunca «todo cuadra».
 */
export default async function FinanzasPage() {
  await requireRole('SUPERADMIN')
  const r = await resumenFinanzas()
  const sin = 'Sin datos todavía'
  const d = (n: string) => (r.hayDatos ? dineroSupplyV2(n) : sin)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Finanzas de Supply"
        description="Cuánto debemos a cada proveedor, cuánto pagamos, cuánto tenemos depositado y qué dejó cada venta. Subledger de Supply, no contabilidad general."
        eyebrow="Supply 2.0"
        nav={<NavSupplyV2 activa="finanzas" />}
        action={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline"><Link href={`${RUTA_FINANZAS}/pagos/nuevo`} data-testid="btn-nuevo-pago">+ Registrar pago</Link></Button>
            <Button asChild><Link href={`${RUTA_FINANZAS}/facturas/nueva`} data-testid="btn-nueva-factura">+ Nueva factura</Link></Button>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Cuentas por pagar (CxP)" value={<span data-testid="kpi-cxp">{d(r.cxpTotal)}</span>} sub="obligaciones pendientes con proveedores" icon={Landmark} accent={Number(r.cxpTotal) > 0 ? 'warning' : 'brand'} href={`${RUTA_FINANZAS}/obligaciones`} hrefLabel="Ver obligaciones" />
        <StatCard label="Facturas pendientes" value={<span data-testid="kpi-facturas">{r.hayDatos ? r.facturasPendientes.toLocaleString('es-DO') : sin}</span>} sub={r.hayDatos ? `${dineroSupplyV2(r.facturasPendientesMonto)} por pagar` : 'ninguna registrada'} icon={FileText} href={`${RUTA_FINANZAS}/facturas?estado=PENDIENTES`} hrefLabel="Ver facturas" />
        <StatCard label="Depósitos disponibles" value={<span data-testid="kpi-depositos">{d(r.depositosDisponibles)}</span>} sub="dinero adelantado sin aplicar" icon={PiggyBank} href={`${RUTA_FINANZAS}/depositos`} hrefLabel="Ver depósitos" />
        <StatCard label="Pagos del mes" value={<span data-testid="kpi-pagos">{d(r.pagosDelMes)}</span>} sub={r.pagosPendientesDeConfirmar > 0 ? `${r.pagosPendientesDeConfirmar} pendiente(s) de confirmar` : 'confirmados este mes'} icon={Banknote} accent={r.pagosPendientesDeConfirmar > 0 ? 'warning' : undefined} href={`${RUTA_FINANZAS}/pagos`} hrefLabel="Ver pagos" />
      </div>

      <Card>
        <CardHeader><CardTitle>Economía del mes</CardTitle></CardHeader>
        <CardContent>
          {!r.hayDatos ? (
            <p className="text-sm text-muted-foreground" data-testid="economia-sin-datos">Sin datos todavía. Cuando se confirme la primera venta aparecerán ingreso, costo y margen.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="GMV" value={<span data-testid="kpi-gmv">{dineroSupplyV2(r.gmv)}</span>} sub={`${r.unitsSold.toLocaleString('es-DO')} unidades vendidas`} icon={Coins} />
              <StatCard label="Ingreso" value={<span data-testid="kpi-revenue">{dineroSupplyV2(r.revenue)}</span>} sub="reconocido por Membego" icon={Wallet} accent="brand" />
              <StatCard label="Costo" value={<span data-testid="kpi-cost">{dineroSupplyV2(r.cost)}</span>} sub="costo real del supply vendido" icon={Receipt} />
              <StatCard label="Margen bruto" value={<span data-testid="kpi-margen">{dineroSupplyV2(r.grossMargin)}</span>} sub={r.marginPct != null ? `${r.marginPct.toLocaleString('es-DO')} %` : '—'} icon={TrendingUp} accent="success" />
              <StatCard label="Supply vencido sin vender" value={<span data-testid="kpi-vencido">{dineroSupplyV2(r.supplyVencidoCosto)}</span>} sub={`${r.supplyVencidoUnidades.toLocaleString('es-DO')} unidades · costo histórico real`} accent={r.supplyVencidoUnidades > 0 ? 'danger' : undefined} />
              <StatCard label="Breakage" value={<span data-testid="kpi-breakage">{r.unitsExpired.toLocaleString('es-DO')}</span>} sub={r.breakageRate != null ? `${r.breakageRate.toLocaleString('es-DO')} % de lo vendido venció sin usarse` : 'derechos vencidos sin usar'} accent={r.unitsExpired > 0 ? 'warning' : undefined} />
              <StatCard label="Redimidas" value={r.unitsRedeemed.toLocaleString('es-DO')} sub="entregas vivas del mes" />
            </div>
          )}
          <p className="mt-3 text-caption text-muted-foreground">
            <Link href={RUTA_ECONOMIA} className="underline-offset-4 hover:underline">Reporte completo con filtros →</Link>
          </p>
        </CardContent>
      </Card>

      <Card data-testid="finanzas-comision">
        <CardHeader><CardTitle>Ventas a comisión</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Comisión del mes (ingreso)" value={<span data-testid="kpi-comision-ingreso">{dineroSupplyV2(r.comision.ingresoMes)}</span>} sub={`GMV ${dineroSupplyV2(r.comision.gmvMes)} · ${r.comision.unidadesMes.toLocaleString('es-DO')} unidades`} icon={Percent} accent="brand" />
            <StatCard label="Neto de proveedores (mes)" value={<span data-testid="kpi-comision-neto">{dineroSupplyV2(r.comision.netoProveedoresMes)}</span>} sub="cobrado por cuenta del proveedor; no es ingreso ni costo" />
            <StatCard label="Pendiente de liquidar" value={<span data-testid="kpi-sin-liquidar">{dineroSupplyV2(r.comision.netoPendienteDeLiquidar)}</span>} sub={`${r.comision.entregasPendientesDeLiquidar.toLocaleString('es-DO')} entrega(s) sin liquidación`} accent={r.comision.entregasPendientesDeLiquidar > 0 ? 'warning' : undefined} href={`${RUTA_LIQUIDACIONES}/nueva`} hrefLabel="Generar liquidación" />
            <StatCard label="Liquidaciones por pagar" value={<span data-testid="kpi-liq-por-pagar">{dineroSupplyV2(r.comision.liquidacionesPorPagarMonto)}</span>} sub={`${r.comision.liquidacionesPorPagar} aprobada(s) · ${r.comision.liquidacionesPendientesDeAprobar} pendiente(s) de aprobar${r.comision.incidenciasAbiertas > 0 ? ` · ${r.comision.incidenciasAbiertas} incidencia(s)` : ''}`} accent={r.comision.liquidacionesPendientesDeAprobar > 0 || r.comision.incidenciasAbiertas > 0 ? 'warning' : undefined} href={RUTA_LIQUIDACIONES} hrefLabel="Ver liquidaciones" />
          </div>
        </CardContent>
      </Card>

      {!r.hayDatos && (
        <EmptyState variant="card" title="Sin movimientos financieros" description="Registra la factura de una compra, un pago o un anticipo a un proveedor. Nada se marca como «cuadrado» sin datos." action={<Button asChild><Link href={`${RUTA_FINANZAS}/facturas/nueva`}>Nueva factura</Link></Button>} />
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SECCIONES.map((s) => (
          <Link key={s.href} href={s.href} className="rounded-xl border border-border bg-card p-4 transition-colors hover:bg-muted/40" data-testid={`seccion-${s.label.toLowerCase()}`}>
            <s.icon className="mb-2 size-5 text-primary" aria-hidden />
            <p className="font-medium">{s.label}</p>
            <p className="text-caption text-muted-foreground">{s.texto}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
