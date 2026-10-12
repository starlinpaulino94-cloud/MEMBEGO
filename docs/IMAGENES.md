# Imágenes: un formato por sección y el editor de encuadre

Una regla para todas las imágenes de la marca: **cada sección tiene UN formato**
(una proporción y un tamaño final) y **todas pasan por el mismo editor**, donde la
persona mueve la foto al lugar que quiere que se vea más, la acerca, la aleja hasta
verla entera, la gira y ve cómo quedará. Nada se rechaza por tener otra proporción:
se encuadra.

## Los formatos (`FORMATOS` en `src/lib/imagen/formatos.ts`)

| Sección | Formato | Tamaño final | Por qué |
|---|---|---|---|
| Producto del catálogo | cuadrada 1:1 | 1200×1200 | estándar de las tiendas; tarjeta, ficha, perfil y ofertas la muestran entera |
| Promoción | cuadrada 1:1 | 1080×1080 | el «formato Instagram» que ya tenían; la tarjeta es cuadrada |
| Plan de membresía | panorámica 16:9 | 1600×900 | la tarjeta del plan se pinta a 16:9 |
| Portada de excursión | panorámica 16:9 | 1600×900 | las tarjetas y la ficha se pintan a 16:9 |
| Foto extra de excursión / galería de la empresa | cuadrada 1:1 | 1000×1000 | cuadrícula cuadrada |
| Logo | cuadrado 1:1 | 512×512 | se pinta cuadrado; **admite fondo transparente** |
| Banner del perfil | banner 3:1 | 1800×600 | ocupa todo el ancho: ≈1,7:1 en móvil y ≈4,4:1 en escritorio |
| Imagen al compartir una campaña | apaisada 1,91:1 | 1200×630 | la proporción de las tarjetas de WhatsApp y Facebook |
| Fondo de campañas y de landings | panorámica 16:9 | 1600×900 | |
| Foto de perfil del cliente | cuadrada 1:1 | 400×400 | se pinta en círculo |

Cambiar un formato ahí cambia el editor, el aviso de resolución y los letreros a la vez.
`tests/imagen-secciones.test.ts` falla si un componente nuevo sube un archivo sin pasar
por el editor (o sin declararse como excepción con su motivo).

**Fuera del editor a propósito**: fotos de evidencia del vehículo, comprobantes de pago,
adjuntos de reportes y adjuntos contables. Son pruebas o documentos: recortarlos
cambiaría lo que prueban.

## Qué hace el editor (`EditorDeImagen`)

- **Mover**: arrastrar con ratón o dedo, o con las flechas. La foto se mueve libremente
  dentro de lo que cubre; nunca queda una esquina vacía sin querer.
- **Acercar y alejar**: de ×4 hasta ver la **foto entera**. Si sobra espacio, se rellena
  con un color de fondo a elegir (blanco, gris claro u oscuro; «sin fondo» en logos).
- **Girar** a 90° a la izquierda o a la derecha.
- **Zonas por pantalla**: si una imagen se recorta distinto en alguna pantalla (el banner
  en móvil y en escritorio), el editor dibuja cada zona y oscurece lo que no se ve en
  ninguna.
- **Así se verá**: vista final en el formato de la sección (círculo en avatares).
- **Aviso de resolución** según los píxeles **reales** del recorte: óptima ≥ el ancho
  final, justa ≥ el mínimo, baja por debajo.

## Dos caminos para producir la imagen final

**Catálogo — se guarda el original.** El navegador manda el encuadre (rectángulo + giro +
fondo) y el servidor genera las versiones desde el original, así que reencuadrar no
degrada la foto:

| Versión | Medida | Dónde |
|---|---|---|
| `tarjeta` | 600×600 | listas, inicio, perfil de empresa, ofertas, panel |
| `ficha` | 1200×1200 | ficha del producto, API de plataforma |
| `compartir` | 1200×630 | `og:image`: la foto **entera** centrada sobre un fondo desenfocado de sí misma |

