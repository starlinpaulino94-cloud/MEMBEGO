import Link from 'next/link'
import { Sparkles } from 'lucide-react'
import type { MarketplaceSupplyOffer } from '@/modules/supply-v2/marketplace/read-model'

function dinero(n: string, moneda: string): string {
  return `${moneda === 'DOP' ? 'RD$' : `${moneda} `}${Number(n).toLocaleString('es-DO', { minimumFractionDigits: 0 })}`
}

/**
 * MEMBEGO SUPPLY · tarjeta pública de una oferta Membego (§19).
 * Solo lo que el cliente necesita: producto, proveedor, precio regular,
 * precio Membego y ahorro. Nunca costos ni lotes.
 */
export function OfertaMembegoCard({ oferta }: { oferta: MarketplaceSupplyOffer }) {
  return (
    <Link href={oferta.href} className="group flex flex-col overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm transition hover:shadow-premium" data-testid="oferta-membego-card">
      <div className="flex h-36 items-center justify-center bg-primary/10 text-primary">
        <Sparkles className="h-10 w-10" aria-hidden />
      </div>
      <div className="flex flex-1 flex-col gap-1 p-4">
        <span className="inline-flex w-fit items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-caption font-semibold text-primary">
          Oferta Membego · −{oferta.discountPercentage} %
        </span>
        <p className="text-h4 group-hover:underline">{oferta.title}</p>
        <p className="text-caption text-muted-foreground">{oferta.supplier}</p>
        <div className="mt-auto flex items-baseline gap-2 pt-2">
          <span className="text-h3 tabular-nums" data-testid="oferta-card-precio">{dinero(oferta.salePrice, oferta.currency)}</span>
          <span className="text-caption text-muted-foreground line-through tabular-nums">{dinero(oferta.publicPrice, oferta.currency)}</span>
        </div>
        <p className="text-caption text-success">Ahorras {dinero(oferta.savings, oferta.currency)}</p>
      </div>
    </Link>
  )
}
