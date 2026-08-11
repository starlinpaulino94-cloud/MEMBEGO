import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { getRegalosConfig } from '@/modules/regalos/config'
import { GiftCardForm } from '@/components/regalos/GiftCardForm'
import { EmptyState } from '@/components/ui/empty-state'
import { CreditCard } from 'lucide-react'
import { SinEmpresaTodavia } from '@/components/cliente/SinEmpresaTodavia'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Gift card' }

/**
 * Gift card de monto abierto (Regalos P2P · extensión R4): el cliente regala
 * un monto libre; el destinatario lo consume en el negocio con el código.
 */
export default async function GiftCardPage() {
  const user = await requireRole('CLIENTE')
  const clienteId = user.metadata.clienteId
  // Una cuenta de Membego que todavía no es cliente de ningún negocio. No
  // es un error ni una falta de permiso: es el primer día. Ver
  // `SinEmpresaTodavia`.
  if (!clienteId) {
    return <SinEmpresaTodavia que="giftcards" />
  }
  const companyId = user.metadata.companyId
  if (!clienteId || !companyId) {
    return <p className="text-muted-foreground">Tu cuenta no está vinculada a una empresa.</p>
  }

  const config = await getRegalosConfig(companyId)

  return (
    <div className="mx-auto max-w-xl space-y-6 animate-fade-up">
      <header>
        <Link href="/cliente/regalos" className="text-sm text-primary hover:underline">
          ← Regalos
        </Link>
        <h1 className="mt-2 text-h1 text-foreground">Gift card</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Regala un monto libre: tu persona especial lo usa en el negocio
          mostrando el código. No expira.
        </p>
      </header>

      {!config.permitirGiftCards ? (
        <EmptyState
          icon={<CreditCard className="h-7 w-7" />}
          title="Gift cards desactivadas"
          description="El negocio no tiene activadas las gift cards por ahora."
        />
      ) : (
        <GiftCardForm montoMin={config.giftCardMontoMin} montoMax={config.giftCardMontoMax} />
      )}
    </div>
  )
}
