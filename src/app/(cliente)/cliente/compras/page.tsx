import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ChipCompra } from '@/components/supply-v2/chips'
import { misCompras, misDerechos } from '@/modules/supply-v2/commerce/queries'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Mis compras Membego' }

function dinero(n: string, moneda: string): string {
  return `${moneda === 'DOP' ? 'RD$' : `${moneda} `}${Number(n).toLocaleString('es-DO', { minimumFractionDigits: 0 })}`
}
const fecha = (d: Date) => new Intl.DateTimeFormat('es-DO', { dateStyle: 'medium' }).format(d)

/** MEMBEGO SUPPLY 2.0 · compras y beneficios del cliente (§46, §52). */
export default async function ComprasClientePage() {
  const user = await requireRole('CLIENTE')
  const customerId = user.metadata.dbUserId
  const [compras, derechos] = await Promise.all([misCompras(customerId), misDerechos(customerId)])

  return (
    <div className="space-y-6">
      <PageHeader title="Mis compras Membego" description="Lo que compraste a Membego y los beneficios que ya son tuyos." />

      <Card>
        <CardHeader><CardTitle>Mis beneficios</CardTitle></CardHeader>
        <CardContent>
          {derechos.length === 0 ? (
            <p className="text-sm text-muted-foreground">Cuando confirmemos un pago, tu beneficio aparecerá aquí.</p>
          ) : (
            <ul className="divide-y divide-border text-sm" data-testid="mis-derechos">
              {derechos.map((d) => (
                <li key={d.id} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between">
                  <span>
                    <span className="font-medium">{d.producto}</span> · {d.proveedor}
                    <span className="block text-caption text-muted-foreground">
                      Comprado por {dinero(d.precio, d.currency)} · {d.orderNumber}
                      {d.expiresAt ? ` · válido hasta ${fecha(d.expiresAt)}` : ''}
                    </span>
                  </span>
                  <span className="rounded-full border border-success/30 px-2 py-0.5 text-caption text-success">{d.status === 'ACTIVE' ? 'Disponible' : d.status}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {compras.length === 0 ? (
        <EmptyState
          variant="card"
          title="Todavía no has comprado nada"
          description="Las ofertas Membego están en Promociones."
          action={
            <Button asChild>
              <Link href="/promociones">Ver ofertas</Link>
            </Button>
          }
        />
      ) : (
        <Card>
          <CardHeader><CardTitle>Compras</CardTitle></CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y divide-border" data-testid="mis-compras">
              {compras.map((c) => (
                <li key={c.id}>
                  <Link href={`/cliente/compras/${c.id}`} className="flex flex-col gap-1 px-4 py-3 hover:bg-muted/50 sm:flex-row sm:items-center sm:justify-between">
                    <span>
                      <span className="font-medium">{c.lineas.map((l) => `${l.quantity} × ${l.titulo}`).join(', ')}</span>
                      <span className="block text-caption text-muted-foreground">{c.number} · {fecha(c.createdAt)}</span>
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="tabular-nums">{dinero(c.total, c.currency)}</span>
                      <ChipCompra estado={c.status} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
