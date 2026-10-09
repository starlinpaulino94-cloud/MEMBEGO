import type { OfertaPublica } from '@/modules/deals/publico-nucleo'
import { ReclamarOfertaBoton } from './ReclamarOfertaBoton'

/**
 * La acción de una oferta DENTRO DE LA APP: el botón que la obtiene. Solo la
 * importan las páginas de `/cliente`; la landing usa `AccionDeOfertaPublica`, que
 * es un enlace al traspaso.
 */
export function AccionObtenerOferta({ oferta, retorno }: { oferta: OfertaPublica; retorno: string }) {
  return <ReclamarOfertaBoton dealId={oferta.id} retorno={retorno} sucursales={oferta.sucursales} />
}
