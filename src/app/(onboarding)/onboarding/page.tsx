import { redirect } from 'next/navigation'
import { conEmpresa } from '@/lib/tenant'
import { requireRole } from '@/lib/auth/guards'
import { FULL_ADMIN_ROLES } from '@/types'
import { getOnboardingEmpresa } from '@/modules/empresas/onboarding'
import { WizardEmpresa } from '@/components/onboarding/WizardEmpresa'

export const dynamic = 'force-dynamic'

export default async function OnboardingPage() {
  const user = await requireRole(FULL_ADMIN_ROLES)
  const companyId = user.metadata.companyId
  // Superadmin sin empresa no tiene onboarding.
  if (!companyId) redirect('/admin/dashboard')

  const [onboarding, company] = await Promise.all([
    getOnboardingEmpresa(companyId).catch(() => null),
    conEmpresa(companyId, (tx) =>
      tx.company.findUnique({ where: { id: companyId }, select: { name: true } })
    ).catch(() => null),
  ])
  if (!onboarding) redirect('/admin/dashboard')

  return (
    <WizardEmpresa onboarding={onboarding} companyName={company?.name ?? 'tu empresa'} />
  )
}
