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

---

## 9. F3 · La carcasa del hub administrativo (2026-09-08)

### 9.1 De nueve espacios a una columna con ocho grupos

El panel de empresa era un riel de dos niveles con nueve espacios. Los diseños
lo definen como **una columna** con ocho grupos rotulados. El riel no se
retira: sigue siendo el mecanismo para quien tenga varios espacios, y el
cliente lo conserva. Lo que cambia es que el ámbito de empresa pasa a tener uno
solo, y `menuEnUnaColumna` ya sabía qué hacer con eso — la plataforma llevaba
tiempo pintándose así.

**El reparto era lo delicado, no la estructura.** La barra lateral del diseño
enseña los ~20 módulos de la empresa que sirvió de ejemplo; MEMBEGO tiene 37.
Adoptar esa lista al pie de la letra habría escondido 17 módulos que funcionan.
Se adopta la ESTRUCTURA y cada módulo entra en su grupo. Tres guardias nuevas
lo vigilan: los ocho grupos en orden, ningún módulo huérfano, ninguno duplicado.

### 9.2 Del diseño, lo que sí existe

- **Tarjeta de empresa** bajo la marca: nombre + «Sede <ciudad>». Sin ciudad
  enseña solo el nombre; no se inventa una sede.
- **«Canje rápido»** en la barra superior, comprobado contra el MISMO menú
  filtrado: un rol sin permiso sobre el escáner tampoco ve el atajo.
- **Tema claro por defecto.** Los doce diseños son claros y la app del cliente
  ya forzaba claro en `.retail`; el oscuro solo sobrevivía en el panel, así que
  había dos identidades según por qué puerta entraras. El toggle sigue y la
  elección persiste: quien prefiera oscuro no lo pierde.
- **Barra lateral clara.** Era navy profundo. Los tokens `--sidebar-*` del tema
  claro se recalcularon: sobre superficie clara el azul de marca sí llega a AA
  (4.6:1 contra blanco), así que el azul aclarado —que existía solo por el
  navy— deja de hacer falta. El navy sigue intacto en el tema oscuro.

### 9.3 Del diseño, lo que NO se pintó

| Elemento | Por qué |
|---|---|
| Píldora «Higüey Online · Turno Diurno» | No hay dato de turno ni de estado en línea para el ámbito de empresa. Existe `/admin/app/carwash/turnos`, pero es de un vertical, no del hub. |
| Contadores junto a los grupos (8, 14, 3, «Hot») | El mecanismo de insignias existe (`badgesDeNavegacion`) y hoy alimenta cinco claves reales. Las del diseño son otras; cada una necesita su consulta antes de pintarse. |
| Navegación · Cerca de ti · Mi QR (empresa) | Módulos administrativos que no existen. Son capacidades nuevas, no enlaces. |
| Servicios · Ingresos · Rendimiento | Ídem. |
| Pie con razón social y RNC | El RNC no está en el modelo de empresa. |

**Verificación:** `tsc` 0 · `eslint` 0 errores (2 avisos preexistentes) ·
**suite 1970/1970** · `build` compilado · E2E autenticado en verde, con el hub
comprobando sus rótulos de grupo.

---

## 10. Corrección de rumbo: construir el diseño, no empujar lo que había (2026-09-08)

El usuario señaló, con razón, que el hub construido era «muy distinto» al de
Stitch. El fallo era de método: se estaban acercando los componentes
existentes al diseño en vez de construir lo que el diseño dibuja. Este pase
rehace la carcasa y el editor contra la captura, pieza por pieza:

- **Columna**: marca «MEMBEGO / Admin Hub», tarjeta de empresa con sede (el
  conmutador REAL cuando hay ≥2 empresas — se movió del cuerpo del contenido a
  la columna), contadores junto a los módulos (`planesActivos`, `canjesHoy`:
  conteos baratos cacheados 60 s; los caros siguen fuera por la regla de coste
  de `badges.ts`), tono rojo reservado para avisos, y pie con la empresa y el
  cierre de sesión.
- **Cabecera**: buscador ancho en píldora, «Canje rápido», y la persona con su
  nombre y su rol. La píldora de empresa se retiró: ya vive en la columna y
  solo le robaba ancho al buscador.
