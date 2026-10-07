import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { requireUser } from '@/lib/auth/guards'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { proveedorDeLaSesion } from '@/modules/supply-v2/permisos'

/**
 * MEMBEGO SUPPLY · portal del PROVEEDOR (§14, §47): la barrera viva de
 * todo el subárbol. La empresa sale de la sesión; el proveedor se resuelve
 * desde ella (`SupplyV2Supplier.companyId`). Sin proveedor activo, fuera.
 */
export default async function LayoutPortalProveedorV2({ children }: { children: ReactNode }) {
  const user = await requireUser()
  await requireCompanyContext(user)
  const proveedor = await proveedorDeLaSesion()
  if (!proveedor) redirect('/admin/dashboard')
  return children
}
