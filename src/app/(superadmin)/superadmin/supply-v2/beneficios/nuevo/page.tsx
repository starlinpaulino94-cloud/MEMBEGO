import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { WizardBeneficio } from '@/components/supply-v2/wizard-beneficio'
import { opcionesDeBeneficio } from '@/modules/supply-v2/benefits/queries'
import { RUTA_BENEFICIOS } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Crear beneficio · Supply 2.0' }

/** MEMBEGO SUPPLY 2.0 · SLICE 6 · asistente de alta de beneficios (§30). */
export default async function NuevoBeneficioPage() {
  await requireRole('SUPERADMIN')
  const opciones = await opcionesDeBeneficio()
  const sinDonde = opciones.ofertas.length === 0 && opciones.productos.length === 0 && opciones.proveedores.length === 0

  return (
    <div className="space-y-6">
      <PageHeader
        title="Crear beneficio"
        description="Siete pasos: qué es, quién lo financia, cuánto rebaja, a qué aplica, cuánto dinero pone Membego, hasta cuándo vale y el resumen con el ejemplo económico."
        eyebrow="Supply 2.0 · Beneficios"
        action={
          <Button asChild variant="outline">
            <Link href={RUTA_BENEFICIOS}>Volver a beneficios</Link>
          </Button>
        }
      />
      {sinDonde ? (
        <EmptyState
          variant="card"
          title="Todavía no hay dónde aplicar un beneficio"
          description="Un beneficio rebaja el precio de una oferta, de un producto o de todo un proveedor: da de alta al menos un proveedor con su catálogo primero."
          action={
            <Button asChild>
              <Link href="/superadmin/supply-v2/proveedores">Ir a proveedores</Link>
            </Button>
          }
        />
      ) : (
        <WizardBeneficio opciones={opciones} />
      )}
    </div>
  )
}
