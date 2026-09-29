import Link from 'next/link'
import type { SupplyLiquidacionEstado } from '@prisma/client'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { StatCard } from '@/components/ui/stat-card'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { TablaReporte } from '@/components/ui/reporte-imprimible'
import { formatDate, formatMoneyRD } from '@/lib/format'
import { NavFinanzas } from '@/components/supply/nav'
import { FormAccion } from '@/components/supply/form-accion'
import { FiltrosChips, FiltroProveedor } from '@/components/supply/filtros-finanzas'
import { listarLiquidaciones } from '@/modules/supply/liquidaciones'
import { opcionesFinanzas } from '@/modules/supply/opciones'
import { calcularLiquidacionAction } from '@/modules/supply/actions-finanzas'
import { SUPPLY_LIQUIDACION_ESTADO_LABELS } from '@/modules/supply/catalogo'
import { varianteLiquidacion } from '@/components/supply/variantes'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Liquidaciones a proveedores' }

const BASE = '/superadmin/supply/finanzas/liquidaciones'

/**
 * MEMBEGO SUPPLY · LIQUIDACIONES (§17).
 *
 * Un corte por proveedor y período: reclama las cuentas por pagar y por
 * cobrar vivas, las redenciones sin liquidar, planea el uso del depósito y
 * congela el neto en un snapshot. Lo que se cambie en el acuerdo después no
 * altera este corte.
 */
export default async function LiquidacionesPage({ searchParams }: { searchParams: Promise<{ estado?: string; proveedor?: string }> }) {
  await requireRole('SUPERADMIN')
  const { estado = '', proveedor = '' } = await searchParams
  const estados = Object.keys(SUPPLY_LIQUIDACION_ESTADO_LABELS) as SupplyLiquidacionEstado[]
  const estadoValido = estados.includes(estado as SupplyLiquidacionEstado) ? (estado as SupplyLiquidacionEstado) : undefined

  const [liquidaciones, opciones] = await Promise.all([
    listarLiquidaciones({ estado: estadoValido, proveedorId: proveedor || undefined }),
    opcionesFinanzas(),
  ])
  const enCurso = liquidaciones.filter((l) => ['CALCULADA', 'EN_REVISION', 'APROBADA'].includes(l.estado))
  const porPagar = liquidaciones.filter((l) => l.estado === 'APROBADA')

  const hoy = new Date()
  const primeroDeMes = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1)).toISOString().slice(0, 10)
  const hoyIso = hoy.toISOString().slice(0, 10)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Liquidaciones"
        description="Cortes por proveedor y período: cuentas por pagar menos cuentas por cobrar, redenciones devengadas, depósito aplicado y el neto que se transfiere. El snapshot se congela al calcular."
        eyebrow={
          <Link href="/superadmin/supply/finanzas" className="hover:underline">
            Finanzas
          </Link>
        }
        nav={<NavFinanzas activa="liquidaciones" />}
      />

      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard label="En curso" value={enCurso.length} sub={formatMoneyRD(enCurso.reduce((t, l) => t + Number(l.netoLiquidar), 0))} />
        <StatCard label="Aprobadas por pagar" value={porPagar.length} sub={formatMoneyRD(porPagar.reduce((t, l) => t + Number(l.netoLiquidar), 0))} accent={porPagar.length > 0 ? 'warning' : undefined} />
        <StatCard label="Disputadas" value={liquidaciones.filter((l) => l.estado === 'DISPUTADA').length} accent={liquidaciones.some((l) => l.estado === 'DISPUTADA') ? 'danger' : undefined} />
        <StatCard label="Pagadas" value={liquidaciones.filter((l) => l.estado === 'PAGADA' || l.estado === 'CONCILIADA').length} sub={formatMoneyRD(liquidaciones.filter((l) => l.estado === 'PAGADA' || l.estado === 'CONCILIADA').reduce((t, l) => t + Number(l.netoLiquidar), 0))} accent="success" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Calcular un corte</CardTitle>
        </CardHeader>
        <CardContent>
          {opciones.proveedores.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay proveedores con los que liquidar.</p>
          ) : (
            <FormAccion
              accion={calcularLiquidacionAction}
              etiqueta="Calcular liquidación"
              etiquetaPendiente="Calculando…"
              nota="Reclama lo pendiente del período y lo congela. Se puede recalcular mientras no esté aprobada."
              campos={[
                { name: 'proveedorId', label: 'Proveedor', tipo: 'select', opciones: opciones.proveedores, required: true },
                { name: 'acuerdoId', label: 'Acuerdo (opcional)', tipo: 'select', opciones: [{ value: '', label: 'Todos los del proveedor' }, ...opciones.acuerdos] },
                { name: 'desde', label: 'Desde', tipo: 'date', required: true, defaultValue: primeroDeMes },
                { name: 'hasta', label: 'Hasta', tipo: 'date', required: true, defaultValue: hoyIso },
                { name: 'aplicarDeposito', label: 'Consumir depósitos vivos antes de transferir', tipo: 'checkbox', defaultValue: 'on' },
                { name: 'notas', label: 'Notas', tipo: 'textarea' },
              ]}
            />
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <FiltrosChips base={BASE} parametro="estado" actual={estadoValido ?? ''} otros={{ proveedor }} opciones={estados.map((e) => ({ value: e, label: SUPPLY_LIQUIDACION_ESTADO_LABELS[e] }))} />
        <FiltroProveedor base={BASE} actual={proveedor} proveedores={opciones.proveedores} otros={{ estado: estadoValido }} />
      </div>

      <Card>
        <CardContent className="pt-6">
          <TablaReporte
            titulo="Liquidaciones"
            columnas={[
              { clave: 'codigo', titulo: 'Liquidación' },
              { clave: 'proveedor', titulo: 'Proveedor' },
              { clave: 'periodo', titulo: 'Período' },
              { clave: 'lineas', titulo: 'Líneas', alinearDerecha: true },
              { clave: 'proveedorMonto', titulo: 'A favor del proveedor', alinearDerecha: true },
              { clave: 'reembolsos', titulo: 'A favor de Membego', alinearDerecha: true },
              { clave: 'deposito', titulo: 'Depósito', alinearDerecha: true },
              { clave: 'neto', titulo: 'Neto', alinearDerecha: true },
              { clave: 'estado', titulo: 'Estado' },
            ]}
            filas={liquidaciones.map((l) => ({
              __clave: l.id,
              codigo: (
                <Link href={`${BASE}/${l.id}`} className="font-medium underline-offset-4 hover:underline">
                  {l.codigo}
                </Link>
              ),
              proveedor: l.proveedor.name,
              periodo: `${formatDate(l.periodoDesde)} → ${formatDate(l.periodoHasta)}`,
              lineas: l._count.lineas,
              proveedorMonto: formatMoneyRD(Number(l.montoProveedor) + Number(l.redencionesMonto)),
              reembolsos: formatMoneyRD(Number(l.reembolsos)),
              deposito: formatMoneyRD(Number(l.depositoAplicado)),
              neto: <strong className={Number(l.netoLiquidar) < 0 ? 'text-destructive' : undefined}>{formatMoneyRD(Number(l.netoLiquidar))}</strong>,
              estado: <Badge variant={varianteLiquidacion(l.estado)}>{SUPPLY_LIQUIDACION_ESTADO_LABELS[l.estado]}</Badge>,
            }))}
            vacio="Ninguna liquidación con ese filtro."
          />
        </CardContent>
      </Card>
    </div>
  )
}
