import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { DetalleVisita } from '@/components/visitas-membego/detalle-visita'
import { AnularVentaAdicional } from '@/components/supply-v2/portal/anular-venta-adicional'
import { FUNCION_PORTAL, proveedorDeLaSesion } from '@/modules/supply-v2/permisos'
import { visitaDeLaEmpresa } from '@/modules/visitas-membego/queries'
import { RUTA_PORTAL_PROVEEDOR, RUTA_PORTAL_VENTAS_ADICIONALES } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Visita · Proveedor Membego' }

/** SUPPLIER & FULFILLMENT COMMERCE · una visita de la empresa con sus ventas adicionales (§30, §36). */
export default async function VisitaProveedorPage({ params }: { params: Promise<{ id: string }> }) {
  const proveedor = await proveedorDeLaSesion(FUNCION_PORTAL.ventas_adicionales)
  if (!proveedor) redirect(RUTA_PORTAL_PROVEEDOR)
  const { id } = await params
  const visita = await visitaDeLaEmpresa(proveedor.companyId, id)
  if (!visita) notFound()

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title={visita.number}
        description={`${visita.cliente} · ${visita.incluido ? `${visita.incluido.producto} incluido por Membego` : 'visita atribuida'}`}
        eyebrow={<Link href={RUTA_PORTAL_VENTAS_ADICIONALES} className="hover:underline">Ventas adicionales</Link>}
      />
      <DetalleVisita
        visita={visita}
        conComision
        accionDeVenta={(v) => (v.status === 'REPORTED' || v.status === 'CONFIRMED' ? <AnularVentaAdicional saleId={v.id} visitId={visita.id} /> : null)}
      />
    </div>
  )
}
