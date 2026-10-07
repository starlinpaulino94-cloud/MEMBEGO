import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { NavSupplyV2 } from '@/components/supply-v2/nav'
import { WizardCompra, type ProveedorWizard } from '@/components/supply-v2/wizard-compra'
import { proveedoresParaWizard } from '@/modules/supply-v2/suppliers/queries'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Nueva compra · Supply' }

export default async function NuevaCompraPage() {
  await requireRole('SUPERADMIN')
  const filas = await proveedoresParaWizard()
  const proveedores: ProveedorWizard[] = filas.map((p) => ({
    id: p.id,
    commercialName: p.commercialName,
    source: p.source,
    currency: p.currency,
    catalogItems: p.catalogItems.map((i) => ({
      id: i.id,
      name: i.name,
      type: i.type,
      sku: i.sku,
      category: i.category,
      publicPrice: i.publicPrice?.toFixed(2) ?? null,
      currency: i.currency,
      unit: i.unit,
    })),
    agreements: p.agreements.map((a) => ({
      id: a.id,
      code: a.code,
      version: a.version,
      type: a.type,
      scope: a.scope,
      status: a.status,
      catalogItemId: a.catalogItemId,
      category: a.category,
      negotiatedUnitCost: a.negotiatedUnitCost?.toFixed(2) ?? null,
      currency: a.currency,
      paymentTermsDays: a.paymentTermsDays,
      startsAt: a.startsAt.toISOString(),
      endsAt: a.endsAt?.toISOString() ?? null,
    })),
  }))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Nueva compra"
        description="Proveedor → producto → acuerdo → cantidad → pago → orden de compra. Lo que falte se crea por el camino."
        eyebrow={
          <Link href="/superadmin/supply/compras" className="hover:underline">
            Compras
          </Link>
        }
        nav={<NavSupplyV2 activa="compras" />}
      />
      <WizardCompra proveedores={proveedores} />
    </div>
  )
}
