import { ADMIN_ROLES } from '@/types'
import { conEmpresaOTodas } from '@/lib/tenant'
import { requireRole } from '@/lib/auth/guards'
import { contarSegmentos, type ConteoSegmentos } from '@/modules/admin/segmentos'
import { NotifSegmentForm } from '@/components/admin/NotifSegmentForm'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page-header'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'
import { StatusBanner } from '@/components/ui/status-banner'

export const dynamic = 'force-dynamic'

export default async function NotificacionesEmpresaPage() {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = user.metadata.companyId

  if (!companyId) {
    return <SinEmpresaActiva seccion="tus notificaciones" />
  }

  let conteos: ConteoSegmentos = {
    seguidores: 0,
    todos: 0,
    activos: 0,
    por_vencer: 0,
    nuevos: 0,
    inactivos: 0,
  }
  let planes: { id: string; nombre: string }[] = []
  let loadError = false
  try {
    // `contarSegmentos` abre su propia transacción: fuera del envoltorio.
    ;[conteos, planes] = await Promise.all([
      contarSegmentos(companyId),
      conEmpresaOTodas(
        companyId,
        'notificaciones: sin empresa activa es el superadmin',
        (tx) =>
          tx.plan.findMany({
            where: { companyId, activo: true },
            select: { id: true, nombre: true },
            orderBy: { orden: 'asc' },
          })
      ),
    ])
  } catch (e) {
    console.error('[admin-notificaciones]', e)
    loadError = true
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notificaciones"
        description="Envía avisos dentro de MembeGo a segmentos específicos de tus clientes y seguidores."
      />

      {loadError && (
        <StatusBanner variant="destructive" title="No pudimos cargar los conteos de segmentos">
          Los tamaños de cada segmento pueden mostrarse en cero. Recarga la página para
          intentarlo de nuevo.
        </StatusBanner>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Nueva notificación segmentada</CardTitle>
        </CardHeader>
        <CardContent>
          <NotifSegmentForm conteos={conteos} planes={planes} />
        </CardContent>
      </Card>
    </div>
  )
}
