import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { NavSupplyV2 } from '@/components/supply-v2/nav'
import { FormConciliacion } from '@/components/supply-v2/finanzas/form-conciliacion'
import { proveedoresParaFinanzas } from '@/modules/supply-v2/finance/queries'
import { RUTA_FINANZAS } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Nueva conciliación · Supply 2.0' }

export default async function NuevaConciliacionPage() {
  await requireRole('SUPERADMIN')
  const proveedores = await proveedoresParaFinanzas()
  return (
    <div className="space-y-6">
      <PageHeader title="Nueva conciliación" description="Membego arma su lado del periodo. Si tienes el estado de cuenta del proveedor, indica su saldo; si no, queda abierta sin inventar nada." eyebrow={<Link href={`${RUTA_FINANZAS}/conciliaciones`} className="hover:underline">Conciliaciones</Link>} nav={<NavSupplyV2 activa="finanzas" />} />
      <Card><CardContent className="pt-6"><FormConciliacion proveedores={proveedores} /></CardContent></Card>
    </div>
  )
}
