import { conEmpresa } from '@/lib/tenant'
import { requireRole, requireSection, puedeFuncion } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { getRegionalPrefs } from '@/modules/empresas/regional'
import { formatDateTime, TZ_PLATAFORMA } from '@/lib/format'
import { leerRango, paramsDeRango } from '@/modules/reportes/rango'
import { getReporteRegalos } from '@/modules/reportes/regalos'
import { RangoFechas } from '@/components/reportes/RangoFechas'
import { ReporteRegalosVista } from '@/components/reportes/ReporteRegalosVista'
import { BotonImprimir } from '@/components/ui/boton-imprimir'
import { BotonExportar } from '@/components/ui/boton-exportar'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Códigos y regalos' }

/**
 * Lo que un cliente le paga a otro: regalos y gift cards.
 *
 * Los dos permisos viajan a la CONSULTA y no al componente, porque la ruta de
 * exportación usa la misma función: `ver_financieros` para el dinero y el saldo
 * vivo, `ver_datos_personales` para la tabla de quién más regala.
 */
export default async function ReporteRegalosPage({
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
  const verDatosPersonales = await puedeFuncion('reportes', 'ver_datos_personales')
  // La alarma de los que vencen solo se enlaza a quien puede ir a resolverla.
  const verRegalos = (await requireSection('regalos')) !== null
  const r = await getReporteRegalos(companyId, rango, timeZone, {
    verFinancieros,
    verDatosPersonales,
  })
  const qs = paramsDeRango(rango)

  return (
    <ReporteRegalosVista
      r={r}
      rango={rango}
      prefs={prefs}
      empresa={empresa?.name ?? 'Tu negocio'}
      generadoEn={formatDateTime(new Date(), prefs)}
      hrefRegalos={verRegalos ? '/admin/regalos' : undefined}
      eyebrow={<RangoFechas rango={rango} accion="/admin/reportes/regalos" />}
      controles={
        <>
          <BotonExportar href={`/admin/reportes/regalos/export${qs}`} />
          <BotonImprimir />
        </>
      }
    />
  )
}
