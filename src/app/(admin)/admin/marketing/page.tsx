import Link from 'next/link'
import { Sparkles, Plus, Pencil, Clock, Users } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { campanaEstadoUi } from '@/lib/estados'
import { formatDate } from '@/lib/format'
import { ADMIN_ROLES } from '@/types'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { getCampanasMarketingAdmin } from '@/modules/engagement/campanas'
import { MARKETING_TIPO_LABEL } from '@/lib/marketing'
import { PageHeader } from '@/components/ui/page-header'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  MarketingEstadoButton,
  MarketingEliminarButton,
} from '@/components/engagement/MarketingCampaignAcciones'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Campañas de Marketing' }


function fmt(d: Date) {
  return formatDate(d, undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export default async function AdminMarketingPage() {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = await resolveCompanyId(user)
  if (!companyId) {
    return <SinEmpresaActiva seccion="tus banners de marketing" />
  }

  const campanas = await getCampanasMarketingAdmin(companyId)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Campañas de Marketing"
        description="Ofertas relámpago, Happy Hour y promociones que aparecen vivas en el inicio de tus clientes, con contador y urgencia."
        action={
          <Link href="/admin/marketing/nueva">
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              Nueva campaña
            </Button>
          </Link>
        }
      />

      {campanas.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Sparkles className="mx-auto mb-4 h-12 w-12 text-muted-foreground/40" />
            <h3 className="text-lg font-semibold text-foreground">Sin campañas todavía</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Crea tu primera oferta con contador para que el inicio de tus clientes se
              sienta vivo.
            </p>
            <Link href="/admin/marketing/nueva" className="mt-5 inline-block">
              <Button className="gap-2">
                <Plus className="h-4 w-4" />
                Crear campaña
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {campanas.map((c) => {
            const badge = campanaEstadoUi(c.estado)
            const cupos =
              c.maxReclamos != null
                ? `${Math.max(0, c.maxReclamos - c.reclamosCount)} / ${c.maxReclamos} cupos`
                : null
            return (
              <Card key={c.id}>
                <CardContent className="py-4">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div
                      className="hidden h-12 w-12 shrink-0 rounded-xl sm:block"
                      style={{
                        background: `linear-gradient(135deg, ${c.colorPrimario ?? 'var(--primary)'}, ${c.colorSecundario ?? 'var(--accent)'})`,
                      }}
                    />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate font-semibold text-foreground">{c.titulo}</h3>
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                        <Badge variant="outline">
                          {MARKETING_TIPO_LABEL[c.tipo] ?? c.tipo}
                        </Badge>
                        {c.destacada && <Badge variant="secondary">Destacada</Badge>}
                      </div>
                      <p className="truncate text-sm text-muted-foreground">{c.descripcion}</p>
                      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {fmt(c.fechaInicio)} — {fmt(c.fechaFin)}
                        </span>
                        {cupos && (
                          <span className="flex items-center gap-1">
                            <Users className="h-3 w-3" />
                            {cupos}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <MarketingEstadoButton id={c.id} estado={c.estado} />
                      <Link href={`/admin/marketing/${c.id}/editar`}>
                        <Button variant="outline" size="sm" className="gap-1">
                          <Pencil className="h-3.5 w-3.5" />
                          Editar
                        </Button>
                      </Link>
                      <MarketingEliminarButton id={c.id} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