- **Editor de inicio**: misma lógica, mismos ids (los usa el E2E), pantalla
  nueva. Tarjeta de territorio con sobretítulo; «Producción en Vivo ·
  Sincronizado hace N min» del `updatedAt` real; píldoras Borrador / Programar
  / Publicar en App; cada bloque del feed como fila con candado o asa, número,
  chip de tipo (SISTEMA · EN EDICIÓN · PÍLDORAS · GEO N KM · MONETIZACIÓN ·
  CANJE INMEDIATO · CATÁLOGO), resumen hecho de DATOS REALES (banners que hay,
  categorías publicadas, planes con su precio, excursiones del catálogo) e
  interruptor; el hero se edita una diapositiva a la vez con «Banner N de M»;
  la segmentación son tres tarjetas con el valor grande; y la vista previa
  vive dentro de un teléfono con bisel, con su dock.
- Las métricas del diseño sin fuente (impresiones, CTR, «18.4%») **no se
  pintan**: un número inventado en un panel es peor que ninguno.

Verificación: `tsc` 0 · `eslint` 0 · suite **1970/1970** (la guardia de deuda
de diseño obligó a expresar el bisel con el vocabulario de radios) · build ·
E2E en verde sin cambiar un id.

---

## 10. F3 · Resumen Operativo (2026-09-09)

`/admin/dashboard` se rehizo contra `stitch/resumen_administrativo_membego`.
Cada cifra tiene consulta; del mockup no se copió ningún número.

**Datos añadidos a `getDashboardEjecutivo`** (no a la pantalla): cobrado del
mes anterior completo (base del «% vs mes anterior», que antes no existía),
top 2 de planes por membresías vigentes, monto declarado y última de las
transferencias por validar (con `whereTransferencias`, el criterio
centralizado), nombres de quienes vencen en 7 días (pila de avatares) y citas
de hoy en el calendario del negocio.

**«Estado en App Móvil» es real**: enseña la revisión PUBLICADA —estado,
territorio, titular del hero sobre el degradado del cliente— y sin composición
lleva al editor. El E2E cierra el circuito editor → dashboard: publica y
comprueba «Público Ahora» con el titular recién publicado, y captura
`admin-resumen-1280.png`.

**No se pintó** (sin fuente): capacidad de bahía, tiempo promedio de servicio
y tasa de conversión del pie del gráfico — su lugar lo ocupan las referencias
reales del período. La píldora «Pico: <día>» sí, porque se deriva de la serie.

**Conservado**: checklist de perfil, recomendaciones del sistema, atajos de
pagos y notificaciones, y los avisos que solo hablan cuando hay algo (>0).

**Verificación:** `tsc` 0 · **suite 2028/2028** (incluye el arnés visual
nuevo) · `build` compilado · E2E autenticado en verde con la aserción nueva.

---

## 11. El Inicio del diseño pasa a ser el estado por defecto (2026-09-09)

**El usuario tenía razón otra vez, y era de arquitectura.** El Inicio de Stitch
solo aparecía si la empresa activa tenía una composición PUBLICADA que además
admitiera a la persona. En su base real —donde ninguna empresa ha publicado—
el diseño no lo veía nadie: todo el mundo caía al respaldo de ofertas, que era
la pantalla vieja con otro nombre. El rediseño quedaba condicionado a un acto
administrativo que quizá nunca ocurre.

**Corrección (segunda de D10):** `getInicioVista` SIEMPRE devuelve los siete
bloques del contrato. Por defecto se arman con el marketplace —cada sección de
su consulta real, y el hero desde las promociones destacadas, enriquecido con
la ciudad y el plan más barato de su negocio—. La composición publicada no
habilita el diseño: **lo cura** (qué bloques, en qué orden, con qué banners
propios, para qué audiencia). Si la segmentación no admite a la persona, cae
al defecto, no a la nada.

**Retirados:** `RetailOfertas` y `OfertasParaTi` (el respaldo). El feed
personalizado que servían sigue viviendo en `/cliente/promociones`, que es su
pantalla. `PanelPersonal` deja de cargar `getPromoFeed` en cada visita.

