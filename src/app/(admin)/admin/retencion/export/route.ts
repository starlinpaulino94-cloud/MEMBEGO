import { NextResponse } from 'next/server'
import { getUser } from '@/lib/auth'
import { ADMIN_ROLES } from '@/types'
import { formatMoney } from '@/lib/format'
import { respuestaCsv } from '@/lib/csv'
import { getRegionalPrefs } from '@/modules/empresas/regional'
import { getRetencion, retencionToCsv } from '@/modules/riesgo/retencion'

export const dynamic = 'force-dynamic'

/**
 * CSV del reporte de retención.
 *
 * Era el único reporte del panel sin ninguna forma de sacarlo. El bloque que
 * más se pide es el pasivo de servicio —usos cobrados y todavía no prestados—,
 * porque es el que hay que cruzar con la contabilidad, y hasta ahora había que
 * copiarlo a mano de la pantalla.
 */
export async function GET() {
  const user = await getUser()
  if (!user || !ADMIN_ROLES.includes(user.metadata.role)) {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 403 })
  }
  const companyId = user.metadata.companyId as string | undefined
  if (!companyId) {
    return NextResponse.json({ error: 'Tu cuenta no está vinculada a una empresa.' }, { status: 400 })
  }

  const [r, prefs] = await Promise.all([getRetencion(companyId), getRegionalPrefs(companyId)])

  return respuestaCsv(retencionToCsv(r, formatMoney(r.valorPendiente, prefs)), 'retencion')
}
