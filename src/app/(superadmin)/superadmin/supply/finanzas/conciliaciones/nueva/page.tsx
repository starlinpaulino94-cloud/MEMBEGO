import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { NavSupplyV2 } from '@/components/supply-v2/nav'
import { FormConciliacion, FormConciliacionComision } from '@/components/supply-v2/finanzas/form-conciliacion'
import { proveedoresParaFinanzas } from '@/modules/supply-v2/finance/queries'
import { RUTA_FINANZAS } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Nueva conciliación · Supply' }

export default async function NuevaConciliacionPage({ searchParams }: { searchParams: Promise<{ tipo?: string }> }) {
  await requireRole('SUPERADMIN')
  const { tipo } = await searchParams
  const comision = tipo === 'COMMISSION'
  const proveedores = await proveedoresParaFinanzas()
  return (
    <div className="space-y-6">
      <PageHeader
        title={comision ? 'Nueva conciliación de comisión' : 'Nueva conciliación'}
        description={comision ? 'Membego pone bruto vendido, comisión, neto y pagos de las entregas a comisión del periodo. Compáralo con lo que el proveedor reclama; sin su cifra no cuadra sola.' : 'Membego arma su lado del periodo. Si tienes el estado de cuenta del proveedor, indica su saldo; si no, queda abierta sin inventar nada.'}
        eyebrow={<Link href={`${RUTA_FINANZAS}/conciliaciones`} className="hover:underline">Conciliaciones</Link>}
        nav={<NavSupplyV2 activa="finanzas" />}
      />
      <nav className="flex gap-2 text-sm" aria-label="Tipo de conciliación" data-testid="conciliacion-tipo">
        <Link href={`${RUTA_FINANZAS}/conciliaciones/nueva`} className={`rounded-full border px-3 py-1 ${!comision ? 'border-primary bg-primary/10 text-primary' : 'border-border'}`}>Supply adquirido</Link>
        <Link href={`${RUTA_FINANZAS}/conciliaciones/nueva?tipo=COMMISSION`} className={`rounded-full border px-3 py-1 ${comision ? 'border-primary bg-primary/10 text-primary' : 'border-border'}`} data-testid="conciliacion-tipo-comision">Ventas a comisión</Link>
      </nav>
      <Card><CardContent className="pt-6">{comision ? <FormConciliacionComision proveedores={proveedores} /> : <FormConciliacion proveedores={proveedores} />}</CardContent></Card>
    </div>
  )
}
