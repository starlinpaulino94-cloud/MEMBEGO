import type { OfertaPublica } from '@/modules/deals/publico-nucleo'
import { rutaDeItem } from '@/modules/comercio/rutas'
import { EnlaceDeTraspaso } from './TraspasoALaApp'

/**
 * La acción de una oferta EN LA LANDING: no se obtiene aquí. Lleva a la ficha del
 * producto dentro de la app, donde está el botón, según quién mire (ver `TraspasoALaApp`).
 */
export function AccionDeOfertaPublica({ oferta, destino }: { oferta: OfertaPublica; destino?: string }) {
  return <EnlaceDeTraspaso destino={destino ?? rutaDeItem('app', oferta.empresa.slug, oferta.itemSlug)} etiqueta="Obtener en la app" />
}
