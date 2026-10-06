import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ChipCompra, ChipDerecho } from '@/components/supply-v2/chips'
import { UsarBeneficio } from '@/components/supply-v2/usar-beneficio'
import { misCompras, misDerechos } from '@/modules/supply-v2/commerce/queries'
import { sesionesQrVivasDelCliente } from '@/modules/supply-v2/redemption/queries'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Mis compras Membego' }

function dinero(n: string, moneda: string): string {
  return `${moneda === 'DOP' ? 'RD$' : `${moneda} `}${Number(n).toLocaleString('es-DO', { minimumFractionDigits: 0 })}`
}
const fecha = (d: Date) => new Intl.DateTimeFormat('es-DO', { dateStyle: 'medium' }).format(d)
const fechaHora = (d: Date) => new Intl.DateTimeFormat('es-DO', { dateStyle: 'short', timeStyle: 'short' }).format(d)

/**
 * MEMBEGO SUPPLY · compras y beneficios del cliente (§46, §52; Slice 3 §12, §33).
 * Un beneficio Disponible ofrece «Usar beneficio»; el QR se genera solo al pulsarlo.
 * Un beneficio Utilizado muestra cuándo y dónde, sin datos internos.
 */
export default async function ComprasClientePage() {
  const user = await requireRole('CLIENTE')
  const customerId = user.metadata.dbUserId
  const [compras, derechos, sesiones] = await Promise.all([misCompras(customerId), misDerechos(customerId), sesionesQrVivasDelCliente(customerId)])

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
              {derechos.map((d) => {
                const viva = sesiones.get(d.id)
                return (
                  <li key={d.id} className="flex flex-col gap-2 py-3" data-testid="beneficio">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <span>
                        <span className="font-medium" data-testid="beneficio-producto">{d.producto}</span> · {d.proveedor}
                        <span className="block text-caption text-muted-foreground">
                          Comprado por {dinero(d.precio, d.currency)} · {d.orderNumber}
                          {d.expiresAt ? ` · válido hasta ${fecha(d.expiresAt)}` : ''}
                        </span>
                        {d.status === 'REDEEMED' && d.redencion && (
                          <span className="block text-caption text-muted-foreground" data-testid="beneficio-utilizado">
                            Utilizado el {fechaHora(d.redencion.redeemedAt)} · {d.proveedor}
                            {d.redencion.sucursal ? ` · ${d.redencion.sucursal}` : ''}
                          </span>
                        )}
                      </span>
                      <ChipDerecho estado={d.status} />
                    </div>
                    {d.status === 'ACTIVE' && (
                      <UsarBeneficio
                        entitlementId={d.id}
                        proveedor={d.proveedor}
                        sesionInicial={viva ? { id: viva.id, nonce: viva.nonce, expiresAt: viva.expiresAt } : null}
                      />
                    )}
                  </li>
                )
              })}
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
