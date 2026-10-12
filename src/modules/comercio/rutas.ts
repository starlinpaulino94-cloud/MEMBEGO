/**
 * EL MAPA ÚNICO DE RUTAS ENTRE LA LANDING Y LA APP.
 *
 * Una misma pantalla compartida (una tarjeta, un perfil de empresa, la ficha de
 * un producto) se pinta en dos espacios: la landing pública, que solo informa, y
 * la app del cliente, donde se opera. Cada espacio tiene su propia ruta para el
 * mismo recurso, y quien está dentro de la app no debe salir a la landing para
 * seguir un enlace.
 *
 * Los componentes compartidos NO escriben esas rutas a mano: reciben el
 * `Espacio` en el que se pintan y piden aquí el destino. Así, mover una
 * operación de la landing a la app (fases F2 a F4 de
 * docs/SEPARACION_LANDING_APP.md) es añadir una función en este archivo, no
 * buscar enlaces sueltos por los componentes.
 *
 * Es un módulo PURO (sin imports): lo usan componentes de servidor y de cliente.
 */

/** Dónde se pinta una pantalla: la landing informativa o la app del cliente. */
export type Espacio = 'publico' | 'app'

/** La vitrina de una empresa. */
export function rutaDeEmpresa(espacio: Espacio, slug: string): string {
  return espacio === 'app' ? `/cliente/empresas/${slug}` : `/empresas/${slug}`
}

/** La ficha de un producto o servicio del catálogo de una empresa. */
export function rutaDeItem(espacio: Espacio, empresaSlug: string, itemSlug: string): string {
  return espacio === 'app' ? `/cliente/empresas/${empresaSlug}/catalogo/${itemSlug}` : `/empresas/${empresaSlug}/catalogo/${itemSlug}`
}

/** Buscar excursiones (todas las empresas). */
export function rutaDeBuscarExcursiones(espacio: Espacio): string {
  return espacio === 'app' ? '/cliente/excursiones' : '/excursiones'
}

/** La lista de excursiones de una empresa. */
export function rutaDeExcursiones(espacio: Espacio, empresaSlug: string): string {
  return espacio === 'app' ? `/cliente/empresas/${empresaSlug}/excursiones` : `/empresas/${empresaSlug}/excursiones`
}

/** La ficha de una excursión de una empresa. */
export function rutaDeExcursion(espacio: Espacio, empresaSlug: string, excursionSlug: string): string {
  return espacio === 'app' ? `/cliente/empresas/${empresaSlug}/excursiones/${excursionSlug}` : `/empresas/${empresaSlug}/excursiones/${excursionSlug}`
}

/** La ficha de un plan de membresía de una empresa. En la landing es consulta; en la app es donde se contrata. */
export function rutaDePlan(espacio: Espacio, planId: string): string {
  return espacio === 'app' ? `/cliente/planes/${planId}` : `/plan/${planId}`
}

/** El índice de promociones: en la landing, el escaparate; en la app, las promociones del cliente. */
export function rutaDePromociones(espacio: Espacio): string {
  return espacio === 'app' ? '/cliente/promociones' : '/promociones'
}

/** La ficha de una oferta Membego (Supply). La compra solo existe en la app. */
export function rutaDeOfertaMembego(espacio: Espacio, slug: string): string {
  return espacio === 'app' ? `/cliente/ofertas-membego/${slug}` : `/promociones/membego/${slug}`
}

/** La lista de campañas. */
export function rutaDeCampanas(espacio: Espacio): string {
  return espacio === 'app' ? '/cliente/campanas' : '/promociones/campanas'
}

/** La ficha de una campaña. */
export function rutaDeCampana(espacio: Espacio, code: string): string {
  return `${rutaDeCampanas(espacio)}/${code}`
}

/** Los planes de membresía de la red. Contratar solo existe en la app. */
export function rutaDeMembresias(espacio: Espacio): string {
  return espacio === 'app' ? '/cliente/membresias-membego' : '/promociones/membresias'
}

/** El regalo de una empresa que llega por enlace compartido (`/oferta/<código>`). Reclamarlo solo existe en la app. */
export function rutaDeOfertaLegada(espacio: Espacio, codigo: string): string {
  return espacio === 'app' ? `/cliente/oferta/${codigo}` : `/oferta/${codigo}`
}

/** El carrito de productos y servicios. Solo existe en la app: la landing no tiene carrito. */
export const RUTA_CARRITO = '/cliente/carrito'

/** La reserva de las excursiones del carrito (su pantalla de confirmación y pago). Solo existe en la app. */
export const RUTA_CARRITO_EXCURSIONES = '/cliente/carrito/excursiones'

/** El pago del carrito de UN negocio. Solo existe en la app. */
export function rutaDePago(empresaSlug: string): string {
  return `/cliente/carrito/pagar/${empresaSlug}`
}

/** Iniciar sesión y volver a `destino`. El destino lo vuelve a validar el login: aquí solo se arma el enlace. */
export function rutaDeLogin(destino: string): string {
  return `/login?redirect=${encodeURIComponent(destino)}`
}

/** Crear cuenta y volver a `destino`. */
export function rutaDeRegistro(destino: string): string {
  return `/registro/cuenta?next=${encodeURIComponent(destino)}`
}
