import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { conEmpresa } from '@/lib/tenant'
import { requireRole, requireSection, puedeFuncion } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { getRegionalPrefs } from '@/modules/empresas/regional'
import { formatDateTime, TZ_PLATAFORMA } from '@/lib/format'
import { leerRango, paramsDeRango } from '@/modules/reportes/rango'
import { getReporte } from '@/modules/reportes/queries'
import { RangoFechas } from '@/components/reportes/RangoFechas'
import { ReporteEmpresaVista } from '@/components/reportes/ReporteEmpresaVista'
import { BotonImprimir } from '@/components/ui/boton-imprimir'
import { BotonExportar } from '@/components/ui/boton-exportar'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'

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
  // El módulo ya estaba guardado por rol; ahora además por función. Quien no
  // tenga `reportes.ver` no entra aunque su rol lo dejara pasar.
  await requireRole(ADMIN_ROLES)
  const user = await requireSection('reportes', 'ver')
  if (!user) return <SinEmpresaActiva seccion="los reportes" />
  const companyId = await requireCompanyContext(user)
  if (!companyId || companyId === '__none__') {
    return <SinEmpresaActiva seccion="tus reportes" />
  }

  const sp = await searchParams
  const empresa = await conEmpresa(companyId,
    (tx) =>
      tx.company
        .findUnique({ where: { id: companyId }, select: { name: true, zonaHoraria: true } })
        .catch(() => null)
  )
  const timeZone = empresa?.zonaHoraria || TZ_PLATAFORMA

  const rango = leerRango(sp, timeZone)
  const prefs = await getRegionalPrefs(companyId)
  // El permiso viaja a la CONSULTA, no al componente: la ruta de exportación
  // usa esta misma función, así que esconder la columna en la vista dejaría el
  // dato saliendo por el archivo.
  const verFinancieros = await puedeFuncion('reportes', 'ver_financieros')
  // La bitácora responde la pregunta que los agregados no pueden —«¿QUÉ pasó,
  // cuándo y quién lo hizo?»— y vivía desconectada de Reportes: quien buscaba
  // «la extensión de vigencia que le hice a este cliente» no tenía cómo llegar.
  // Se enlaza solo si la persona tiene la sección (permiso aparte de reportes).
  const verActividad = (await requireSection('actividad')) !== null
  const r = await getReporte(companyId, rango, timeZone, { verFinancieros })
  const qs = paramsDeRango(rango)

  return (
    <ReporteEmpresaVista
      reporte={r}
      rango={rango}
      prefs={prefs}
      empresa={empresa?.name ?? 'Tu negocio'}
      generadoEn={formatDateTime(new Date(), prefs)}
      eyebrow={
        <div className="space-y-3">
          <RangoFechas rango={rango} accion="/admin/reportes" />
          {/* El ciclo de vida vive aparte porque responde otra pregunta: este
              reporte dice cuánto entró, aquél dice qué pasó con las membresías.
              Mezclarlos daría una pantalla que no se puede leer de una vez. */}
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <Link
              href={`/admin/reportes/membresias${qs}`}
              className="inline-flex items-center gap-1.5 text-small text-primary hover:underline"
            >
              Ciclo de vida de las membresías <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href={`/admin/reportes/operacion${qs}`}
              className="inline-flex items-center gap-1.5 text-small text-primary hover:underline"
            >
              Operación y canjes <ArrowRight className="h-4 w-4" />
            </Link>
            {verFinancieros && (
              <Link
                href={`/admin/reportes/finanzas${qs}`}
                className="inline-flex items-center gap-1.5 text-small text-primary hover:underline"
              >
                Finanzas y cobros <ArrowRight className="h-4 w-4" />
              </Link>
            )}
            {verActividad && (
              <Link
                href="/admin/actividad"
                className="inline-flex items-center gap-1.5 text-small text-primary hover:underline"
              >
                Actividad: todo lo que pasó, acción por acción <ArrowRight className="h-4 w-4" />
              </Link>
            )}
          </div>
        </div>
      }
      controles={
        <>
          <BotonExportar href={`/admin/reportes/export${qs}`} />
          <BotonImprimir />
        </>
      }
    />
  )
}

