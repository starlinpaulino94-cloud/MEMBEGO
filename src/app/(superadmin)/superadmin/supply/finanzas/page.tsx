import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { sinEmpresa } from '@/lib/tenant'
import { PageHeader } from '@/components/ui/page-header'
import { StatCard } from '@/components/ui/stat-card'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { TablaReporte } from '@/components/ui/reporte-imprimible'
import { formatDate, formatMoneyRD } from '@/lib/format'
import { NavFinanzas } from '@/components/supply/nav'
import { resumenFinanciero, obligacionesVencidas } from '@/modules/supply/tablero'
import { listarLiquidaciones } from '@/modules/supply/liquidaciones'
import { SUPPLY_LIQUIDACION_ESTADO_LABELS } from '@/modules/supply/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Finanzas de Membego Supply' }

/**
 * MEMBEGO SUPPLY · FINANZAS, resumen (auditoría 2026-09).
 *
 * Cinco cosas distintas que antes se llamaban «Cobros»: pagos, depósitos,
 * facturas, cuentas por pagar y por cobrar, liquidaciones. Esta pantalla las
 * pone una al lado de la otra con su número y su enlace, y nada más: cada
 * dominio se administra en su propia pestaña.
 */
export default async function FinanzasResumenPage() {
  await requireRole('SUPERADMIN')

  const [r, vencidas, liquidaciones] = await Promise.all([
    resumenFinanciero(),
    sinEmpresa('Membego Supply: obligaciones vencidas', (tx) => obligacionesVencidas(tx, new Date(), 10)),
    listarLiquidaciones({ limite: 8 }),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Finanzas"
        description="Lo que Membego debe, lo que le deben, lo que tiene depositado y lo que está por liquidar. Cada cifra sale de su propio libro; el ledger financiero los suma."
        eyebrow={
          <Link href="/superadmin/supply" className="hover:underline">
            Membego Supply
          </Link>
        }
        nav={<NavFinanzas activa="" />}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Cuentas por pagar"
          value={formatMoneyRD(r.cuentasPorPagar.montoPendiente)}
          sub={`${r.cuentasPorPagar.abiertas} abiertas · ${r.cuentasPorPagar.vencidas} vencidas`}
          accent={r.cuentasPorPagar.montoVencido > 0 ? 'warning' : undefined}
          href="/superadmin/supply/finanzas/cuentas-por-pagar"
          hrefLabel="Ver cuentas por pagar"
        />
        <StatCard
          label="Cuentas por cobrar"
          value={formatMoneyRD(r.cuentasPorCobrar.montoPendiente)}
          sub={`${r.cuentasPorCobrar.abiertas} abiertas · ${r.cuentasPorCobrar.vencidas} vencidas`}
          href="/superadmin/supply/finanzas/cuentas-por-cobrar"
          hrefLabel="Ver cuentas por cobrar"
        />
        <StatCard
          label="Depósitos disponibles"
          value={formatMoneyRD(r.depositos.disponible)}
          sub={`${r.depositos.depositos} depósitos vivos`}
          accent="brand"
          href="/superadmin/supply/finanzas/depositos"
          hrefLabel="Ver depósitos"
        />
        <StatCard
          label="Liquidaciones pendientes"
          value={formatMoneyRD(r.liquidaciones.montoPendiente)}
          sub={`${r.liquidaciones.pendientes} en curso · ${r.liquidaciones.disputadas} disputadas`}
          accent={r.liquidaciones.disputadas > 0 ? 'danger' : undefined}
          href="/superadmin/supply/finanzas/liquidaciones"
          hrefLabel="Ver liquidaciones"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Capital comprometido" value={formatMoneyRD(r.capitalInvertido)} sub="lotes adquiridos + depósitos vivos" />
        <StatCard label="Valor vencido sin usar" value={formatMoneyRD(r.valorVencido)} sub={`${r.unidadesVencidas.toLocaleString('es-DO')} unidades`} accent={r.valorVencido > 0 ? 'warning' : undefined} />
        <StatCard label="Ventas del mes (bruto)" value={formatMoneyRD(r.ventasMes.bruto)} sub={`comisión ${formatMoneyRD(r.ventasMes.comision)} · ${r.ventasMes.entregadas} entregadas`} href="/superadmin/supply/ventas" hrefLabel="Ver ventas" />
        <StatCard label="Discrepancias abiertas" value={r.discrepanciasAbiertas} sub="conciliación con proveedores" accent={r.discrepanciasAbiertas > 0 ? 'warning' : 'success'} href="/superadmin/supply/conciliacion" hrefLabel="Ver conciliación" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Obligaciones vencidas</CardTitle>
        </CardHeader>
        <CardContent>
          <TablaReporte
            columnas={[
              { clave: 'lado', titulo: 'Lado' },
              { clave: 'codigo', titulo: 'Cuenta' },
              { clave: 'proveedor', titulo: 'Proveedor' },
              { clave: 'descripcion', titulo: 'Descripción' },
              { clave: 'pendiente', titulo: 'Pendiente', alinearDerecha: true },
              { clave: 'vencio', titulo: 'Venció' },
            ]}
            filas={vencidas.map((v) => ({
              __clave: `${v.lado}-${v.id}`,
              lado: <Badge variant={v.lado === 'CXP' ? 'warning' : 'outline'}>{v.lado === 'CXP' ? 'Por pagar' : 'Por cobrar'}</Badge>,
              codigo: (
                <Link href={`/superadmin/supply/finanzas/${v.lado === 'CXP' ? 'cuentas-por-pagar' : 'cuentas-por-cobrar'}`} className="underline-offset-4 hover:underline">
                  {v.codigo}
                </Link>
              ),
              proveedor: v.proveedor,
              descripcion: v.descripcion,
              pendiente: formatMoneyRD(v.pendiente),
              vencio: formatDate(v.vencimientoAt),
            }))}
            vacio="Nada vencido. Todas las cuentas abiertas están dentro de plazo."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Últimas liquidaciones</CardTitle>
        </CardHeader>
        <CardContent>
          <TablaReporte
            columnas={[
              { clave: 'codigo', titulo: 'Liquidación' },
              { clave: 'proveedor', titulo: 'Proveedor' },
              { clave: 'periodo', titulo: 'Período' },
              { clave: 'neto', titulo: 'Neto', alinearDerecha: true },
              { clave: 'estado', titulo: 'Estado' },
            ]}
            filas={liquidaciones.map((l) => ({
              __clave: l.id,
              codigo: (
                <Link href={`/superadmin/supply/finanzas/liquidaciones/${l.id}`} className="font-medium underline-offset-4 hover:underline">
                  {l.codigo}
                </Link>
              ),
              proveedor: l.proveedor.name,
              periodo: `${formatDate(l.periodoDesde)} → ${formatDate(l.periodoHasta)}`,
              neto: formatMoneyRD(Number(l.netoLiquidar)),
              estado: <Badge variant={l.estado === 'PAGADA' || l.estado === 'CONCILIADA' ? 'success' : l.estado === 'DISPUTADA' ? 'destructive' : 'secondary'}>{SUPPLY_LIQUIDACION_ESTADO_LABELS[l.estado]}</Badge>,
            }))}
            vacio="Todavía no se ha calculado ninguna liquidación."
          />
        </CardContent>
      </Card>
    </div>
  )
}
