# Fidelidad a Stitch · matriz pantalla por pantalla

Los diseños son la especificación obligatoria, no una referencia aproximada.
Viven versionados en `docs/transformacion-membego/stitch/` (12 pantallas +
`retail_commercial_mobile/DESIGN.md`). Antes solo existían en el Escritorio.

Decisión del usuario (2026-09-08): **exactamente este diseño**. Los colores más
vivos son una conversación posterior; ahora no se añaden.

---

## 1. Las doce pantallas y a qué corresponden

| Stitch | Ámbito | Ruta MEMBEGO | Estado |
|---|---|---|---|
| `inicio_membego` | Cliente | `/cliente/inicio` | Construida · **fidelidad parcial** |
| `cuenta_membego` | Cliente | `/cliente/perfil` | Construida · fidelidad por auditar |
| `men_membego` | Cliente | `/cliente/menu` | Construida · **fidelidad alta** |
| `mi_qr_sin_beneficio_membego` | Cliente | `/cliente/qr` | Construida · fidelidad por auditar |
| `editor_de_inicio_de_la_app_membego` | Admin | `/admin/personalizacion` | Construida · **falta la carcasa hub** |
| `resumen_administrativo_membego` | Admin | `/admin/dashboard` | No abordada (F3+) |
| `gesti_n_de_membres_as_y_planes_membego` | Admin | `/admin/planes`, `/admin/membresias` | No abordada (F4) |
| `centro_de_canjes_y_validaci_n_qr_membego` | Admin | `/admin/scanner` | No abordada (F4) |
| `pagos_y_comprobantes_membego` | Admin | `/admin/pagos`, `/admin/conciliacion` | No abordada (F6) |
| `marketing_y_notificaciones_membego` | Admin | `/admin/campanas`, `/admin/notificaciones` | No abordada (F7) |
| `prospectos_y_crm_membego` | Admin | `/admin/crm`, `/admin/clientes` | No abordada (F7) |
| `fidelizaci_n_y_crecimiento_membego` | Admin | `/admin/gamificacion`, `/admin/referidos`, `/admin/regalos` | No abordada (F7) |

**D04 queda cancelada.** Decía que los módulos administrativos sin pantalla de
Stitch se derivarían del sistema. Sí las hay: siete. Se usan.

## 2. La arquitectura administrativa, confirmada por los diseños

El `code.html` del resumen trae la navegación completa del hub, y coincide casi
literalmente con la agrupación que el encargo proponía:

```
PRINCIPAL           Resumen
EXPERIENCIA CLIENTE Editor de Inicio · Navegación · Cerca de ti · Mi QR
CATÁLOGO            Membresías(8) · Beneficios · Ofertas(Hot) · Servicios · Excursiones
OPERACIONES         Canjes y QR(14) · Reservas y Citas · Pagos & Facturación
CLIENTES            Directorio · Segmentos · En Riesgo(3)
MARKETING           Campañas · Banners · Fidelización
ANALÍTICA           Métricas · Ingresos · Rendimiento
AJUSTES             Empresa · Sucursales · Roles y Permisos
```

Los contadores junto a las etiquetas (8, 14, 3, «Hot») son datos vivos, no
adorno: cada uno necesita su consulta o no se pinta (D08).

## 3. El sistema visual: lo que acertamos y lo que no

**Acertado en F1.** La paleta es exactamente la nuestra: `#0284C7` primario,
`#0369A1` estados activos, `#06B6D4` acento, `#F0F9FF` barra de ubicación,
`#F59E0B` estrellas, `#111827` texto, `#E5E7EB` bordes, Inter. El degradado de
cabecera `#0284C7 → #06B6D4` y el dock de 4 destinos también.

**No acertado — y hay que corregirlo:**

| Elemento | Stitch | Nuestro | Acción |
|---|---|---|---|
| Radio de tarjeta | **8px** (`0.5rem`) | `rounded-xl` = 12px | Bajar a 8px |
| Botón primario | **Píldora** (9999px), alto 36–40px | `rounded-lg` | Convertir a píldora |
| Botón secundario | 8px + borde 1px | variado | Unificar |
| Chips de filtro | Píldora, borde `#E5E7EB`, 13px/500 | no existen | Crear |
| Sombra de tarjeta | `0 1px 2px rgb(0 0 0 / .05)` | `elevation-1` | Verificar equivalencia |
| Barra de ubicación | alto 36px | `py-2` libre | Fijar 36px |
| Buscador | alto 44–48px, borde `#CBD5E1` | 44px, borde `--border` | Ajustar borde |
| Dock inferior | 56px | `--dock-inferior` | Verificar |

