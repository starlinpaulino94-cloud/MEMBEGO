import { requireRole } from '@/lib/auth/guards'
import { adopcionConnect, catalogoAdmin, empresasConnect } from '@/modules/connect/superadmin'
import { PageHeader } from '@/components/ui/page-header'
import { CatalogoAdminPanel } from '@/components/superadmin/CatalogoAdminPanel'
import { ConcesionesPanel } from '@/components/superadmin/ConcesionesPanel'
import { Activity, Building2, KeyRound, Webhook } from 'lucide-react'
import { StatCard } from '@/components/ui/stat-card'

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

      {/* ADOPCIÓN — cuatro números, y los cuatro salen de `adopcionConnect`,
          que cuenta filas. No hay ninguna métrica de demostración aquí: si un
          número está en cero es porque de verdad no hay nada, y eso es una
          respuesta útil («todavía no lo usa nadie»), no un hueco.

          Se usan las tarjetas del sistema de diseño en vez de la rejilla que
          había escrita a mano: mismo dato, y además llevan a la pantalla que
          lo explica. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Empresas conectadas"
          value={adopcion.empresasConConexion}
          sub="Con al menos una app viva"
          icon={Building2}
          accent="brand"
        />
        <StatCard
          label="Claves de API activas"
          value={adopcion.clavesActivas}
          sub="En toda la plataforma"
          icon={KeyRound}
          accent="brand"
        />
        <StatCard
          label="Webhooks activos"
          value={adopcion.webhooksActivos}
          sub="Suscripciones vivas"
          icon={Webhook}
          accent="success"
        />
        <StatCard
          label="Entregas (7 días)"
          value={adopcion.entregasUltimos7d}
          sub="Eventos enviados"
          icon={Activity}
          accent="success"
        />
      </div>

      <CatalogoAdminPanel conectores={conectores} />
      <ConcesionesPanel empresas={empresas} />
    </div>
  )
}
