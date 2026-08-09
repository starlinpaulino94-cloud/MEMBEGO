import Link from 'next/link'
import { ADMIN_ROLES } from '@/types'
import { requireRole } from '@/lib/auth/guards'
import { SegmentoServicio } from '@/modules/geo/segmentacion/segmentos'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { NavAudiencia } from '@/components/admin/NavAudiencia'
import { EmptyState } from '@/components/ui/empty-state'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'
import { Users, Plus } from 'lucide-react'
import {
  archivarSegmento,
  eliminarSegmento,
  estimarSegmento,
} from '@/modules/geo/segmentacion/actions'

export const dynamic = 'force-dynamic'

const fmt = (n: number) => new Intl.NumberFormat('es-DO').format(n)

const ETIQUETA_ESTADO: Record<string, string> = {
  BORRADOR: 'Borrador',
  ACTIVO: 'Activo',
  ARCHIVADO: 'Archivado',
}

export default async function SegmentosPage() {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = user.metadata.companyId
  if (!companyId) return <SinEmpresaActiva seccion="tus segmentos de audiencia" />

  let segmentos: Awaited<ReturnType<typeof SegmentoServicio.listar>> = []
  try {
    segmentos = await SegmentoServicio.listar(companyId)
  } catch (e) {
    console.error('[admin-segmentos]', e)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Audiencia"
        title="Segmentos"
        description="Crea audiencias por ciudad, sector, radio o comportamiento. Las campañas dirigidas las usan para llegar solo a quien corresponde."
        nav={<NavAudiencia activa="/admin/audiencia/segmentos" />}
        action={
          <Button asChild>
            <Link href="/admin/audiencia/segmentos/nueva">
              <Plus className="h-4 w-4" /> Nuevo segmento
            </Link>
          </Button>
        }
      />

      {segmentos.length === 0 ? (
        <EmptyState
          icon={<Users className="h-6 w-6" />}
          title="Aún no tienes segmentos"
          description="Crea tu primer segmento para armar una audiencia por ubicación y lanzar campañas dirigidas."
          action={
            <Button asChild>
              <Link href="/admin/audiencia/segmentos/nueva">Crear segmento</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {segmentos.map((s) => (
            <Card key={s.id}>
              <CardContent className="space-y-3 p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    <Link
                      href={`/admin/audiencia/segmentos/${s.id}/editar`}
                      className="font-semibold text-foreground hover:underline"
                    >
                      {s.nombre}
                    </Link>
                    <div className="flex items-center gap-2">
                      <Badge variant={s.estado === 'ACTIVO' ? 'default' : 'secondary'}>
                        {ETIQUETA_ESTADO[s.estado]}
                      </Badge>
                      {s.campanas > 0 && (
                        <span className="text-xs text-muted-foreground">
                          {s.campanas} campaña{s.campanas > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="text-sm text-muted-foreground">
                  Audiencia estimada:{' '}
                  <span className="font-semibold tabular-nums text-foreground">
                    {s.ultimaAudienciaEstimada != null ? fmt(s.ultimaAudienciaEstimada) : '—'}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/admin/audiencia/segmentos/${s.id}/editar`}>Editar</Link>
                  </Button>
                  <form action={estimarSegmento}>
                    <input type="hidden" name="segmentoId" value={s.id} />
                    <Button size="sm" variant="outline">
                      Estimar
                    </Button>
                  </form>
                  {s.estado !== 'ARCHIVADO' ? (
                    <form action={archivarSegmento}>
                      <input type="hidden" name="segmentoId" value={s.id} />
                      <Button size="sm" variant="ghost">
                        Archivar
                      </Button>
                    </form>
                  ) : null}
                  <form action={eliminarSegmento}>
                    <input type="hidden" name="segmentoId" value={s.id} />
                    <Button size="sm" variant="ghost" className="text-destructive">
                      Eliminar
                    </Button>
                  </form>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