**Nota de contraste.** El DESIGN.md manda el banner de ofertas con degradado
`#0284C7 → #0369A1`. Con texto blanco eso da entre **4.10:1 y 5.93:1**: el
extremo claro no llega al 4.5:1 que WCAG AA pide para texto normal. Nuestro
azul sólido `#0369A1` (5.93:1) cumple en todo el banner. **Se conserva el
sólido** salvo que decidas priorizar el degradado sobre la accesibilidad; es la
única desviación deliberada del diseño y queda anotada aquí.

## 4. `/cliente/inicio` · brecha detallada

El esqueleto y el orden de bloques coinciden. Falta densidad — que es
justamente lo que define este diseño.

| Bloque | Falta respecto a Stitch |
|---|---|
| Categorías | Es una fila de **píldoras con icono en cuadro redondeado y etiqueta debajo**, con scroll horizontal y una píldora «Todos». Hoy es una retícula plana. |
| Hero | Falta el **badge de ubicación** («Higüey»), el **badge sobre la imagen** («Hasta 40% ahorro en membresía»), la **fila de precio** («Planes desde RD$1,850/mes») y el CTA en píldora. La segunda tarjeta debe **asomar** por el borde. |
| Empresas destacadas | Faltan «Ver todas ›», badges **«Abierto ahora»** y **«2 planes»**, **estrellas + nº de reseñas**, la **fila de chip de beneficio** con botón circular, y el botón **«Explorar más de N empresas asociadas ›»**. |
| Membresías | Faltan badges (**«Popular»**, **«VIP Gastronómico»**), **precio tachado** anterior, y el **botón píldora «Unirme» a todo el ancho**. Hoy hay un botón circular. Falta **«Ver todas las N membresías activas ›»**. |
| Experiencias | Stitch es una **lista vertical** con miniatura, badge de duración («Full Day», «4 horas»), precio y píldora «Reservar cupo». Hoy es una retícula. |
| Código de comercio | **No existe.** Tarjeta «¿Tienes un código de comercio?» con píldora «Ingresar» y el texto del PIN en tienda. Es una capacidad nueva, no solo visual. |

Las estrellas, las reseñas, «Abierto ahora», los cupos y el precio anterior son
**datos**, no decoración: cada uno necesita su fuente o el elemento no se pinta.
Eso es trabajo de backend, no de CSS, y por eso este no es un retoque.

## 5. Lo que la fidelidad reabre

- **D09 se revierte.** `cuenta_membego` **sí** lleva campana de notificaciones
  con punto rojo, y también la píldora **DO / ES**. Se omitieron por no tener
  centro de notificaciones ni i18n. Vuelven a estar en alcance: la campana con
  F7, la píldora cuando haya i18n real. Hasta entonces no se pinta ninguna de
  las dos (D08 manda sobre la fidelidad cuando el dato no existe).
- **D03 se amplía.** No es solo `/superadmin`: los diseños definen la carcasa
  del **hub administrativo** completo (barra lateral agrupada, selector de
  empresa, barra superior con búsqueda, turno, «Canje Rápido», notificaciones).
  Eso es fundamento de todas las pantallas admin, así que sube de F8 a **F3**.

## 6. Criterios de aceptación de fidelidad

Por pantalla, y en los tres anchos (**390 / 768 / 1280**):

1. Mismos bloques, en el mismo orden, con la misma jerarquía.
2. Radios, altos de barra y espaciados según §3.
3. Sin desbordamiento horizontal (ya automatizado en el E2E).
4. Contraste **WCAG AA** en todo texto; cualquier desviación del diseño por
   accesibilidad se anota aquí con su medición.
5. Ningún elemento con dato inventado: si no hay fuente, no se pinta.
6. Captura comparada contra `stitch/<pantalla>/screen.png` antes de cerrar.