**Evidencia:** el E2E ahora pausa la composición y comprueba que el cliente
siga viendo «Membresías recomendadas» y «Empresas destacadas» — el fallo
exacto que el usuario vio no puede volver sin ponerse en rojo. Captura:
`inicio-defecto-390.png`. Suite 2046/2046 · `tsc` 0 · build compilado.

---

## 12. Vida (sin gris) y el perfil de la promoción (2026-09-09)

Dirección nueva del usuario, con Amazon como referencia: fuera el gris de
fondo, la imagen manda sobre el botón, y cada promoción o membresía con su
propio perfil (galería, descripción, reseñas).

### 12.1 Vida

- Bandas de sección `bg-muted` (gris) → `bg-retail-mist` (#F0F9FF, el tinte de
  marca que ya definía el DESIGN.md para la barra de ubicación).
- **El hero se tiñe con el color de marca del negocio** (`colorPrimario`, dato
  real, al 9 % de opacidad) — el equivalente honesto de cómo Amazon tiñe cada
  campaña con su arte. Sin color declarado, tarjeta blanca. Vale para el hero
  por defecto y para el compuesto.
- Estados vacíos y placeholders: blanco con borde o tinte de marca, no gris.

### 12.2 La imagen manda

- Tarjetas de membresías y del catálogo de Mi QR: **la tarjeta entera es el
  enlace** y los botones «Unirme» / «Ver beneficio» se retiran. Un botón por
  tarjeta pedía compromiso antes de dar información; el detalle es quien pide.
- El hero conserva su CTA: es el único banner y el diseño lo trae.

### 12.3 El perfil de la promoción

- **Galería**: `Promocion.imagenes` existía en el modelo y ninguna pantalla lo
  enseñaba. `GaleriaPromocion` (imagen grande + miniaturas) aparece con 2+
  imágenes; con una, la portada de siempre.
- **Reseñas**: `getResenasEmpresa` — promedio y total de `CompanyRating`
  visibles, y los últimos 5 comentarios con nombre de pila + inicial. La
  sección se titula «Reseñas de clientes de {empresa}» a propósito: reseñas
  POR PLAN no existen todavía, y etiquetarlas como si lo fueran sería
  inventar una fuente. El modelo por plan queda para F4.
- Estrellas junto al nombre de la empresa en la cabecera del perfil.
- Corregido de paso: un título con una palabra más ancha que el móvil
  desbordaba la página entera (`break-words`), y el E2E ahora afirma la
  ausencia de desbordamiento también en el perfil.

**Evidencia**: el E2E entra al perfil desde el hero y comprueba galería
(3 miniaturas), estrellas y el comentario real del cliente QA. Captura
`promo-perfil-390.png`. Suite 2048/2048 · `tsc` 0 · build compilado.

---

## 13. Cinco empresas demo con todo lleno (2026-09-09)

`scripts/sembrar-demo.mts` siembra el marketplace de presentación que el
usuario pidió: AquaShine Car Spa, La Braza Grill House, Caribe Aventura Tours,
Bella Vita Spa y Fade Masters Barbershop. Cada una con perfil público completo
(ningún campo visible vacío), 3 membresías, 5 promociones con galería, 1
relámpago con vigencia corta, 5 reseñas con comentario, y 108 imágenes PNG
generadas con `sharp` desde SVG con la paleta de cada negocio (en
`public/demo/`). El de tours trae 3 excursiones con variantes. Idempotente;
`--limpiar` lo retira todo por el prefijo `demo-`.

`esDemo: false` a propósito: la vitrina excluye las demo y verlas es el único
motivo de que existan. Aceptable SOLO porque la base es desechable.

### Lo que la siembra destapó (tres fallos reales)

1. **Decimal fuera del borde.** `getCompaniesPublic` devolvía `averageRating`
   como Decimal de Prisma bajo un cast que juraba `number`. Crudo tiene
   `.toFixed`; tras `unstable_cache` se vuelve string y **el Inicio entero
   caía al límite de error** — solo con empresas valoradas (desde la siembra) y
   solo en cargas cacheadas: intermitente puro. Normalizado en la fuente
   (lista y detalle) y `RetailValoracion` endurecido: formatear jamás tumba la
   pantalla que enseña la cifra.

