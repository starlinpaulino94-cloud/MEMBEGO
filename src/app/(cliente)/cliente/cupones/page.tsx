import Link from 'next/link'
import { TicketPercent } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { formatDate } from '@/lib/format'
import { ChipCupon, ChipTipoCupon } from '@/components/supply-v2/chips'
import { misCupones } from '@/modules/supply-v2/campaigns/queries'
import { dineroSupplyV2, RUTA_CAMPANAS_PUBLICAS } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Mis cupones' }

/**
 * MEMBEGO SUPPLY · SLICE 7 · «MIS CUPONES» del cliente (§21).
 *
 * Los cupones privados de esta persona y los públicos de las campañas en cuyo
 * público encaja. Disponibles, usados y vencidos en una sola lista ordenada,
 * sin repetir el mismo cupón en varias secciones. Si uno no se puede usar, se
 * dice por qué en una frase. Nunca presupuesto ni costos.
 */
export default async function MisCuponesPage() {
  const user = await requireRole('CLIENTE')
  const cupones = user.metadata.dbUserId ? await misCupones(user.metadata.dbUserId) : []
  const usables = cupones.filter((c) => c.usable)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mis cupones"
        description="Códigos de las campañas de Membego. Se escriben en el checkout y rebajan lo que pagas; si cubren el total, no pagas nada."
        eyebrow="Membego"
        action={
          <Button asChild variant="outline">
            <Link href={RUTA_CAMPANAS_PUBLICAS}>Ver campañas</Link>
          </Button>
        }
      />

      {cupones.length === 0 ? (
        <EmptyState
          variant="card"
          icon={<TicketPercent className="h-6 w-6" aria-hidden />}
          title="Todavía no tienes cupones"
          description="Cuando Membego publique una campaña con cupones o te asigne uno, lo verás aquí con las ofertas donde vale."
          action={<Button asChild><Link href={RUTA_CAMPANAS_PUBLICAS}>Ver campañas</Link></Button>}
        />
      ) : (
        <>
          <p className="text-sm text-muted-foreground" data-testid="cupones-resumen">
            {usables.length === 0 ? 'Ahora mismo no tienes cupones listos para usar.' : `Tienes ${usables.length} cupón(es) listo(s) para usar.`}
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {cupones.map((c) => (
              <Card key={c.id} data-testid="tarjeta-cupon" className={c.usable ? 'border-primary/40' : undefined}>
                <CardContent className="space-y-3 pt-6">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-mono text-h3" data-testid="cupon-codigo-cliente">{c.code}</p>
                      <p className="text-caption text-muted-foreground">{c.campanaNombre}</p>
                    </div>
                    <ChipCupon estado={c.status} />
                  </div>
                  <p className="text-h2 tabular-nums" data-testid="cupon-valor">
                    {c.valueType === 'PERCENTAGE' ? `${Number(c.valor).toLocaleString('es-DO')} %` : dineroSupplyV2(c.valor, c.currency)}
                  </p>
                  <dl className="space-y-1 text-sm">
                    <div className="flex items-baseline justify-between"><dt className="text-muted-foreground">Promoción</dt><dd className="text-right">{c.promocion}</dd></div>
                    <div className="flex items-baseline justify-between"><dt className="text-muted-foreground">Usos</dt><dd className="tabular-nums">{Math.max(0, c.maxPerCustomer - c.usados)} de {c.maxPerCustomer} disponibles</dd></div>
                    <div className="flex items-baseline justify-between"><dt className="text-muted-foreground">Válido hasta</dt><dd>{c.expiresAt ? formatDate(c.expiresAt) : 'Sin vencimiento'}</dd></div>
                    {c.minPurchase && <div className="flex items-baseline justify-between"><dt className="text-muted-foreground">Compra mínima</dt><dd className="tabular-nums">{dineroSupplyV2(c.minPurchase, c.currency)}</dd></div>}
                  </dl>
                  <ChipTipoCupon kind={c.kind} />
                  {c.motivo && <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground" data-testid="cupon-motivo">{c.motivo}</p>}
                  {c.ofertas.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-caption font-medium text-muted-foreground">Dónde usarlo</p>
                      <ul className="space-y-1 text-sm">
                        {c.ofertas.map((o) => (
                          <li key={o.slug}>
                            <Link href={`${o.href}?cupon=${encodeURIComponent(c.code)}`} className="text-primary underline-offset-4 hover:underline" data-testid="cupon-oferta">
                              {o.titulo}
                            </Link>
                            <span className="block text-caption text-muted-foreground">{o.proveedor} · {dineroSupplyV2(o.salePrice, c.currency)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {c.usable && c.ofertas[0] && (
                    <Button asChild className="w-full">
                      <Link href={`${c.ofertas[0].href}?cupon=${encodeURIComponent(c.code)}`} data-testid="btn-usar-cupon">Usar mi cupón</Link>
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
