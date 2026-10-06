import { redirect } from 'next/navigation'

/** «Cobros» se disolvió en la sección Finanzas (auditoría 2026-09). */
export default function CobrosRedirect() {
  redirect('/superadmin/supply/finanzas/cobros-clientes')
}
