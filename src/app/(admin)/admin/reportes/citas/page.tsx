import Link from 'next/link'
import Form from 'next/form'
import { conEmpresa } from '@/lib/tenant'
import { requireRole, requireSection, puedeFuncion } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { getRegionalPrefs } from '@/modules/empresas/regional'
import { formatDateTime } from '@/lib/format'
import { zonaSegura } from '@/lib/zona-horaria'
import { leerRango, paramsDeRango } from '@/modules/reportes/rango'
import { getReporteCitas } from '@/modules/reportes/citas'
import { RangoFechas } from '@/components/reportes/RangoFechas'
import { ReporteCitasVista } from '@/components/reportes/ReporteCitasVista'
import { Button } from '@/components/ui/button'
import { BotonImprimir } from '@/components/ui/boton-imprimir'
import { BotonesExportar } from '@/components/reportes/BotonesExportar'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Citas' }

/**
 * Cómo quedó la agenda.
 *
 * No lleva permiso financiero: aquí no hay dinero, hay citas. El desglose por
 * persona sí va detrás de `ver_empleados`, y el permiso viaja a la CONSULTA, no
 * al componente: la ruta de exportación usa esta misma función, así que
 * esconder la tabla en la vista dejaría el dato saliendo por el archivo.
 *
 * El filtro es por SERVICIO y solo por servicio, y eso también es una decisión:
 * la sucursal de una cita nunca se guarda (ver la cabecera del motor), así que
 * ofrecerla sería un desplegable que solo devuelve reportes vacíos.
 */
export default async function ReporteCitasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireRole(ADMIN_ROLES)
  const user = await requireSection('reportes', 'ver')
  if (!user) return <SinEmpresaActiva seccion="los reportes" />
  const companyId = await requireCompanyContext(user)

  const sp = await searchParams
  const leerParam = (k: string) => {
    const v = Array.isArray(sp[k]) ? sp[k][0] : sp[k]
    return typeof v === 'string' ? v.trim() : ''
  }
  const servicioPedido = leerParam('servicio')
  const sucursalPedida = leerParam('sucursal')

  const empresa = await conEmpresa(companyId, (tx) =>
    tx.company
      .findUnique({ where: { id: companyId }, select: { name: true, zonaHoraria: true } })
      .catch(() => null)
  )
  const timeZone = zonaSegura(empresa?.zonaHoraria)

  const rango = leerRango(sp, timeZone)
  const prefs = await getRegionalPrefs(companyId)
  const verEmpleados = await puedeFuncion('reportes', 'ver_empleados')
  const r = await getReporteCitas(companyId, rango, timeZone, {
    verEmpleados,
    filtro: {
      servicio: servicioPedido || undefined,
      sucursalId: sucursalPedida || undefined,
    },
  })

  // Lo que viaja pegado a los enlaces es el filtro APLICADO, no el pedido: un
  // servicio que la consulta descartó no sobrevive en los presets ni en el
  // enlace de exportación.
  const extra = new URLSearchParams()
  if (r.filtro?.servicio) extra.set('servicio', r.filtro.servicio)
  if (r.filtro?.sucursal) extra.set('sucursal', r.filtro.sucursal.id)
  const qs = paramsDeRango(rango)
  const spExport = new URLSearchParams(qs ? qs.slice(1) : '')
  for (const [k, v] of extra) spExport.set(k, v)
  const qsExport = spExport.toString()

  return (
    <ReporteCitasVista
      r={r}
      rango={rango}
      empresa={empresa?.name ?? 'Tu negocio'}
      generadoEn={formatDateTime(new Date(), prefs)}
      // El detalle abre con EL MISMO periodo y el MISMO filtro: es la misma
      // query string que se lleva la exportación.
      qs={qsExport}
      eyebrow={
        <div className="space-y-3">
          <RangoFechas rango={rango} accion="/admin/reportes/citas" extra={extra} />
          {(r.serviciosDisponibles.length > 0 || r.sucursalesDisponibles.length > 1) && (
            <Form
              action="/admin/reportes/citas"
              className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3"
            >
              {[...new URLSearchParams(qs ? qs.slice(1) : '').entries()].map(([k, v]) => (
                <input key={k} type="hidden" name={k} value={v} />
              ))}
              {/* Con una sola sucursal el desplegable sobra: todas las citas
                  son de esa. Aparece cuando de verdad hay que elegir. */}
              {r.sucursalesDisponibles.length > 1 && (
                <select
                  name="sucursal"
                  defaultValue={r.filtro?.sucursal?.id ?? ''}
                  aria-label="Filtrar por sucursal"
                  className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground"
                >
                  <option value="">Todas las sucursales</option>
                  {r.sucursalesDisponibles.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nombre}
                    </option>
                  ))}
                </select>
              )}
              {r.serviciosDisponibles.length > 0 && (
                <select
                  name="servicio"
                  defaultValue={r.filtro?.servicio ?? ''}
                  aria-label="Filtrar por servicio"
                  className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground"
                >
                  <option value="">Todos los servicios</option>
                  {r.serviciosDisponibles.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              )}
              <Button type="submit" variant="secondary" size="sm">
                Filtrar
              </Button>
              {r.filtro && (
                <Button asChild variant="ghost" size="sm">
                  <Link href={`/admin/reportes/citas${qs}`}>Limpiar</Link>
                </Button>
              )}
            </Form>
          )}
        </div>
      }
      controles={
        <>
          <BotonesExportar base="/admin/reportes/citas/export" qs={qsExport} />
          <BotonImprimir />
        </>
      }
    />
  )
}
