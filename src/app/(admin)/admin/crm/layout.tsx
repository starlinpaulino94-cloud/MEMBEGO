import { Contact } from 'lucide-react'
import { CrmTabs } from '@/components/crm/CrmTabs'

export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  // Skeleton: skip auth guard — 'crm' not in ADMIN_SECTIONS yet.
  // In production, add: const user = await requireSection('crm')
  // if (!user) redirect('/admin/dashboard')

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-h1 text-foreground">
          <Contact className="h-7 w-7 text-primary" /> Prospectos
        </h1>
        <CrmTabs />
      </div>
      {children}
    </div>
  )
}