2. **Los `sr-only` escapaban del recorte.** `position:absolute` no lo recorta
   un ancestro `overflow-hidden` sin posicionar, y el `template` del cliente
   (animado, con transform) era su contenedor: los sr-only de las tarjetas
   desplazadas del carrusel anclaban a x≈1400 y **ensanchaban la página** — a
   partir de 6 tarjetas, o sea, desde la siembra. Todos los carriles con
   scroll horizontal son ahora `relative`: cualquier absoluto ancla dentro de
   su recorte. La sonda del E2E aprendió a nombrar culpables (rects, cadena de
   propagación y flotantes que escapan).

3. El paso del perfil en el E2E asumía que la promo QA encabezaba el hero; con
   un marketplace lleno el orden es del marketplace. Ahora va directo por id.

**Verificación:** suite 2048/2048 · build compilado · E2E completo en verde
sobre el marketplace sembrado.

---

## 14. F3 · Descubrimiento, primera mitad (2026-09-09)

Sin pantalla de Stitch propia, estas se DERIVAN del lenguaje que el Inicio
estableció (la misma regla que D04 en admin). Decisión de arquitectura: no se
crearon tarjetas paralelas — se restilizaron las COMPARTIDAS conservando su
API, y el retail se propagó a todas las pantallas que ya las usaban (catálogo,
buscador, explorador y landing pública de una vez).

- **`PromotionCard`**: era un anuncio estilo Temu (degradados de relleno, CTA
  gigante «Aprovechar ahora» por tarjeta). Ahora: arte 1:1, tarjeta entera
  enlace, sellos funcionales (descuento, Destacada, Por vencer, Agotada,
  Expirada), contador en vivo <72 h, código y precio. Sin botón: el
  compromiso se pide en el perfil, que ya tiene con qué.
- **`BusinessCard`**: guiada por imagen como la tarjeta del Inicio — banner
  16/10 con ciudad y Destacada, logo, valoración, stats y el chip del plan más
  barato. «Ver membresías» se retira; el slot de seguir sigue clicable por
  encima de la capa-enlace.
- **Catálogo `/cliente/promociones`**: rejilla densa 2→4 columnas, chips con
  activo en azul profundo (AA), carriles `relative`. Toda la lógica intacta:
  feed curado, búsqueda con privadas de mis empresas, guardadas.
- **Explorar `/cliente/explorar`**: mismos chips y tarjetas; seguir intacto.
- **Corregido**: los enlaces «Ver todas / Explorar más» del Inicio apuntaban a
  `/cliente/empresas` (MIS empresas) en vez de al directorio `/cliente/explorar`.
- **`/cliente/cerca`**: sus márgenes negativos replicaban el AppShell del
  personal (`px-8/py-8`); desde F1 el cliente vive en CustomerShell
  (`px-4 py-4 lg:px-6`) y el mapa quedaba descuadrado. Sincronizados.
- El E2E captura y vigila desbordamiento también en promociones y explorar.

**Pendiente de F3**: `/cliente/buscar` (las tarjetas ya son retail vía los
componentes compartidos; falta su carcasa/filtros), el perfil de empresa
(`CompanyProfile`, 864 líneas — funcionalmente completo, lenguaje viejo) y la
pantalla de sinónimos.

**Verificación:** suite 2048/2048 · build compilado · E2E completo en verde.

---

## 15. F3 · Perfil de empresa en retail (2026-09-09)

`CompanyProfile` (ambos modos: landing pública y `/cliente/empresas/[slug]`)
pasa al lenguaje retail conservando la API completa y toda la funcionalidad
(sucursales con activa, elegibilidad de planes, `ctaSlot`/`relacionSlot`,
seguir/compartir, posts, actividades, galería, reseñas + formulario).

- **Banner**: fuera el degradado esmeralda/pizarra oscuro; la imagen de la
  empresa se enseña tal cual con un velo solo abajo, donde apoya la tarjeta.
  Sin banner, degradado de marca (`retail-deep → primary`). Píldora de volver
  clara (`bg-card/90`), no cristal blanco sobre oscuro.
