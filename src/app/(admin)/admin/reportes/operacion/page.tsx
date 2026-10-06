import { conEmpresa } from '@/lib/tenant'
import { requireRole, requireSection, puedeFuncion } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { getRegionalPrefs } from '@/modules/empresas/regional'
import { formatDateTime } from '@/lib/format'
import { zonaSegura } from '@/lib/zona-horaria'
import { leerRango, paramsDeRango } from '@/modules/reportes/rango'
import { getReporteOperacion } from '@/modules/reportes/operacion'
import { RangoFechas } from '@/components/reportes/RangoFechas'
import { FiltroReporteForm } from '@/components/reportes/FiltroReporteForm'
import { ReporteOperacionVista } from '@/components/reportes/ReporteOperacionVista'
import { BotonImprimir } from '@/components/ui/boton-imprimir'
import { BotonesExportar } from '@/components/reportes/BotonesExportar'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Operación' }

/**
 * Lo que pasó en la pista.
 *
 * No lleva permiso financiero: aquí no hay dinero, hay canjes. Un encargado de
 * turno que no puede ver cuánto factura el negocio sí necesita saber cuántos
 * lavados se registraron ayer y en qué sucursal.
 *
 * El desglose por empleado sí va detrás de `ver_empleados`, y el permiso viaja
 * a la CONSULTA, no al componente: la ruta de exportación usa esta misma
 * función, así que esconder la tabla en la vista dejaría el dato saliendo por
 * el archivo. El FILTRO por empleado hereda la misma regla: sin el permiso, el
 * parámetro se ignora en la consulta, no solo en el desplegable.
 *
 * El filtro viaja en la URL (`?sucursal=`, `?empleado=`) junto al rango: un
 * enlace guardado abre EXACTAMENTE el mismo corte, y la exportación se lleva
 * el mismo filtro que la pantalla.
 */
export default async function ReporteOperacionPage({
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

  const verEmpleados = await puedeFuncion('reportes', 'ver_empleados')
  const sucursalId = leerParam('sucursal')
  // Sin el permiso el parámetro NI SE LEE: así ni el reporte ni los enlaces
  // (presets, exportación) lo arrastran.
  const empleadoId = verEmpleados ? leerParam('empleado') : ''

  const [empresa, sucursales, empleados] = await conEmpresa(companyId, (tx) =>
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
      // Solo el personal, nunca los clientes, y solo con el permiso: el
      // desplegable de personas ES una lista de empleados.
      verEmpleados
        ? tx.user
            .findMany({
              where: {
                role: { not: 'CLIENTE' },
                OR: [{ companyId }, { empresasAcceso: { some: { companyId } } }],
              },
              select: { id: true, name: true },
              orderBy: { name: 'asc' },
            })
            .catch(() => [])
        : Promise.resolve(null),
    ])
  )
  const timeZone = zonaSegura(empresa?.zonaHoraria)

  const rango = leerRango(sp, timeZone)
  const prefs = await getRegionalPrefs(companyId)
  const r = await getReporteOperacion(companyId, rango, timeZone, {
    verEmpleados,
    filtro: { sucursalId: sucursalId || undefined, empleadoId: empleadoId || undefined },
  })

  // El filtro que viaja pegado a los enlaces es el APLICADO, no el pedido: un
  // id que la consulta descartó tampoco debe sobrevivir en los presets ni
  // colarse en la exportación.
  const extra = new URLSearchParams()
  if (r.filtro?.sucursal) extra.set('sucursal', r.filtro.sucursal.id)
  if (r.filtro?.empleado) extra.set('empleado', r.filtro.empleado.id)
  const qs = paramsDeRango(rango)
  const spExport = new URLSearchParams(qs ? qs.slice(1) : '')
  for (const [k, v] of extra) spExport.set(k, v)
  const qsExport = spExport.toString()

  return (
    <ReporteOperacionVista
      r={r}
      rango={rango}
      empresa={empresa?.name ?? 'Tu negocio'}
      generadoEn={formatDateTime(new Date(), prefs)}
      // El detalle abre con EL MISMO periodo y los MISMOS filtros: es la misma
      // query string que se lleva la exportación.
      qs={qsExport}
      eyebrow={
        <div className="space-y-3">
          <RangoFechas rango={rango} accion="/admin/reportes/operacion" extra={extra} />
          <FiltroReporteForm
            accion="/admin/reportes/operacion"
            rango={rango}
            sucursales={sucursales}
            sucursalId={r.filtro?.sucursal?.id ?? ''}
            empleados={empleados}
            empleadoId={r.filtro?.empleado?.id ?? ''}
          />
        </div>
      }
      controles={
        <>
          <BotonesExportar base="/admin/reportes/operacion/export" qs={qsExport} />
          <BotonImprimir />
        </>
      }
    />
  )
}
