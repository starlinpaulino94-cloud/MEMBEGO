# Banner del Inicio del cliente: tres formatos, como Amazon

La tarjeta del carrusel «Beneficios destacados» **es la imagen**. Antes se le
ponía encima un sello, un titular, una tarjeta blanca y un botón aunque la foto
ya trajera su propio texto, y se amontonaba. Ahora el negocio decide, banner a
banner, cómo va el texto, con una vista previa que es la misma tarjeta que verá
el cliente.

## Los formatos

| Formato | Para qué | Qué pinta MembeGo |
| --- | --- | --- |
| `SOLO_IMAGEN` | La imagen ya trae su texto | Nada encima. Opcional: pie con negocio y botón |
| `TITULAR_ARRIBA` | Fotos limpias | Panel de color con el titular y, debajo, la foto entera. Opcional: pie |
| `TEXTO_ENCIMA` | Fotos de ambiente sin texto | Velo, sello, titular, tarjeta del negocio y botón (el formato de antes) |

- **Un banner nuevo nace como «Solo imagen».** Los ya guardados no traen formato
  y siguen siendo «Texto encima»: nadie pierde su titular.
- Con «Solo imagen» el titular no es obligatorio (la imagen lo trae). Con los
  otros dos sí.
- El pie (`mostrarPie`) no aplica a «Texto encima», que ya lleva dentro la
  tarjeta del negocio y el botón.
- El color del panel sale de los fondos suaves del sistema (`bg-info-soft`,
  etc.), que ya tienen modo oscuro. Nada de hex a mano.

## Cómo se configura (Panel → Editor de inicio)

1. **Imagen.** «Subir imagen» abre el editor de encuadre del sistema al formato
   `FORMATOS.bannerInicio` (4:5, 1080×1350) y sube el resultado a
   `promociones/<empresa>/banners/`. También se puede elegir una imagen que la
   empresa ya tiene, o dejarla automática (la del destino).
2. **Formato.** Tres tarjetas. Con «Solo imagen» los campos de texto se apagan.
3. **Texto, color del panel y pie.**
4. **Destino y botón.**

La vista previa del teléfono usa `TarjetaBanner`, el mismo componente que
`VibeHero` en el inicio del cliente.

## El carrusel se fabrica solo (aprobado 2026-10-29)

Lo que una empresa publica entra solo al carrusel del inicio de sus clientes,
sin armar nada: **promociones, productos y servicios, ofertas y planes**, de lo
más reciente a lo más viejo, con la imagen y el color de cada pieza.

**El orden y los topes** (`ordenarNovedades` / `armarCola`, puros):

1. Lo **fijado** por la empresa, por su orden.
2. Lo demás, de lo más reciente a lo más viejo.
3. Máximo `MAX_CARRUSEL` (6) tarjetas y `MAX_POR_EMPRESA` (3) por empresa; lo
   fijado no cuenta contra el tope de su empresa.
4. Una promoción u oferta sale al vencer. Un producto, servicio o plan deja de
   ser novedad a los `DIAS_NOVEDAD` (30) días, salvo que esté fijado.
5. Los banners a medida de la pestaña «Inicio» van siempre primero.

**La plantilla se elige sola** (`plantillaAutomatica`): promoción con arte
propio → Solo imagen; sin arte, Descuento con sello o Titular arriba; producto
o servicio → Precio grande; oferta → Antes y ahora; membresía → Membresía; lo que
vence en menos de 72 h → Cuenta atrás. La empresa puede cambiarla por pieza.
Una plantilla que pide lo que falta (fotos, precio, fecha) cae a la más parecida
(`formatoRealizable`): nunca se pinta un hueco.

**El color**: el dominante de la foto (calculado con `sharp` la primera vez que
se necesita y guardado en `banners_inicio.colorDominante`; solo se baja de
nuestro propio almacenamiento), si no el de marca de la empresa, si no el del
rubro (`RUBRO_BANNER`: color, verbo del botón y etiqueta). El texto sale claro u
oscuro según el fondo (`textoSobre`).

**Las diez plantillas**: Solo imagen, Titular arriba, Texto encima, Precio
grande, Antes y ahora, Descuento con sello, Cuenta atrás, Tres en uno, Collage y
Membresía (`FORMATOS_BANNER`, pintadas por `TarjetaBanner`). Los banners a medida
solo admiten las tres primeras (`FORMATOS_A_MEDIDA`); el resto nacen de una pieza.

**Lo que decide la empresa** vive en `banners_inicio` (un registro por pieza y
solo si decidió algo): fijar, ocultar, plantilla, orden de lo fijado. Se hace en
**Editor de inicio → Carrusel** (`CarruselLista`) y con la pregunta que sale al
publicar:

- **«¿La destacamos en el inicio?»** (`DestacarEnInicio`) aparece al crear una
  promoción, al publicar un producto o servicio y al publicar una oferta. Enseña
  la tarjeta tal como se verá, con la plantilla recomendada y las que caben.
  «Destacar ahora» la fija primera; «Ahora no» no cambia nada (la pieza ya entró
  sola). Si la pieza no es pública todavía, el aviso no sale. Los planes no
  tienen aviso (siguen entrando solos y se destacan desde la lista).