WebP, sin metadatos (se va el GPS). Archivos en `promociones/<empresa>/catalogo/<item>/`:

```
<id>.jpg                       ← original
<id>-<token>_tarjeta.webp      ← versiones (el token cambia al reencuadrar:
<id>-<token>_ficha.webp          cache de un año, no se reutilizan nombres)
<id>-<token>_compartir.webp
```

**Resto de secciones — se sube una sola imagen.** `useEditorDeImagen` abre el editor y, al
confirmar, `exportarEncuadre` pinta el encuadre en un lienzo del **tamaño único** de la
sección y entrega un WebP al `handleFile` que cada componente ya tenía (con sus
validaciones y su subida a Storage). Para reencuadrar una imagen ya subida se parte de
esa imagen.

## Seguridad

- El encuadre llega del navegador y **no se confía en él**: `validarEncuadre` exige
  números finitos, giro múltiplo de 90°, color hexadecimal, proporción del formato, que
  no se aleje más de «foto entera» y que ni el marco ni la foto se salgan donde no deben.
- `limitInputPixels` (40 MP) contra bombas de descompresión; el tipo real sale de la
  firma del archivo, no de `file.type`.
- Quitar o reencuadrar solo borra rutas que cuelgan del ítem y la empresa de la sesión.
- Las versiones se escriben con la sesión del usuario (la política de Storage comprueba
  la empresa), no con la clave de servicio.
- SVG: los logos en SVG se suben tal cual (pasarlos por un lienzo los volvería píxeles).

## Dónde vive cada cosa

| Pieza | Archivo |
|---|---|
| Formatos, geometría y validación (puro) | `src/lib/imagen/formatos.ts` |
| Pintar el encuadre en un lienzo (navegador) | `src/lib/imagen/exportar.ts` |
| Editor | `src/components/imagen/EditorDeImagen.tsx` |
| Conexión con un componente de subida | `src/components/imagen/useEditorDeImagen.tsx` |
| Versiones del catálogo con `sharp` (servidor) | `src/modules/catalog/variantes-imagen.ts` |
| Acciones del catálogo: subir, reencuadrar, quitar | `src/modules/catalog/actions.ts` |
| Columnas `width`, `height`, `crop`, `variantesBase` | `CatalogItemImage`, migración `20261055` |

`crop` guarda `{ x, y, w, h, giro, fondo }`; las filas anteriores al giro solo traen el
rectángulo y se leen con giro 0° y fondo blanco (`encuadreGuardado`).

## Fotos anteriores

- Catálogo anterior al editor: sin versiones (`variantesBase` null), se sirve el
  original; «Encuadrar» las convierte.
- Promociones, planes, etc. ya subidas: se ven como antes. «Encuadrar» las reabre desde
  la imagen guardada.
- Las excursiones, planes y tarjetas cuya proporción cambió (excursión 16:10 → 16:9,
  búsqueda de promociones 4:3 → 1:1) recortan ahora menos, no más.

## Añadir un formato nuevo

1. Define su entrada en `FORMATOS` (proporción, tamaño final, umbrales y, si hace falta,
   `zonas` o `permiteTransparente`).
2. En su componente de subida: `useEditorDeImagen({ formato: FORMATOS.x, alAplicar: handleFile })`
   y el `input` llama a `elegir(...)`.
3. Añade el componente a `SECCIONES` en `tests/imagen-secciones.test.ts`.
4. Pinta la imagen con la proporción del formato (nada de `aspect-[4/3]` sueltos).

## Pendiente

- **El original del catálogo queda en el bucket público con sus metadatos EXIF** (como
  ya ocurría). Las versiones salen sin ellos. Cerrarlo pide un bucket privado para originales.
- La app móvil (Expo) todavía pinta las imágenes con alto fijo; cuando muestre el
  catálogo debe usar la proporción del formato.
