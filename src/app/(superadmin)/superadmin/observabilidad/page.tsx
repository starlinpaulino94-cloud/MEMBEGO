import { requireRole } from '@/lib/auth/guards'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Activity, Database, CreditCard, Users, AlertTriangle, TrendingDown, TrendingUp } from 'lucide-react'
import {
  estadoGeneral,
  leerMetricas,
  saturacionConexiones,
  variacionVisitas,
} from '@/modules/observabilidad/metricas'
import { SLOS, minutosPresupuesto, presupuestoLegible, umbralDeAlerta } from '@/modules/observabilidad/slo'

export const dynamic = 'force-dynamic'

/**
 * Panel de observabilidad del superadministrador (auditoría · A-09, Fase 6).
 *
 * POR QUÉ EXISTE UNA PÁGINA Y NO SOLO EL ENDPOINT: `/api/metricas` sirve para
 * que una máquina alerte. Esta página sirve para que una PERSONA mire, que es
 * lo que de verdad ocurre en un negocio de una persona. Montar Grafana para
 * ver ocho números sería pagar una herramienta para no usarla.
 *
 * Lo que esta página NO es: un panel de latencias en tiempo real. Eso vive en
 * los eventos estructurados (`src/modules/observabilidad/eventos.ts`) y en
 * Sentry, porque la base de datos no guarda cuánto tardó cada petición.
 * Ver docs/OBSERVABILIDAD.md.
 */
