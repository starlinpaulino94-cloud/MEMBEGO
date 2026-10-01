import Link from 'next/link'
import { Gift } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { formatDate } from '@/lib/format'
import { ChipAsignacion } from '@/components/supply-v2/chips'
import { misBeneficios } from '@/modules/supply-v2/benefits/queries'
import { BENEFIT_FUNDING_LABELS, dineroSupplyV2, RUTA_OFERTAS_PUBLICAS } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Mis bonos y descuentos' }

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 6 · «MIS BENEFICIOS» del cliente (§31).
 *
 * Lo que esta persona tiene en su cuenta: qué vale, dónde se puede usar,
 * cuántos usos le quedan y hasta cuándo. Lo que NO ve, nunca: el presupuesto
 * de la campaña, el costo de la unidad, la comisión ni lo que Membego le
 * liquida al proveedor. Si un beneficio no se puede usar, se dice por qué en
 * una frase, sin tecnicismos.
 */
export default async function MisBonosPage() {
  const user = await requireRole('CLIENTE')
  const beneficios = user.metadata.dbUserId ? await misBeneficios(user.metadata.dbUserId) : []
  const usables = beneficios.filter((b) => b.usable)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mis bonos y descuentos"
        description="Beneficios que Membego te asignó. Se aplican al comprar: rebajan lo que pagas y, si cubren el total, no pagas nada."
        eyebrow="Membego"
      />

      {beneficios.length === 0 ? (
        <EmptyState
          variant="card"
          icon={<Gift className="h-6 w-6" aria-hidden />}
          title="Todavía no tienes bonos"
          description="Cuando Membego te asigne un bono o un descuento, lo verás aquí con las ofertas donde puedes usarlo."
          action={
            <Button asChild>
              <Link href="/promociones">Ver promociones</Link>
            </Button>
          }
        />
      ) : (
        <>
          <p className="text-sm text-muted-foreground" data-testid="bonos-resumen">
            {usables.length === 0 ? 'Ahora mismo no tienes bonos listos para usar.' : `Tienes ${usables.length} bono(s) listo(s) para usar.`}
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {beneficios.map((b) => (
              <Card key={b.customerBenefitId} data-testid="tarjeta-bono" className={b.usable ? 'border-primary/40' : undefined}>
                <CardContent className="space-y-3 pt-6">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-h4" data-testid="bono-nombre">{b.name}</p>
                      <p className="font-mono text-caption text-muted-foreground">{b.code}</p>
                    </div>
                    <ChipAsignacion estado={b.status} />
                  </div>
                  <p className="text-h2 tabular-nums" data-testid="bono-valor">
                    {b.valueType === 'PERCENTAGE' ? `${Number(b.valor).toLocaleString('es-DO')} %` : dineroSupplyV2(b.valor, b.currency)}
                  </p>
                  {b.description && <p className="text-sm text-muted-foreground">{b.description}</p>}
                  <dl className="space-y-1 text-sm">
                    <div className="flex items-baseline justify-between"><dt className="text-muted-foreground">Usos</dt><dd className="tabular-nums">{b.usesAllowed - b.usesConsumed} de {b.usesAllowed} disponibles</dd></div>
                    <div className="flex items-baseline justify-between"><dt className="text-muted-foreground">Válido hasta</dt><dd>{b.vigenteHasta ? formatDate(b.vigenteHasta) : 'Sin vencimiento'}</dd></div>
                    <div className="flex items-baseline justify-between"><dt className="text-muted-foreground">Lo pone</dt><dd className="text-right">{BENEFIT_FUNDING_LABELS[b.funding]}</dd></div>
                  </dl>
                  {b.motivo && <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground" data-testid="bono-motivo">{b.motivo}</p>}
                  {b.ofertas.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-caption font-medium text-muted-foreground">Dónde usarlo</p>
                      <ul className="space-y-1 text-sm">
                        {b.ofertas.map((o) => (
                          <li key={o.slug}>
                            <Link
                              href={`${RUTA_OFERTAS_PUBLICAS}/${o.slug}?beneficio=${b.customerBenefitId}`}
                              className="text-primary underline-offset-4 hover:underline"
                              data-testid="bono-oferta"
                            >
                              {o.title}
                            </Link>
                            <span className="block text-caption text-muted-foreground">{o.supplier} · {dineroSupplyV2(o.salePrice, b.currency)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {b.usable && b.ofertas[0] && (
                    <Button asChild className="w-full">
                      <Link href={`${RUTA_OFERTAS_PUBLICAS}/${b.ofertas[0].slug}?beneficio=${b.customerBenefitId}`} data-testid="btn-usar-bono">Usar mi beneficio</Link>
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
