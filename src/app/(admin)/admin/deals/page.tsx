import Link from 'next/link'
import { BadgePercent, Plus } from 'lucide-react'
import { conEmpresa } from '@/lib/tenant'
import { ADMIN_ROLES } from '@/types'
import { puedeFuncion, requireRole } from '@/lib/auth/guards'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/ui/page-header'
import { ETIQUETA_ESTADO_OFERTA } from '@/modules/deals/domain'
import { BADGE_ESTADO_OFERTA } from '@/modules/deals/formato'
import { listarOfertasEnTx } from '@/modules/deals/queries'
import { formatearFechaHora, formatearMonto } from '@/modules/orders/formato'

export const dynamic = 'force-dynamic'

export default async function OfertasPage() {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = await requireCompanyContext(user)

  let ofertas: Awaited<ReturnType<typeof listarOfertasEnTx>> | null = null
  try {
    ofertas = await conEmpresa(companyId, (tx) => listarOfertasEnTx(tx, companyId))
  } catch (e) {
    console.error('[admin-deals]', e)
  }
  const puedeCrear = await puedeFuncion('deals', 'crear')

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ofertas y promociones"
        description="Descuentos sobre los productos y servicios de tu catálogo. El cliente los ve en el marketplace con el precio de antes y el de ahora, los obtiene y los canjea con el QR de su pedido. Tú fijas el tope de lo que estás dispuesto a pagar por canje; la oferta se pausa sola cuando se acaba."
        action={
          puedeCrear ? (
            <Link href="/admin/deals/nueva">
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Nueva oferta
              </Button>
            </Link>
          ) : undefined
        }
      />

      {!ofertas ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">No se pudieron cargar las ofertas. Intenta de nuevo en un momento.</CardContent>
        </Card>
      ) : ofertas.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <BadgePercent className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
            <p className="font-medium">Todavía no tienes ofertas</p>
            <p className="text-sm">Crea una sobre un producto o servicio de tu catálogo y fija cuánto estás dispuesto a pagar por traer clientes.</p>
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-3" aria-label="Ofertas">
          {ofertas.map((o) => (
            <li key={o.id}>
              <Link href={`/admin/deals/${o.id}`}>
                <Card className="transition-colors hover:bg-muted/40">
                  <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground">{o.title}</p>
                      <p className="truncate text-sm text-muted-foreground">
                        {o.itemName}
                        {o.variantName !== o.itemName ? ` · ${o.variantName}` : ''}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {o.rendimiento.reclamos} obtenida{o.rendimiento.reclamos === 1 ? '' : 's'} · {o.rendimiento.canjeados} canjeada{o.rendimiento.canjeados === 1 ? '' : 's'}
                        {o.endsAt ? ` · hasta ${formatearFechaHora(o.endsAt)}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right text-sm tabular-nums">
                        <p className="font-semibold">{formatearMonto(o.budgetSpent, o.currency)}</p>
                        <p className="text-xs text-muted-foreground">de {formatearMonto(o.budgetTotal, o.currency)}</p>
                      </div>
                      <Badge variant={BADGE_ESTADO_OFERTA[o.status]}>{ETIQUETA_ESTADO_OFERTA[o.status]}</Badge>
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