---

## 7. Pase de fidelidad del Inicio · ejecutado (2026-09-08)

### 7.1 Forma

- **Radio de tarjeta a 8px** en todo el Inicio (`rounded-lg`), como manda §3.
  Los `rounded-xl` que quedan viven en los tres buscadores muertos que hereda
  F3.
- **Botones primarios en píldora** (`rounded-full`, alto 40–44px): «Unirme»,
  «Reservar cupo», «Ver oferta», el CTA de la experiencia y el del estado
  vacío de la wallet.
- **Escala `label-*` y `price-*`** añadida a `globals.css`. Una desviación
  anotada: Stitch pone `label-sm` en 11px y aquí es 12px, porque el suelo de
  12px de este sistema salió de una auditoría de 218 tamaños a mano y bajarlo
  reabre lo que esa decisión cerró.
- **`RetailSeccion`**: cabecera de sección con «Ver todas ›», pie de sección a
  todo el ancho y la valoración con reseñas. El patrón se repetía en cinco
  sitios.

### 7.2 Bloques rehechos

| Bloque | Qué cambió |
|---|---|
| Categorías | Fila de píldoras con icono en cuadro de 8px y etiqueta debajo, scroll horizontal y píldora «Todos» al cierre. |
| Hero | Sello de ciudad, fila «Planes desde …» (del plan más barato de esa empresa), CTA en píldora, y la siguiente tarjeta **asoma** al 85 % del ancho. En escritorio las tarjetas se reparten la fila en vez de dejar dos tercios vacíos. |
| Empresas destacadas | «Ver todas ›», sello de ciudad, sello «N planes», **valoración con número de reseñas**, chip del plan más barato, y pie «Explorar más de N empresas asociadas». |
| Membresías | Botón **«Unirme» en píldora a todo el ancho**, precio en `price-lg` con su periodo, pie «Ver todas las N membresías activas». Sin arte no se reserva el hueco de la imagen. |
| Experiencias | **Lista vertical** con miniatura, **sello de duración**, precio con «Precio socio Membego» y píldora «Reservar cupo». |

### 7.3 Los datos que faltaban, y de dónde salieron

`modules/home/vitrina.ts`:

- **Reseñas**: existía `CompanyRating` y nadie lo contaba. Un `groupBy` por
  lote, solo para las empresas que se pintan.
- **Planes por empresa**: otro `groupBy` del mismo lote.
- **Totales de la vitrina**: `count` de empresas publicadas y planes activos,
  cacheados 10 min con la etiqueta del marketplace. Los números de los botones
  son reales.
- **Duración legible**: de `duracionMin`, que ya existía. A partir de 7 h dice
  «Full Day», como lo vende el negocio.

No se amplió `getCompaniesPublic`: su forma la comparten marketplace,
explorador y landing, y va cacheada; dos agregados más ahí los pagarían todas
esas pantallas sin enseñarlos.

### 7.4 Un defecto de modelado que salió al separar los tipos

Había una sola `TarjetaInicio` para empresas, planes y excursiones. En la
tarjeta de empresa `titulo` y `empresa` eran el mismo nombre, y la pantalla lo
pintaba **dos veces** —sobretítulo y título— porque el tipo no distinguía «de
quién es esto» de «qué es esto». Ahora hay `EmpresaInicio`, `PlanInicio` y
`ExperienciaInicio`, cada una con los hechos que su tarjeta enseña.

### 7.5 Lo que sigue faltando, y por qué no es CSS

Cinco elementos del diseño necesitan un dato que **no existe**. Ninguno se
pinta inventado (D08):

| Elemento | Qué falta | Decisión pendiente |
|---|---|---|
| «Abierto ahora» | `Company.horario` es texto libre («Lun-Vie 8:00-18:00 · Sáb…»). No se puede saber si está abierto. | Modelar horarios por día, o retirar el sello del diseño. |
| «Popular» / «VIP Gastronómico» | `Plan` no tiene distintivo. | Campo de distintivo administrable, o derivarlo de suscripciones. |
| Precio anterior tachado | `Plan` no tiene precio anterior. | Campo `precioAnterior` con vigencia, atado a promociones. |
| «Hasta 40% ahorro» sobre el hero | El slide del hero no tiene ese campo. | Añadirlo al esquema del hero y al editor. |
| «¿Tienes un código de comercio?» | Capacidad inexistente: canjear un PIN de tienda para afiliarse. | Recorrido nuevo completo (modelo, acción, pantalla admin que emite el PIN). |

