import type { NextRequest } from 'next/server'
import { ADMIN_ROLES } from '@/types'
import { requireRole } from '@/lib/auth/guards'
import { exportarTickets } from '@/modules/soporte/exportar'

export const dynamic = 'force-dynamic'

/** CSV de la bandeja de la EMPRESA, con el mismo filtro que hay en pantalla. */
export async function GET(request: NextRequest) {
  const user = await requireRole(ADMIN_ROLES)
  return exportarTickets(request, user, 'empresa')
}
