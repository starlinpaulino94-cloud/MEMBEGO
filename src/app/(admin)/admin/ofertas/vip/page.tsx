import Link from 'next/link'
import { Gift, Plus, Users, ArrowLeft } from 'lucide-react'
import { ADMIN_ROLES } from '@/types'
import { requireRole } from '@/lib/auth/guards'
import { empresaDelPanel } from '@/modules/admin/queries'
import { getOfertasAdmin } from '@/modules/ofertas/queries'
import { PERIODO_LABEL } from '@/modules/ofertas/periodo'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Regalos VIP' }

const ESTADO_CLASE: Record<string, string> = {
  ACTIVA: 'bg-success/15 text-success',
  PAUSADA: 'bg-warning/15 text-warning',
  FINALIZADA: 'bg-muted text-muted-foreground',
}

export default async function OfertasVipPage() {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = empresaDelPanel(user)

  if (!companyId) {
    return <SinEmpresaActiva seccion="tus regalos VIP" />
  }

  const ofertas = await getOfertasAdmin(companyId)

  return (
    <div className="space-y-6">
      <Link
        href="/admin/ofertas"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Ofertas
      </Link>

      <PageHeader
        title="Regalos VIP"
        description="Ofertas privadas para clientes seleccionados: no se publican, solo se comparten por link y únicamente tu lista puede reclamarlas."
        action={
          <Button asChild className="gap-1.5">
            <Link href="/admin/ofertas/nueva">
              <Plus className="h-4 w-4" /> Crear regalo
            </Link>
          </Button>
        }
      />

      {ofertas.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/80 bg-muted/20 p-10 text-center">
          <Gift className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
          <p className="font-semibold text-foreground">Aún no tienes regalos VIP</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Crea el primero: por ejemplo, &quot;12 lavados gratis al mes por un
            año&quot; para tus mejores clientes.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {ofertas.map((o) => (
            <Link
              key={o.id}
              href={`/admin/ofertas/${o.id}`}
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/70 bg-card p-4 shadow-card transition hover:-translate-y-0.5 hover:shadow-premium"
            >
              <div className="min-w-0">
                <p className="font-semibold text-foreground">{o.titulo}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {o.usosPorPeriodo} usos {PERIODO_LABEL[o.periodo]}
                  {o.vigenciaHasta
                    ? ` · hasta ${new Intl.DateTimeFormat('es-DO', { dateStyle: 'medium' }).format(o.vigenciaHasta)}`
                    : ''}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Users className="h-4 w-4" />
                  {o.invitados.length}/{o._count.invitados} reclamaron
                </span>
                <Badge className={cn('hover:bg-inherit', ESTADO_CLASE[o.estado] ?? '')}>
                  {o.estado === 'ACTIVA' ? 'Activa' : o.estado === 'PAUSADA' ? 'Pausada' : 'Finalizada'}
                </Badge>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
