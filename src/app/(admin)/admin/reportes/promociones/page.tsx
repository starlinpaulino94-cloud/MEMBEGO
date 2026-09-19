import { conEmpresa } from '@/lib/tenant'
import { requireRole, requireSection, puedeFuncion } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { getRegionalPrefs } from '@/modules/empresas/regional'
import { formatDateTime, TZ_PLATAFORMA } from '@/lib/format'
import { leerRango, paramsDeRango } from '@/modules/reportes/rango'
import { getReportePromociones } from '@/modules/reportes/promociones'
import { RangoFechas } from '@/components/reportes/RangoFechas'
import { ReportePromocionesVista } from '@/components/reportes/ReportePromocionesVista'
import { BotonImprimir } from '@/components/ui/boton-imprimir'
import { BotonExportar } from '@/components/ui/boton-exportar'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Promociones' }

/**
 * Qué se vende, qué se entrega y qué se usa de verdad.
 *
 * `ver_financieros` viaja a la CONSULTA y no al componente, porque la ruta de
 * exportación usa la misma función: esconder el dinero en la vista lo dejaría
 * saliendo por el archivo.
 */
export default async function ReportePromocionesPage({
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
  const verFinancieros = await puedeFuncion('reportes', 'ver_financieros')
  // La alarma de comprobantes por validar solo se enlaza a quien puede entrar
  // a resolverla: ofrecer una puerta cerrada es peor que no ofrecer ninguna.
  const verPromociones = (await requireSection('promociones')) !== null
  const r = await getReportePromociones(companyId, rango, timeZone, { verFinancieros })
  const qs = paramsDeRango(rango)

  return (
    <ReportePromocionesVista
      r={r}
      rango={rango}
      prefs={prefs}
      empresa={empresa?.name ?? 'Tu negocio'}
      generadoEn={formatDateTime(new Date(), prefs)}
      hrefCompras={verPromociones ? '/admin/promociones' : undefined}
      eyebrow={<RangoFechas rango={rango} accion="/admin/reportes/promociones" />}
      controles={
        <>
          <BotonExportar href={`/admin/reportes/promociones/export${qs}`} />
          <BotonImprimir />
        </>
      }
    />
  )
}