Las acciones (`banners-acciones.ts`) exigen la sección donde se crea cada pieza
(promociones, catálogo, deals, planes) y comprueban que la pieza es pública y de
la empresa de la sesión.

## Cada empresa ve y maneja todos sus banners

La pestaña **Carrusel** del editor de inicio lista los dos tipos, cada uno con
sus acciones:

- **Banners a medida** (`BannersAMedida`, `banners-medida.ts`): los publicados
  hoy, estén o no al aire. *Editar* abre el editor en ese banner
  (`/admin/personalizacion?banner=N`). *Quitar* (`quitarBanner`) lo saca de la
  revisión publicada y del borrador, sin pisar otros cambios sin publicar. No se
  puede quitar el último: el hero necesita al menos un banner (`quitarSlide`,
  que además exige que posición y huella coincidan con lo guardado). Editar y
  quitar piden la capacidad `HOME_BUILDER`; sin ella la lista es de solo lectura.
- **Banners automáticos** (`CarruselLista`): *Editar* lleva a donde se creó la
  pieza (`rutaDeEdicionDePieza`); *Visible en el inicio* la oculta del carrusel
  sin tocar la pieza. Quitar la pieza del todo se hace en su sección (promoción,
  catálogo, oferta, plan).

El editor de inicio abre con el **borrador** y, si no hay, con lo **publicado**.
Antes abría en blanco tras publicar y la empresa no veía sus banners activos.

## Un banner enganchado a productos y servicios

El destino «Productos y servicios» (`ctaDestino.tipo = 'catalogo'`) engancha
hasta `MAX_ITEMS_BANNER` (12) ítems ACTIVOS de la empresa (`itemIds`, en el
orden marcado). Al tocar el banner se abre la **colección**:

- `/cliente/empresas/<slug>/coleccion?i=<ids>&t=<título>` en la app, y la
  misma ruta bajo `/empresas/…` en la landing (`rutaDeColeccion`).
- Arriba, **los principales**: los ítems del banner, en su orden, solo los
  que hoy son públicos. Si no queda ninguno, «no encontrado».
- Debajo, **«También te puede interesar»**: lo que venden empresas
  relacionadas (misma categoría de negocio; si no hay, misma ciudad; si no,
  lo más reciente), repartido por rondas para que una sola no lo acapare
  (`catalogoDeEmpresasRelacionadas`).
- Los ids de la URL pasan por `parsearIdsDeColeccion` y por el mismo filtro
  de visibilidad del marketplace: una URL retocada no enseña nada que no
  fuera público.

## Dónde vive cada cosa

| Pieza | Archivo |
| --- | --- |
| Formatos, paleta y orden de los banners (puro) | `src/modules/home/banner-formatos.ts` |
| Esquema del banner (`HeroSlide`) | `src/modules/home/esquema.ts` |
| Tarjeta y pie | `src/components/cliente/inicio/TarjetaBanner.tsx` |
| Carrusel del cliente | `src/components/cliente/inicio/VibeHero.tsx` |
| Editor del panel | `src/components/admin/EditorInicio.tsx` |
| Subida de la imagen (autoriza antes de escribir) | `src/modules/home/imagen-banner-accion.ts` |
| Qué URLs de imagen acepta un banner | `src/modules/home/imagen-banner.ts` y `hero-publico.ts` |
| Cola automática, plantillas y color (puros) | `src/modules/home/banner-formatos.ts`, `banner-hero.ts` |
| Piezas públicas, ajustes y lista del panel | `src/modules/home/novedades-auto.ts`, `color-dominante.ts` |
| Destacar, ajustar, mover | `src/modules/home/banners-acciones.ts`, `src/components/admin/DestacarEnInicio.tsx`, `CarruselLista.tsx` |
| Colección (ids, título, carga y página) | `src/modules/home/coleccion.ts`, `coleccion-carga.ts`, `src/components/catalogo/ColeccionDeBanner.tsx` |
| Ítems por id y empresas relacionadas | `src/modules/catalog/publico.ts` |

## Reglas que conviene no romper

- **Los banners configurados van primero.** `combinarHeroes` pone los del
  negocio antes de los automáticos (promociones destacadas) y no repite
  destinos. Los automáticos siguen con «Texto encima».
- **Una URL de imagen manual solo se acepta** si es una imagen que la empresa
  ya tiene o una subida a su carpeta `banners/`. `esImagenDeBannerPropia`
  exige un único nombre de archivo, sin `..`, `/` ni `%`: un `startsWith`
  ingenuo dejaría pasar `…/banners/../<otraEmpresa>/x.png`.
- **La subida autoriza ANTES de escribir** (sección `personalizacion`,
  capacidad `HOME_BUILDER`, empresa de la sesión, tipo por la firma del
  archivo, sin sobrescribir), porque escribe con el cliente de servicio que
  ignora las políticas de Storage.
- **«Solo imagen» sin imagen no se puede guardar**: si ni la subida ni el
  destino aportan una, el servidor lo rechaza con un mensaje claro.

Las pruebas están en `tests/banner-formatos.test.ts`, `tests/banner-coleccion.test.ts` y `tests/banner-novedades.test.ts`.