- **Tarjeta de cabecera**: radio 8px + `elevation`, logo con borde `border-card`
  y respaldo `brand-primary-soft` (adiós `from-primary to-teal-500`), chips de
  datos NEUTROS con icono en color de marca (antes rojo/azul/ámbar cada uno
  gritando lo suyo), estrella `retail-star`, CTAs en píldora con
  `hover:bg-brand-primary-hover`.
- **Nav de secciones**: `bg-card/95` por token (era `bg-white/90` a mano),
  carril `relative`, hover `brand-primary-soft`.
- **Planes**: tarjeta 8px, precio `text-price-lg`, caja de usos en
  `retail-mist` (era gris), «Más popular» sobre `retail-deep` sin
  `shadow-glow`, CTA píldora (secundario = borde, no gris).
- **Beneficios/eventos/noticias/actividades/galería/información**: radios 8px,
  escala tipográfica del sistema, tile de fecha en `brand-primary-soft`.
- **CTA final**: `bg-retail-deep` plano (AA) en vez del degradado
  azul→índigo; botones píldora.
- **Piezas satélite** al mismo idioma: `SucursalesSection` (ficha 8px, activa
  con anillo primario), `ResenasSection` (estrellas `retail-star`, avatar
  `brand-primary-soft`, promedio blindado contra Decimal serializado),
  `FollowButton` y `ShareButton` (píldoras; favorita en `retail-star`).

Tres desbordes reales que la sonda del E2E destapó al añadir el paso del
perfil:

1. **`grid` sin plantilla base.** Sin `grid-cols-1`, la pista implícita es
   `auto` y respeta el min-content de la tarjeta más ancha: a 390px la rejilla
   de explorar medía 516px. `grid-cols-N` compila a `minmax(0,1fr)`, que
   recorta. Explicitado en explorar, planes, beneficios, eventos,
   actividades, información y sucursales.
2. **`flex-1` sin `min-w-0`** en la cabecera: a 768px el nombre imparable del
   fixture fijaba el ancho de la fila.
3. **Títulos sin `break-words`** (h1 y CTA final) con nombres largos.

La guardia del tema oscuro vetó `bg-white` sólido en el CTA final → `bg-card
text-primary`, que se adapta. El trinquete de deuda obligó a bajar el techo de
color crudo: **170 → 159** (el perfil devolvió 11 clases al vocabulario).

El E2E gana el paso `empresa-perfil` (capturas 390/768/1280 con sonda de
desbordamiento + cabecera, planes y la reseña real visibles; `exact: true`
porque el CTA «¿Te gusta…?» también contiene el nombre, y `.first()` porque el
formulario de reseña precarga el mismo comentario).

**Pendiente de F3**: carcasa/filtros de `/cliente/buscar` y la pantalla de
sinónimos.

**Verificación:** suite 2048/2048 · build compilado · E2E completo (8 pasos)
en verde · perfil público demo revisado a 375px en navegador.

---

## 16. F3 · El cierre del Inicio, calcado de Stitch (2026-09-09)

El usuario señaló que las secciones inferiores del Inicio «se ven mal
estructuradas»; se le enseñaron dos mockups (el primero, rechazado por no
seguir la línea de Stitch) y aprobó el segundo, calcado de las recetas de la
pantalla `inicio_membego`. Dos movimientos:

**Fuera «EN VIVO» (prueba social)** — por instrucción directa. Se retiró
completa: la sección del Inicio, la consulta del panel personal, el
componente, el módulo y el interruptor del panel de personalización del admin
(un mando sin sección detrás es un mando muerto). La clave `pruebaSocial` que
quede en JSON guardado se ignora; la guardia de capacidades ahora vigila que
el componente NO vuelva.

**El cierre del Inicio con las recetas de Stitch:**

- **Wallet vacía** → el banner comercial («Canje inmediato»): degradado
  `retail-blue → retail-lagoon` (token nuevo: el `secondary` #00687a de
  Stitch), sobretítulo en mayúsculas, título blanco, disco con el QR y
  píldora `bg-card text-primary` (nada de blanco fijo: en oscuro sigue
  legible). La tarjeta entera es el enlace. El error de wallet dejó el gris.
