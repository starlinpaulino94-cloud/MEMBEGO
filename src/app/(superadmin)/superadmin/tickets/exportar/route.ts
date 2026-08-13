import type { NextRequest } from 'next/server'
import { requireRole } from '@/lib/auth/guards'
import { exportarTickets } from '@/modules/soporte/exportar'

export const dynamic = 'force-dynamic'

/** CSV de la bandeja de PLATAFORMA, con el mismo filtro que hay en pantalla. */
export async function GET(request: NextRequest) {
  const user = await requireRole('SUPERADMIN')
  return exportarTickets(request, user, 'plataforma')
}
