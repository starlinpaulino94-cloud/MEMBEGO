import Link from 'next/link'
import { redirect } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { formatDate } from '@/lib/format'
import { sinEmpresa } from '@/lib/tenant'
import { ConfiguracionProveedor } from '@/components/supply-v2/portal/configuracion-proveedor'
import { proveedorDeLaSesion, FUNCION_PORTAL } from '@/modules/supply-v2/permisos'
import { preparacionDelProveedorEnTx } from '@/modules/supply-v2/suppliers/acceso'
import { RUTA_PORTAL_PROVEEDOR } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Configuración · Proveedor Membego' }

/**
 * SUPPLIER & FULFILLMENT COMMERCE · Configuración del portal (§8): lista de
 * preparación, contrato y prueba del escáner. Verla la puede cualquiera del
 * portal; aceptar el contrato y generar la prueba exigen `configuracion`.
 */
export default async function ConfiguracionProveedorPage() {
  const proveedor = await proveedorDeLaSesion()
  if (!proveedor) redirect(RUTA_PORTAL_PROVEEDOR)
  const puedeConfigurar = (await proveedorDeLaSesion(FUNCION_PORTAL.configuracion)) !== null
  const [preparacion, ficha] = await sinEmpresa('Supply: configuración del proveedor de la sesión', (tx) =>
    Promise.all([
      preparacionDelProveedorEnTx(tx, proveedor.supplierId),
      tx.supplyV2Supplier.findUniqueOrThrow({ where: { id: proveedor.supplierId }, select: { termsAcceptedAt: true, qrTestCode: true, qrTestedAt: true, accessStatus: true } }),
    ])
  )

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title="Configuración"
        description={`Lo que ${proveedor.supplierName} necesita para operar con Membego.`}
        eyebrow={<Link href={RUTA_PORTAL_PROVEEDOR} className="hover:underline">Proveedor Membego</Link>}
      />
      <ConfiguracionProveedor
        accessStatus={ficha.accessStatus}
        preparacion={preparacion}
        contratoAceptadoEn={ficha.termsAcceptedAt ? formatDate(ficha.termsAcceptedAt) : null}
        codigoDePrueba={puedeConfigurar ? ficha.qrTestCode : null}
        qrProbadoEn={ficha.qrTestedAt ? formatDate(ficha.qrTestedAt) : null}
        puedeConfigurar={puedeConfigurar}
      />
    </div>
  )
}
