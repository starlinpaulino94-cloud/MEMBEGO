import { notFound } from 'next/navigation'
import { ofertaPublicaPorSlug } from '@/modules/supply-v2/marketplace/read-model'
import { rutaDeOfertaMembego } from '@/modules/comercio/rutas'
import { FichaDeOfertaMembego } from '@/components/supply-v2/FichaDeOfertaMembego'
import { TraspasoALaApp } from '@/components/public/TraspasoALaApp'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const o = await ofertaPublicaPorSlug(slug)
  return { title: o ? `${o.title} · Oferta Membego` : 'Oferta Membego' }
}

/**
 * MEMBEGO SUPPLY · ficha pública de una oferta (§19, §45): CONSULTA. La compra, con sus beneficios y cupones,
 * se hace dentro de la app (`/cliente/ofertas-membego/[slug]`); aquí solo se informa y se ofrece el traspaso.
 *
 * Esta página no lee la sesión: lo que cada persona ve en el traspaso lo decide el navegador, y lo que puede
 * hacer lo decide el servidor en la app.
 */
export default async function OfertaMembegoPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ beneficio?: string; cupon?: string }> }) {
  const { slug } = await params
  const [o, q] = await Promise.all([ofertaPublicaPorSlug(slug), searchParams])
  if (!o) notFound()
  // Un beneficio o un cupón que llegan por enlace viajan con la persona hasta la ficha de la app.
  const consulta = new URLSearchParams()
  if (typeof q.beneficio === 'string' && q.beneficio) consulta.set('beneficio', q.beneficio)
  if (typeof q.cupon === 'string' && q.cupon) consulta.set('cupon', q.cupon)
  const destino = `${rutaDeOfertaMembego('app', o.slug)}${consulta.size ? `?${consulta}` : ''}`

  return (
    <FichaDeOfertaMembego
      o={o}
      espacio="publico"
      ranuraCompra={
        <TraspasoALaApp
          destino={destino}
          titulo="Comprar esta oferta"
          descripcion="Las compras se hacen dentro de tu cuenta MembeGo, con tus beneficios y cupones."
          etiquetaCliente="Comprar en la app"
        />
      }
    />
  )
}
