import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { getUser } from '@/lib/auth'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { guardiaProveedor } from '@/modules/supply/permisos'

/**
 * GUARDIA VIVA DE `supply`, en su layout.
 *
 * No usa la fábrica `guardarSeccion` como las otras 38 secciones, y el motivo
 * es el contrato propio del portal del proveedor: aquí no basta con que la
 * sesión tenga la sección permitida, la EMPRESA tiene que ser proveedora.
 * `guardiaProveedor` comprueba las dos cosas —incluye el `requireSection` que
 * haría la fábrica— y no se la salta ni el superadmin: una pantalla vacía con
 * datos de otro inquilino es peor que un «no autorizado».
 *
 * Que esté en el LAYOUT y no solo en cada página es lo que cubre el subárbol
 * entero, incluidas las pantallas que alguien añada mañana sin acordarse.
 * Las páginas mantienen la suya: esto guarda la VISTA, y las server actions se
 * despachan por su id desde cualquier path, así que se guardan donde se
 * ejecutan.
 */
export default async function LayoutSupply({ children }: { children: ReactNode }) {
  const user = await getUser()
  if (!user) redirect('/login')

  const companyId = await requireCompanyContext(user)
  if (!(await guardiaProveedor(companyId))) redirect('/admin/dashboard')

  return children
}
