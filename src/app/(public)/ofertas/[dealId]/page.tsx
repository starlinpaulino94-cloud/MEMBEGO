import Link from 'next/link'
import { notFound } from 'next/navigation'
import { TarjetaOferta } from '@/components/deals/TarjetaOferta'
import { ofertasPublicas } from '@/modules/deals/publico'

export const revalidate = 60

export default async function OfertaPublicaPage({
  params,
}: {
  params: Promise<{ dealId: string }>
}) {
  const { dealId } = await params
  const [oferta] = await ofertasPublicas({ dealId, limite: 1 })
  if (!oferta || oferta.id !== dealId) notFound()

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
        <TarjetaOferta oferta={oferta} retorno={`/ofertas/${encodeURIComponent(oferta.id)}`} />
      </div>
    </main>
  )
}
