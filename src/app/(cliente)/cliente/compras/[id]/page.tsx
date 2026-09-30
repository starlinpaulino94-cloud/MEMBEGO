import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { ChipCompra } from '@/components/supply-v2/chips'
import { CheckoutCliente } from '@/components/supply-v2/checkout-cliente'
import { miCompra } from '@/modules/supply-v2/commerce/queries'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Mi compra' }

/**
 * MEMBEGO SUPPLY 2.0 · checkout y detalle de una compra (§27, §46).
 * `miCompra` filtra por el cliente de la sesión: la compra de otra persona
 * responde 404, igual que una que no existe.
 */
export default async function CompraClientePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole('CLIENTE')
  const { id } = await params
  const compra = await miCompra(user.metadata.dbUserId, id)
  if (!compra) notFound()

  return (
    <div className="space-y-6">
      <PageHeader
        title={compra.status === 'PAID' ? 'Compra confirmada' : compra.status === 'PENDING' ? 'Completa tu pago' : 'Mi compra'}
        description={compra.number}
        eyebrow={<Link href="/cliente/compras" className="hover:underline">Mis compras Membego</Link>}
        action={<ChipCompra estado={compra.status} />}
      />
      <div className="max-w-xl">
        <CheckoutCliente compra={compra} />
      </div>
    </div>
  )
}
