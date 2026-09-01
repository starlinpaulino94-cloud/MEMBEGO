import { requireSection } from '@/lib/auth/guards'
import { redirect } from 'next/navigation'
import { clavesDeEmpresa } from '@/modules/connect/clavesApi'
import { suscripcionesDeEmpresa } from '@/modules/connect/webhooks'
import { registrosDeEmpresa } from '@/modules/connect/bitacora'
import { catalogoParaEmpresas, conexionesDeEmpresa } from '@/modules/connect/registro'
import { limiteDe } from '@/modules/connect/entitlements'
import { calendarioDeEmpresa, canalesDeEmpresa } from '@/modules/connect/canales'
import { PageHeader } from '@/components/ui/page-header'
import { ClavesApiPanel } from '@/components/connect/ClavesApiPanel'
import { WebhooksPanel } from '@/components/connect/WebhooksPanel'
import { ActividadConnect } from '@/components/connect/ActividadConnect'
import { AplicacionesPanel } from '@/components/connect/AplicacionesPanel'
import { CanalesPanel } from '@/components/connect/CanalesPanel'
import { GuiaDesarrolladores } from '@/components/connect/GuiaDesarrolladores'

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

  const [
    conectores,
    conexiones,
    claves,
    webhooks,
    registros,
    canales,
    calendario,
    maxClaves,
    maxWebhooks,
  ] =
    await Promise.all([
      catalogoParaEmpresas(),
      conexionesDeEmpresa(companyId),
      clavesDeEmpresa(companyId),
      suscripcionesDeEmpresa(companyId),
      registrosDeEmpresa(companyId, { limite: 30 }),
      canalesDeEmpresa(companyId),
      calendarioDeEmpresa(companyId),
      limiteDe(companyId, 'api_keys.max'),
      limiteDe(companyId, 'webhooks.max'),
    ])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Integraciones"
        description="Conecta MembeGo con las herramientas que ya usas: claves de API para consultar tus datos y webhooks para que te avisemos cuando pasa algo."
      />

      {/* Lo primero: qué está llegando de verdad. Antes que el catálogo, porque
          la pregunta que trae aquí a una empresa casi nunca es «qué puedo
          conectar» sino «¿esto que configuré está funcionando?». */}
      <CanalesPanel canales={canales} calendario={calendario} />

      <AplicacionesPanel
        conectores={conectores}
        conexiones={conexiones.map((c) => ({
          id: c.id,
          slug: c.conector.slug,
          nombre: c.conector.nombre,
          estado: c.estado,
          ultimoError: c.ultimoError,
        }))}
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
      <GuiaDesarrolladores base={process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.membego.com'} />

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
