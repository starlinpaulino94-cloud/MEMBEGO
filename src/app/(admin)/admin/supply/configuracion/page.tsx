import Link from 'next/link'
import { redirect } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { formatDate } from '@/lib/format'
import { ConfiguracionProveedor } from '@/components/supply-v2/portal/configuracion-proveedor'
import { proveedorDeLaSesion, FUNCION_PORTAL } from '@/modules/supply-v2/permisos'
import { configuracionDelProveedor } from '@/modules/supply-v2/portal/queries'
import { extrasDelProveedor } from '@/modules/visitas-membego/queries'
import { MiniCatalogoExtras } from '@/components/supply-v2/portal/mini-catalogo-extras'
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
  const [{ preparacion, ficha }, extras] = await Promise.all([configuracionDelProveedor(proveedor.supplierId), extrasDelProveedor(proveedor.supplierId)])

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
      {/* SUPPLIER & FULFILLMENT COMMERCE · el mini catálogo de extras (§26). */}
      <MiniCatalogoExtras
        extras={extras.map((e) => ({ id: e.id, name: e.name, price: e.price, activo: e.sellableAsExtra && e.activo, deMembego: e.deMembego }))}
        puedeConfigurar={puedeConfigurar}
      />
    </div>
  )
}
