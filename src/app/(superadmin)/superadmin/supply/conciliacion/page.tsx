import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { StatCard } from '@/components/ui/stat-card'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { TablaReporte } from '@/components/ui/reporte-imprimible'
import { formatDate, formatDateTime, formatMoneyRD } from '@/lib/format'
import { NavSupply } from '@/components/supply/nav'
import { FormAccion } from '@/components/supply/form-accion'
import { conciliar, senalesDeRiesgo } from '@/modules/supply/conciliacion'
import { listarConciliaciones } from '@/modules/supply/conciliacion-proveedor'
import { listarLiquidaciones } from '@/modules/supply/liquidaciones'
import { opcionesFinanzas } from '@/modules/supply/opciones'
import { abrirConciliacionAction } from '@/modules/supply/actions-finanzas'
import { HALLAZGO_LABELS } from '@/modules/supply/hallazgos'
import { BotonRecalcular } from '@/components/supply/boton-recalcular'
import { DISCREPANCIA_VIVA } from '@/modules/supply/estados'
import { SUPPLY_CONCILIACION_ESTADO_LABELS } from '@/modules/supply/catalogo'
import { varianteConciliacion } from '@/components/supply/variantes'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Conciliación de supply' }

const BASE = '/superadmin/supply/conciliacion'

/**
 * MEMBEGO SUPPLY · CONCILIACIÓN (Fases 32, 53, 54; §18 del encargo).
 *
 * Dos capas. La interna contrasta contadores contra ledger, redenciones
 * contra vouchers, campañas contra derechos: es la herramienta que se abre el
 * día que algo no cuadra. La externa contrasta lo que dice Membego con lo que
 * DECLARA EL PROVEEDOR para un período, y cada diferencia es una discrepancia
 * con tipo, investigación, notas, ajuste y aprobación.
 */
