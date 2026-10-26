import Link from 'next/link'
import { ADMIN_ROLES } from '@/types'
import { requireRole } from '@/lib/auth/guards'
import { getAudienciaEmpresa, type AudienciaStats } from '@/modules/social/queries'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'
import { StatusBanner } from '@/components/ui/status-banner'
import { StatCard } from '@/components/ui/stat-card'
import { Users, Eye, Percent, Handshake } from 'lucide-react'
import { Tabla } from '@/components/ui/tabla'

export const dynamic = 'force-dynamic'

const fmt = (n: number) => new Intl.NumberFormat('es-DO').format(n)

export default async function AudienciaPage() {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = user.metadata.companyId

  if (!companyId) {
    return <SinEmpresaActiva seccion="tus métricas de audiencia" />
  }

  let stats: AudienciaStats | null = null
  try {
    stats = await getAudienciaEmpresa(companyId)
  } catch (e) {
    console.error('[admin-audiencia]', e)
  }

  if (!stats) {
    return (
      <div className="space-y-6">
        <PageHeader title="Audiencia" />
        <StatusBanner variant="destructive" title="No pudimos cargar las métricas">
          Recarga la página para intentarlo de nuevo.
        </StatusBanner>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Audiencia"
        description="Tus seguidores y el rendimiento de tus promociones en el marketplace."
      />

      {/* CUATRO KPI, no ocho (§44). Eran dos rejillas de cuatro tarjetas
          idénticas —seguidores, nuevos, favoritos, clientes / vistas,
          compartidas, guardadas, CTR—. Arriba quedan las que responden
          "¿cuánta gente y cuánto interactúa?"; el resto son cifras de apoyo. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={Users}
          accent="brand"
          label="Seguidores"
          value={fmt(stats.seguidores)}
          sub={`+${fmt(stats.nuevosSeguidores30d)} en 30 días`}
        />
        <StatCard
          icon={Handshake}
          accent="success"
          label="Clientes obtenidos"
          sub="Últimos 30 días"
          value={fmt(stats.clientesNuevos30d)}
        />
        <StatCard
          icon={Eye}
          accent="brand"
          label="Vistas de promociones"
          value={fmt(stats.vistasTotales)}
        />
        <StatCard
          icon={Percent}
          accent="brand"
          label="Interacción (CTR)"
          sub="Compartidas + guardadas / vistas"
          value={`${stats.ctr.toFixed(1)}%`}
        />
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-3">
        {[
          { label: 'Te marcaron favorita', valor: fmt(stats.favoritos) },
          { label: 'Compartidas', valor: fmt(stats.compartidasTotales) },
          { label: 'Guardadas', valor: fmt(stats.guardadasTotales) },
        ].map((m) => (
          <div key={m.label} className="min-w-0">
            <dt className="truncate text-caption">{m.label}</dt>
            <dd className="truncate text-h4 tabular-nums text-foreground">{m.valor}</dd>
          </div>
        ))}
      </dl>

      {/* Detalle por promoción */}
      <Card>
        <CardContent className="p-0">
          <div className="border-b border-border p-5">
            <h2 className="text-h4 text-foreground">Rendimiento por promoción</h2>
          </div>
          {stats.promos.length === 0 ? (
            <EmptyState
              icon={<Eye className="h-6 w-6" />}
              title="Aún no has publicado promociones"
              description="Publica tu primera promoción para ver aquí su rendimiento."
              action={
                <Button asChild>
                  <Link href="/admin/promociones">Crear promoción</Link>
                </Button>
              }
            />
          ) : (
            <Tabla
              caption="Rendimiento por promoción"
              claveDe={(p) => p.id}
              filas={stats.promos}
              className="border-0 shadow-none"
              columnas={[
                {
                  clave: 'promocion',
                  encabezado: 'Promoción',
                  celda: (p) => (
                    <>
                      <span className="font-medium text-foreground">{p.titulo}</span>
                      {!p.activo && (
                        <Badge variant="secondary" className="ml-2">
                          Inactiva
                        </Badge>
                      )}
                    </>
                  ),
                },
                { clave: 'vistas', encabezado: 'Vistas', tipo: 'numero', valor: (p) => p.vistas },
                { clave: 'compartidas', encabezado: 'Compartidas', tipo: 'numero', valor: (p) => p.compartidas },
                { clave: 'guardadas', encabezado: 'Guardadas', tipo: 'numero', valor: (p) => p.guardadas },
              ]}
              formato={{ numero: fmt }}
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
