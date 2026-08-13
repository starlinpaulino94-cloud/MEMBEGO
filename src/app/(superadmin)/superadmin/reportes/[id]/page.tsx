import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth/guards'
import { sinEmpresa } from '@/lib/tenant'
import { formatDateTime, TZ_PLATAFORMA } from '@/lib/format'
import { leerRango, paramsDeRango } from '@/modules/reportes/rango'
import { getReporte } from '@/modules/reportes/queries'
import { RangoFechas } from '@/components/reportes/RangoFechas'
import { ReporteEmpresaVista } from '@/components/reportes/ReporteEmpresaVista'
import { BotonImprimir } from '@/components/ui/boton-imprimir'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Download } from 'lucide-react'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Reporte de la empresa' }

/**
 * EL REPORTE COMPLETO DE UNA EMPRESA, desde el panel de plataforma.
 *
 * Faltaba: el superadmin veía el resumen por empresa y ahí se acababa. Para
 * responder «¿por qué bajó este negocio?» tenía que entrar como uno de sus
 * administradores —o pedírselo—, cuando el dato ya estaba en la base.
 *
 * Es EL MISMO componente que monta `/admin/reportes`. Y lo es a propósito: si
 * fueran dos vistas distintas, el superadmin y el cliente acabarían discutiendo
 * sobre cifras del mismo negocio que no coinciden.
 *
 * La lectura de la empresa va con `sinEmpresa` porque es el panel de
 * plataforma; el reporte en sí lo abre `getReporte` con `conEmpresa`, que es
 * donde corresponde. Son dos transacciones seguidas, nunca anidadas.
 */
export default async function ReporteDeEmpresaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireRole('SUPERADMIN')
  const { id } = await params
  const sp = await searchParams

  const empresa = await sinEmpresa(
    'panel de plataforma: el superadmin abre el reporte de cualquier empresa',
    (tx) =>
      tx.company
        .findUnique({
          where: { id },
          select: { name: true, moneda: true, idioma: true, zonaHoraria: true, esDemo: true },
        })
        .catch(() => null)
  )
  if (!empresa) notFound()

  // La zona horaria y la moneda son LAS DE LA EMPRESA, no las de la
  // plataforma: un reporte del negocio cortado en otro huso no cuadra con su
  // caja, y da igual quién lo esté mirando.
  const timeZone = empresa.zonaHoraria || TZ_PLATAFORMA
  const rango = leerRango(sp, timeZone)
  const r = await getReporte(id, rango, timeZone)

  // Solo el periodo vuelve al listado: la búsqueda y el orden de allí no
  // significan nada aquí, y arrastrarlos ensuciaría la URL sin efecto.
  const qs = paramsDeRango(rango)

  return (
    <ReporteEmpresaVista
      reporte={r}
      rango={rango}
      prefs={empresa}
      empresa={`${empresa.name}${empresa.esDemo ? ' · práctica' : ''}`}
      generadoEn={formatDateTime(new Date(), empresa)}
      eyebrow={
        <div className="space-y-4">
          <Button asChild variant="ghost" size="sm" className="gap-1.5">
            <Link href={`/superadmin/reportes${qs}`}>
              <ArrowLeft className="h-4 w-4" aria-hidden /> Volver a los reportes de plataforma
            </Link>
          </Button>
          <RangoFechas rango={rango} accion={`/superadmin/reportes/${id}`} />
        </div>
      }
      controles={
        <>
          <Button asChild variant="secondary">
            <a href={`/superadmin/reportes/${id}/exportar${qs}`}>
              <Download className="mr-2 h-4 w-4" aria-hidden /> Exportar CSV
            </a>
          </Button>
          <BotonImprimir />
        </>
      }
    />
  )
}
