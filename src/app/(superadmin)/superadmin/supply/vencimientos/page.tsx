import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { StatCard } from '@/components/ui/stat-card'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { TablaReporte } from '@/components/ui/reporte-imprimible'
import { EmptyState } from '@/components/ui/empty-state'
import { formatDate, formatMoneyRD } from '@/lib/format'
import { NavSupply } from '@/components/supply/nav'
import { alertasDeVencimiento } from '@/modules/supply/vencimientos'
import {
  ACCION_VENCIMIENTO_LABELS,
  SUPPLY_POLITICA_SOBRANTE_LABELS,
  type SupplyPoliticaSobranteLabelKey,
} from '@/modules/supply/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Vencimientos de supply' }

/**
 * MEMBEGO SUPPLY · reporte de VENCIMIENTO (Fases 39, 52).
 *
 * Ordenado por DINERO EN RIESGO, no por fecha. 500 unidades que vencen en diez
 * días importan más que dos que vencen mañana, y una lista por calendario
 * esconde exactamente el caso que hay que atender primero.
 *
 * Las acciones propuestas salen de la POLÍTICA DE SOBRANTES del contrato:
 * «extender la vigencia» solo aparece si se negoció esa posibilidad. Ofrecer
 * botones que el contrato no permite genera peticiones que el proveedor va a
 * rechazar.
 */
export default async function VencimientosPage({
  searchParams,
}: {
  searchParams: Promise<{ dias?: string }>
}) {
  await requireRole('SUPERADMIN')
  const { dias } = await searchParams
  const ventana = Math.min(180, Math.max(1, Number(dias) || 30))

  const alertas = await alertasDeVencimiento(ventana)
  const exposicionTotal = alertas.reduce((t, a) => t + a.exposicionFinanciera, 0)
  const unidades = alertas.reduce((t, a) => t + a.enRiesgo + a.expuestas, 0)
  const criticas = alertas.filter((a) => a.nivel === 'CRITICO')

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vencimientos"
        description="Lo que vence sin usarse ya está pagado. Esto es cuánto dinero está a punto de evaporarse y qué se puede hacer con él."
        eyebrow={
          <Link href="/superadmin/supply" className="hover:underline">
            Membego Supply
          </Link>
        }
        nav={<NavSupply activa="vencimientos" />}
      />

      <div className="flex flex-wrap gap-2">
        {[7, 14, 30, 60, 90].map((d) => (
          <Link
            key={d}
            href={`/superadmin/supply/vencimientos?dias=${d}`}
            className={`rounded-full border px-3 py-1 text-sm ${
              ventana === d ? 'border-primary bg-primary/10 text-primary' : 'border-border'
            }`}
          >
            {d} días
          </Link>
        ))}
      </div>

      {alertas.length === 0 ? (
        <EmptyState
          variant="card"
          title={`Nada vence en los próximos ${ventana} días`}
          description="No hay supply en riesgo en esta ventana. Amplía el rango para mirar más lejos."
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard
              label="Dinero en riesgo"
              value={formatMoneyRD(exposicionTotal)}
              sub={`en los próximos ${ventana} días`}
              accent={exposicionTotal > 0 ? 'warning' : undefined}
            />
            <StatCard
              label="Unidades comprometidas"
              value={unidades.toLocaleString('es-DO')}
              sub="disponibles, apartadas y en manos de clientes"
            />
            <StatCard
              label="Lotes críticos"
              value={criticas.length}
              sub="vencen en 3 días o menos"
              accent={criticas.length > 0 ? 'danger' : undefined}
            />
          </div>

          <Card>
            <CardContent className="pt-6">
              <TablaReporte
                titulo="Supply próximo a vencer, ordenado por riesgo"
                columnas={[
                  { clave: 'lote', titulo: 'Lote' },
                  { clave: 'proveedor', titulo: 'Proveedor' },
                  { clave: 'item', titulo: 'Producto' },
                  { clave: 'enRiesgo', titulo: 'Sin repartir', alinearDerecha: true },
                  { clave: 'expuestas', titulo: 'En clientes', alinearDerecha: true },
                  { clave: 'costo', titulo: 'Costo unit.', alinearDerecha: true },
                  { clave: 'exposicion', titulo: 'En riesgo', alinearDerecha: true },
                  { clave: 'vence', titulo: 'Vence' },
                  { clave: 'dias', titulo: 'Días', alinearDerecha: true },
                  { clave: 'politica', titulo: 'Política' },
                  { clave: 'acciones', titulo: 'Qué se puede hacer' },
                ]}
                filas={alertas.map((a) => ({
                  __clave: a.loteId,
                  lote: (
                    <Link
                      href={`/superadmin/supply/lotes/${a.loteId}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {a.codigo}
                    </Link>
                  ),
                  proveedor: a.proveedorNombre,
                  item: a.item,
                  enRiesgo: a.enRiesgo.toLocaleString('es-DO'),
                  expuestas: a.expuestas.toLocaleString('es-DO'),
                  costo: formatMoneyRD(a.costoUnitario),
                  exposicion: (
                    <span className="font-medium">{formatMoneyRD(a.exposicionFinanciera)}</span>
                  ),
                  vence: formatDate(a.venceAt),
                  dias: (
                    <Badge
                      variant={
                        a.nivel === 'CRITICO'
                          ? 'destructive'
                          : a.nivel === 'ALTO'
                            ? 'warning'
                            : 'outline'
                      }
                    >
                      {a.diasRestantes}
                    </Badge>
                  ),
                  politica:
                    SUPPLY_POLITICA_SOBRANTE_LABELS[
                      a.politicaSobrante as SupplyPoliticaSobranteLabelKey
                    ] ?? a.politicaSobrante,
                  acciones: (
                    <span className="text-caption text-muted-foreground">
                      {a.acciones.map((ac) => ACCION_VENCIMIENTO_LABELS[ac] ?? ac).join(' · ')}
                    </span>
                  ),
                }))}
              />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
