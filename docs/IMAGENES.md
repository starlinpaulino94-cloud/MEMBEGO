# Imágenes: formatos, editor de encuadre y versiones

Una sola regla para todas las imágenes de la plataforma: se guarda el **original**
tal como lo subió la persona, más un **encuadre** (un rectángulo en píxeles de ese
original), y el servidor genera las **versiones** que cada pantalla necesita.
Reencuadrar después parte siempre del original, así que no degrada la foto.

> Estado: **fase 1 (catálogo)** hecha. Las promociones, planes, ofertas,
> excursiones, campañas, logos, banners y avatares siguen con su componente de
> subida actual y se enchufan al mismo editor en las fases 2 y 3.

## Dónde vive cada cosa

| Pieza | Archivo |
|---|---|
| Formatos, geometría del recorte y validación (puro, sin dependencias) | `src/lib/imagen/formatos.ts` |
| Editor de encuadre (cliente) | `src/components/imagen/EditorDeImagen.tsx` |
| Generación de versiones con `sharp` (servidor) | `src/modules/catalog/variantes-imagen.ts` |
| Acciones: subir, reencuadrar, quitar | `src/modules/catalog/actions.ts` |
| URL de cada versión | `urlImagenCatalogo` en `src/modules/catalog/formato.ts` |
| Columnas (`width`, `height`, `crop`, `variantesBase`) | `CatalogItemImage`, migración `20261055` |

## Formato del catálogo

Foto de producto **cuadrada (1:1)**: es el estándar de las tiendas y la misma
decisión de las promociones. La tarjeta, la ficha, el perfil de la empresa y las
ofertas muestran el cuadrado entero.

| Versión | Medida | Dónde se usa |
|---|---|---|
| `tarjeta` | 600×600 | inicio, vitrina, perfil de empresa, ofertas, panel |
| `ficha` | 1200×1200 | ficha del producto, API de plataforma |
| `compartir` | 1200×630 (1,91:1) | `og:image` al compartir el enlace |

`compartir` sale de una **franja centrada** del encuadre (`franjaCompartir`). El
editor oscurece lo que queda fuera de esa franja para que se vea qué se pierde.

Todas salen en **WebP** y **sin metadatos** (se va el GPS de las fotos de celular).

## Flujo de subida

1. La persona elige un archivo. **No se sube todavía**: se abre el editor.
2. Mueve y acerca la foto dentro del marco. Ve en vivo la tarjeta, la ficha y la
   tarjeta de compartir, y un aviso de resolución según los píxeles **reales** del
   recorte (`evaluarResolucion`): óptima ≥ 1200 px, justa ≥ 600 px, baja < 600 px.
3. «Subir foto»: `prepararSubidaImagenCatalogo` autoriza y firma la subida del
   **original** (directo a Storage, sin pasar por la Server Action).
4. `confirmarImagenCatalogo(itemId, ruta, recorte)` lee el original, decide el tipo
   por la firma del archivo, **valida el recorte contra las dimensiones reales**,
   genera las tres versiones, las sube y registra la fila. Si algo falla, borra lo
   que ya había subido: no quedan archivos sueltos.
5. «Encuadrar» en una foto ya subida: `reencuadrarImagenCatalogo` regenera desde el
   original con un prefijo nuevo y borra las versiones viejas **al final**.

Las coordenadas del recorte son las de la imagen **ya orientada** (rotación EXIF
aplicada), que es la que ve el navegador; `variantes-imagen.ts` rota antes de
recortar.

## Storage

Todo en el bucket `promociones`, bajo `<empresa>/catalogo/<item>/`:

```
<id>.jpg                       ← original
<id>-<token>_tarjeta.webp      ← versiones
<id>-<token>_ficha.webp
<id>-<token>_compartir.webp
```

Las versiones se suben con `cache-control` de un año. Por eso el nombre lleva un
`token` nuevo cada vez que se generan: reutilizar el nombre serviría la versión
vieja desde el CDN. La política de Storage (`membego_medio_propio`) comprueba que
el primer segmento sea una empresa del usuario.

## Fotos anteriores al editor

No tienen versiones (`variantesBase` es null): se siguen sirviendo desde el
original, como siempre. El botón «Encuadrar» las convierte: genera sus versiones
la primera vez que se guardan.

## Seguridad

- El recorte llega del navegador y **no se confía en él**: `validarRecorte` exige
  números finitos, dentro de la imagen, de la proporción del formato y de un tamaño
  mínimo.
- `limitInputPixels` (40 MP) corta las bombas de descompresión.
- El tipo real lo decide la firma del archivo, no `file.type`.
- Quitar una foto o reencuadrarla solo borra rutas que cuelgan del ítem y la
  empresa de la sesión.

## Añadir un formato nuevo

1. Define su `FormatoImagen` en `formatos.ts` (proporción, versiones, resolución).
2. Reutiliza `EditorDeImagen` con ese formato.
3. Genera sus versiones con la misma tubería de `variantes-imagen.ts`.
4. Si guarda la imagen en una tabla propia, añade las mismas cuatro columnas.

## Fases siguientes

2. **Promociones**: hoy rechazan lo que no es 1:1–4:5; pasan a abrir el editor y
   recortar al formato Instagram.
3. **Planes, ofertas, excursiones, campañas, logos, banners, avatar**: cada
   componente de subida (ocho en total) pasa por el editor con su formato.
