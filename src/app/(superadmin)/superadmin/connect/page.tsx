import { requireRole } from '@/lib/auth/guards'
import { adopcionConnect, catalogoAdmin, empresasConnect } from '@/modules/connect/superadmin'
import { PageHeader } from '@/components/ui/page-header'
import { CatalogoAdminPanel } from '@/components/superadmin/CatalogoAdminPanel'
import { ConcesionesPanel } from '@/components/superadmin/ConcesionesPanel'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Connect' }

/**
 * MEMBEGO CONNECT · panel de plataforma (Fase 9).
 *
 * Es la llave que faltaba. Las fases 3 a 8 construyeron claves de API,
 * webhooks, OAuth, conectores y documentación, y todo eso vive detrás de un
 * límite cuyo valor por defecto es CERO. Hasta esta pantalla no había forma de
 * conceder nada: la cerradura estaba puesta y la llave no existía.
 */
export default async function ConnectSuperadminPage() {
  await requireRole('SUPERADMIN')
  const [conectores, adopcion, empresas] = await Promise.all([
    catalogoAdmin(),
    adopcionConnect(),
    empresasConnect(),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Connect"
        description="El catálogo de aplicaciones, cuánto se usa, y qué tiene concedida cada empresa."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Adopción</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: 'Empresas con una app conectada', valor: adopcion.empresasConConexion },
              { label: 'Claves de API activas', valor: adopcion.clavesActivas },
              { label: 'Webhooks activos', valor: adopcion.webhooksActivos },
              { label: 'Entregas (últimos 7 días)', valor: adopcion.entregasUltimos7d },
            ].map((m) => (
              <div key={m.label} className="rounded-xl border border-border/60 bg-muted/30 px-3 py-2">
                <p className="text-lg font-semibold">{m.valor}</p>
                <p className="text-caption text-muted-foreground">{m.label}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <CatalogoAdminPanel conectores={conectores} />
      <ConcesionesPanel empresas={empresas} />
    </div>
  )
}
