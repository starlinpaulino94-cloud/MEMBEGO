import { requireSection } from '@/lib/auth/guards'
import { redirect } from 'next/navigation'
import { clavesDeEmpresa } from '@/modules/connect/clavesApi'
import { suscripcionesDeEmpresa } from '@/modules/connect/webhooks'
import { registrosDeEmpresa } from '@/modules/connect/bitacora'
import { catalogoParaEmpresas } from '@/modules/connect/registro'
import { limiteDe } from '@/modules/connect/entitlements'
import { PageHeader } from '@/components/ui/page-header'
import { ClavesApiPanel } from '@/components/connect/ClavesApiPanel'
import { WebhooksPanel } from '@/components/connect/WebhooksPanel'
import { ActividadConnect } from '@/components/connect/ActividadConnect'
import { CatalogoConectores } from '@/components/connect/CatalogoConectores'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Integraciones' }

/**
 * INTEGRACIONES de una empresa (Membego Connect · Fase 4).
 *
 * Lo que hasta ahora vivía solo en la base —claves de API, webhooks, la
 * bitácora— por fin se ve y se administra. Cuatro bloques, en el orden en que
 * se usan: qué puedo conectar, con qué clave, a dónde te aviso, y qué ha
 * pasado.
 *
 * EL CATÁLOGO SE ENSEÑA VACÍO Y LO DICE. No hay conectores nativos todavía
 * (llegan en la Fase 6). Pintar logos de WhatsApp o Google ahora sería
 * prometer lo que no existe, y la primera empresa que pulsara «conectar»
 * descubriría el engaño. Un vacío honesto envejece mejor que una demo.
 */
export default async function IntegracionesPage() {
  const user = await requireSection('integraciones')
  if (!user?.metadata.companyId) redirect('/admin/dashboard')
  const companyId = user.metadata.companyId

  const [conectores, claves, webhooks, registros, maxClaves, maxWebhooks] = await Promise.all([
    catalogoParaEmpresas(),
    clavesDeEmpresa(companyId),
    suscripcionesDeEmpresa(companyId),
    registrosDeEmpresa(companyId, { limite: 30 }),
    limiteDe(companyId, 'api_keys.max'),
    limiteDe(companyId, 'webhooks.max'),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Integraciones"
        description="Conecta MembeGo con las herramientas que ya usas: claves de API para consultar tus datos y webhooks para que te avisemos cuando pasa algo."
      />

      <CatalogoConectores conectores={conectores} />

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
