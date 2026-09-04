import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { adopcionConnect, catalogoAdmin, empresasConnect } from '@/modules/connect/superadmin'
import { PageHeader } from '@/components/ui/page-header'
import { SectionHeader } from '@/components/ui/section-header'
import { StatCard } from '@/components/ui/stat-card'
import { CatalogoAdminPanel } from '@/components/superadmin/CatalogoAdminPanel'
import { ConcesionesPanel } from '@/components/superadmin/ConcesionesPanel'
import { TabsIntegracionesPlataforma } from '@/components/superadmin/TabsIntegracionesPlataforma'
import { Activity, Building2, KeyRound, Webhook } from 'lucide-react'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Integraciones' }

/**
 * MEMBEGO CONNECT · panel de plataforma (Fase 9, rediseño «hub»).
 *
 * Es la llave que faltaba. Las fases 3 a 8 construyeron claves de API,
 * webhooks, OAuth, conectores y documentación, y todo eso vive detrás de un
 * límite cuyo valor por defecto es CERO. Hasta esta pantalla no había forma de
 * conceder nada: la cerradura estaba puesta y la llave no existía.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TRES SECCIONES EN UNA RUTA
 *
 * Resumen (adopción + estado de la plataforma), Catálogo (todos los
 * conectores, con filtro) y Empresas (qué tiene concedida cada una) se eligen
 * con `?seccion=` y se pintan una a la vez. Una ruta y no tres porque los
 * datos son los mismos y la barra de pestañas es la misma; tres rutas serían
 * tres sitios donde olvidarse de una pestaña. Salud vive en su ruta de siempre
 * y comparte la barra.
 */

type Seccion = 'resumen' | 'catalogo' | 'empresas'

const TITULO: Record<Seccion, { title: string; description: string }> = {
  resumen: {
    title: 'Integraciones',
    description: 'Disponibilidad, adopción y salud de las conexiones de la plataforma.',
  },
  catalogo: {
    title: 'Catálogo de integraciones',
    description: 'Qué conectores existen, en qué estado están y cuánto se usan.',
  },
  empresas: {
    title: 'Empresas y disponibilidad',
    description: 'Qué tiene concedida cada empresa: aplicaciones, claves de API y webhooks.',
  },
}

export default async function ConnectSuperadminPage({
  searchParams,
}: {
  searchParams: Promise<{ seccion?: string }>
}) {
  await requireRole('SUPERADMIN')
  const { seccion: crudo } = await searchParams
  // Solo se aceptan las tres conocidas; cualquier otra cosa es el resumen.
  const seccion: Seccion = crudo === 'catalogo' || crudo === 'empresas' ? crudo : 'resumen'

  const [conectores, adopcion, empresas] = await Promise.all([
    catalogoAdmin(),
    adopcionConnect(),
    empresasConnect(),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title={TITULO[seccion].title}
        description={TITULO[seccion].description}
        nav={
          <TabsIntegracionesPlataforma
            activa={seccion}
            badges={{ catalogo: conectores.length, empresas: empresas.length }}
          />
        }
      />

      {seccion === 'resumen' && (
        <>
          {/* ADOPCIÓN — cuatro números, y los cuatro salen de `adopcionConnect`,
              que cuenta filas. No hay ninguna métrica de demostración aquí: si
              un número está en cero es porque de verdad no hay nada, y eso es
              una respuesta útil («todavía no lo usa nadie»), no un hueco. */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="Empresas conectadas"
              value={adopcion.empresasConConexion}
              sub="Con al menos una app viva"
              icon={Building2}
              accent="brand"
              href="/superadmin/connect?seccion=empresas"
              hrefLabel="Ver empresas"
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
              href="/superadmin/integraciones"
              hrefLabel="Ver la salud de la cola"
            />
          </div>

          <SectionHeader
            title="Estado de la plataforma"
            description="Cada conector, con su implementación, su configuración en este despliegue y su publicación."
            action={
              <Link
                href="/superadmin/connect?seccion=catalogo"
                className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
              >
                Ver catálogo completo
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            }
          />
          <CatalogoAdminPanel conectores={conectores} enlaceCatalogo />
        </>
      )}

      {seccion === 'catalogo' && <CatalogoAdminPanel conectores={conectores} conFiltros />}

      {seccion === 'empresas' && <ConcesionesPanel empresas={empresas} />}
    </div>
  )
}
