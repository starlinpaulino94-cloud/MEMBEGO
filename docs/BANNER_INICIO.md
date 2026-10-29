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

Las pruebas están en `tests/banner-formatos.test.ts`.
