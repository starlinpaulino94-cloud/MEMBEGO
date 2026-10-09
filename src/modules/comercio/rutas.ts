/**
 * EL MAPA ÚNICO DE RUTAS ENTRE LA LANDING Y LA APP.
 *
 * Una misma pantalla compartida (una tarjeta, un perfil de empresa) se pinta en
 * dos espacios: la landing pública, que solo informa, y la app del cliente,
 * donde se opera. Cada espacio tiene su propia ruta para el mismo recurso, y
 * quien está dentro de la app no debe salir a la landing para seguir un enlace.
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
