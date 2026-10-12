import Link from 'next/link'
import { ShoppingBag } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { misClienteIds } from '@/modules/cliente/afiliacion'
import { misPedidos } from '@/modules/orders/cliente-queries'
import { BADGE_ESTADO, ETIQUETA_ESTADO, formatearFechaHora, formatearMonto } from '@/modules/orders/formato'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Mis pedidos' }

/**
 * Los pedidos Membego de la persona, de TODAS sus fichas (una por empresa). Lo
 * que acota la lectura son los ids de sus fichas, que salen de la sesión.
 */
export default async function MisPedidosPage() {
  const user = await requireRole('CLIENTE')
  const ids = await misClienteIds(user.supabaseId)
  const pedidos = await misPedidos(ids)

  return (
    <div className="space-y-6">
      <PageHeader title="Mis pedidos" description="Lo que pediste a las empresas, el monto que acordaron contigo y el QR para recogerlo." />

      {pedidos.length === 0 ? (
        <EmptyState
          variant="card"
          icon={<ShoppingBag className="h-6 w-6" />}
          title="Todavía no has hecho ningún pedido"
          description="Cuando pidas algo del catálogo de una empresa, lo seguirás desde aquí."
          action={
            <Button asChild>
              <Link href="/cliente/explorar?ver=productos">Ver el catálogo</Link>
            </Button>
          }
        />
      ) : (
        <ul className="grid gap-3" aria-label="Mis pedidos">
          {pedidos.map((p) => (
            <li key={p.id}>
              <Link href={`/cliente/pedidos/${p.id}`}>
                <Card className="transition-colors hover:bg-muted/40">
                  <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground">
                        {p.code} <span className="font-normal text-muted-foreground">· {p.empresaNombre}</span>
                      </p>
                      <p className="truncate text-sm text-muted-foreground">{p.resumen}</p>
                      <p className="text-xs text-muted-foreground">{formatearFechaHora(p.createdAt)}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      {p.requiereConfirmacion && <Badge variant="warning">Confirma el monto</Badge>}
                      <p className="font-semibold tabular-nums">{formatearMonto(p.total, p.currency)}</p>
                      <Badge variant={BADGE_ESTADO[p.status]}>{ETIQUETA_ESTADO[p.status]}</Badge>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