export default async function ObservabilidadPage() {
  await requireRole('SUPERADMIN')

  const m = await leerMetricas()
  const estado = estadoGeneral(m)
  const variacion = variacionVisitas(m.negocio)
  const saturacion = saturacionConexiones(m.sistema)

  const colorEstado =
    estado === 'ok'
      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
      : estado === 'degradado'
        ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
        : 'bg-red-500/15 text-red-600 dark:text-red-400'

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Observabilidad</h1>
          <p className="text-sm text-muted-foreground">
            Últimas 24 horas, sin contar las empresas de práctica.
          </p>
        </div>
        <Badge className={colorEstado}>
          <Activity className="mr-1 h-3.5 w-3.5" />
          {estado === 'ok' ? 'Todo normal' : estado === 'degradado' ? 'Degradado' : 'Crítico'}
        </Badge>
      </header>

      {m.fallos.length > 0 && (
        <Card className="border-amber-500/40">
          <CardContent className="flex items-start gap-3 pt-6 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <p>
              No se pudieron leer estos bloques: <strong>{m.fallos.join(', ')}</strong>. Los números
              que faltan aparecen como <em>sin dato</em>, no como cero — un cero inventado en un
              panel de operaciones se cree justo el día que importa.
            </p>
          </CardContent>
        </Card>
      )}

      {/* ── Negocio ──────────────────────────────────────────────────────── */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metrica
          icono={<Users className="h-4 w-4" />}
          titulo="Visitas"
          valor={m.negocio.visitas24h}
          pie={
            variacion === null
              ? 'Sin base de comparación'
              : `${variacion >= 0 ? '+' : ''}${variacion.toFixed(0)}% frente a ayer`
          }
          tendencia={variacion === null ? undefined : variacion >= 0 ? 'sube' : 'baja'}
        />
        <Metrica
          icono={<CreditCard className="h-4 w-4" />}
          titulo="Transacciones"
          valor={m.negocio.transacciones24h}
          pie="Cobros registrados"
        />
        <Metrica
          icono={<Users className="h-4 w-4" />}
          titulo="Clientes nuevos"
          valor={m.negocio.clientesNuevos24h}
          pie="Altas en 24 h"
        />
        <Metrica
          icono={<Activity className="h-4 w-4" />}
          titulo="Empresas activas"
          valor={m.negocio.empresasActivas}
          pie="Sin las de práctica"
        />
      </section>

      {/* ── Pagos ───────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pasarela de pago</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <Dato etiqueta="Aprobados" valor={m.negocio.pagosAprobados24h} />
          <Dato etiqueta="Rechazados" valor={m.negocio.pagosRechazados24h} />
          <div>
            <p className="text-sm text-muted-foreground">Sin resolver</p>
            <p
              className={`text-2xl font-semibold ${
                m.negocio.pagosSinResolver > 0 ? 'text-amber-600 dark:text-amber-400' : ''
              }`}
            >
              {m.negocio.pagosSinResolver}
            </p>
            {m.negocio.pagosSinResolver > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                Cobros iniciados hace más de una hora que nunca se cerraron. Cada uno es un cliente
                que pagó y no recibió lo suyo, o que se fue sin pagar. Conciliar con el runbook de
                pagos.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Sistema ─────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Database className="h-4 w-4" />
            Base de datos
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <Dato
            etiqueta="Latencia"
            valor={m.sistema.latenciaBdMs === null ? null : `${m.sistema.latenciaBdMs} ms`}
            aviso={m.sistema.latenciaBdMs !== null && m.sistema.latenciaBdMs > 300}
          />
          <Dato
            etiqueta="Conexiones"
            valor={
              m.sistema.conexiones === null
                ? null
                : `${m.sistema.conexiones} / ${m.sistema.conexionesMax ?? '?'}`
            }
            aviso={saturacion !== null && saturacion >= 0.75}
          />
          <Dato
            etiqueta="Índices inválidos"
            valor={m.sistema.indicesInvalidos}
            aviso={(m.sistema.indicesInvalidos ?? 0) > 0}
          />
        </CardContent>
      </Card>

      {/* ── SLO ─────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Objetivos de servicio (SLO)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Son una <strong>propuesta</strong>: nadie los ha aceptado todavía y no hay un mes
            completo de datos para saber si se cumplen. El consumo real del presupuesto se calcula
            con los eventos del log, no con esta página. Ver <code>docs/OBSERVABILIDAD.md</code>.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead className="text-left text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 font-medium">Objetivo</th>
                  <th className="py-2 font-medium">Meta</th>
                  <th className="py-2 font-medium">Presupuesto</th>
                  <th className="py-2 font-medium">Alerta urgente a partir de</th>
                </tr>
              </thead>
              <tbody>
                {SLOS.map((s) => (
                  <tr key={s.id} className="border-b last:border-0">
                    <td className="py-2 pr-4">
                      <p className="font-medium">{s.nombre}</p>
                      <p className="text-xs text-muted-foreground">{s.sli}</p>
                    </td>
                    <td className="py-2 pr-4 tabular-nums">{(s.objetivo * 100).toFixed(1)}%</td>
                    <td className="py-2 pr-4">
                      <span className="tabular-nums">{presupuestoLegible(s)}</span>
                      <span className="block text-xs text-muted-foreground tabular-nums">
                        {Math.round(minutosPresupuesto(s))} min
                      </span>
                    </td>
                    <td className="py-2 tabular-nums">
                      {(umbralDeAlerta(s, 14.4) * 100).toFixed(1)}% de fallos en 1 h
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Medido el {new Date(m.medidoEn).toLocaleString('es-DO')}.
      </p>
    </div>
  )
}

function Metrica({
  icono,
  titulo,
  valor,
  pie,
  tendencia,
}: {
  icono: React.ReactNode
  titulo: string
  valor: number
  pie: string
  tendencia?: 'sube' | 'baja'
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {icono}
          {titulo}
        </div>
        <p className="mt-2 text-3xl font-semibold tabular-nums">
          {valor.toLocaleString('es-DO')}
        </p>
        <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          {tendencia === 'sube' && <TrendingUp className="h-3 w-3 text-emerald-500" />}
          {tendencia === 'baja' && <TrendingDown className="h-3 w-3 text-amber-500" />}
          {pie}
        </p>
      </CardContent>
    </Card>
  )
}

function Dato({
  etiqueta,
  valor,
  aviso,
}: {
  etiqueta: string
  valor: number | string | null
  aviso?: boolean
}) {
  return (
    <div>
      <p className="text-sm text-muted-foreground">{etiqueta}</p>
      <p
        className={`text-2xl font-semibold tabular-nums ${
          aviso ? 'text-amber-600 dark:text-amber-400' : ''
        }`}
      >
        {valor === null ? <span className="text-base font-normal">sin dato</span> : valor}
      </p>
    </div>
  )
}
