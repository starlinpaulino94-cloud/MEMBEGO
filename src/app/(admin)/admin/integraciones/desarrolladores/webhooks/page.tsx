import { redirect } from 'next/navigation'
import { requireSection } from '@/lib/auth/guards'
import { suscripcionesDeEmpresa } from '@/modules/connect/webhooks'
import { limiteDe } from '@/modules/connect/entitlements'
import { WebhooksPanel } from '@/components/connect/WebhooksPanel'
import { PlanNoIncluye } from '@/components/connect/EstadoPlanConnect'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Webhooks' }

/** Mismo criterio que las claves: sin concesión y sin nada creado, se explica. */
export default async function WebhooksPage() {
  const user = await requireSection('integraciones')
  if (!user?.metadata.companyId) redirect('/admin/dashboard')
  const companyId = user.metadata.companyId

  const [webhooks, limite] = await Promise.all([
    suscripcionesDeEmpresa(companyId),
    limiteDe(companyId, 'webhooks.max'),
  ])

  if (limite === 0 && webhooks.length === 0) return <PlanNoIncluye que="webhooks" />

  return (
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
      limite={limite}
    />
  )
}
