import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { SITE_NAME } from '@/lib/site'
import { requireRole } from '@/lib/auth/guards'
import { ofertaPublicaPorSlug } from '@/modules/supply-v2/marketplace/read-model'
import { beneficiosParaOferta } from '@/modules/supply-v2/benefits/queries'
import { promocionesParaOferta } from '@/modules/supply-v2/campaigns/queries'
import { rutaDeOfertaMembego } from '@/modules/comercio/rutas'
import { FichaDeOfertaMembego } from '@/components/supply-v2/FichaDeOfertaMembego'
import { BotonComprar } from '@/components/supply-v2/boton-comprar'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const o = await ofertaPublicaPorSlug(slug)
  // La app no se indexa: su ficha es la de la landing, que es la que se comparte.
  return { title: `${o?.title ?? 'Oferta Membego'} · ${SITE_NAME}`, robots: { index: false, follow: false } }
}

/**
 * La ficha de una oferta Membego DENTRO DE LA APP: aquí se compra. Es la misma ficha que ve la landing
 * (`FichaDeOfertaMembego`), con el botón de compra de verdad en lugar del traspaso.
 *
 * Slice 6 (§17): los beneficios son del cliente de la sesión y se calculan en el servidor. Slice 7 (§20): las
 * promociones de campaña de esta oferta; las automáticas se anuncian, las de cupón piden su código en el checkout.
 * El importe lo decide siempre el servidor: nada de esto viaja como verdad desde el navegador.
 */
export default async function OfertaMembegoEnLaAppPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ beneficio?: string; cupon?: string }> }) {
  const { slug } = await params
  const [o, user, q] = await Promise.all([ofertaPublicaPorSlug(slug), requireRole('CLIENTE'), searchParams])
  if (!o) notFound()
  const dbUserId = user.metadata.dbUserId ?? null
  const beneficios = dbUserId ? await beneficiosParaOferta(dbUserId, o.id, 1) : []
  const promociones = await promocionesParaOferta(dbUserId, o.id, 1)
  // Slice 5: una oferta a comisión sin tope no limita por unidades, solo por persona.
  const maximo = o.unlimited ? o.perCustomerLimit : Math.max(1, Math.min(o.perCustomerLimit, o.remaining))

  return (
    <FichaDeOfertaMembego
      o={o}
      espacio="app"
      ranuraCompra={
        <BotonComprar
          offerId={o.id}
          href={rutaDeOfertaMembego('app', o.slug)}
          sesion="cliente"
          maximo={maximo}
          disponible={o.available}
          moneda={o.currency}
          precio={o.salePrice}
          beneficios={beneficios}
          beneficioPreseleccionado={q.beneficio}
          promociones={promociones}
          cuponPreseleccionado={q.cupon}
        />
      }
    />
  )
}
