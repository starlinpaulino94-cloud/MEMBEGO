import { redirect } from 'next/navigation'
import { requireSection } from '@/lib/auth/guards'
import { companyFilter } from '@/modules/admin/queries'
import { getAutoReplyConfigs } from '@/modules/connect/autoReply-actions'
import { AutoReplySection } from './auto-reply-section'

export const dynamic = 'force-dynamic'

export default async function AutoReplyPage() {
  const user = await requireSection('clientes', 'auto_reply_leer')
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

  const result = await getAutoReplyConfigs(companyId)

  if ('error' in result) {
    return (
      <div className="space-y-5">
        <p className="text-sm text-destructive">{result.error}</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <AutoReplySection
        companyId={companyId}
        initialConfigs={result.data ?? []}
      />
    </div>
  )
}
