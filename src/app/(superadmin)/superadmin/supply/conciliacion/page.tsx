import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { StatCard } from '@/components/ui/stat-card'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { TablaReporte } from '@/components/ui/reporte-imprimible'
import { formatDateTime } from '@/lib/format'
import { NavSupply } from '@/components/supply/nav'
import { conciliar, senalesDeRiesgo } from '@/modules/supply/conciliacion'
import { HALLAZGO_LABELS } from '@/modules/supply/hallazgos'
import { BotonRecalcular } from '@/components/supply/boton-recalcular'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Conciliación de supply' }

/**
 * MEMBEGO SUPPLY · CONCILIACIÓN (Fases 32, 53, 54).
 *
 * No es un panel de porcentajes verdes: es la herramienta que se abre el día
 * que algo no cuadra. Por eso cada hallazgo dice QUÉ FILA mirar y trae el
 * botón que lo arregla cuando el arreglo es mecánico (recalcular contadores
 * desde el ledger).
 *
 * Un hallazgo CRÍTICO significa que las cifras de supply son mentira, y que
 * nada de lo que hay encima —reportes, liquidaciones, unit economics— se
 * puede creer hasta resolverlo. Por eso se separan de los demás.
 */
export default async function ConciliacionPage() {
  await requireRole('SUPERADMIN')

  const [reporte, senales] = await Promise.all([conciliar(), senalesDeRiesgo()])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Conciliación"
        description="Contrasta los contadores contra el ledger, las redenciones contra los vouchers y las campañas contra los derechos que existen de verdad."
        eyebrow={
          <Link href="/superadmin/supply" className="hover:underline">
            Membego Supply
          </Link>
        }
        nav={<NavSupply activa="conciliacion" />}
      />

      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard
          label="Lotes revisados"
          value={reporte.lotesRevisados}
          sub={formatDateTime(reporte.generadoAt)}
        />
        <StatCard
          label="Críticos"
          value={reporte.criticos}
          sub="invalidan las cifras"
          accent={reporte.criticos > 0 ? 'danger' : 'success'}
        />
        <StatCard
          label="Altos"
          value={reporte.altos}
          sub="hay que corregirlos"
          accent={reporte.altos > 0 ? 'warning' : undefined}
        />
        <StatCard label="Medios" value={reporte.medios} sub="revisables sin urgencia" />
      </div>

      {reporte.cuadra ? (
        <EmptyState
          variant="card"
          title="Todo cuadra"
          description="Los contadores coinciden con el ledger, no hay redenciones duplicadas ni campañas que hayan repartido de más. El invariante se cumple en todos los lotes revisados."
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Hallazgos</CardTitle>
          </CardHeader>
          <CardContent>
            <TablaReporte
              titulo="Hallazgos de conciliación"
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
                  <Badge
                    variant={
                      h.gravedad === 'CRITICA'
                        ? 'destructive'
                        : h.gravedad === 'ALTA'
                          ? 'warning'
                          : 'outline'
                    }
                  >
                    {h.gravedad}
                  </Badge>
                ),
                tipo: HALLAZGO_LABELS[h.tipo],
                titulo: h.loteId ? (
                  <Link
                    href={`/superadmin/supply/lotes/${h.loteId}`}
                    className="underline-offset-4 hover:underline"
                  >
                    {h.titulo}
                  </Link>
                ) : (
                  h.titulo
                ),
                detalle: <span className="text-caption text-muted-foreground">{h.detalle}</span>,
                // Solo la deriva de contadores tiene arreglo mecánico: se
                // recalcula desde el ledger. Los demás hallazgos exigen decidir
                // algo, y un botón "arreglar" sería una invitación a tapar el
                // problema sin mirarlo.
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
            Reglas deterministas, no un modelo: se aplican sobre proveedores con al menos diez
            entregas, para no etiquetar a nadie por una muestra de tres.
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
                <Link
                  href={`/superadmin/supply/proveedores/${s.proveedorId}`}
                  className="underline-offset-4 hover:underline"
                >
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
