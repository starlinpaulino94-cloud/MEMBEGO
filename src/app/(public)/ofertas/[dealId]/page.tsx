import Link from 'next/link'
import { notFound } from 'next/navigation'
import { TarjetaOferta } from '@/components/deals/TarjetaOferta'
import { AccionDeOfertaPublica } from '@/components/public/AccionDeOfertaPublica'
import { ofertasPublicas } from '@/modules/deals/publico'

export const revalidate = 60

export default async function OfertaPublicaPage({
  params,
  searchParams,
}: {
  params: Promise<{ dealId: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const { dealId } = await params
  const query = await searchParams
  const campaignId = typeof query.campaign === 'string' && query.campaign.length <= 60 ? query.campaign : undefined
  const [oferta] = await ofertasPublicas({ dealId, limite: 1 })
  if (!oferta || oferta.id !== dealId) notFound()
  const destino = `/cliente/ofertas/${encodeURIComponent(dealId)}${campaignId ? `?campaign=${encodeURIComponent(campaignId)}` : ''}`

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <Link href="/ofertas" className="text-sm text-muted-foreground underline underline-offset-4">
        Ver todas las ofertas
      </Link>
      <h1 className="mt-4 text-h1 text-foreground">{oferta.title}</h1>
      <p className="mt-2 text-muted-foreground">
        Oferta de {oferta.empresa.name}. Reclámala para recibir tu cupón con QR.
      </p>
      <div className="mt-6">
        <TarjetaOferta
          oferta={oferta}
          espacio="publico"
          accion={<AccionDeOfertaPublica oferta={oferta} destino={destino} />}
        />
      </div>
    </main>
  )
}
