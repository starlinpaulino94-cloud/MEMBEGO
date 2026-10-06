import Link from 'next/link'
import { Banknote, FileText, Landmark, PiggyBank, Plus } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { cn } from '@/lib/utils'
import { MarcoSupplyV2 } from '@/components/supply-v2/marco'
import { TarjetaIndicador } from '@/components/supply-v2/indicador'
import { MONO, Tarjeta } from '@/components/supply-v2/resumen/superficie'
import { PanelComision, PanelEconomia } from '@/components/supply-v2/finanzas/paneles-resultado'
import { TarjetasSecciones } from '@/components/supply-v2/finanzas/tarjetas-secciones'
import { TablaObligaciones } from '@/components/supply-v2/finanzas/tabla-obligaciones'
import { extrasFinanzas, listarObligaciones, resumenFinanzas } from '@/modules/supply-v2/finance/queries'
import { dineroSupplyV2, RUTA_FINANZAS } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Finanzas · Supply 2.0' }

/**
 * MEMBEGO SUPPLY 2.0 · TABLERO DE FINANZAS (§33), rediseño Stitch (propuesta A,
 * dirección blanca). Cada cifra sale de la base; sin datos se dice «Sin datos
 * todavía», nunca «todo cuadra». No se muestran ITBIS, cierre fiscal ni
 * exportaciones: Membego no los calcula.
 */
export default async function FinanzasPage() {
  await requireRole('SUPERADMIN')
  const ahora = new Date()
  const [r, extras, deudas] = await Promise.all([resumenFinanzas(ahora), extrasFinanzas(), listarObligaciones({ status: 'VIVAS' }, { pagina: 1, tamano: 5, saltar: 0, tomar: 5 })])
  const sin = 'Sin datos todavía'
  const d = (n: string) => (r.hayDatos ? dineroSupplyV2(n) : sin)

  const avisos: Partial<Record<string, string>> = {}
  if (r.facturasPendientes > 0) avisos.Facturas = `${r.facturasPendientes} por pagar`
  if (r.pagosPendientesDeConfirmar > 0) avisos.Pagos = `${r.pagosPendientesDeConfirmar} por confirmar`
  if (deudas.total > 0) avisos.Obligaciones = `${deudas.total} vivas`
  if (extras.conciliacionesAbiertas > 0) avisos.Conciliaciones = `${extras.conciliacionesAbiertas} abierta(s)`
  if (r.comision.entregasPendientesDeLiquidar > 0 || r.comision.liquidacionesPendientesDeAprobar > 0) avisos.Liquidaciones = `${r.comision.entregasPendientesDeLiquidar + r.comision.liquidacionesPendientesDeAprobar} por atender`
  if (r.comision.incidenciasAbiertas > 0) avisos.Incidencias = `${r.comision.incidenciasAbiertas} abierta(s)`

  return (
    <MarcoSupplyV2 activa="finanzas">
      <div className="flex flex-col gap-4">
        <Tarjeta className="flex flex-col gap-4 p-5 @4xl:flex-row @4xl:items-center @4xl:justify-between">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn(MONO, 'font-bold uppercase tracking-wide text-sv2-primary')}>Supply 2.0</span>
              <span aria-hidden className="text-sv2-outline">•</span>
              <span className="text-[12px] font-semibold uppercase leading-4 tracking-wider text-sv2-outline">Subledger de proveedores</span>
            </div>
            <h2 className="text-[28px] font-bold leading-9 tracking-[-0.02em]">Finanzas de Supply</h2>
            <p className="max-w-3xl text-[14px] leading-5 text-sv2-ink-variant">
              Cuánto debemos a cada proveedor, cuánto pagamos, cuánto tenemos depositado y qué dejó cada venta. Subledger de Supply, no contabilidad general.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Link href={`${RUTA_FINANZAS}/pagos/nuevo`} data-testid="btn-nuevo-pago" className="inline-flex h-10 items-center gap-1.5 rounded-[8px] border border-sv2-border bg-card px-3 text-[14px] font-semibold leading-5 transition-colors hover:bg-sv2-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sv2-accent">
              <Banknote aria-hidden className="size-4 text-sv2-ink-variant" />
              Registrar pago
            </Link>
            <Link href={`${RUTA_FINANZAS}/facturas/nueva`} data-testid="btn-nueva-factura" className="inline-flex h-10 items-center gap-1.5 rounded-[8px] bg-sv2-accent px-4 text-[14px] font-semibold leading-5 text-white shadow-sm transition-colors hover:bg-sv2-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sv2-accent focus-visible:ring-offset-2">
              <Plus aria-hidden className="size-4" />
              Nueva factura
            </Link>
          </div>
        </Tarjeta>

        <div className="grid grid-cols-1 gap-3 @xl:grid-cols-2 @6xl:grid-cols-4" data-testid="tablero-finanzas">
          <TarjetaIndicador
            etiqueta="Cuentas por pagar (CxP)"
            icono={Landmark}
            tonoIcono={Number(r.cxpTotal) > 0 ? 'aviso' : 'primario'}
            valor={d(r.cxpTotal)}
            pie={extras.mayorDeuda ? `Mayor: ${extras.mayorDeuda.proveedor} · ${dineroSupplyV2(extras.mayorDeuda.saldo)}` : 'obligaciones pendientes con proveedores'}
            testId="kpi-cxp"
          />
          <TarjetaIndicador etiqueta="Facturas pendientes" icono={FileText} tonoIcono="primario" valor={r.hayDatos ? r.facturasPendientes.toLocaleString('es-DO') : sin} pie={r.hayDatos ? `${dineroSupplyV2(r.facturasPendientesMonto)} por pagar` : 'ninguna registrada'} testId="kpi-facturas" />
          <TarjetaIndicador etiqueta="Depósitos disponibles" icono={PiggyBank} tonoIcono="exito" valor={d(r.depositosDisponibles)} pie="dinero adelantado sin aplicar" testId="kpi-depositos" />
          <TarjetaIndicador
            etiqueta="Pagos del mes"
            icono={Banknote}
            tonoIcono={r.pagosPendientesDeConfirmar > 0 ? 'aviso' : 'primario'}
            valor={d(r.pagosDelMes)}
            pie={r.pagosPendientesDeConfirmar > 0 ? `${r.pagosPendientesDeConfirmar} pendiente(s) de confirmar` : 'confirmados este mes'}
            tonoPie={r.pagosPendientesDeConfirmar > 0 ? 'aviso' : 'neutral'}
            testId="kpi-pagos"
          />
        </div>

        {!r.hayDatos && (
          <Tarjeta className="flex flex-col items-start gap-2 p-5" data-testid="finanzas-vacio">
            <p className="text-[15px] font-semibold leading-5">Sin movimientos financieros</p>
            <p className="text-[13px] leading-[18px] text-sv2-ink-variant">Registra la factura de una compra, un pago o un anticipo a un proveedor. Nada se marca como «cuadrado» sin datos.</p>
            <Link href={`${RUTA_FINANZAS}/facturas/nueva`} className="inline-flex h-9 items-center gap-1.5 rounded-[8px] bg-sv2-accent px-3 text-[13px] font-semibold leading-4 text-white hover:bg-sv2-accent-hover">
              <Plus aria-hidden className="size-4" />
              Nueva factura
            </Link>
          </Tarjeta>
        )}

        <PanelEconomia r={r} />
        <PanelComision r={r} />
        {deudas.total > 0 && <TablaObligaciones filas={deudas.filas} total={deudas.total} ahora={ahora} />}
        <TarjetasSecciones avisos={avisos} />
      </div>
    </MarcoSupplyV2>
  )
}
