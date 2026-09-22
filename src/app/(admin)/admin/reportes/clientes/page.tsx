import { conEmpresa } from '@/lib/tenant'
import { requireRole, requireSection, puedeFuncion } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { getRegionalPrefs } from '@/modules/empresas/regional'
import { formatDateTime, TZ_PLATAFORMA } from '@/lib/format'
import { leerRango, paramsDeRango } from '@/modules/reportes/rango'
import { getReporteClientes } from '@/modules/reportes/clientes'
import { RangoFechas } from '@/components/reportes/RangoFechas'
import { ReporteClientesVista } from '@/components/reportes/ReporteClientesVista'
import { BotonImprimir } from '@/components/ui/boton-imprimir'
import { BotonesExportar } from '@/components/reportes/BotonesExportar'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Clientes' }

/**
 * Quién entra, quién vuelve y de dónde vienen.
 *
 * DOS permisos viajan a la consulta, no al componente, porque la ruta de
 * exportación usa la misma función: `ver_financieros` para el dinero y
 * `ver_datos_personales` para los nombres. Sin ellos, esas consultas ni se
 * lanzan — esconderlas en la vista dejaría el dato saliendo por el archivo.
 */
export default async function ReporteClientesPage({
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
  // El semáforo del cliente vive en su propia sección: solo se enlaza a quien
  // puede entrar, para no ofrecer una puerta cerrada.
  const verRiesgo = (await requireSection('riesgo')) !== null
  const r = await getReporteClientes(companyId, rango, timeZone, {
    verFinancieros,
    verDatosPersonales,
  })
  const qs = paramsDeRango(rango)

  return (
    <ReporteClientesVista
      r={r}
      rango={rango}
      prefs={prefs}
      empresa={empresa?.name ?? 'Tu negocio'}
      generadoEn={formatDateTime(new Date(), prefs)}
      verRiesgo={verRiesgo}
      eyebrow={<RangoFechas rango={rango} accion="/admin/reportes/clientes" />}
      controles={
        <>
          <BotonesExportar base="/admin/reportes/clientes/export" qs={qs} />
          <BotonImprimir />
        </>
      }
    />
  )
}
