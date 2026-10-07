import { revalidatePath } from 'next/cache'

/**
 * Las páginas públicas que enseñan ofertas: la lista, la portada del catálogo y la ficha de cada
 * empresa. Cuando una oferta se publica, se pausa, se agota o se reclama, hay que refrescarlas
 * para no prometer lo que ya no hay. (El reclamo SIEMPRE se vuelve a comprobar en el servidor:
 * esto solo evita que la vitrina vaya atrasada.)
 */
export function refrescarVitrinasDeOfertas(): void {
  revalidatePath('/ofertas')
  revalidatePath('/catalogo')
  revalidatePath('/empresas/[companySlug]', 'page')
}
