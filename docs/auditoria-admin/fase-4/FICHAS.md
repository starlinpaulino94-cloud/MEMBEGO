# Fichas de las primitivas del panel (fase 4)

> Una ficha por pieza, como pide `10` §7: finalidad, anatomía, variantes, estados, responsive, accesibilidad, usos correctos e incorrectos. Todas viven en `packages/ui/src/ui/` y **no tienen consumidor todavía** (criterio de la fase 4); su consumidor previsto está en cada ficha. Ninguna importa nada de la aplicación ni de Next (lo vigila `tests/primitivas-panel.test.ts`).
> **Convención común:** son de **servidor** (sin estado ni efectos); el enlace lo pone quien las usa (`enlace` o `render`), porque el design system no depende del router; los textos y colores salen de tokens, nunca de un hexadecimal.

---

## `Campo` · etiqueta + control + ayuda + error enlazado
**Finalidad.** Que un campo sea UNA pieza. Resuelve `04` · F-01: ningún formulario medido vinculaba el error con su campo.
**Anatomía.** `<label for>` siempre visible · control (lo pinta quien lo usa) · ayuda · error con `role="alert"`.
**API.** `<Campo id etiqueta opcional? ayuda? error? como? >{(control) => <Input {...control} />}</Campo>`. `control` trae `id`, `aria-describedby` y `aria-invalid`.
**Variantes.** `como="campo"` (por defecto) · `como="grupo"` (varios controles bajo una pregunta: `<fieldset>`/`<legend>`).
**Estados.** Sin error: sin `aria-invalid` ni `aria-describedby` si tampoco hay ayuda. Con error: `data-invalido="true"`, control marcado y error anunciado al aparecer.
**Responsive.** Una columna; el ancho lo decide el contenedor (tipo Formulario, ≤ 720 px).
**Accesibilidad.** `id` obligatorio y estable (uno generado distinto en servidor y cliente rompe la hidratación). Se marca lo **opcional**, nunca lo obligatorio con asterisco (`04` §3, regla 2).
**Correcto.** Un `Campo` por control; el error de la acción llega como `{campo: mensaje}`. **Incorrecto.** Un error solo en un `toast`; una etiqueta como `placeholder`; `*` en los obligatorios.
**Consumidor previsto.** Todos los formularios (fase 7); baja el techo de 94 campos sin nombre.

## `Tabla` · la tabla de servidor
**Finalidad.** Sustituir las 54 `<table>` crudas con cinco dialectos de celda (`06` · T-01, T-15).
**Anatomía.** `<caption class="sr-only">` · cabecera `th scope="col"` (con enlace de orden si es ordenable) · filas con el identificador como `th scope="row"` · pie opcional (paginación, total).
**Celdas tipadas.** `texto`, `numero` y `dinero` (derecha, cifras tabulares), `fecha`/`fechaHora` (`<time datetime>`), `estado` (`EstadoChip`), `enlace` (destino de la fila). El formato regional llega **una vez** en `formato` (la tabla no importa moneda ni zona horaria). Lo que no hay se dice: «Sin dato».
**Orden.** Por URL: `hrefOrden(clave, dir)`; solo la columna activa lleva `aria-sort`; el siguiente clic invierte.
**Vacío.** Dos variantes con `EmptyState`: `vacio` (no hay nada; con la acción de crear) y `sinResultados` (hay filtros; con «Limpiar filtros»).
**Responsive.** Prioridad por columna: 1 siempre, 2 se oculta bajo 768 px, 3 bajo 1024 px; máximo seis visibles en escritorio. En móvil, scroll horizontal **dentro** de la tabla con la columna identificadora fija; nunca de la página. *Pendiente (fase 5, 5.2):* variante de tarjetas para las colas de trabajo con botones (Pagos).
**Accesibilidad.** `caption` y `scope` siempre; columna de acciones con encabezado solo para lectores.
**Correcto.** Filtros, orden y paginación en la URL; el nombre de columna ordenable de una lista blanca. **Incorrecto.** Filtrar en el navegador sobre un `take` fijo; `useState` para ordenar; una tabla sin `caption`.
**Consumidor previsto.** Clientes y Pagos (fase 5); el resto de las 44 tablas (fase 7).

