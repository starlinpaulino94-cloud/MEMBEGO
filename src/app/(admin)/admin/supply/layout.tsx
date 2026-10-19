import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { requireUser } from '@/lib/auth/guards'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { StatusBanner } from '@/components/ui/status-banner'
import { motivoPortalCerrado, proveedorDeLaSesion } from '@/modules/supply-v2/permisos'
import { ACCESS_STATUS_LABELS } from '@/modules/supply-v2/suppliers/acceso-dominio'

/**
 * MEMBEGO SUPPLY · portal del PROVEEDOR (§14, §47): la barrera viva de
 * todo el subárbol. La empresa sale de la sesión; el proveedor se resuelve
 * desde ella (`SupplyV2Supplier.companyId`). Sin proveedor activo, fuera.
 *
 * Supplier Lite: con el acceso SUSPENDIDO o DADO DE BAJA se enseña por qué
 * en vez de redirigir —una empresa solo proveedora no tiene otro sitio al
 * que ir, y mandarla al panel la devolvería aquí en bucle—.
 */
export default async function LayoutPortalProveedorV2({ children }: { children: ReactNode }) {
  const user = await requireUser()
  await requireCompanyContext(user)
  const proveedor = await proveedorDeLaSesion()
  if (!proveedor) {
    const cerrado = await motivoPortalCerrado()
    if (!cerrado) redirect('/admin/dashboard')
    return (
      <div className="mx-auto max-w-2xl py-6">
        <StatusBanner variant="warning" title={`Portal de proveedor: ${ACCESS_STATUS_LABELS[cerrado.accessStatus].toLowerCase()}`}>
          <p data-testid="portal-cerrado">
            El acceso de {cerrado.supplierName} al portal de proveedor de Membego está {cerrado.accessStatus === 'SUSPENDED' ? 'suspendido' : 'dado de baja'}.
            {cerrado.reason ? ` Motivo: ${cerrado.reason}.` : ''} Tus acuerdos y tu historial se conservan. Escríbenos para reactivarlo.
          </p>
        </StatusBanner>
      </div>
    )
  }
  return children
}
