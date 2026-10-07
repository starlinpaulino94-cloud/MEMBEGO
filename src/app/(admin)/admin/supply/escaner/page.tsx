import Link from 'next/link'
import { redirect } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { EscanerProveedor } from '@/components/supply-v2/escaner-proveedor'
import { proveedorDeLaSesion } from '@/modules/supply-v2/permisos'
import { branchGateway } from '@/modules/supply-v2/contracts/adapters'
import { RUTA_PORTAL_PROVEEDOR } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Escanear beneficio · Membego' }

/**
 * MEMBEGO SUPPLY · escáner del proveedor (§15, §19, §51–§52).
 * Dos pasos siempre: escanear enseña; «Confirmar entrega» redime.
 */
export default async function EscanerProveedorPage() {
  const proveedor = await proveedorDeLaSesion()
  if (!proveedor) redirect('/admin/dashboard')
  const sucursales = await branchGateway.listForCompany(proveedor.companyId)

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <PageHeader
        title="Escanear beneficio"
        description="Lee el código del cliente, comprueba qué debes entregar y confirma."
        eyebrow={
          <Link href={RUTA_PORTAL_PROVEEDOR} className="hover:underline">
            Entregas Membego
          </Link>
        }
      />
      <EscanerProveedor sucursales={sucursales.map((s) => ({ id: s.id, nombre: s.name }))} />
    </div>
  )
}
