import { conEmpresa } from '@/lib/tenant'
import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { getRegionalPrefs } from '@/modules/empresas/regional'
import { formatDateTime } from '@/lib/format'
import { zonaSegura } from '@/lib/zona-horaria'
import { leerRango } from '@/modules/reportes/rango'
import { resultadosDeMembegoEnTx } from '@/modules/analytics/queries'
import { RangoFechas } from '@/components/reportes/RangoFechas'
import { ResultadosMembegoVista } from '@/components/analytics/ResultadosMembegoVista'
import { BotonImprimir } from '@/components/ui/boton-imprimir'
import { StatusBanner } from '@/components/ui/status-banner'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Resultados Membego' }

/**
 * Analítica (Fase 6) · lo que Membego le produjo a la empresa y lo que le costó. Solo lectura; la
 * sección y la capacidad (`PEDIDOS_MEMBEGO`) las guarda el layout, y la empresa sale de la sesión.
 */
export default async function ResultadosMembegoPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = await requireCompanyContext(user)
  const sp = await searchParams

  const empresa = await conEmpresa(companyId, (tx) => tx.company.findUnique({ where: { id: companyId }, select: { name: true, zonaHoraria: true } }).catch(() => null))
  const timeZone = zonaSegura(empresa?.zonaHoraria)
  const rango = leerRango(sp, timeZone)
  const prefs = await getRegionalPrefs(companyId)

  let r: Awaited<ReturnType<typeof resultadosDeMembegoEnTx>> | null = null
  try {
    r = await conEmpresa(companyId, (tx) => resultadosDeMembegoEnTx(tx, companyId, rango, timeZone))
  } catch (e) {
    console.error('[resultados-membego]', e)
  }

  if (!r) {
    return (
      <StatusBanner variant="warning" title="No se pudieron cargar los resultados">
        Intenta de nuevo en un momento. Si sigue pasando, avisa a soporte.
      </StatusBanner>
    )
  }

  return (
    <ResultadosMembegoVista
      r={r}
      rango={rango}
      prefs={prefs}
      empresa={empresa?.name ?? 'Tu negocio'}
      generadoEn={formatDateTime(new Date(), prefs)}
      eyebrow={<RangoFechas rango={rango} accion="/admin/resultados-membego" />}
      controles={<BotonImprimir />}
    />
  )
}
