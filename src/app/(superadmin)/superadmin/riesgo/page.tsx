import { sinEmpresa } from '@/lib/tenant'
import { requireRole } from '@/lib/auth/guards'
import { formatDateTime } from '@/lib/format'
import { riesgoDeLaPlataformaEnTx } from '@/modules/riesgo-comercio/queries'
import { RiesgoVista } from '@/components/riesgo/RiesgoVista'
import { BotonImprimir } from '@/components/ui/boton-imprimir'
import { StatusBanner } from '@/components/ui/status-banner'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Señales de riesgo' }

/**
 * Señales de riesgo (Fase 9): a qué empresas y clientes conviene llamar primero. Solo lectura y solo del
 * superadmin; corre sin contexto de empresa y deja fuera las empresas de práctica.
 */
export default async function RiesgoPage() {
  await requireRole('SUPERADMIN')
  const panorama = await sinEmpresa('señales de riesgo (superadmin)', (tx) => riesgoDeLaPlataformaEnTx(tx)).catch((e) => {
    console.error('[superadmin-riesgo]', e)
    return null
  })

  if (!panorama) {
    return (
      <StatusBanner variant="warning" title="No se pudieron cargar las señales">
        Intenta de nuevo en un momento.
      </StatusBanner>
    )
  }

  return <RiesgoVista senales={panorama.senales} ventanaDias={panorama.ventanaDias} empresasRevisadas={panorama.revisadas.empresas} generadoEn={formatDateTime(panorama.generadoEn, null)} controles={<BotonImprimir />} />
}
