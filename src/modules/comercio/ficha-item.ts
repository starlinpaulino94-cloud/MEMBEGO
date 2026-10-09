import { getItemCatalogoPublico } from '@/modules/marketplace/cached'
import { opcionesDePedidoPublico } from '@/modules/orders/publico'
import { ofertasPublicas } from '@/modules/deals/publico'
import { esServicio, porcentajeDeAhorro } from '@/modules/comercio/vitrina'

/**
 * LOS DATOS DE LA FICHA DE UN PRODUCTO O SERVICIO — UNA SOLA VEZ.
 *
 * La ficha se pinta en dos espacios: la landing (consulta, SEO, enlaces
 * compartidos) y la app del cliente (donde se pide, se reserva y se obtiene la
 * oferta). Las dos leen lo mismo, con las mismas reglas de visibilidad, y por eso
 * se cargan aquí y no en cada página: así «no existe» y «no es público» (borrador,
 * pausado, otra empresa sin la capacidad…) se ven EXACTAMENTE igual en ambos.
 *
 * Nada de esto es una operación: es lectura. Quien opera es la app.
 */
export async function cargarFichaDeItem(companySlug: string, itemSlug: string) {
  const item = await getItemCatalogoPublico(companySlug, itemSlug)
  if (!item) return null
  // El slug de la oferta Membego (Supply), no su ruta: la ruta depende del espacio donde se pinta la ficha.
  const ofertaSlug = item.origen === 'SUPPLY' && item.ofertaSlug ? item.ofertaSlug : null
  // Pedir es de los productos de la EMPRESA: las ofertas de Membego se compran por su propio checkout.
  const pedido = item.origen === 'EMPRESA' ? await opcionesDePedidoPublico(item.company.slug) : null
  const ofertasDeLaEmpresa = item.origen === 'EMPRESA' ? await ofertasPublicas({ companySlug: item.company.slug, limite: 24 }).catch(() => []) : []
  // Las ofertas VIVAS sobre este ítem (sus variantes). Si hay varias, la de menor precio va primero.
  const ofertas = ofertasDeLaEmpresa.filter((o) => o.itemSlug === item.slug).sort((a, b) => Number(a.precioAhora) - Number(b.precioAhora))
  const mejorOferta = ofertas[0] ?? null
  return {
    item,
    ofertaSlug,
    pedido,
    ofertas,
    mejorOferta,
    pct: mejorOferta ? porcentajeDeAhorro(mejorOferta) : null,
    agotado: item.disponibilidad === 'AGOTADO',
    servicio: esServicio(item),
  }
}

export type FichaDeItemDatos = NonNullable<Awaited<ReturnType<typeof cargarFichaDeItem>>>
