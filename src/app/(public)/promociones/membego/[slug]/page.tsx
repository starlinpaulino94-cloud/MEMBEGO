import Link from 'next/link'
import { notFound } from 'next/navigation'
import { BadgeCheck, CalendarClock, Sparkles, Users } from 'lucide-react'
import { getUser } from '@/lib/auth'
import { ofertaPublicaPorSlug } from '@/modules/supply-v2/marketplace/read-model'
import { beneficiosParaOferta } from '@/modules/supply-v2/benefits/queries'
import { promocionesParaOferta } from '@/modules/supply-v2/campaigns/queries'
import { BotonComprar } from '@/components/supply-v2/boton-comprar'

export const dynamic = 'force-dynamic'

function dinero(n: string, moneda: string): string {
  return `${moneda === 'DOP' ? 'RD$' : `${moneda} `}${Number(n).toLocaleString('es-DO', { minimumFractionDigits: 0 })}`
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const o = await ofertaPublicaPorSlug(slug)
  return { title: o ? `${o.title} · Oferta Membego` : 'Oferta Membego' }
}

/**
 * MEMBEGO SUPPLY 2.0 · ficha pública de una oferta (§19, §45). El cliente ve
 * producto, proveedor, precio regular, precio Membego, ahorro, vigencia y
 * máximo por persona. Nada de lotes, ledger ni costos.
 */
export default async function OfertaMembegoPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ beneficio?: string; cupon?: string }> }) {
  const { slug } = await params
  const [o, user, q] = await Promise.all([ofertaPublicaPorSlug(slug), getUser(), searchParams])
  if (!o) notFound()
  const sesion = !user ? 'ninguna' : user.metadata.role === 'CLIENTE' ? 'cliente' : 'otro'
  // Slice 6 (§17): los beneficios son del cliente de la sesión y se calculan en el servidor.
  const beneficios = sesion === 'cliente' && user?.metadata.dbUserId ? await beneficiosParaOferta(user.metadata.dbUserId, o.id, 1) : []
  // Slice 7 (§20): las promociones de campaña de esta oferta. Las automáticas
  // se anuncian; las de cupón piden su código en el checkout.
  const promociones = await promocionesParaOferta(sesion === 'cliente' ? (user?.metadata.dbUserId ?? null) : null, o.id, 1)
  // Slice 5: una oferta a comisión sin tope no limita por unidades, solo por persona.
  const maximo = o.unlimited ? o.perCustomerLimit : Math.max(1, Math.min(o.perCustomerLimit, o.remaining))

  return (
    <main className="container max-w-3xl py-10">
      <p className="mb-3 text-caption">
        <Link href="/promociones" className="text-muted-foreground underline-offset-4 hover:underline">← Promociones</Link>
      </p>
      <div className="grid gap-6 rounded-2xl border border-border/70 bg-card p-6 shadow-premium sm:grid-cols-[1fr_18rem]">
        <div className="space-y-4">
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-caption font-semibold text-primary">
            <Sparkles className="h-3.5 w-3.5" aria-hidden /> Oferta Membego
          </span>
          <h1 className="text-h1" data-testid="oferta-titulo">{o.title}</h1>
          <p className="text-muted-foreground" data-testid="oferta-proveedor">{o.supplier}</p>
          {o.description && <p className="text-body">{o.description}</p>}
          <ul className="space-y-1 text-sm text-muted-foreground">
            <li className="flex items-center gap-2"><BadgeCheck className="h-4 w-4 text-success" aria-hidden /> {o.available ? 'Disponible' : 'No disponible ahora mismo'}</li>
            {o.endsAt && <li className="flex items-center gap-2"><CalendarClock className="h-4 w-4" aria-hidden /> Válido hasta {new Intl.DateTimeFormat('es-DO', { dateStyle: 'medium' }).format(new Date(o.endsAt))}</li>}
            <li className="flex items-center gap-2"><Users className="h-4 w-4" aria-hidden /> Máximo {o.perCustomerLimit} por persona</li>
            {o.available && !o.unlimited && o.remaining <= 5 && <li className="text-warning">Quedan {o.remaining}</li>}
          </ul>
        </div>
        <div className="space-y-3 rounded-xl border border-border bg-background p-4">
          <dl className="space-y-1 text-sm">
            <div className="flex items-baseline justify-between"><dt className="text-muted-foreground">Precio regular</dt><dd className="line-through tabular-nums" data-testid="oferta-precio-regular">{dinero(o.publicPrice, o.currency)}</dd></div>
            <div className="flex items-baseline justify-between"><dt className="text-muted-foreground">Precio Membego</dt><dd className="text-h2 tabular-nums" data-testid="oferta-precio-membego">{dinero(o.salePrice, o.currency)}</dd></div>
            <div className="flex items-baseline justify-between"><dt className="text-muted-foreground">Ahorras</dt><dd className="font-semibold text-success tabular-nums" data-testid="oferta-ahorro">{dinero(o.savings, o.currency)}</dd></div>
          </dl>
          <BotonComprar
            offerId={o.id}
            href={o.href}
            sesion={sesion}
            maximo={maximo}
            disponible={o.available}
            moneda={o.currency}
            precio={o.salePrice}
            beneficios={beneficios}
            beneficioPreseleccionado={q.beneficio}
            promociones={promociones}
            cuponPreseleccionado={q.cupon}
          />
        </div>
      </div>
    </main>
  )
}
