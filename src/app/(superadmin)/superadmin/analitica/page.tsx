import { sinEmpresa } from '@/lib/tenant'
import { requireRole } from '@/lib/auth/guards'
import { formatDateTime, TZ_PLATAFORMA } from '@/lib/format'
import { leerRango } from '@/modules/reportes/rango'
import { panoramaDePlataformaEnTx } from '@/modules/analytics/queries'
import { resumenFinanzas } from '@/modules/supply-v2/finance/queries'
import { RangoFechas } from '@/components/reportes/RangoFechas'
import { AnaliticaPlataformaVista } from '@/components/analytics/AnaliticaPlataformaVista'
import { BotonImprimir } from '@/components/ui/boton-imprimir'
import { StatusBanner } from '@/components/ui/status-banner'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Analítica de Membego' }

/**
 * Analítica de la plataforma (Fase 6): GMV, toma, ventas por empresa y canal, ofertas y salud de los
 * cobros. COMPONE dos módulos que no se conocen —la analítica del comercio y Supply Economics— y los
 * pone en bloques separados: ninguna cifra mezcla los dos libros. Solo el superadmin.
 */
export default async function AnaliticaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole('SUPERADMIN')
  const sp = await searchParams
  const rango = leerRango(sp, TZ_PLATAFORMA)

  const [panorama, supply] = await Promise.all([
    sinEmpresa('analítica de plataforma (superadmin)', (tx) => panoramaDePlataformaEnTx(tx, rango, TZ_PLATAFORMA)).catch((e) => {
      console.error('[superadmin-analitica]', e)
      return null
    }),
    resumenFinanzas().catch((e) => {
      console.error('[superadmin-analitica-supply]', e)
      return null
    }),
  ])

  if (!panorama) {
    return (
      <StatusBanner variant="warning" title="No se pudo cargar la analítica">
        Intenta de nuevo en un momento.
      </StatusBanner>
    )
  }

  return (
    <AnaliticaPlataformaVista
      p={panorama}
      supply={supply}
      rango={rango}
      generadoEn={formatDateTime(new Date(), null)}
      eyebrow={<RangoFechas rango={rango} accion="/superadmin/analitica" />}
      controles={<BotonImprimir />}
    />
  )
}