- **Novedades** → filas densas de «Experiencias y Excursiones»: miniatura de
  88px con el tipo en pastilla oscura, sobretítulo de la EMPRESA en
  mayúsculas (`text-overline text-retail-deep`), título de una línea, bajada,
  y la fila de dato (descuento formateado + «hasta el…», fecha-hora del
  evento, «Publicada el…») con la píldora clara de acción. Las promociones
  traen su arte real (`getNovedadesInicio` ahora selecciona imagen,
  descripción, descuento y vigencia); los posts llevan tesela con icono.
  Cabecera y pie con los patrones compartidos (`RetailSeccionHeader/Pie`).
- **«Descubre más» desaparece como cabecera**: queda la fila de «Regala
  beneficios, gana premios» con la receta de «¿Tienes un código de
  comercio?» — banda azul niebla, texto azul profundo, píldora «Compartir».

El trinquete de deuda bajó dos veces en el día: 170 → 159 (perfil) → 147
(fuera los degradados naranja/violeta de las tarjetas viejas de novedades).

**Verificación:** suite 2048/2048 · build compilado · E2E completo en verde ·
captura del Inicio (wallet vacía + novedades) revisada.

---

## 17. F3 · Cuenta y Configuración, pantallas separadas (2026-09-10)

Decisión del usuario: la Cuenta no debe cargar con las secciones de
configuración — el engranaje lleva a una pantalla propia. La captura de
Stitch (S02) enseña filas de «Configuración y soporte» al pie de Cuenta;
la instrucción del usuario manda sobre la captura en ese punto.

- **`/cliente/perfil` (Cuenta)** queda con lo que la persona USA: saludo con
  engranaje → `/cliente/ajustes`, teselas suaves (`retail-mist`, sin borde,
  como el diseño), pestañas con conteos, «Tus membresías» con la tarjeta del
  contrato (estado con punto, tesela de icono a la derecha y la fila del
  pase «Pase digital listo · Ver QR y uso» sobre azul niebla), banner azul
  profundo con el CTA a la derecha, «Usar de nuevo» guiado por imagen
  (logo o inicial sobre tinte), beneficios con teselas de marca, e «Invita
  amigos y gana» como banda suave.
- **`/cliente/ajustes` (Configuración, NUEVA)**: cabecera con volver, filas
  de soporte (servicio 24/7, métodos de pago, términos legales), Mi ID
  MembeGo, y los formularios movidos tal cual (Perfil, Seguridad, Mi
  ubicación, Mis vehículos, Privacidad) con «Cerrar sesión» en rojo al
  fondo. `ensureCodigoCorto` viaja con la tarjeta del ID.
- Migas y avisos actualizados: `/cliente/vehiculos` vuelve a Configuración,
  y la nota del Menú apunta a `/cliente/ajustes`.
- El E2E gana dos cosas: `ajustes` en el bucle de capturas (390/768/1280 +
  sonda de desbordamiento) y el paso que VIGILA la separación — en Cuenta no
  existen «Configuración y soporte» ni «Cerrar sesión», y en Configuración
  sí están el título y la sesión.

**Verificación:** suite 2048/2048 · build compilado · E2E completo (10
pasos) en verde · capturas de Cuenta y Configuración revisadas a 390px.

---

## 18. F3 · Buscar entra al lenguaje retail (2026-09-10)

Sin captura propia de Stitch: derivada del Inicio, con una regla ya conocida
aplicada de nuevo — **el buscador vive en la carcasa**. La página traía su
propia barra de «Volver al inicio», un hero con OTRO buscador (el de la
cabecera ya envía a `/cliente/buscar`) y contenedores `max-w-7xl` peleándose
con los del CustomerShell.

- La página ahora pone solo lo suyo: título con el conteo (`break-words`: el
  término de búsqueda es texto ajeno), **chips rápidos** de categoría y
  «Solo con cupos» (enlaces que conservan el resto de parámetros, activo en
  azul profundo como el catálogo), el panel de **filtros avanzados**
  (tarjeta 8px, rótulos en sobretítulo, hover azul niebla; plegable en
  móvil) y las tres secciones con las tarjetas compartidas — empresas y
  excursiones a 1→2→3 columnas, promociones densas a 2→3→4.
