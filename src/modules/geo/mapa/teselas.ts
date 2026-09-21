/**
 * BASEMAP ÚNICO DE MEMBEGO.
 *
 * Había tres mapas en el producto con tres basemaps distintos. Hoy comparten
 * uno solo definido aquí, y la prueba `mapa-basemap.test.ts` impide que vuelva
 * a escribirse a mano.
 *
 * POR QUÉ OSM Y NO CARTO. La Fase 5 eligió las teselas de CARTO (Voyager en
 * claro, Dark Matter en oscuro) por su acabado. En agosto de 2026 CARTO hizo
 * obligatoria una API key: sin ella no corta el servicio, pero sirve cada
 * tesela con la marca de agua "API KEY REQUIRED" —verificado el 2026-09-16:
 * Voyager, `light_all` y `dark_all` llegan marcadas; `tile.openstreetmap.org`
 * llega limpia—. Como no hay key de CARTO y conseguir una depende de un alta
 * externa, se vuelve al proveedor que la decisión G-2 ya documentaba: Leaflet
 * con las teselas de OpenStreetMap, sin llave y sin cuota registrada.
 *
 * El filtro oscuro. OpenStreetMap publica un solo estilo, claro. Aplicarlo tal
 * cual dentro de la app en tema oscuro repetiría el destello blanco que la
 * Fase 5 quiso evitar, así que en oscuro se invierte el tono por CSS. Es la
 * técnica habitual para un basemap claro sin variante oscura.
 */

const OSM = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'

export const ATRIBUCION_MAPA = OSM

/** Opciones comunes de la capa de teselas. `className` da el tono oscuro. */
export const OPCIONES_TESELAS = {
  attribution: ATRIBUCION_MAPA,
  maxZoom: 19,
  className: 'dark:invert dark:hue-rotate-180',
} as const

/**
 * URL de las teselas para el tema pedido.
 *
 * Sin `{r}`: OpenStreetMap no publica la variante `@2x`, así que pedirla no
 * cambiaría nada —y una URL con un marcador que nadie sustituye es una URL
 * rota esperando a que la lea alguien—.
 */
export function urlTeselas(_oscuro: boolean): string {
  return 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
}

/** ¿Está la aplicación en tema oscuro ahora mismo? */
export function temaOscuroActivo(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
}