## `BarraFiltros` · filtros en la URL
**Finalidad.** Sustituir la cadena «Aplicar filtros» copiada en cinco sitios (`07` · FE-05) y cumplir `06` §4, regla 5.
**Anatomía.** `<form method="get" role="search">` con búsqueda, selectores nativos y «Aplicar» · debajo, un chip por filtro activo (se quita con un clic) y «Limpiar».
**API.** `busqueda`, `filtros[]`, `conservar` (lo que no es filtro pero tiene que viajar: la cola, el orden), `hrefSin(nombre)`, `hrefLimpiar`, `enlace`.
**Estados.** Sin filtros activos: sin chips ni «Limpiar». Funciona sin JavaScript.
**Accesibilidad.** Etiquetas `sr-only` en cada control; los chips son enlaces con `aria-label="Quitar el filtro …"`; grupo «Filtros activos».
**Correcto.** La lista filtrada se comparte y sobrevive a recargar. **Incorrecto.** Estado local para filtrar; un botón «Aplicar» propio.
**Consumidor previsto.** Pagos y Clientes (fase 5).

## `EstadoChip` + `estadoUi(dominio, estado)` · UN chip de estado
**Finalidad.** Cerrar el solapamiento `Badge` / `StatusChip` / cinco envoltorios y los 54 mapas «estado → clases» (`07` · FE-03).
**Anatomía.** Punto + texto, sobre `StatusChip` (no lo duplica). El **texto** siempre dice el estado; el color no es el único portador (`10` §1, principio 3).
**Tonos.** `exito` · `aviso` · `peligro` (solo error o rechazo) · `info` · `pendiente` (token `--pending`, nuevo en Tailwind) · `neutro` (terminado, sin carga emocional).
**Contrato.** `estadoUi('membresia' | 'campana' | 'referido', estado, { cliente? })` → `{ label, tono }`. Un estado desconocido se muestra con su texto y tono neutro. Cada dominio nuevo se añade en `src/lib/estados.ts`, **no** en la pantalla.
**Correcto.** `const { label, tono } = estadoUi(...)` y `<EstadoChip tono={tono}>{label}</EstadoChip>`. **Incorrecto.** Un `Record<Estado, 'bg-… text-…'>` local; rojo para algo que no es un error.
**Consumidor previsto.** Las columnas `estado` de `Tabla` y los encabezados de detalle (fases 5–7). `Badge` queda para etiquetas que no son estados.

## `NavSeccion` + `pestanasVisibles` · pestañas de módulo
**Finalidad.** Sustituir `CrmTabs`, `ExcursionesTabs` y `VendedorTabs` (el mismo código de 25 líneas, `07` · FE-06) y habilitar el menú de 21 entradas (`03`).
**Anatomía.** `TabsNav` con contrato de panel: cada pestaña lleva su **ruta real** (`href`) y su **sección** de permisos; la activa lleva `aria-current="page"`.
**Permisos.** `NavSeccion` **no decide**: la página resuelve la sección una vez y filtra con `pestanasVisibles(items, permitida)` antes de pintar. La barrera sigue siendo la guarda de servidor de cada ruta.
**Responsive.** Desplaza en horizontal, sin barra visible.
**Correcto.** Una pestaña por ruta existente; ninguna sección renombrada. **Incorrecto.** Decidir visibilidad por rol a mano; una pestaña que cambia una URL.
**Consumidor previsto.** La consolidación de navegación (fase 6).

## `SelectorColor` · paleta cerrada
**Finalidad.** Un solo selector para el color de empresa, con paleta cerrada y contraste dicho (`04` · F-07). Hoy el color se pide en tres sitios, uno con el azul retirado (`#2563eb`).
**Anatomía.** Radios nativos (sin JavaScript, con teclado) · para el color guardado, «Pasa AA / No pasa AA» y el contraste de su tinta.
**Datos.** La paleta sale de `PALETA_MARCA_EMPRESA` y `paletaDeMarca()` en `src/lib/company-branding.ts`, que ya es el único sitio autorizado a escribir hexadecimales y decide la tinta con `brandDisplayForeground`. **El paquete no escribe ni calcula un solo color.** La persistencia sigue siendo `normalizeCompanyBrandColor` / `withCompanyBrandColor`.
**Correcto.** El color de una empresa colorea **sus** objetos (tarjetas, QR, comprobantes). **Incorrecto.** Usarlo para colorear la interfaz del panel.
**Consumidor previsto.** Empresa › Perfil público (fase 7), Planes y Personalización.

