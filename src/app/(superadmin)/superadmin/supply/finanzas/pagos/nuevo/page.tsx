import Link from 'next/link'
import { randomUUID } from 'crypto'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { NavSupplyV2 } from '@/components/supply-v2/nav'
import { FormPago } from '@/components/supply-v2/finanzas/form-pago'
import { proveedoresParaFinanzas } from '@/modules/supply-v2/finance/queries'
import { RUTA_FINANZAS } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Registrar pago · Supply' }

export default async function NuevoPagoPage({ searchParams }: { searchParams: Promise<{ proveedor?: string; destino?: string }> }) {
  await requireRole('SUPERADMIN')
  const sp = await searchParams
  const proveedores = await proveedoresParaFinanzas()
  const destino = sp.destino === 'DEPOSITO' ? 'DEPOSITO' : 'NINGUNO'
  return (
    <div className="space-y-6">
      <PageHeader
        title={destino === 'DEPOSITO' ? 'Registrar anticipo (depósito)' : 'Registrar pago a proveedor'}
        description={destino === 'DEPOSITO' ? 'Dinero adelantado al proveedor. Al confirmarlo otra persona, nace el depósito con ese saldo disponible.' : 'Dinero que sale hacia un proveedor. Otra persona lo confirma; entonces se aplica a lo declarado.'}
        eyebrow={<Link href={`${RUTA_FINANZAS}/pagos`} className="hover:underline">Pagos</Link>}
        nav={<NavSupplyV2 activa="finanzas" />}
      />
      <Card><CardContent className="pt-6"><FormPago proveedores={proveedores} supplierId={sp.proveedor} destinoInicial={destino} idempotencyKey={`ui-pago-${randomUUID()}`} /></CardContent></Card>
    </div>
  )
}
