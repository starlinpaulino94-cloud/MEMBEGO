import { conEmpresa } from '@/lib/tenant'
import { requireRole, requireSection } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { getRegionalPrefs } from '@/modules/empresas/regional'
import { formatDateTime } from '@/lib/format'
import { zonaSegura } from '@/lib/zona-horaria'
import { leerRango, paramsDeRango } from '@/modules/reportes/rango'
import { getReporteFinanzas } from '@/modules/reportes/finanzas'
import { RangoFechas } from '@/components/reportes/RangoFechas'
import { FiltroReporteForm } from '@/components/reportes/FiltroReporteForm'
import { ReporteFinanzasVista } from '@/components/reportes/ReporteFinanzasVista'
import { BotonImprimir } from '@/components/ui/boton-imprimir'
import { BotonesExportar } from '@/components/reportes/BotonesExportar'
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
  const sucursalPedida = (() => {
    const v = Array.isArray(sp.sucursal) ? sp.sucursal[0] : sp.sucursal
    return typeof v === 'string' ? v.trim() : ''
  })()

  const [empresa, sucursales] = await conEmpresa(companyId, (tx) =>
    Promise.all([
      tx.company
        .findUnique({ where: { id: companyId }, select: { name: true, zonaHoraria: true } })
        .catch(() => null),
      tx.sucursal
        .findMany({
          where: { companyId },
          select: { id: true, nombre: true },
          orderBy: { nombre: 'asc' },
        })
        .catch(() => []),
    ])
  )
  const timeZone = zonaSegura(empresa?.zonaHoraria)

  const rango = leerRango(sp, timeZone)
  const prefs = await getRegionalPrefs(companyId)
  const r = await getReporteFinanzas(companyId, rango, timeZone, new Date(), {
    filtro: { sucursalId: sucursalPedida || undefined },
  })

  // Lo que viaja pegado a los enlaces es el filtro APLICADO, no el pedido: un
  // id que la consulta descartó no sobrevive en los presets ni en el export.
  const extra = new URLSearchParams()
  if (r.filtro) extra.set('sucursal', r.filtro.sucursal.id)
  const qs = paramsDeRango(rango)
  const spExport = new URLSearchParams(qs ? qs.slice(1) : '')
  for (const [k, v] of extra) spExport.set(k, v)
  const qsExport = spExport.toString()

  return (
    <ReporteFinanzasVista
      r={r}
      rango={rango}
      prefs={prefs}
      empresa={empresa?.name ?? 'Tu negocio'}
      generadoEn={formatDateTime(new Date(), prefs)}
      // El detalle abre con EL MISMO periodo y el MISMO filtro: es la misma
      // query string que se lleva la exportación.
      qs={qsExport}
      eyebrow={
        <div className="space-y-3">
          <RangoFechas rango={rango} accion="/admin/reportes/finanzas" extra={extra} />
          <FiltroReporteForm
            accion="/admin/reportes/finanzas"
            rango={rango}
            sucursales={sucursales}
            sucursalId={r.filtro?.sucursal.id ?? ''}
          />
        </div>
      }
      controles={
        <>
          <BotonesExportar base="/admin/reportes/finanzas/export" qs={qsExport} />
          <BotonImprimir />
        </>
      }
    />
  )
}
