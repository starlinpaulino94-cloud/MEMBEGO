import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { NavSupplyV2 } from '@/components/supply-v2/nav'
import { DetalleVisita } from '@/components/visitas-membego/detalle-visita'
import { ResolverDisputa, VerificarPagoVenta } from '@/components/supply-v2/visitas/resolver-disputa'
import { visitaParaPlataforma } from '@/modules/visitas-membego/queries'
import { puedeSupplyV2 } from '@/modules/supply-v2/permisos'
import { RUTA_VISITAS } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Visita · Supply' }

/**
 * SUPPLIER & FULFILLMENT COMMERCE · ficha interna de una visita (§32, §35):
 * resolver disputas y registrar evidencia externa. Nada aquí edita un asiento:
 * una resolución a favor del cliente crea un reverso o un ajuste nuevos.
 */
export default async function VisitaPlataformaPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole('SUPERADMIN')
  const { id } = await params
  const [visita, puedeResolver, puedeVerificar] = await Promise.all([visitaParaPlataforma(id), puedeSupplyV2('SUPPLY_V2_REDEMPTION_REVERSE'), puedeSupplyV2('SUPPLY_V2_RECONCILE')])
  if (!visita) notFound()

  return (
    <div className="space-y-6">
      <PageHeader
        title={visita.number}
        description={`${visita.empresa} · ${visita.cliente}`}
        eyebrow={<Link href={RUTA_VISITAS} className="hover:underline">Visitas</Link>}
        nav={<NavSupplyV2 activa="visitas" />}
      />
      <DetalleVisita
        visita={visita}
        conComision
        mostrarEmpresa
        accionDeVenta={(v) => (puedeVerificar && v.status !== 'REVERSED' && v.evidenceLevel !== 'PAYMENT_VERIFIED' && v.evidenceLevel !== 'FISCALLY_RECONCILED' ? <VerificarPagoVenta saleId={v.id} visitId={visita.id} /> : null)}
        accionDeDisputa={(d) => (puedeResolver && (d.status === 'OPEN' || d.status === 'UNDER_REVIEW') ? <ResolverDisputa disputeId={d.id} visitId={visita.id} estado={d.status} reportedTotal={d.reportedTotal} claimedTotal={d.claimedTotal} /> : null)}
      />
    </div>
  )
}
