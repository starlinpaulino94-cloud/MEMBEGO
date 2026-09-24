import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { requireUser } from '@/lib/auth/guards'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { guardiaProveedor } from '@/modules/supply/permisos'

/**
 * La barrera VIVA del portal del proveedor, para todo el subárbol.
 *
 * `/admin/supply` era la única sección del panel sin guardia de layout: sus
 * pantallas se cerraban sola con la del proxy, que lee los permisos del TOKEN
 * y va con un refresco de retraso. Quitarle Supply a alguien no le cerraba la
 * puerta hasta que su sesión se renovara.
 *
 * No usa la fábrica `guardarSeccion('supply')` porque aquí la sección no basta:
 * `guardiaProveedor` es esa misma comprobación —lee `requireSection('supply')`
 * contra la base en cada render— MÁS la que de verdad delimita este portal, que
 * la empresa activa sea proveedora. Poner las dos juntas y en el layout es lo
 * que hace que una pantalla nueva bajo esta carpeta nazca cubierta en vez de
 * depender de que quien la escriba se acuerde.
 */
export default async function LayoutPortalProveedor({ children }: { children: ReactNode }) {
  const user = await requireUser()
  const companyId = await requireCompanyContext(user)
  if (!(await guardiaProveedor(companyId))) redirect('/admin/dashboard')
  return children
}