export default async function ConciliacionPage() {
  await requireRole('SUPERADMIN')

  const [reporte, senales, conciliaciones, opciones, liquidaciones] = await Promise.all([
    conciliar(),
    senalesDeRiesgo(),
    listarConciliaciones({ limite: 100 }),
    opcionesFinanzas(),
    listarLiquidaciones({ limite: 60 }),
  ])

  const hoy = new Date()
  const primeroDeMes = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1)).toISOString().slice(0, 10)
  const hoyIso = hoy.toISOString().slice(0, 10)
  const abiertas = conciliaciones.filter((c) => c.estado !== 'CERRADA')
  const discrepanciasVivas = conciliaciones.reduce((t, c) => t + c.discrepancias.filter((d) => DISCREPANCIA_VIVA.includes(d.estado)).length, 0)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Conciliación"
        description="Contrasta lo que Membego registró con lo que declara cada proveedor, y por dentro los contadores contra el ledger. Cada diferencia es una discrepancia con dueño y resolución."
        eyebrow={
          <Link href="/superadmin/supply" className="hover:underline">
            Membego Supply
          </Link>
        }
        nav={<NavSupply activa="conciliacion" />}
      />

      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard label="Conciliaciones abiertas" value={abiertas.length} sub="con proveedores" accent={abiertas.length > 0 ? 'warning' : undefined} />
        <StatCard label="Discrepancias vivas" value={discrepanciasVivas} accent={discrepanciasVivas > 0 ? 'danger' : 'success'} />
        <StatCard label="Hallazgos internos críticos" value={reporte.criticos} sub={`${reporte.lotesRevisados} lotes revisados · ${formatDateTime(reporte.generadoAt)}`} accent={reporte.criticos > 0 ? 'danger' : 'success'} />
        <StatCard label="Hallazgos altos / medios" value={`${reporte.altos} / ${reporte.medios}`} accent={reporte.altos > 0 ? 'warning' : undefined} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Abrir una conciliación con un proveedor</CardTitle>
        </CardHeader>
        <CardContent>
          {opciones.proveedores.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay proveedores.</p>
          ) : (
            <FormAccion
              accion={abrirConciliacionAction}
              etiqueta="Abrir conciliación"
              etiquetaPendiente="Comparando…"
              nota="Membego calcula sus cifras del período y las compara con las declaradas: las diferencias nacen como discrepancias."
              campos={[
                { name: 'proveedorId', label: 'Proveedor', tipo: 'select', opciones: opciones.proveedores, required: true },
                { name: 'acuerdoId', label: 'Acuerdo (opcional)', tipo: 'select', opciones: [{ value: '', label: 'Todos' }, ...opciones.acuerdos] },
                { name: 'liquidacionId', label: 'Liquidación (opcional)', tipo: 'select', opciones: [{ value: '', label: '—' }, ...liquidaciones.map((l) => ({ value: l.id, label: `${l.codigo} · ${l.proveedor.name} · ${l.estado}` }))] },
                { name: 'desde', label: 'Desde', tipo: 'date', required: true, defaultValue: primeroDeMes },
                { name: 'hasta', label: 'Hasta', tipo: 'date', required: true, defaultValue: hoyIso },
                { name: 'proveedorRedenciones', label: 'Redenciones que declara', tipo: 'number', step: '1', min: 0, required: true },
                { name: 'proveedorMonto', label: 'Monto que declara', tipo: 'number', min: 0, required: true },
                { name: 'proveedorVentas', label: 'Entregas de ventas que declara', tipo: 'number', step: '1', min: 0 },
                { name: 'proveedorVentasMonto', label: 'Monto de ventas que declara', tipo: 'number', min: 0 },
                { name: 'documentos', label: 'Documentos (una ruta por línea)', tipo: 'textarea' },
                { name: 'notas', label: 'Notas', tipo: 'textarea' },
              ]}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Conciliaciones con proveedores</CardTitle>
        </CardHeader>
        <CardContent>
          <TablaReporte
            titulo="Conciliaciones"
            columnas={[
              { clave: 'codigo', titulo: 'Conciliación' },
              { clave: 'proveedor', titulo: 'Proveedor' },
              { clave: 'periodo', titulo: 'Período' },
              { clave: 'redenciones', titulo: 'Redenciones M / P', alinearDerecha: true },
              { clave: 'monto', titulo: 'Monto M / P', alinearDerecha: true },
              { clave: 'discrepancias', titulo: 'Discrepancias', alinearDerecha: true },
              { clave: 'liquidacion', titulo: 'Liquidación' },
              { clave: 'estado', titulo: 'Estado' },
            ]}
            filas={conciliaciones.map((c) => {
              const vivas = c.discrepancias.filter((d) => DISCREPANCIA_VIVA.includes(d.estado)).length
              return {
                __clave: c.id,
                codigo: (
                  <Link href={`${BASE}/${c.id}`} className="font-medium underline-offset-4 hover:underline">
                    {c.codigo}
                  </Link>
                ),
                proveedor: c.proveedor.name,
                periodo: `${formatDate(c.periodoDesde)} → ${formatDate(c.periodoHasta)}`,
                redenciones: `${c.membegoRedenciones} / ${c.proveedorRedenciones}`,
                monto: `${formatMoneyRD(Number(c.membegoMonto))} / ${formatMoneyRD(Number(c.proveedorMonto))}`,
                discrepancias: vivas > 0 ? <Badge variant="destructive">{vivas} vivas de {c.discrepancias.length}</Badge> : `${c.discrepancias.length}`,
                liquidacion: c.liquidacion ? (
                  <Link href={`/superadmin/supply/finanzas/liquidaciones/${c.liquidacion.id}`} className="underline-offset-4 hover:underline">
                    {c.liquidacion.codigo}
                  </Link>
                ) : (
                  '—'
                ),
                estado: <Badge variant={varianteConciliacion(c.estado)}>{SUPPLY_CONCILIACION_ESTADO_LABELS[c.estado]}</Badge>,
              }
            })}
            vacio="Todavía no se ha abierto ninguna conciliación con un proveedor."
          />
        </CardContent>
      </Card>

      {reporte.cuadra ? (
        <EmptyState
          variant="card"
          title="Por dentro, todo cuadra"
          description="Los contadores coinciden con el ledger, no hay redenciones duplicadas ni campañas que hayan repartido de más. El invariante se cumple en todos los lotes revisados."
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Hallazgos internos</CardTitle>
          </CardHeader>
          <CardContent>
            <TablaReporte
              titulo="Hallazgos de conciliación interna"
              columnas={[
                { clave: 'gravedad', titulo: 'Gravedad' },
                { clave: 'tipo', titulo: 'Qué pasa' },
                { clave: 'titulo', titulo: 'Dónde' },
                { clave: 'detalle', titulo: 'Detalle' },
                { clave: 'accion', titulo: '' },
              ]}
              filas={reporte.hallazgos.map((h, i) => ({
                __clave: `${h.entidad}-${h.entidadId}-${i}`,
                gravedad: (
                  <Badge variant={h.gravedad === 'CRITICA' ? 'destructive' : h.gravedad === 'ALTA' ? 'warning' : 'outline'}>{h.gravedad}</Badge>
                ),
                tipo: HALLAZGO_LABELS[h.tipo],
                titulo: h.loteId ? (
                  <Link href={`/superadmin/supply/lotes/${h.loteId}`} className="underline-offset-4 hover:underline">
                    {h.titulo}
                  </Link>
                ) : (
                  h.titulo
                ),
                detalle: <span className="text-caption text-muted-foreground">{h.detalle}</span>,
                accion:
                  h.tipo === 'DERIVA_CONTADORES' && h.loteId ? (
                    <BotonRecalcular loteId={h.loteId} />
                  ) : (
                    <span className="text-caption text-muted-foreground">
                      {h.entidad} · {h.entidadId.slice(0, 10)}…
                    </span>
                  ),
              }))}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Señales de riesgo por proveedor</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-caption text-muted-foreground">
            Reglas deterministas, no un modelo: se aplican sobre proveedores con al menos diez entregas, para no etiquetar a nadie por una muestra de tres.
          </p>
          <TablaReporte
            titulo="Señales de riesgo"
            columnas={[
              { clave: 'proveedor', titulo: 'Proveedor' },
              { clave: 'senal', titulo: 'Señal' },
              { clave: 'detalle', titulo: 'Detalle' },
            ]}
            filas={senales.map((s, i) => ({
              __clave: `${s.proveedorId}-${i}`,
              proveedor: (
                <Link href={`/superadmin/supply/proveedores/${s.proveedorId}`} className="underline-offset-4 hover:underline">
                  {s.proveedorNombre}
                </Link>
              ),
              senal: <Badge variant="warning">{s.senal}</Badge>,
              detalle: s.detalle,
            }))}
            vacio="Ningún proveedor con volumen suficiente muestra señales de riesgo."
          />
        </CardContent>
      </Card>
    </div>
  )
}
