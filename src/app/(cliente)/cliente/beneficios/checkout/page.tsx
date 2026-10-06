import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { misClienteIds } from '@/modules/cliente/afiliacion'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { resumenCheckout } from '@/modules/supply/checkout'
import { CheckoutSupply } from '@/components/supply/checkout-supply'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Confirmar compra' }

/**
 * MEMBEGO SUPPLY · CHECKOUT (§19). `?oferta=<asignacionId>` para una unidad
 * precomprada; `?venta=<acuerdoId>&cantidad=n` para una venta a comisión, donde
 * un bono del cliente puede cubrir parte del valor.
 */
export default async function CheckoutPage({ searchParams }: { searchParams: Promise<{ oferta?: string; venta?: string; cantidad?: string }> }) {
  const user = await requireRole('CLIENTE')
  const { oferta, venta, cantidad } = await searchParams
  const clienteIds = await misClienteIds(user.supabaseId)
  const resumen = await resumenCheckout({ clienteIds, asignacionId: oferta || null, acuerdoId: venta || null, cantidad: Number(cantidad) || 1 }).catch(() => null)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Confirmar compra"
        description="Revisa el precio, el descuento y el bono antes de comprometerte."
        eyebrow={
          <Link href="/cliente/beneficios/disponibles" className="hover:underline">
            Beneficios disponibles
          </Link>
        }
      />
      {!resumen ? (
        <EmptyState variant="card" title="Esta oferta ya no está disponible" description="Se agotó, terminó o cambió. Vuelve a la vitrina para ver lo que hay hoy." />
      ) : (
        <div className="max-w-xl">
          <CheckoutSupply resumen={{ ...resumen, bonos: resumen.bonos.map((b) => ({ ...b, venceAt: b.venceAt.toISOString() })) }} clienteId={clienteIds[0] ?? ''} />
        </div>
      )}
    </div>
  )
}
