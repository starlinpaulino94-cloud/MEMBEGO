import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  Users,
  Target,
  Trophy,
  Share2,
  Eye,
  UserPlus,
  CheckCircle2,
  Gift,
  CreditCard,
  ShoppingBag,
  TrendingDown,
  Pencil,
  ArrowLeft,
  Clock,
  Link2,
} from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { campanaEstadoUi } from '@/lib/estados'
import { formatDate } from '@/lib/format'
import { ADMIN_ROLES } from '@/types'
import { getCampanaDashboard } from '@/modules/invitaciones/queries'
import { absoluteUrl } from '@/lib/site'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CampanaEstadoButton } from '@/components/invitaciones/CampanaEstadoButton'
import { CampanaEliminarButton } from '@/components/invitaciones/CampanaEliminarButton'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Detalle de campaña' }


function fmtDate(d: Date) {
  return formatDate(d)
}

function pct(n: number, d: number) {
  if (d === 0) return '0%'
  return `${((n / d) * 100).toFixed(1)}%`
}

const FUNNEL_STEPS = [
  { key: 'compartidas', label: 'Compartidas', icon: Share2 },
  { key: 'enlacesAbiertos', label: 'Enlaces abiertos', icon: Link2 },
  { key: 'landingVistas', label: 'Landing vistas', icon: Eye },
  { key: 'registrosIniciados', label: 'Registros iniciados', icon: UserPlus },
  { key: 'registrosCompletados', label: 'Registros completados', icon: CheckCircle2 },
  { key: 'premiosReclamados', label: 'Premios reclamados', icon: Gift },
  { key: 'membresiasAdquiridas', label: 'Membresías adquiridas', icon: CreditCard },
  { key: 'primerCanje', label: 'Primer canje', icon: ShoppingBag },
  { key: 'conversionFinal', label: 'Conversión final', icon: TrendingDown },
] as const

export default async function CampanaDetallePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireRole(ADMIN_ROLES)
  const { id } = await params
  const data = await getCampanaDashboard(id)
  if (!data || !data.campana) notFound()

  const { campana, embudoStats, participantes, metasAlcanzadas, premiosReclamados, topCompartidores } = data
  const badge = campanaEstadoUi(campana.estado)
  const url = absoluteUrl(`/invita/${campana.slug}`)

  return (
    <div className="space-y-6">
      <PageHeader
        title={campana.nombre}
        description={campana.titulo}
        action={
          <div className="flex items-center gap-2">
            <CampanaEstadoButton id={campana.id} estado={campana.estado} />
            <Link href={`/admin/invitaciones/${campana.id}/editar`}>
              <Button variant="outline" size="sm" className="gap-1">
                <Pencil className="h-3.5 w-3.5" />
                Editar
              </Button>
            </Link>
            <CampanaEliminarButton id={campana.id} />
            <Link href="/admin/invitaciones">
              <Button variant="ghost" size="sm" className="gap-1">
                <ArrowLeft className="h-3.5 w-3.5" />
                Volver
              </Button>
            </Link>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <Badge variant={badge.variant}>{badge.label}</Badge>
        <span className="flex items-center gap-1">
          <Clock className="h-3.5 w-3.5" />
          {fmtDate(campana.fechaInicio)} — {fmtDate(campana.fechaFin)}
        </span>
        <code className="rounded bg-muted px-2 py-0.5 text-xs">{url}</code>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Users} label="Participantes" value={participantes} />
        <StatCard icon={Target} label="Metas alcanzadas" value={metasAlcanzadas} />
        <StatCard icon={Trophy} label="Premios reclamados" value={premiosReclamados} />
        <StatCard
          icon={Target}
          label="Tasa de meta"
          value={pct(metasAlcanzadas, participantes)}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Embudo de conversión</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {(() => {
              // Base del embudo = la etapa más alta (normalmente las visitas a
              // la landing). Así las barras son proporcionales y ningún % supera
              // el 100% (antes se calculaba contra "Compartidas", de ahí los
              // 200%/233% sin sentido cuando un enlace se abre varias veces).
              const funnelMax = Math.max(
                ...FUNNEL_STEPS.map((s) => embudoStats[s.key]),
                1
              )
              return FUNNEL_STEPS.map((step) => {
                const count = embudoStats[step.key]
                const width = Math.max((count / funnelMax) * 100, 2)
                const Icon = step.icon
                return (
                  <div key={step.key} className="flex items-center gap-3">
                    <div className="flex w-44 items-center gap-2 shrink-0">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">{step.label}</span>
                    </div>
                    <div className="flex-1 h-6 bg-muted rounded-lg overflow-hidden">
                      <div
                        className="h-full bg-primary/80 rounded-lg transition-all"
                        style={{ width: `${width}%` }}
                      />
                    </div>
                    <span className="w-16 text-right text-sm font-medium tabular-nums">
                      {count}
                    </span>
                    <span className="w-14 text-right text-xs text-muted-foreground tabular-nums">
                      {pct(count, funnelMax)}
                    </span>
                  </div>
                )
              })
            })()}
          </div>
        </CardContent>
      </Card>

      {topCompartidores.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top compartidores</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 font-medium">#</th>
                    <th className="pb-2 font-medium">Cliente</th>
                    <th className="pb-2 text-right font-medium">Compartidas</th>
                    <th className="pb-2 text-right font-medium">Registros</th>
                  </tr>
                </thead>
                <tbody>
                  {topCompartidores.map((t, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-2 text-muted-foreground">{i + 1}</td>
                      <td className="py-2 font-medium text-foreground">{t.nombre}</td>
                      <td className="py-2 text-right tabular-nums">{t.compartidas}</td>
                      <td className="py-2 text-right tabular-nums">{t.registros}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Users
  label: string
  value: number | string
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 py-4">
        <div className="rounded-lg bg-primary/10 p-2.5">
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <div>
          <p className="text-2xl font-bold text-foreground">{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  )
}
