import { notFound } from 'next/navigation'
import { TarjetaOferta } from '@/components/deals/TarjetaOferta'
import { AccionObtenerOferta } from '@/components/deals/AccionObtenerOferta'
import { ofertasPublicas } from '@/modules/deals/publico'

export const dynamic = 'force-dynamic'

export default async function ClienteOfertaPage({
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

  const retorno = `/cliente/ofertas/${encodeURIComponent(dealId)}${campaignId ? `?campaign=${encodeURIComponent(campaignId)}` : ''}`
  return (
    <div>
      <h1 className="mb-4 text-h1 text-foreground">Tu oferta</h1>
      <TarjetaOferta
        oferta={oferta}
        espacio="app"
        accion={<AccionObtenerOferta oferta={oferta} retorno={retorno} campaignId={campaignId} />}
      />
    </div>
  )
}
