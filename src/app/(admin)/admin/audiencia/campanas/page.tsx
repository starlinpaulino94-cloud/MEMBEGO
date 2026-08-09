import Link from 'next/link'
import { ADMIN_ROLES } from '@/types'
import { requireRole } from '@/lib/auth/guards'
import { CampanaDirigidaService } from '@/modules/geo/segmentacion/campanas'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { NavAudiencia } from '@/components/admin/NavAudiencia'
import { EmptyState } from '@/components/ui/empty-state'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'
import { Megaphone, Plus } from 'lucide-react'

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
  IN_APP: 'In-app',
  EMAIL: 'Email',
}

const VARIANTE_ESTADO: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  ACTIVA: 'default',
  PROGRAMADA: 'secondary',
  BORRADOR: 'outline',
  PAUSADA: 'secondary',
  FINALIZADA: 'outline',
}

export default async function CampanasPage() {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = user.metadata.companyId
  if (!companyId) return <SinEmpresaActiva seccion="tus campañas dirigidas" />

  let campanas: Awaited<ReturnType<typeof CampanaDirigidaService.listar>> = []
  try {
    campanas = await CampanaDirigidaService.listar(companyId)
  } catch (e) {
    console.error('[admin-campanas]', e)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Audiencia"
        title="Campañas segmentadas"
        description="Envía a una audiencia por segmento o por radio de sucursal, con límites de frecuencia por día y semana."
        nav={<NavAudiencia activa="/admin/audiencia/campanas" />}
        action={
          <Button asChild>
            <Link href="/admin/audiencia/campanas/nueva">
              <Plus className="h-4 w-4" /> Nueva campaña
            </Link>
          </Button>
        }
      />

      {campanas.length === 0 ? (
        <EmptyState
          icon={<Megaphone className="h-6 w-6" />}
          title="Aún no tienes campañas"
          description="Elige un segmento o un radio de sucursal y lanza tu primera campaña dirigida."
          action={
            <Button asChild>
              <Link href="/admin/audiencia/campanas/nueva">Crear campaña</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {campanas.map((c) => (
            <Card key={c.id}>
              <CardContent className="space-y-3 p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    <Link
                      href={`/admin/audiencia/campanas/${c.id}`}
                      className="font-semibold text-foreground hover:underline"
                    >
                      {c.nombre}
                    </Link>
                    <div className="flex items-center gap-2">
                      <Badge variant={VARIANTE_ESTADO[c.estado] ?? 'outline'}>
                        {ETIQUETA_ESTADO[c.estado]}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {c.canales.map((ch) => ETIQUETA_CANAL[ch]).join(' · ')}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Audiencia</span>
                  <span className="font-semibold tabular-nums">
                    {c.audiencia != null ? fmt(c.audiencia) : '—'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Entregas</span>
                  <span className="font-semibold tabular-nums">{fmt(c.entregas)}</span>
                </div>
                {c.programadaEn && (
                  <p className="text-xs text-muted-foreground">
                    Programada:{' '}
                    {new Date(c.programadaEn).toLocaleString('es-DO', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
