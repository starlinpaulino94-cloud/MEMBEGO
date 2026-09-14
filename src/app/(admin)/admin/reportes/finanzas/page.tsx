import { conEmpresa } from '@/lib/tenant'
import { requireRole, requireSection } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { getRegionalPrefs } from '@/modules/empresas/regional'
import { formatDateTime, TZ_PLATAFORMA } from '@/lib/format'
import { leerRango, paramsDeRango } from '@/modules/reportes/rango'
import { getReporteFinanzas } from '@/modules/reportes/finanzas'
import { RangoFechas } from '@/components/reportes/RangoFechas'
import { ReporteFinanzasVista } from '@/components/reportes/ReporteFinanzasVista'
import { BotonImprimir } from '@/components/ui/boton-imprimir'
import { BotonExportar } from '@/components/ui/boton-exportar'
import { EmptyState } from '@/components/ui/empty-state'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Finanzas' }

/**
 * Este reporte SÍ exige `ver_financieros`, y a nivel de pantalla entera: aquí
 * todo es dinero. Esconder tarjetas sueltas dejaría una página vacía y una
 * pregunta; negar el acceso con su motivo dice lo que pasa.
 */
export default async function ReporteFinanzasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireRole(ADMIN_ROLES)
  const user = await requireSection('reportes', 'ver_financieros')
  if (!user) {
    return (
      <EmptyState
        title="No tienes permiso para ver las cifras de dinero"
        description="Este reporte es solo de finanzas. Pídeselo a quien administra el negocio, o abre el ciclo de vida de las membresías, que no lleva importes."
      />
    )
  }
  const companyId = await requireCompanyContext(user)

  const sp = await searchParams
  const empresa = await conEmpresa(companyId, (tx) =>
    tx.company
      .findUnique({ where: { id: companyId }, select: { name: true, zonaHoraria: true } })
      .catch(() => null)
  )
  const timeZone = empresa?.zonaHoraria || TZ_PLATAFORMA

  const rango = leerRango(sp, timeZone)
  const prefs = await getRegionalPrefs(companyId)
  const r = await getReporteFinanzas(companyId, rango)
  const qs = paramsDeRango(rango)

  return (
    <ReporteFinanzasVista
      r={r}
      rango={rango}
      prefs={prefs}
      empresa={empresa?.name ?? 'Tu negocio'}
      generadoEn={formatDateTime(new Date(), prefs)}
      eyebrow={<RangoFechas rango={rango} accion="/admin/reportes/finanzas" />}
      controles={
        <>
          <BotonExportar href={`/admin/reportes/finanzas/export${qs}`} />
          <BotonImprimir />
        </>
      }
    />
  )
}