- **Dos vacíos distintos**: buscó y no hubo (se dice qué falló) ≠ aún no
  buscó (se invita al buscador de arriba); antes ambos decían «no hay
  contenido publicado», que era mentira. Sin materia que filtrar, el panel
  no se enseña.
- **`PromotionCard.esquinaLibre`**: el corazón de guardar (buscar y
  catálogo) tapaba el sello «Destacada» — ambos vivían arriba-derecha. Con
  la prop, los sellos bajan cuando la pantalla superpone la acción; el
  corazón pasa a tokens (`bg-card/95`, `fill-destructive`).
- Toda la lógica intacta: q/cat/emp/fd/fh/stock, excursiones vigentes,
  guardadas, «Ver todas» con contexto.
- El E2E captura buscar CON resultados (término del sinónimo QA) en los
  tres anchos con la sonda de desbordamiento — que ya pescó el primer
  fallo: el h1 sin `break-words`.

**Verificación:** suite 2048/2048 · build compilado · E2E completo en verde.

---

## 19. F3 · Sinónimos de búsqueda: la tabla gana pantalla (2026-09-10)

La tabla `busqueda_sinonimos` ya decidía búsquedas (el E2E la ejercita desde
el principio) pero solo se podía alimentar por SQL. Ahora tiene sus dos
pantallas, según la decisión del usuario — ámbitos separados con dueños
separados:

- **`/superadmin/busqueda`** (plataforma): sinónimos GLOBALES. Ítem
  «Búsqueda» en el grupo Operación del panel de plataforma.
- **`/admin/sinonimos`** (empresa): los suyos, que MANDAN sobre los
  globales para sus clientes (esa precedencia ya vivía en
  `equivalenciasPara`; aquí solo se administra). Ítem «Sinónimos de
  búsqueda» junto a Personalización (grupo Empresa y hub Experiencia
  cliente).
- Un solo panel (`SinonimosPanel`) para ambos: alta «Cuando busquen →
  Encuentra también» con la nota honesta de que el modelo guarda UNA
  equivalencia por término (guardar reemplaza), y la lista término →
  equivalencia con borrar. Las acciones llegan por props: la guardia de rol
  (SUPERADMIN / ADMIN_ROLES + companyId) vive en las server actions, y
  `eliminarSinonimo` verifica el ámbito de la fila antes de borrar.
- El E2E gana el paso: `/admin/sinonimos` enseña la fila QA sembrada — la
  misma que acaba de responder la búsqueda del cliente — y se captura a
  1280. (El ámbito global no se ejercita: el E2E no tiene identidad
  SUPERADMIN; queda anotado.) El paso devuelve el adminPage al editor,
  porque el paso siguiente pulsa su «Pausar» — primer intento en rojo por
  asumirlo.

**Verificación:** suite 2048/2048 · build compilado · E2E completo (10
pasos) en verde · captura revisada.

---

## 20. F4 · Planes entra al lenguaje retail (2026-09-10)

Arranca la F4 (membresías, pase y canje) por el primer paso del recorrido:
elegir plan. `/cliente/planes` hablaba el idioma «premium monocromo»
anterior a Stitch (foreground como único acento, radios de 16px, precio de
2.5rem a mano) y traía `<main class="container">` propio — un segundo main
anidado dentro del que ya pone el CustomerShell.

- **Página**: fuera el main/contenedor; cabecera con sobretítulo del
  sistema, título `text-h2` y las salidas («Otros negocios», «Mis
  membresías») en píldoras fantasma. Banderas de estado (pago pendiente,
  cambio solicitado, vitrina sin vehículo) a 8px con teselas de icono en
  tinte. TODA la lógica intacta: elegibilidad §9/§10, vitrina, bienvenida,
  retorno del mapa.
- **`PlanesGrid`**: tarjetas a 8px con `elevation-1`; recomendado y «Tu
  plan» con anillo primario (adiós `shadow-premium` y el negro); sello
  «Para tu {vehículo}» sobre azul profundo; precio `text-h1 tabular-nums`;
  caja usos/vigencia en `retail-mist` con iconos de marca; beneficios con
  check verde; CTAs en píldora (primario azul, secundarios con borde). La
  recomendación por vehículo, el atenuado y los cinco estados del CTA se
  conservan tal cual.
