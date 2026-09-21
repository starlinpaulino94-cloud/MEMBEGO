import { redirect } from 'next/navigation'
import { Contact } from 'lucide-react'
import { requireSection } from '@/lib/auth/guards'
import { CrmTabs } from '@/components/crm/CrmTabs'

/**
 * CRM · Prospectos.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Guardia por sección: solo usuarios con permiso 'leads' (la sección
 * principal del CRM) pueden acceder. La capacidad CRM en el catálogo
 * controla la visibilidad y acceso a las secciones del módulo.
 */
export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  const user = await requireSection('leads')
  if (!user) redirect('/admin/dashboard')

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
