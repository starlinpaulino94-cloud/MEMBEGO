import { conEmpresa } from '@/lib/tenant'
import { requireRole, requireSection, puedeFuncion } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { getRegionalPrefs } from '@/modules/empresas/regional'
import { formatDateTime, TZ_PLATAFORMA } from '@/lib/format'
import { leerRango, paramsDeRango } from '@/modules/reportes/rango'
import { getReporte } from '@/modules/reportes/queries'
import { RangoFechas } from '@/components/reportes/RangoFechas'
import { NavegacionReportes } from '@/components/reportes/NavegacionReportes'
import { ReporteEmpresaVista } from '@/components/reportes/ReporteEmpresaVista'
import { BotonImprimir } from '@/components/ui/boton-imprimir'
import { BotonesExportar } from '@/components/reportes/BotonesExportar'
import { PersonalizarResumen } from '@/components/reportes/PersonalizarResumen'
import { misPreferenciasReportes } from '@/modules/reportes/preferenciasActions'
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
  // Qué cifras ve ESTA persona. Va con el resto de la carga y no en un efecto:
  // pintar las cinco y quitar dos después es el salto que el esqueleto de carga
  // existe para evitar.
  const { pref: preferencias, disponible: sePuedePersonalizar } = await misPreferenciasReportes()

  return (
    <ReporteEmpresaVista
      reporte={r}
      rango={rango}
      prefs={prefs}
      empresa={empresa?.name ?? 'Tu negocio'}
      generadoEn={formatDateTime(new Date(), prefs)}
      preferencias={preferencias}
      // Sin la columna aplicada todavía, el panel NO se ofrece: mejor que la
      // opción no esté a que esté y falle al primer clic. Aparece sola cuando
      // la migración corre. Ver `misPreferenciasReportes`.
      personalizar={
        sePuedePersonalizar ? (
          <PersonalizarResumen pref={preferencias} verFinancieros={verFinancieros} />
        ) : null
      }
      // Drill-down: cada cifra del resumen abre el reporte que la explica, con
      // el MISMO periodo. El superadmin monta esta vista sin enlaces porque sus
      // reportes viven en otras rutas.
      enlaces={{
        finanzas: verFinancieros ? `/admin/reportes/finanzas${qs}` : undefined,
        operacion: `/admin/reportes/operacion${qs}`,
        clientes: `/admin/reportes/clientes${qs}`,
        membresias: `/admin/reportes/membresias${qs}`,
      }}
      eyebrow={
        <div className="space-y-4">
          <RangoFechas rango={rango} accion="/admin/reportes" />
          {/* Cada reporte responde una pregunta distinta, y por eso viven
              aparte: mezclarlos daría una pantalla que no se puede leer de una
              vez. El mapa dice cuál responde la que se trae. */}
          <NavegacionReportes
            categorias={[
              ...(verFinancieros
                ? [
                    {
                      titulo: 'Finanzas y cobros',
                      pregunta: '¿Cuánto entró, por qué vía y qué quedó sin cobrar?',
                      href: `/admin/reportes/finanzas${qs}`,
                    },
                  ]
                : []),
              {
                titulo: 'Membresías',
                pregunta: '¿Qué pasó con cada membresía: altas, renovaciones y bajas?',
                href: `/admin/reportes/membresias${qs}`,
              },
              {
                titulo: 'Clientes',
                pregunta: '¿Cuánta gente entró, de dónde vino y volvió?',
                href: `/admin/reportes/clientes${qs}`,
              },
              {
                titulo: 'Operación y canjes',
                pregunta: '¿Cuánto se trabajó, dónde y con qué beneficio?',
                href: `/admin/reportes/operacion${qs}`,
              },
              {
                titulo: 'Promociones',
                pregunta: '¿Qué se vende, qué se entrega y qué se usa de verdad?',
                href: `/admin/reportes/promociones${qs}`,
              },
              {
                titulo: 'Códigos y regalos',
                pregunta: '¿Qué le paga un cliente a otro, y llega a su destino?',
                href: `/admin/reportes/regalos${qs}`,
              },
              {
                titulo: 'Crecimiento',
                pregunta: '¿Quién trae gente nueva y dónde se cae el embudo?',
                href: `/admin/reportes/crecimiento${qs}`,
              },
              {
                titulo: 'Citas y asistencia',
                pregunta: '¿Cómo quedó la agenda y cuántos se presentaron?',
                href: `/admin/reportes/citas${qs}`,
              },
              ...(verActividad
                ? [
                    {
                      titulo: 'Actividad',
                      pregunta: '¿Qué pasó exactamente, cuándo y quién lo hizo?',
                      href: '/admin/actividad',
                    },
                  ]
                : []),
            ]}
          />
        </div>
      }
      controles={
        <>
          <BotonesExportar base="/admin/reportes/export" qs={qs} />
          <BotonImprimir />
        </>
      }
    />
  )
}

