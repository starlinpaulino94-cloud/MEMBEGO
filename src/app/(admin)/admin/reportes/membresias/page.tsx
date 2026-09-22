import { conEmpresa } from '@/lib/tenant'
import { requireRole, requireSection } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { getRegionalPrefs } from '@/modules/empresas/regional'
import { formatDateTime, TZ_PLATAFORMA } from '@/lib/format'
import { leerRango, paramsDeRango } from '@/modules/reportes/rango'
import { getReporteMembresias } from '@/modules/reportes/membresias'
import { RangoFechas } from '@/components/reportes/RangoFechas'
import { ReporteMembresiasVista } from '@/components/reportes/ReporteMembresiasVista'
import { BotonImprimir } from '@/components/ui/boton-imprimir'
import { BotonesExportar } from '@/components/reportes/BotonesExportar'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Ciclo de vida de membresías' }

/**
 * El reporte que el estado de las membresías no podía dar.
 *
 * No lleva permiso financiero: aquí no hay dinero, hay movimientos. Un
 * encargado que no puede ver cuánto factura el negocio sí necesita saber
 * cuántas membresías se le están cayendo.
 */
export default async function ReporteMembresiasPage({
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
  const r = await getReporteMembresias(companyId, rango, timeZone)
  const qs = paramsDeRango(rango)

  return (
    <ReporteMembresiasVista
      r={r}
      rango={rango}
      empresa={empresa?.name ?? 'Tu negocio'}
      generadoEn={formatDateTime(new Date(), prefs)}
      qs={qs}
      eyebrow={<RangoFechas rango={rango} accion="/admin/reportes/membresias" />}
      controles={
        <>
          <BotonesExportar base="/admin/reportes/membresias/export" qs={qs} />
          <BotonImprimir />
        </>
      }
    />
  )
}
