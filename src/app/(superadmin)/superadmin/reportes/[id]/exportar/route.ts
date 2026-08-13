import { NextResponse, type NextRequest } from 'next/server'
import { requireRole } from '@/lib/auth/guards'
import { sinEmpresa } from '@/lib/tenant'
import { TZ_PLATAFORMA } from '@/lib/format'
import { respuestaCsv } from '@/lib/csv'
import { leerRango } from '@/modules/reportes/rango'
import { getReporte, reporteToCsv } from '@/modules/reportes/queries'

export const dynamic = 'force-dynamic'

/**
 * CSV del reporte de UNA empresa, desde el panel de plataforma.
 *
 * Mismo periodo que la pantalla y misma zona horaria que el negocio: si el
 * archivo cortara los días en otro huso, sus cifras no cuadrarían con las que
 * el propio cliente ve en `/admin/reportes`, y la conversación siguiente sería
 * sobre cuál de los dos miente.
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  await requireRole('SUPERADMIN')
  const { id } = await ctx.params

  const empresa = await sinEmpresa(
    'panel de plataforma: exportar el reporte de una empresa',
    (tx) =>
      tx.company
        .findUnique({ where: { id }, select: { name: true, zonaHoraria: true } })
        .catch(() => null)
  )
  if (!empresa) return NextResponse.json({ error: 'Empresa no encontrada.' }, { status: 404 })

  const sp: Record<string, string> = {}
  request.nextUrl.searchParams.forEach((v, k) => {
    sp[k] = v
  })

  const timeZone = empresa.zonaHoraria || TZ_PLATAFORMA
  const rango = leerRango(sp, timeZone)
  const reporte = await getReporte(id, rango, timeZone)

  return respuestaCsv(
    reporteToCsv(reporte, {
      empresa: empresa.name,
      desdeDia: rango.desdeDia,
      hastaDia: rango.hastaDia,
      dias: rango.dias,
    }),
    `reporte-${empresa.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}-${rango.desdeDia}_${rango.hastaDia}`,
    { fechar: false }
  )
}
