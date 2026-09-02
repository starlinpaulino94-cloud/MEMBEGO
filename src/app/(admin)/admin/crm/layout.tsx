import { redirect } from 'next/navigation'
import { Contact } from 'lucide-react'
import { ADMIN_ROLES } from '@/types'
import { requireRole } from '@/lib/auth/guards'
import { CrmTabs } from '@/components/crm/CrmTabs'

/**
 * CRM · Prospectos.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA GUARDIA QUE FALTABA
 *
 * Este módulo llegó con un comentario en vez de una comprobación
 * («In production, add: requireSection('crm')»). Hoy no es una puerta abierta
 * —el proxy es fail-closed con las rutas de /admin que no reconoce, así que
 * los roles acotados ya rebotan al panel— pero un comentario no es una
 * guardia, y en cuanto estas pantallas dejen de ser datos simulados el hueco
 * es real.
 *
 * `requireRole(ADMIN_ROLES)` es lo que se puede exigir HOY sin inventar una
 * sección de permisos nueva: entra quien es administrador, y nadie más.
 * Cuando `crm` sea una `AdminSection` de verdad —con sus funciones y su
 * interruptor por empleado— esto pasa a `requireSection('crm')` y el resto no
 * cambia.
 */
export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole(ADMIN_ROLES)
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
