import { redirect } from 'next/navigation'
import { requireSection } from '@/lib/auth/guards'
import { companyFilter } from '@/modules/admin/queries'
import { getConversaciones, getMensajes } from '@/modules/crm/conversaciones-queries'
import type { ConversacionCanal, ConversacionFilter } from '@/modules/crm/conversaciones-queries'
import { ChatPanel } from './chat-panel'

export const dynamic = 'force-dynamic'

export default async function ConversacionesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const user = await requireSection('leads')
  if (!user) redirect('/login')

  const companyId = companyFilter(user)
  if (!companyId) {
    return (
      <div className="space-y-5">
        <p className="text-sm text-muted-foreground">
          Selecciona una empresa desde el panel de superadmin para usar el CRM.
        </p>
      </div>
    )
  }

  const sp = await searchParams
  const canal = (sp.canal as ConversacionCanal | undefined) ?? undefined
  const q = (sp.q ?? '').trim()
  const seleccionId = sp.id ?? null

  const filtro: ConversacionFilter = {
    q: q || undefined,
    canal,
  }

  const result = await getConversaciones(companyId, filtro, { porPagina: 50 })

  // If there's a selected conversation, fetch its messages
  let conversacionInicial = result.items.find((c) => c.id === seleccionId) ?? result.items[0] ?? null
  let mensajesIniciales: Awaited<ReturnType<typeof getMensajes>>['items'] = []

  if (conversacionInicial) {
    const msgs = await getMensajes(companyId, conversacionInicial.id)
    mensajesIniciales = msgs.items
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Gestiona las conversaciones de tus prospectos en todos los canales.
      </p>

      <ChatPanel
        conversaciones={result.items}
        conversacionInicial={conversacionInicial}
        mensajesIniciales={mensajesIniciales}
        companyId={companyId}
      />
    </div>
  )
}
