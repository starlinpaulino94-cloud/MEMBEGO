import { redirect } from 'next/navigation'
import { puedeFuncion, requireSection } from '@/lib/auth/guards'
import { suscripcionesParaPanel } from '@/modules/connect/webhooks'
import { limiteDe } from '@/modules/connect/entitlements'
import { WebhooksPanel } from '@/components/connect/WebhooksPanel'
import { eventosSuscribibles } from '@/modules/connect/eventosSuscribibles'
import { PlanNoIncluye } from '@/components/connect/EstadoPlanConnect'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Webhooks' }

/** Mismo criterio que las claves: sin concesión y sin nada creado, se explica. */
export default async function WebhooksPage() {
  const user = await requireSection('integraciones')
  if (!user?.metadata.companyId) redirect('/admin/dashboard')
  const companyId = user.metadata.companyId

  const [webhooks, limite, puedeRotar] = await Promise.all([
    suscripcionesParaPanel(companyId),
    limiteDe(companyId, 'webhooks.max'),
    puedeFuncion('integraciones', 'webhook_rotar'),
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
        // Solo la FECHA del solape, y ya decidida en el servidor: el tipo que
        // llega aquí ni siquiera tiene campos de secreto.
        rotandoHasta: w.rotandoHasta?.toISOString() ?? null,
      }))}
      puedeRotar={puedeRotar}
      limite={limite}
      // El catálogo se calcula AQUÍ, en el servidor. Es una lista derivada de
      // lo que el bus emite; calcularla en el navegador arrastraría el núcleo
      // de integraciones —y `node:crypto` con él— al bundle del cliente.
      catalogo={eventosSuscribibles()}
    />
  )
}
