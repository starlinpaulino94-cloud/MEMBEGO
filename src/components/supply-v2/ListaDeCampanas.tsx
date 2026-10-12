import Link from 'next/link'
import { Megaphone, Sparkles } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { RUTA_CUPONES_CLIENTE } from '@/modules/supply-v2/core/catalogo'
import type { campanasPublicas } from '@/modules/supply-v2/campaigns/queries'
import { rutaDeCampana, rutaDeOfertaMembego, rutaDePromociones, type Espacio } from '@/modules/comercio/rutas'

type Campana = Awaited<ReturnType<typeof campanasPublicas>>[number]

function dinero(n: string, moneda: string): string {
  return `${moneda === 'DOP' ? 'RD$' : `${moneda} `}${Number(n).toLocaleString('es-DO', { minimumFractionDigits: 0 })}`
}

/**
 * MEMBEGO SUPPLY · SLICE 7 · CAMPAÑAS en el marketplace (§18), UNA sola vez para los dos espacios.
 *
 * Es una sección DENTRO del marketplace que ya existe, no otro marketplace: la vitrina lista campañas activas y
 * vigentes AHORA (la vigencia y el horario se comprueban aquí también, no solo en el cron) y cada oferta lleva a su
 * ficha de siempre, la de SU espacio. «Mis cupones» es del cliente: solo la app lo muestra.
 */
export function ListaDeCampanas({ campanas, espacio }: { campanas: Campana[]; espacio: Espacio }) {
  return (
    <main className="container max-w-5xl py-10">
      <p className="mb-3 text-caption">
        <Link href={rutaDePromociones(espacio)} className="text-muted-foreground underline-offset-4 hover:underline">← Promociones</Link>
      </p>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-caption font-semibold text-primary">
            <Megaphone className="h-3.5 w-3.5" aria-hidden /> Campañas Membego
          </span>
          <h1 className="mt-2 text-h1">Campañas y promociones</h1>
          <p className="text-muted-foreground">Promociones por tiempo limitado en los comercios de la red. Cada oferta se compra como siempre; la promoción se aplica en el checkout.</p>
        </div>
        {espacio === 'app' && (
          <Button asChild variant="outline">
            <Link href={RUTA_CUPONES_CLIENTE} data-testid="link-mis-cupones">Mis cupones</Link>
          </Button>
        )}
      </div>

      {campanas.length === 0 ? (
        <EmptyState
          variant="card"
          icon={<Sparkles className="h-6 w-6" aria-hidden />}
          title="No hay campañas activas ahora mismo"
          description="Cuando Membego publique una campaña, la verás aquí con los comercios y los productos que participan."
          action={<Button asChild><Link href={rutaDePromociones(espacio)}>Ver promociones</Link></Button>}
        />
      ) : (
        <ul className="space-y-6" data-testid="campanas-publicas">
          {campanas.map((c) => (
            <li key={c.id} className="rounded-2xl border border-border/70 bg-card p-6 shadow-premium" data-testid="campana-publica">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-h2" data-testid="campana-publica-nombre">
                    <Link href={rutaDeCampana(espacio, c.code)} className="underline-offset-4 hover:underline">{c.name}</Link>
                  </h2>
                  {c.description && <p className="mt-1 text-body text-muted-foreground">{c.description}</p>}
                  <p className="mt-1 text-caption text-muted-foreground">{c.empresas.join(' · ')}</p>
                </div>
                {c.paraTi === false && (
                  <span className="rounded-full border border-border px-2 py-0.5 text-caption text-muted-foreground" data-testid="campana-otro-publico">
                    Para otro grupo de clientes
                  </span>
                )}
              </div>
              <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                {c.ofertas.slice(0, 6).map((o) => (
                  <li key={o.slug} className="rounded-xl border border-border p-3">
                    <Link href={rutaDeOfertaMembego(espacio, o.slug)} className="font-medium underline-offset-4 hover:underline" data-testid="campana-publica-oferta">{o.titulo}</Link>
                    <span className="block text-caption text-muted-foreground">{o.proveedor} · {dinero(o.salePrice, o.currency)}</span>
                    {o.rebaja && <span className="mt-1 inline-block rounded-full bg-success/10 px-2 py-0.5 text-caption font-semibold text-success">−{o.rebaja}</span>}
                    {o.exigeCupon && <span className="ml-1 inline-block rounded-full border border-border px-2 py-0.5 text-caption text-muted-foreground">con código</span>}
                  </li>
                ))}
              </ul>
              <ul className="mt-3 space-y-0.5 text-caption text-muted-foreground" data-testid="campana-condiciones">
                {c.condiciones.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
