/**
 * Share Engine · EL TAMAÑO DE LA TARJETA COMPARTIDA. La fuente única.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ 1728×910 Y NO 1200×630
 *
 * 1200×630 es el mínimo que documenta Open Graph, y lo es desde antes de que
 * las pantallas fueran de 2x y 3x. En un móvil moderno esa tarjeta se muestra a
 * un ancho físico mayor que su resolución: el navegador la estira y el texto
 * sale con los bordes blandos.
 *
 * 1728×910 mantiene la proporción 1,9:1 —la que esperan WhatsApp, Facebook y
 * Telegram— con un 44 % más de ancho. Lo que gana no es tamaño en pantalla: es
 * NITIDEZ, porque deja de estirarse.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTÁ EN SU PROPIO ARCHIVO
 *
 * `og.tsx` importa `ImageResponse` de `next/og`, que es de servidor. La vista
 * previa del panel es un componente de cliente y necesita esta proporción: si
 * la leyera de allí, arrastraría el generador de imágenes entero al navegador.
 *
 * Aquí no hay ninguna dependencia, así que lo puede leer cualquiera.
 */

export const OG_SIZE = { width: 1728, height: 910 } as const

/**
 * El lienzo en el que estaban dibujadas las tarjetas ANTES de este cambio.
 *
 * Se conserva documentado porque explica de dónde salen los números del diseño:
 * cada tamaño de letra, padding y ancho de panel de `og.tsx` se multiplicó UNA
 * vez por `OG_ESCALA` y quedó escrito en las coordenadas nuevas.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO SE ESCALA AL VUELO — Y ESTO SE COMPROBÓ, NO SE SUPUSO
 *
 * Lo evidente era envolver el diseño en `transform: scale()` y no tocar ningún
 * número. **Satori descarta los `<svg>` y los `<img>` dentro de un contenedor
 * transformado**: solo sobrevive el texto.
 *
 * Al renderizarlo, el logo de MembeGo desaparecía de la tarjeta. Un cambio
 * hecho para que la marca se viera mejor la habría borrado de todos los
 * enlaces compartidos.
 */
export const OG_LIENZO_BASE = { width: 1200, height: 630 } as const

/**
 * El factor con el que se multiplicaron los tamaños del diseño.
 *
 * Es el MAYOR de los dos, no el del ancho: 1728/1200 = 1,44 exacto, pero
 * 630 × 1,44 = 907,2 y el lienzo pide 910. Usando el del ancho quedaba una
 * franja de casi tres píxeles sin cubrir en el borde inferior — se veía en la
 * imagen generada.
 *
 * Ya está aplicado en el código. Vive aquí para que quien añada una tarjeta
 * nueva sepa en qué escala está escrito todo lo demás.
 */
export const OG_ESCALA = Math.max(
  OG_SIZE.width / OG_LIENZO_BASE.width,
  OG_SIZE.height / OG_LIENZO_BASE.height
)

/**
 * Para `style={{ aspectRatio: OG_ASPECTO }}`.
 *
 * NO se usa como `aspect-[…]` de Tailwind: Tailwind genera sus clases leyendo
 * el código fuente, y una construida con una plantilla en tiempo de ejecución
 * no existe cuando eso ocurre. La clase saldría en el HTML y no tendría CSS
 * detrás.
 */
export const OG_ASPECTO = `${OG_SIZE.width} / ${OG_SIZE.height}`

/**
 * Peso máximo de la imagen de fondo. **El mismo que acepta la subida**, y tiene
 * que serlo.
 *
 * ESTA GRIETA EXISTÍA: la subida admitía 5 MB y el generador rechazaba a partir
 * de 4. Una imagen de 4,5 MB se subía sin queja, se guardaba, se veía bien en
 * el panel — y al compartir el enlace la tarjeta caía al degradado sin que nada
 * lo dijera. Quien la subió no tenía forma de enterarse.
 *
 * Con 1728×910 el archivo pesa más, así que la grieta habría pasado de rara a
 * frecuente: subir la recomendación sin subir esto habría hecho que MÁS
 * enlaces perdieran su imagen.
 */
export const OG_MAX_MB = 5
export const OG_MAX_BYTES = OG_MAX_MB * 1024 * 1024

/** Texto para el usuario. Un solo sitio, para que no se contradiga con el código. */
export const OG_RECOMENDACION = `${OG_SIZE.width}×${OG_SIZE.height} px`
