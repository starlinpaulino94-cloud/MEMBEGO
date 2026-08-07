import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ADMIN_ROLES } from '@/types'
import { requireRole } from '@/lib/auth/guards'
import { CampanaDirigidaService } from '@/modules/geo/segmentacion/campanas'
import CampanaAcciones from '@/components/audiencia/CampanaAcciones'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'
import { Pencil } from 'lucide-react'

export const dynamic = 'force-dynamic'

const fmt = (n: number) => new Intl.NumberFormat('es-DO').format(n)

const ETIQUETA_ESTADO: Record<string, string> = {
  BORRADOR: 'Borrador',
  PROGRAMADA: 'Programada',
  ACTIVA: 'Activa',
  PAUSADA: 'Pausada',
  FINALIZADA: 'Finalizada',
}

const ETIQUETA_CANAL: Record<string, string> = {
  IN_APP: 'Notificación in-app',
  EMAIL: 'Email',
  PUSH_FUTURO: 'Push (futuro)',
}

const ETIQUETA_ENTREGA: Record<string, string> = {
  PENDIENTE: 'Pendientes',
  ENVIADA: 'Enviadas',
  FALLIDA: 'Fallidas',
  EXCLUIDA: 'Excluidas',
}

interface Props {
  params: Promise<{ id: string }>
}

export default async function CampanaDetallePage({ params }: Props) {
  const { id } = await params
  const user = await requireRole(ADMIN_ROLES)
  const companyId = user.metadata.companyId
  if (!companyId) return <SinEmpresaActiva seccion="tus campañas dirigidas" />

  const campana = await CampanaDirigidaService.obtener(companyId, id)
  if (!campana) notFound()

  const snapshot = campana.snapshots[0]

  return (
    <div className="space-y-6">
      <PageHeader
        title={campana.nombre}
        description={campana.mensaje}
        action={
          campana.estado === 'BORRADOR' ? (
            <Button asChild variant="outline">
              <Link href={`/admin/audiencia/campanas/${campana.id}/editar`}>
                <Pencil className="h-4 w-4" /> Editar
              </Link>
            </Button>
          ) : undefined
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Detalles</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Estado</span>
              <Badge>{ETIQUETA_ESTADO[campana.estado]}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Canales</span>
              <span>{campana.canales.map((c) => ETIQUETA_CANAL[c]).join(', ')}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Audiencia</span>
              <span>
                {campana.segment ? `Segmento · ${campana.segment.name}` : null}
                {campana.sucursal
                  ? `Radio · ${campana.sucursal.nombre} (${campana.radioKm ?? '—'} km)`
                  : null}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Frecuencia</span>
              <span>
                {campana.maxPorDia ?? '—'}/día · {campana.maxPorSemana ?? '—'}/semana
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Prioridad</span>
              <span>{campana.prioridad}/10</span>
            </div>
            {campana.programadaEn && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Programada</span>
                <span>
                  {new Date(campana.programadaEn).toLocaleString('es-DO', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Acciones</CardTitle>
            </CardHeader>
            <CardContent>
              <CampanaAcciones campanaId={campana.id} estado={campana.estado} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Última audiencia estimada</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {snapshot ? (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Elegibles</span>
                    <span className="font-semibold tabular-nums">
                      {fmt(snapshot.totalElegibles)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Sin consentimiento</span>
                    <span className="tabular-nums">{fmt(snapshot.sinConsentimiento)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Calculada</span>
                    <span>
                      {new Date(snapshot.calculadaAt).toLocaleString('es-DO', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                    </span>
                  </div>
                  {Array.isArray(snapshot.advertencias) &&
                    snapshot.advertencias.map((a, i) => (
                      <p key={i} className="rounded bg-muted/40 p-2 text-xs text-muted-foreground">
                        {String(a)}
                      </p>
                    ))}
                </>
              ) : (
                <p className="text-muted-foreground">
                  Aún no hay snapshot. Programa o activa la campaña para calcular la audiencia.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {campana.entregasPorEstado.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Entregas</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-4">
            {campana.entregasPorEstado.map((e) => (
              <div key={e.estado} className="rounded-md border bg-muted/40 p-3">
                <div className="text-2xl font-bold tabular-nums">{fmt(e.n)}</div>
                <div className="text-xs text-muted-foreground">
                  {ETIQUETA_ENTREGA[e.estado] ?? e.estado}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
