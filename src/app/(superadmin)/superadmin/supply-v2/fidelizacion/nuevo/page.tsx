import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { NavSupplyV2 } from '@/components/supply-v2/nav'
import { FormPrograma } from '@/components/supply-v2/form-programa-fidelizacion'
import { proveedoresParaFinanzas } from '@/modules/supply-v2/finance/queries'
import { RUTA_FIDELIZACION } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Nuevo programa de fidelización · Supply 2.0' }

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 8 · alta de un programa de fidelización.
 *
 * El formulario enseña lo que cada modalidad implica ANTES de guardar, y pide
 * el techo del presupuesto cuando el programa compromete dinero de Membego:
 * ir sin techo exige una autorización escrita que queda en la bitácora.
 *
 * El programa nace BORRADOR y lo tiene que aprobar otra persona autorizada.
 */
export default async function NuevoProgramaPage() {
  await requireRole('SUPERADMIN')
  const proveedores = await proveedoresParaFinanzas()
  return (
    <div className="space-y-6">
      <PageHeader
        title="Nuevo programa de fidelización"
        description="Un programa agrupa membresías, referidos, puntos y recompensas de un negocio o de Membego. Nace como borrador: lo aprueba otra persona autorizada antes de que los clientes vean nada."
        eyebrow={<Link href={RUTA_FIDELIZACION} className="hover:underline">Fidelización</Link>}
        nav={<NavSupplyV2 activa="fidelizacion" />}
      />
      <FormPrograma proveedores={proveedores.map((p) => ({ id: p.id, nombre: p.commercialName }))} />
    </div>
  )
}
