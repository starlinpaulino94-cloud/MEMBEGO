import { conEmpresa } from '@/lib/tenant'
import { requireRole, requireSection, puedeFuncion } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { getRegionalPrefs } from '@/modules/empresas/regional'
import { formatDateTime, TZ_PLATAFORMA } from '@/lib/format'
import { leerRango, paramsDeRango } from '@/modules/reportes/rango'
import { getReporteCrecimiento } from '@/modules/reportes/crecimiento'
import { RangoFechas } from '@/components/reportes/RangoFechas'
import { ReporteCrecimientoVista } from '@/components/reportes/ReporteCrecimientoVista'
import { BotonImprimir } from '@/components/ui/boton-imprimir'
import { BotonesExportar } from '@/components/reportes/BotonesExportar'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Crecimiento' }

/**
 * Quién trae gente nueva, por dónde entra y dónde se cae.
 *
 * `ver_datos_personales` viaja a la CONSULTA y no al componente, porque la ruta
 * de exportación usa la misma función: esconder la tabla de quién invita en la
 * vista dejaría los nombres saliendo por el archivo.
 */
export default async function ReporteCrecimientoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireRole(ADMIN_ROLES)
  const user = await requireSection('reportes', 'ver')
  if (!user) return <SinEmpresaActiva seccion="los reportes" />
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
  const verDatosPersonales = await puedeFuncion('reportes', 'ver_datos_personales')
  const r = await getReporteCrecimiento(companyId, rango, timeZone, { verDatosPersonales })
  const qs = paramsDeRango(rango)

  return (
    <ReporteCrecimientoVista
      r={r}
      rango={rango}
      prefs={prefs}
      empresa={empresa?.name ?? 'Tu negocio'}
      generadoEn={formatDateTime(new Date(), prefs)}
      hrefClientes={`/admin/reportes/clientes${qs}`}
      eyebrow={<RangoFechas rango={rango} accion="/admin/reportes/crecimiento" />}
      controles={
        <>
          <BotonesExportar base="/admin/reportes/crecimiento/export" qs={qs} />
          <BotonImprimir />
        </>
      }
    />
  )
}
