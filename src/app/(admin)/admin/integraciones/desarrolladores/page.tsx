import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { requireSection } from '@/lib/auth/guards'
import { clavesDeEmpresa } from '@/modules/connect/clavesApi'
import { suscripcionesDeEmpresa } from '@/modules/connect/webhooks'
import { registrosDeEmpresa } from '@/modules/connect/bitacora'
import { limiteDe } from '@/modules/connect/entitlements'
import { PageHeader } from '@/components/ui/page-header'
import { ClavesApiPanel } from '@/components/connect/ClavesApiPanel'
import { WebhooksPanel } from '@/components/connect/WebhooksPanel'
import { GuiaDesarrolladores } from '@/components/connect/GuiaDesarrolladores'
import { ActividadConnect } from '@/components/connect/ActividadConnect'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Desarrolladores' }

/**
 * DESARROLLADORES (Connect · Fase 10).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DOS PERSONAS DISTINTAS, DOS PANTALLAS DISTINTAS
 *
 *   «Quiero conectar WhatsApp»        → /admin/integraciones
 *   «Quiero consumir /v1/customers»   → aquí
 *
 * No son dos niveles de la misma tarea: son dos oficios. Mezclados, la dueña
 * del negocio se encuentra claves de API y bitácoras técnicas mientras busca
 * un botón de conectar, y el programador tiene que bajar media pantalla de
 * tarjetas para llegar a lo suyo.
 *
 * NADA se retiró en la mudanza: los cuatro bloques son los mismos componentes,
 * con el mismo backend y las mismas guardias por función. Solo cambiaron de
 * casa.
 */
export default async function DesarrolladoresPage() {
  const user = await requireSection('integraciones')
  if (!user?.metadata.companyId) redirect('/admin/dashboard')
  const companyId = user.metadata.companyId

  const [claves, webhooks, registros, maxClaves, maxWebhooks] = await Promise.all([
    clavesDeEmpresa(companyId),
    suscripcionesDeEmpresa(companyId),
    registrosDeEmpresa(companyId, { limite: 30 }),
    limiteDe(companyId, 'api_keys.max'),
    limiteDe(companyId, 'webhooks.max'),
  ])

  return (
    <div className="space-y-6">
      <Link
        href="/admin/integraciones"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Integraciones
      </Link>

      <PageHeader
        title="Desarrolladores"
        description="Claves de API, webhooks y registros técnicos para conectar Membego con tu propio sistema."
      />

      <ClavesApiPanel
        claves={claves.map((c) => ({
          ...c,
          expiresAt: c.expiresAt?.toISOString() ?? null,
          lastUsedAt: c.lastUsedAt?.toISOString() ?? null,
          createdAt: c.createdAt.toISOString(),
        }))}
        limite={maxClaves}
      />

      <WebhooksPanel
        webhooks={webhooks.map((w) => ({
          id: w.id,
          nombre: w.nombre,
          url: w.url,
          eventos: w.eventos,
          estado: w.estado,
          fallosSeguidos: w.fallosSeguidos,
          ultimoOkAt: w.ultimoOkAt?.toISOString() ?? null,
          ultimoErrorAt: w.ultimoErrorAt?.toISOString() ?? null,
          ultimoError: w.ultimoError,
        }))}
        limite={maxWebhooks}
      />

      {/* La guía va DESPUÉS de las claves: primero se crea la credencial, y
          entonces la documentación tiene a qué agarrarse. */}
      <GuiaDesarrolladores base={process.env.NEXT_PUBLIC_APP_URL ?? 'https://membego.com'} />

      <ActividadConnect
        registros={registros.map((r) => ({
          id: r.id,
          nivel: r.nivel,
          evento: r.evento,
          createdAt: r.createdAt.toISOString(),
        }))}
      />
    </div>
  )
}
