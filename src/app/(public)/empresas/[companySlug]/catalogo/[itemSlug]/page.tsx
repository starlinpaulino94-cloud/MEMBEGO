import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { SITE_NAME } from '@/lib/site'
import { shareMetadata } from '@/lib/share/metadata'
import { getItemCatalogoPublico } from '@/modules/marketplace/cached'
import { cargarFichaDeItem } from '@/modules/comercio/ficha-item'
import { rutaDeItem } from '@/modules/comercio/rutas'
import { FichaDeItem } from '@/components/catalogo/FichaDeItem'
import { TraspasoALaApp, EnlaceDeTraspaso } from '@/components/public/TraspasoALaApp'

interface Props {
  params: Promise<{ companySlug: string; itemSlug: string }>
}

export const revalidate = 120

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { companySlug, itemSlug } = await params
  const item = await getItemCatalogoPublico(companySlug, itemSlug)
  if (!item) return { title: `Producto · ${SITE_NAME}` }
  return shareMetadata({
    title: `${item.name} · ${item.company.name}`,
    description: item.description ?? `${item.name}, de ${item.company.name}.`,
    url: `/empresas/${item.company.slug}/catalogo/${item.slug}`,
    image: item.imageUrl ?? undefined,
  })
}

/**
 * Ficha PÚBLICA de un ítem: de CONSULTA, para buscadores y enlaces compartidos.
 * «No existe» y «no es público» (borrador, pausado, otra empresa sin la
 * capacidad…) se ven EXACTAMENTE igual: no se puede averiguar desde fuera qué hay
 * en un catálogo que no se publicó.
 *
 * Muestra lo mismo que la ficha de la app (`FichaDeItem`: precio normal y
 * promocional, variantes, sucursal, disponibilidad —nunca la cantidad—,
 * condiciones de la oferta), pero NO opera: ni carrito, ni pedido, ni reserva, ni
 * «Obtener oferta». Donde esos botones estaban hay el traspaso a la app, que
 * según quién mire lleva a iniciar sesión o crear cuenta, directo a la ficha
 * dentro de `/cliente`, o al propio panel. Esta página sigue siendo estática
 * (caché de 120 s): no lee la sesión.
 */
export default async function ItemCatalogoPublicoPage({ params }: Props) {
  const { companySlug, itemSlug } = await params
  const ficha = await cargarFichaDeItem(companySlug, itemSlug)
  if (!ficha) notFound()
  const destino = rutaDeItem('app', ficha.item.company.slug, ficha.item.slug)
  const { servicio } = ficha

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <FichaDeItem
        ficha={ficha}
        espacio="publico"
        ranuraOferta={<EnlaceDeTraspaso destino={destino} etiqueta="Obtener oferta en la app" />}
        ranuraCompra={
          <TraspasoALaApp
            destino={destino}
            titulo={servicio ? 'Reservar este servicio' : 'Hacer un pedido'}
            descripcion={servicio ? 'Las reservas se hacen dentro de tu cuenta MembeGo.' : 'Los pedidos se hacen dentro de tu cuenta MembeGo.'}
            etiquetaCliente={servicio ? 'Reservar en la app' : 'Pedir en la app'}
          />
        }
      />
    </main>
  )
}
