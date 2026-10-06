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
import { alertasDeVencimiento, umbralesVencimiento, vencimientosProximos } from '@/modules/supply/vencimientos'
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

  const [alertas, otros] = await Promise.all([alertasDeVencimiento(ventana), vencimientosProximos(ventana)])
  const derechos = otros.filter((v) => v.tipo === 'DERECHO')
  const depositos = otros.filter((v) => v.tipo === 'DEPOSITO')
  const acuerdos = otros.filter((v) => v.tipo === 'ACUERDO')
  const umbrales = umbralesVencimiento()
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
        {[...new Set([1, 7, 15, 30, 60, 90, ...umbrales])].sort((a, b) => a - b).map((d) => (
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

      <p className="text-caption text-muted-foreground">
        Umbrales de aviso: {umbrales.join(' · ')} días (variable <code>SUPPLY_UMBRALES_VENCIMIENTO</code>). Cada día el cron avisa por lo que cruza un umbral: lotes, derechos en manos de clientes, depósitos con saldo y acuerdos.
      </p>

      {alertas.length === 0 && otros.length === 0 ? (
        <EmptyState
          variant="card"
          title={`Nada vence en los próximos ${ventana} días`}
          description="No hay supply, derechos, depósitos ni acuerdos en riesgo en esta ventana. Amplía el rango para mirar más lejos."
        />
      ) : alertas.length === 0 ? null : (
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
                    <span className="flex flex-col gap-1 text-caption">
                      <span className="text-muted-foreground">{a.acciones.map((ac) => ACCION_VENCIMIENTO_LABELS[ac] ?? ac).join(' · ')}</span>
                      <span className="flex flex-wrap gap-2">
                        <Link href={`/superadmin/supply/lotes/${a.loteId}#acciones`} className="underline underline-offset-4">Crear oferta / regalar</Link>
                        <Link href={`/superadmin/supply/lotes/${a.loteId}#acciones`} className="underline underline-offset-4">Transferir</Link>
                        <Link href={`/superadmin/supply/lotes/${a.loteId}#acciones`} className="underline underline-offset-4">Extender fecha</Link>
                        <Link href={`/superadmin/supply/lotes/${a.loteId}#acciones`} className="underline underline-offset-4">Cancelar unidades</Link>
                        <Link href={`/superadmin/supply/acuerdos/${a.acuerdoId}`} className="underline underline-offset-4">Negociar (enmienda)</Link>
                      </span>
                    </span>
                  ),
                }))}
              />
            </CardContent>
          </Card>
        </>
      )}

      <SeccionVencimientos
        titulo="Derechos en manos de clientes"
        descripcion="Vouchers activos que caducan sin usarse: la unidad ya está pagada."
        filas={derechos}
        href={(v) => `/superadmin/supply/lotes/${v.id.split(':')[0]}`}
        unidades
      />
      <SeccionVencimientos
        titulo="Depósitos con saldo que llegan a su cierre"
        descripcion="Dinero entregado al proveedor que hay que aplicar, prorrogar o recuperar."
        filas={depositos}
        href={(v) => `/superadmin/supply/finanzas/depositos/${v.id}`}
      />
      <SeccionVencimientos
        titulo="Acuerdos que terminan"
        descripcion="Al vencer, ya no se compra ni se vende contra ellos: renovar o cerrar."
        filas={acuerdos}
        href={(v) => `/superadmin/supply/acuerdos/${v.id}`}
      />
    </div>
  )
}

function SeccionVencimientos({
  titulo,
  descripcion,
  filas,
  href,
  unidades = false,
}: {
  titulo: string
  descripcion: string
  filas: Awaited<ReturnType<typeof vencimientosProximos>>
  href: (v: Awaited<ReturnType<typeof vencimientosProximos>>[number]) => string
  unidades?: boolean
}) {
  if (filas.length === 0) return null
  return (
    <Card>
      <CardContent className="pt-6">
        <h2 className="text-base font-semibold">{titulo}</h2>
        <p className="mb-3 text-caption text-muted-foreground">{descripcion}</p>
        <TablaReporte
          titulo={titulo}
          columnas={[
            { clave: 'codigo', titulo: 'Código' },
            { clave: 'proveedor', titulo: 'Proveedor' },
            { clave: 'descripcion', titulo: 'Qué pasa' },
            ...(unidades ? [{ clave: 'unidades', titulo: 'Unidades', alinearDerecha: true }] : []),
            { clave: 'monto', titulo: 'En juego', alinearDerecha: true },
            { clave: 'vence', titulo: 'Vence' },
            { clave: 'dias', titulo: 'Días', alinearDerecha: true },
          ]}
          filas={filas.map((v) => ({
            __clave: v.id,
            codigo: (
              <Link href={href(v)} className="font-medium underline-offset-4 hover:underline">
                {v.codigo}
              </Link>
            ),
            proveedor: v.proveedorNombre,
            descripcion: v.descripcion,
            unidades: v.unidades.toLocaleString('es-DO'),
            monto: formatMoneyRD(v.monto),
            vence: formatDate(v.venceAt),
            dias: (
              <Badge variant={v.nivel === 'CRITICO' ? 'destructive' : v.nivel === 'ALTO' ? 'warning' : 'outline'}>{v.diasRestantes}</Badge>
            ),
          }))}
        />
      </CardContent>
    </Card>
  )
}
