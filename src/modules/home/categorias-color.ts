/**
 * EL COLOR DE CADA CATEGORÍA — la parte que se puede probar.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * AQUÍ NO HAY UN SOLO COLOR, Y ES A PROPÓSITO
 *
 * Los tonos viven en `globals.css`, bajo `[data-categoria="…"]`, con su versión
 * clara y su versión oscura. Este módulo solo decide QUÉ categoría reconoce el
 * sistema; el tema decide con qué se pinta.
 *
 * La primera versión traía los hex aquí y el auditor de diseño la rechazó
 * —`hexEnInterfaz` subió de 121 a 171—. Tenía razón y no era burocracia: un
 * color escrito a mano en un `.tsx` no cambia con el tema, así que en modo
 * oscuro la tesela de «Lavados» habría quedado con fondo azul clarito sobre una
 * pantalla negra. El gate encontró un defecto real antes que ninguna persona.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ANTES EL COLOR DEPENDÍA DE LA POSICIÓN
 *
 * `VibeCategorias` ciclaba tres acentos con `ACENTOS[i % 3]`, así que «Lavados»
 * salía violeta o cian según dónde cayera en la lista, y cambiaba el día que se
 * añadiera una categoría antes. Un color que cambia solo no enseña a reconocer
 * nada: era decoración disfrazada de información.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL VIOLETA DE MEMBEGO NO ES DE NINGUNA CATEGORÍA
 *
 * Es el color de la marca —héroe, botones, sellos—. Si lo llevara también un
 * rubro cualquiera dejaría de señalar «esto es MembeGo». Spa usa un violeta
 * vecino, no el mismo.
 */

/** Categorías con color propio. Cada una tiene su regla en `globals.css`. */
const CON_COLOR = new Set([
  'lavados',
  'restaurantes',
  'cafeterias',
  'belleza',
  'gimnasios',
  'spa',
  'salud',
  'clinicas',
  'farmacias',
  'veterinarias',
  'tiendas',
  'entretenimiento',
  'hoteles',
  'servicios',
  'educacion',
  'automotriz',
  'tours',
])

/** Slugs que significan lo mismo que uno de los de arriba. */
const SINONIMOS: Record<string, string> = {
  lavado: 'lavados',
  carwash: 'lavados',
  vehiculos: 'automotriz',
  restaurante: 'restaurantes',
  gastronomia: 'restaurantes',
  comida: 'restaurantes',
  cafeteria: 'cafeterias',
  barberia: 'belleza',
  salon: 'belleza',
  gimnasio: 'gimnasios',
  fitness: 'gimnasios',
  bienestar: 'salud',
  clinica: 'clinicas',
  farmacia: 'farmacias',
  veterinaria: 'veterinarias',
  tienda: 'tiendas',
  comercio: 'tiendas',
  turismo: 'tours',
  excursiones: 'tours',
}

/** Sin color propio: gris del sistema. Tiene su regla como cualquier otra. */
export const CATEGORIA_NEUTRA = 'otros'

/**
 * El valor de `data-categoria` con el que se pinta un chip.
 *
 * Una categoría nueva sin regla propia cae en `otros` y sale en gris, que es lo
 * correcto: un color inventado sobre la marcha —por hash o por posición— sería
 * volver justo al problema que esto vino a arreglar.
 */
export function claveDeCategoria(slug: string): string {
  const limpio = slug.trim().toLowerCase()
  const canonico = SINONIMOS[limpio] ?? limpio
  return CON_COLOR.has(canonico) ? canonico : CATEGORIA_NEUTRA
}
