/**
 * BASEMAP ÚNICO DE MEMBEGO.
 *
 * Había tres mapas en el producto con tres basemaps distintos: "Cerca de mí"
 * con CARTO, y los dos selectores de ubicación (perfil de empresa y confirmar
 * vivienda) con las teselas crudas de OpenStreetMap. Mismo papel, tres
 * aspectos — el mismo defecto que la Fase 18 saldó con los degradados de
 * cabecera.
 *
 * POR QUÉ VOYAGER Y NO POSITRON. La Fase 5 eligió Positron (`light_all`) para
 * que los marcadores destacaran sobre un fondo apagado, y se pasó de frenada:
 * a poco que se aleje el zoom, el país entero queda como una mancha blanca con
 * etiquetas grises. Un mapa sin agua azul ni verde no se lee como un mapa, se
 * lee como un error de carga.
 *
 * Voyager es el término medio y está diseñado para lo mismo: es un basemap de
 * CARTO pensado para llevar datos encima, pero con agua, parques y carreteras
 * con su color. Los marcadores siguen destacando porque ahora son discos con
 * el logo del negocio y un aro de color, no gotas grises.
 *
 * En oscuro se mantiene Dark Matter: no hay un Voyager oscuro, y las teselas
 * claras dentro de una app oscura son peor problema que la falta de color.
 *
 * Siguen siendo datos de OpenStreetMap: la atribución mantiene a OSM además de
 * CARTO porque lo exige su licencia, no por cortesía.
 */

const OSM = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
const CARTO = '&copy; <a href="https://carto.com/attributions">CARTO</a>'

export const ATRIBUCION_MAPA = `${OSM} ${CARTO}`

/** Opciones comunes de la capa de teselas. `subdomains` reparte la carga. */
export const OPCIONES_TESELAS = {
  attribution: ATRIBUCION_MAPA,
  maxZoom: 20,
  subdomains: 'abcd',
} as const

/**
 * URL de las teselas para el tema pedido.
 *
 * `{r}` lo resuelve Leaflet como `@2x` en pantallas de alta densidad, que es
 * casi todo el parque móvil: sin él, el mapa se ve borroso en el sitio donde
 * más se usa.
 */
export function urlTeselas(oscuro: boolean): string {
  const estilo = oscuro ? 'dark_all' : 'rastertiles/voyager'
  return `https://{s}.basemaps.cartocdn.com/${estilo}/{z}/{x}/{y}{r}.png`
}

/** ¿Está la aplicación en tema oscuro ahora mismo? */
export function temaOscuroActivo(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
}