Los cinco son trabajo de modelo y de pantalla administrativa, no de estilos.
Se abordan con su dominio: los tres primeros en **F4** (membresías y planes),
el del hero en **F3** junto al editor, y el código de comercio como corte
propio porque incluye emisión, validación y auditoría.

**Verificación:** `tsc` 0 · `eslint` 0 errores · **suite 1966/1966** · `build`
compilado · E2E autenticado en verde · capturas 390/768/1280 sin desbordamiento.

---

## 8. Cuenta y Mi QR · pase de fidelidad (2026-09-08)

Ambas tenían la estructura correcta desde F1. La brecha era de forma y, sobre
todo, dos fallos silenciosos que solo se ven mirando una captura.

### 8.1 Cuenta (`/cliente/perfil`)

- **23 tamaños escritos a mano** (`text-[18px]`, `text-[13px]`…) migrados a la
  escala del sistema. Once radios `rounded-xl` bajados a 8px.
- **Contraste**: el chip activo, «Ver QR y uso» y el banner comercial usaban
  blanco sobre `#0284C7` — **4.10:1**, por debajo de AA. Ahora usan el azul
  profundo (**5.93:1**), que además es el que el diseño pinta en esos tres
  sitios: corregirlo fue a la vez más accesible y más fiel.
- La campana y la píldora DO/ES siguen omitidas (D09 + D08): no hay centro de
  notificaciones ni i18n reales, y un adorno sin función no es fidelidad.
- «Usar de nuevo» solo aparece con historial de visitas; en la captura de QA no
  sale porque la persona no tiene ninguna.

### 8.2 Mi QR (`/cliente/qr`)

El estado vacío se extrajo a `components/cliente/qr/QrSinBeneficio.tsx`:

- Sello de descuento sobre la imagen, **desde `descuento` declarado**. El
  precio anterior tachado del diseño NO se pinta: reconstruirlo desde el
  porcentaje sería inventar un número que nunca se registró.
- Barra de acento a la izquierda en el beneficio de bienvenida, insignia en el
  icono del estado vacío, valoración con reseñas reutilizando `RetailSeccion`,
  y la ciudad real en la bajada.
- `<img>` crudo sustituido por `next/image`.
- El pase activo (derivado, D01) adopta la misma escala y los mismos radios.

### 8.3 Dos fallos silenciosos de estilo

1. **`bg-primary-soft` no existe.** El tema registra ese color como
   `--color-brand-primary-soft`, así que la clase corta compila, no avisa y no
   pinta nada. El icono de Mi QR salió sin su fondo y **la franja de ofertas
   relámpago del Inicio sin el suyo**. Lo mismo con `bg-primary-hover`, en
   nueve sitios: el hover de todos los botones primarios del rediseño no hacía
   nada. Corregido, y con guardia en `cliente-retail.test.ts` para que no
   vuelva en silencio.

2. **Las capturas salían a medio fundido.** `animate-fade-up` seguía corriendo
   cuando Playwright disparaba, y la pantalla se veía descolorida. Ahora las
   capturas van con `animations: 'disabled'`: una comparación de fidelidad no
   puede depender de cuándo se apretó el botón.

### 8.4 Una fixture que se quedaba puesta

Visitar Cuenta le asigna a la persona su código corto de referido, y eso deja
eventos colgando de `Cliente`. La limpieza del E2E moría con una clave foránea
y **dejaba todas las fixtures en la base**. Corregido el orden de borrado; las
que quedaron de esa corrida se retiraron.

El E2E ahora captura **las tres pantallas** en los tres anchos, y comprueba el
desbordamiento en cada combinación — no solo en el Inicio.

**Verificación:** `tsc` 0 · `eslint` 0 errores · **suite 1967/1967** · `build`
compilado · E2E autenticado en verde · 9 capturas sin desbordamiento.