## `BarrasSimples` · gráfica accesible
**Finalidad.** Sustituir las barras `div` sin eje, sin valor y sin alternativa (`05` · D-13; `02` · U-02).
**Anatomía.** Eje con 0, la mitad y el tope (múltiplo de 4: la mitad es entera) · barras · valor del pico escrito · etiquetas cada N barras · «Ver como tabla» con los datos.
**Estados.** Sin datos (vacío o todo ceros): un mensaje, no barras de altura cero.
**Responsive.** HTML y CSS, **no** un SVG escalado: el texto mide siempre 12 px reales (el prototipo escalado lo encogía en móvil).
**Accesibilidad.** `role="img"` con todos los valores en `aria-label`; tabla alternativa; cifras tabulares.
**Cuándo no.** Series largas o interactivas: `ReporteChart` (Recharts) cargado de forma diferida.
**Consumidor previsto.** Resumen (fase 5).

## `PageHeader` · cabecera (ampliada)
**Finalidad.** Una sola cabecera de página en lugar de tres sistemas y 17 variantes de `<h1>` (`07` · FE-02).
**Nuevo (todo opcional).** `icon` (decorativo, oculto a lectores) · `breadcrumbs` (nodos ya armados dentro de `<nav aria-label="Migas de pan">`) · `badge` (un `EstadoChip` junto al título) · `back` · `variant="formulario"` (se alinea con la columna de 720 px).
**Garantía.** Sin las props nuevas la salida es **idéntica** byte a byte (`tests/primitivas-panel.test.ts`). El tamaño y peso nuevos del título (24/32, 600) no están aquí: salen de `.panel-ds`.
**Responsive.** El título ajusta en varias líneas con `text-wrap: balance`; nunca se trunca.

## `StatCard` · tarjeta de cifra (variante `panel`)
**Finalidad.** Una sola tarjeta de cifra en lugar de `StatCard` + 24 funciones locales (`07` · FE-04).
**Variante `panel`.** Plana, con borde, **una sola talla de cifra** (`.text-kpi`, 28/32 → 24/28 en móvil). Props propias: `ventana` (el periodo, escrito), `unidad`, `pie` con tono (`exito`/`aviso`/`neutro`) y `sinPermiso`.
**`sinPermiso`.** Pinta «Sin permiso» y **no renderiza `value`**: el servidor ya debió dejar de calcularlo (`05` · D-01); esto solo evita un hueco mudo.
**Garantía.** La variante `clasica` (por defecto) no cambia.
**Correcto.** Toda cifra con su ventana («1–20 oct 2026», «últimos 30 días»). **Incorrecto.** Una cifra sin periodo; ingresos del mes junto a «nuevos» de 30 días rodantes.

## `StatusChip` y `TabsNav` · cambios mínimos
`StatusChip` gana el tono `pending`. `TabsNav` entrega `aria-current` al renderizador; quien no lo propaga pinta lo mismo que antes (los 13 usos actuales desestructuran solo `className` y `children`).

---

## Tokens del panel
- **`.panel-ds`** (`globals.css`): Inter (`--font-panel-inter`), base 14/20, cifras tabulares; `text-h1` 24/32 · 600 (20/28 bajo 640 px), `text-h2` 18/24 · 600, `text-h3`/`text-h4` 16/22 · 600, `text-body` 14/20, `text-small` 13/18, `text-caption`/`text-overline` 12/16. **Definido y apagado:** nada lo aplica. Encenderlo es un cambio en `AppShell` (ver `src/components/layout/fuente-panel.ts`) y `tests/panel-ds.test.ts` obliga a hacerlo a propósito.
- **`.text-kpi`**: la cifra de KPI. (`--color-pending` **ya estaba** expuesto a Tailwind antes de la fase 4; no se añade nada.)
