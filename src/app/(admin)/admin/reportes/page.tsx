import { conEmpresaOTodas } from '@/lib/tenant'
import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { companyFilter } from '@/modules/admin/queries'
import { getRegionalPrefs } from '@/modules/empresas/regional'
import { formatDateTime, TZ_PLATAFORMA } from '@/lib/format'
import { leerRango, paramsDeRango } from '@/modules/reportes/rango'
import { getReporte } from '@/modules/reportes/queries'
import { RangoFechas } from '@/components/reportes/RangoFechas'
import { ReporteEmpresaVista } from '@/components/reportes/ReporteEmpresaVista'
import { BotonImprimir } from '@/components/ui/boton-imprimir'
import { Button } from '@/components/ui/button'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'
import { Download } from 'lucide-react'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Reportes' }

/**
 * Reportes del negocio.
 *
 * La pantalla es fina a propósito: resuelve la empresa, el periodo y las
 * preferencias regionales, y delega en `ReporteEmpresaVista`, que es el MISMO
 * componente que monta el superadmin en `/superadmin/reportes/[id]`. Dos copias
 * del mismo reporte terminan divergiendo, y entonces el superadmin y el cliente
 * discuten sobre cifras distintas del mismo negocio.
 */
export default async function ReportesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = companyFilter(user)
  if (!companyId || companyId === '__none__') {
    return <SinEmpresaActiva seccion="tus reportes" />
  }

  const sp = await searchParams
  const empresa = await conEmpresaOTodas(
    companyId,
    'reportes: sin empresa activa es el superadmin',
    (tx) =>
      tx.company
        .findUnique({ where: { id: companyId }, select: { name: true, zonaHoraria: true } })
        .catch(() => null)
  )
  const timeZone = empresa?.zonaHoraria || TZ_PLATAFORMA

  const rango = leerRango(sp, timeZone)
  const prefs = await getRegionalPrefs(companyId)
  const r = await getReporte(companyId, rango, timeZone)
  const qs = paramsDeRango(rango)

  return (
    <ReporteEmpresaVista
      reporte={r}
      rango={rango}
      prefs={prefs}
      empresa={empresa?.name ?? 'Tu negocio'}
      generadoEn={formatDateTime(new Date(), prefs)}
      eyebrow={<RangoFechas rango={rango} accion="/admin/reportes" />}
      controles={
        <>
          <Button asChild variant="secondary">
            <a href={`/admin/reportes/export${qs}`}>
              <Download className="mr-2 h-4 w-4" aria-hidden /> Exportar CSV
            </a>
          </Button>
          <BotonImprimir />
        </>
      }
    />
  )
}