- **`CatalogoPlanesGlobal`**: mismo tratamiento (agrupado por negocio, mini
  tarjetas con «desde» en `text-price-lg`); el chip «Planes de {empresa}»
  ahora TRUNCA — el nombre es texto ajeno y no decide el ancho del
  documento. `MobilePlanTabs` y `VehicleSelector` al vocabulario.
- La sonda del E2E pescó dos desbordes a 390 en las cabeceras (filas de
  acciones sin `flex-wrap` con textos imparables) — ambos corregidos. Los
  «flotantes» del EmptyState que la sonda listó estaban recortados por su
  `overflow-hidden`: la tercera pasada no comprueba recorte y puede dar
  falsos positivos; el ancho real lo dicen `scrollWidth` y los culpables.
- El E2E captura las DOS caras: la de la empresa (cliente QA sin vehículo →
  asistente de requisitos) y el catálogo global con las cinco demo. La
  rejilla completa de PlanesGrid (con planes y vehículo) no queda capturada:
  exigiría fixture de vehículo compatible; anotado.

**Verificación:** suite 2048/2048 · build compilado · E2E completo en verde.

---

## 21. F4 · Llevar el pase: la wallet en verificación real (2026-09-10)

`/mis-membresias` ya era DS 2.0 (PageHeader, StatCard, WalletStack, grupos
excluyentes §40): esta vez el corte fue quitar los últimos colores crudos de
la wallet y — lo importante — poder VERLA con datos:

- **`WalletStack`**: el botón «Ver detalle» del reverso QR deja
  `bg-slate-900` por `retail-deep`; el cierre pasa a `retail-mist`.
  **`UsageMeter`**: los shimmer `via-sky-200/500` pasan al token
  `retail-cyan`. La tarjeta física (color de marca del negocio, mono para el
  plan, reverso blanco funcional del QR) se queda tal cual: es una pieza
  deliberada y el blanco del QR está declarado en la guardia del tema.
- **El fixture QA gana una membresía ACTIVA con su QR** (plan ilimitado,
  vence en 30 días). Con ella, por primera vez el E2E captura la wallet DE
  VERDAD: `/mis-membresias` con vistazo + tarjeta, la Cuenta con la ficha
  del contrato («● ACTIVO · Renueva …», tesela, «Pase digital listo · Ver
  QR y uso»), el Inicio con la wallet primero, y Planes en modo vitrina
  (las tarjetas de PlanesGrid que el corte 20 no pudo capturar). La
  limpieza borra las membresías ANTES que los planes (la FK no es en
  cascada); los QrToken sí caen en cascada.
- Anotado: `AnimatedCounter` arranca en 0 en las capturas (anima por rAF);
  el valor real aparece al instante en uso. Cosmético de captura, no de
  pantalla.

**Verificación:** suite 2048/2048 · build compilado · E2E completo en verde
· capturas de wallet, Cuenta y vitrina revisadas.

---

## 22. El héroe del motor de experiencias sale del Inicio (2026-09-10)

El usuario lo vio con su membresía pendiente real: la tarjeta «UN PASO PARA
ACTIVAR / Tu plan te espera» arriba del todo «se ve muy feo y rompe el
diseño». Fuera por decisión directa:

- El motor de experiencias habla SOLO por el **popup inteligente** (máx. 1
  al día): el protagonista pasa a ser `experiencias[0]` del motor, que
  antes alimentaba el héroe. Sus estados también viven donde se actúa —
  la wallet enseña «Pendiente», y Planes y el detalle de membresía llevan
  el «Completar pago».
- `RetailExperiencia` se borra y la guardia de capacidades vigila que no
  vuelva (la del motor ahora exige `PopupInteligente`). `RetailExperiencias`
  —plural, el bloque comercial de excursiones— no tiene nada que ver y se
  queda.
- De paso, la cabecera de «Mis membresías» recupera `flex-wrap`: en
  pantallas más angostas que 390 los chips bajan de línea en vez de
  estrujar el título en una columna (lo segundo que enseñaba la captura
  del usuario).

**Verificación:** suite 2048/2048 · build compilado · E2E completo en verde
· Inicio capturado abriendo directo con la wallet.
