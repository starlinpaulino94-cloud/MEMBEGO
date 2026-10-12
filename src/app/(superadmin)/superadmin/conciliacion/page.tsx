import { sinEmpresa } from '@/lib/tenant'
import { requireRole } from '@/lib/auth/guards'
import { formatDateTime } from '@/lib/format'
import { conciliarEnTx } from '@/modules/conciliacion/queries'
import { ConciliacionVista } from '@/components/conciliacion/ConciliacionVista'
import { BotonImprimir } from '@/components/ui/boton-imprimir'
import { StatusBanner } from '@/components/ui/status-banner'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Conciliación del comercio' }

/**
 * Conciliación del comercio (Fase 9): ¿cuadran los pedidos, los pagos, las comisiones, el libro de cada cuenta,
 * las ofertas y el inventario? Solo lectura y solo del superadmin; corre sin contexto de empresa y deja fuera las
 * empresas de práctica.
 */
export default async function ConciliacionPage() {
  await requireRole('SUPERADMIN')
  const hallazgos = await sinEmpresa('conciliación del comercio (superadmin)', (tx) => conciliarEnTx(tx, { companyId: null })).catch((e) => {
    console.error('[superadmin-conciliacion]', e)
    return null
  })

  if (!hallazgos) {
    return (
      <StatusBanner variant="warning" title="No se pudo cargar la conciliación">
        Intenta de nuevo en un momento.
      </StatusBanner>
    )
  }

  return <ConciliacionVista hallazgos={hallazgos} generadoEn={formatDateTime(new Date(), null)} controles={<BotonImprimir />} />
}
