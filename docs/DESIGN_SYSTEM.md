# MembeGo Design System 2.0

Contrato visual del producto. **Toda pantalla nueva o rediseñada debe salir de
aquí** — nada de estilos inventados por página. Referencias de nivel: Stripe,
Linear, Notion, Airbnb, Revolut, Apple Wallet.

> **Este documento estuvo desincronizado del código.** Hasta la Fase 0 afirmaba
> que `--primary` era azul cuando el token era verde esmeralda, y que el origen
> de componentes era `src/components/ui` cuando ese directorio no existe. Las
> dos cosas se corrigieron. Si vuelves a encontrar una diferencia entre lo que
> dice esta página y lo que hace el código, **el código manda y esta página es
> el bug**: arréglala en el mismo commit.

## Principios

1. **Minimalismo con aire.** Mucho espacio en blanco; nada apretado. Si una
   pantalla se siente llena, sobran elementos, no falta espacio.
2. **Una pregunta por pantalla.** Antes de tocar una pantalla, responder:
   *"¿Qué necesita hacer el usuario aquí?"* Todo lo que no aporte a eso se
   elimina o se simplifica.
3. **Jerarquía tipográfica, no cajas.** Preferir tipografía y espaciado a
   bordes y contenedores. Menos líneas, menos cajas anidadas.
4. **Mobile-first en el área de cliente**, desktop-first en administración —
   pero ninguna de las dos puede romperse en el otro tamaño.
5. **Consistencia absoluta.** Mismos botones, mismas cards, mismas tablas en
   todos los módulos.

## Dónde vive el sistema

Una sola implementación, en **`packages/ui/src/ui/`**. Se importa por dos rutas
que apuntan al mismo sitio vía `tsconfig.json`:

```ts
import { Button } from '@/components/ui/button'   // ← forma canónica (796 usos)
import { Button } from '@membego/ui/ui/button'    // ← equivalente (4 usos)
```

`@/components/ui/*` es la forma canónica: úsala. **`src/components/ui/` no
existe como carpeta** — es un alias. El paquete se publica aparte para que la
futura app móvil consuma los mismos componentes y los mismos tokens.

**Dos capas, una frontera:** en `packages/ui` van los *primitives*, que no
dependen de ningún framework — por eso `TabsNav` recibe un `render` en vez de
usar `next/link`. En `src/components` van los *componentes de producto*, que sí
conocen la aplicación (`BusinessCard` necesita `next/image`). Los de producto se
apoyan en los primitives y en los tokens; nunca al revés.

Los valores de diseño viven en dos sitios que **deben mantenerse sincronizados**:

| Archivo | Para qué |
|---|---|
| `src/app/globals.css` | Fuente de verdad en la web (variables CSS) |
| `packages/ui/src/tokens.ts` | Espejo en hex/px para lo que no pasa por CSS: app móvil, emails, imágenes OG, PDFs |

## Color

**El azul es la marca. El verde ya no.**

Hasta la Fase 0 la aplicación era verde esmeralda y solo la web pública era
azul. Ahora `--primary` es el mismo azul en las dos, y `.theme-landing` solo
sigue existiendo para forzar el tema claro en la landing.

- **Marca:** `--primary` (azul eléctrico), con `--primary-hover` y
  `--primary-soft` para los estados.
- **Degradados — dos, y no son intercambiables:**

| Clase | Para qué | Texto blanco encima |
|---|---|---|
| `.surface-hero` | Cabeceras públicas con texto | ✅ 6,34:1 · 8,35:1 · 10,13:1 |
| `.bg-gradient-brand` | Chips, iconos, dock del QR | ❌ su extremo cian da **2,33:1** |

  Este documento recomendaba `.bg-gradient-brand` para héroes hasta la Fase 18.
  Era una combinación ilegible por escrito: sobre el cian, el texto blanco
  pequeño no llega ni a la mitad del mínimo de AA. Si necesitas escribir encima
  de un degradado, es `.surface-hero`.
- **Superficies:** `--background`, `--card`, `--muted`, `--border`.
- **Estados semánticos** — usar SIEMPRE estos, nunca `text-green-600` suelto:

| Estado | Clases |
|---|---|
| Éxito | `text-success`, `bg-success/10` |
| Alerta | `text-warning`, `bg-warning/10` |
| Peligro | `text-destructive`, `bg-destructive/10` |
| Info | `text-info`, `bg-info/10` |

**`--info` es un ESTADO, no un acento.** Es un cian (`#0097b3`, tono 215), a
0,165 de distancia perceptual del azul de marca — no hay confusión posible
entre los dos. Su sitio son los avisos neutros: `Badge`, `StatusBanner`,
`StatusChip` y `AppIcon` con `variant="info"`.

Lo que **no** es: el color de un hover, de un elemento seleccionado ni de un
chip de icono. Pasar el ratón por una tarjeta no informa de nada, y "esto es lo
que elegiste" lo dice `primary` en toda la app — pestañas, chips del mapa, ítem
activo del menú. Se saldaron 42 clases repartidas en 21 archivos.
`tests/token-info.test.ts` lo vigila, incluida la separación mínima de 30° de
tono entre `--info` y `--primary`.

- **El verde es exclusivamente `--success`.** Si un verde en pantalla no
  significa "esto salió bien", está mal puesto.
- **Dark mode:** automático vía variables (`.dark`). No hardcodear blancos ni
  negros. `text-white` solo sobre navy, gradientes o imágenes.

### Superficies de un solo tema

La landing pública y la autenticación son **claras siempre**, aunque la persona
tenga la app en oscuro. Lo consigue la clase `theme-landing` en el contenedor.

**Regla no obvia:** ese bloque debe redefinir **todo** lo que redefine `.dark`,
aunque el valor coincida con `:root`. Las variables CSS se resuelven en el
ancestro más cercano que las declare, y `.dark` vive en `<html>`, por encima
del `<div>` con `theme-landing`: cualquier token que el bloque no declare se lee
del oscuro y aterriza en una página clara. Lo verifica
`tests/tema-landing.test.ts`.

### Alias semánticos

`brand-primary`, `brand-primary-hover`, `brand-primary-soft`, `surface`,
`surface-subtle`, `sidebar-hover` y `sidebar-active` apuntan a los tokens de
siempre. Son nombres nuevos sobre el mismo sistema, no un segundo sistema:
`bg-card` y `bg-surface` dan lo mismo. En pantallas nuevas, usa el que mejor
describa la intención.

## Tipografía

**El suelo es 12px. Nada de la interfaz baja de ahí** — ni microcopy, ni
etiquetas, ni navegación.

| Clase | Tamaño | Uso |
|---|---|---|
| `.text-display` | 40–72px | Héroes / landing |
| `.text-h1` | 28–32px | Título de página (uno por pantalla) |
| `.text-h2` | 20–24px | Título de sección |
| `.text-h3` | 17px | Título de tarjeta |
| `.text-h4` | 15px | Subtítulo / grupo |
| `.text-body` | 16px | Texto normal |
| `.text-small` | 14px | Secundario |
| `.text-caption` | 12.5px | Metadatos |
| `.text-overline` | 12px | Etiqueta de sección en mayúsculas |

Nueve roles. No añadir un décimo. Antes de escribir `text-[13px]` o
`text-[15px]`: ya existen como `.text-small` y `.text-body`.

Fuentes: Geist Sans para lectura (`--font-geist-sans`), Plus Jakarta Sans para
títulos (`--font-display`, aplicada automáticamente a `h1/h2/h3`). No
introducir otras.

## Espaciado

Escala 4/8: `1, 2, 3, 4, 5, 6, 8, 10, 12, 16` de Tailwind (4–64 px).

- Entre secciones de página: `space-y-8` (32px) mínimo.
- Padding de card: `p-5` o `p-6`.
- Padding de página: `px-4 sm:px-6 lg:px-8`.

## Radios

Una familia, un radio:

| Elemento | Clase | Valor |
|---|---|---|
| Inputs, botones, chips | `rounded-lg` | 10px |
| Tarjetas, paneles | `rounded-xl` | 14px |
| Modales, hojas, drawers | `rounded-2xl` | 20px |
| Avatares, pills, dock del QR | `rounded-full` | — |

`rounded-3xl`, `rounded-md` y `rounded-sm` están **fuera del vocabulario**. Los
tokens siguen existiendo para no romper los usos heredados, pero en pantallas
nuevas no se escriben, y cuando le toque la fase a un módulo se migran.

## Elevación (sombras)

Tres, y un acento:

| Clase | Uso |
|---|---|
| `.elevation-1` (= `.shadow-card`) | Reposo |
| `.elevation-2` (= `.shadow-premium`) | Hover, dropdowns |
| `.elevation-3` (= `.shadow-premium-lg`) | Modales, elementos flotantes |
| `.shadow-glow` | **Un solo CTA protagonista por pantalla** |

Los alias entre paréntesis tienen valores idénticos: son la misma sombra con
dos nombres. En código nuevo se escribe la elevación, que dice para qué es.

Nunca usar `shadow-md/lg/xl` de Tailwind directamente.

## Iconografía

Lucide, sistema único. Tamaños normalizados:

| Tamaño | Uso |
|---|---|
| 16px | Acciones pequeñas, dentro de badges |
| 18px | Navegación lateral |
| 20px | Acciones |
| 24px | Features, estados vacíos |

## Glass y texturas

- `.glass` / `.glass-strong`: navbar flotante, chips sobre imágenes. Sutil.
- `.glass-surface`: solo **sobre** imágenes o gradientes. Sobre fondo plano,
  usar `bg-card`.
- `.bg-grid` / `.bg-grid-light` / `.bg-dots` + `.mask-fade`: fondos de hero.

## Componentes

- **Button** — variantes `default | secondary | outline | ghost | destructive |
  link | success | gradient | premium | glass`; tamaños
  `sm | default | lg | xl | icon | icon-sm`. `default` mide 40px; **`lg` (44px)
  es el tamaño de las superficies táctiles** (scanner, cliente, móvil).
  `premium` lleva `shadow-glow`: máximo uno por pantalla.
- **Input** — 40px de alto, `rounded-xl`, focus con ring de marca. Errores con
  `aria-invalid`, nunca solo color. **Nunca usar placeholder como sustituto de
  label.**
- **Card** — `rounded-2xl border-border`. Si es clicable: `.card-interactive`
  (única forma de hover permitida) o `.card-lift` para tarjetas protagonistas.
- **Badge** — `default | secondary | outline | destructive | success | warning |
  info`. Estados de negocio → variante semántica, nunca color suelto.
- **Skeleton** — shimmer, no spinners. Un spinner solo dentro de un botón en
  submit. El skeleton debe parecerse a lo que va a aparecer.
- **EmptyState** — icono + título + descripción + **acción recomendada**.
  Prohibido "No hay datos" sin siguiente paso. Dos variantes: `plain` (dentro
  de una tarjeta o tabla que ya tiene borde) y `card` (cuando el vacío ES la
  pantalla).
- **StatCard** — KPIs. No inventar tarjetas de métricas nuevas. Acentos
  **semánticos**: `brand | success | warning | danger`. Los de tono (`sky`,
  `green`, `amber`, `red`, `indigo`, `violet`) están obsoletos —son de antes
  de los tokens— y se retiran cuando la Fase 8 migre sus 31 llamadas.
- **BusinessCard** — la ÚNICA tarjeta de negocio, en
  `src/components/marketplace/`. Variantes `standard | compact | featured |
  map`. Admite distancia y abierto/cerrado cuando quien la usa los conoce.
- **DataTable** — base de todas las tablas. Extenderla, no reimplementarla.
- **PageHeader** — cabecera de pantalla: el **único `h1`**. Admite `eyebrow`
  (contexto o vuelta al listado) y `nav` (pestañas de la sección). El título no
  se trunca: ajusta con `text-balance`.
- **SectionHeader** — cabecera de una sección dentro de la pantalla (`h2`). No
  componer a mano un flex con un `h2` de tamaño propio.
- **TabsNav** — navegación secundaria de una sección. No trae router: cada
  pestaña se pinta con `render`, así sirve para enlaces o estado local.
- **FormSection** — agrupa un formulario largo por intención. Usa `<fieldset>`
  y `<legend>` de verdad: el lector de pantalla anuncia la sección al entrar en
  cada campo. **FormActions** fija las acciones al fondo.
- **MobileBottomSheet** — lista que convive con un mapa a pantalla completa.
  Dos estados (asomada / abierta) y un tirador que es un botón real; **no** es
  un diálogo, porque el mapa de detrás sigue siendo interactivo.

## Shell global

El armazón vive en `src/components/layout/` y **ninguna pantalla lo reimplementa**.

| Pieza | Qué resuelve |
|---|---|
| `AppShell` | Rejilla, drawer móvil, riel colapsable, contenedor de página |
| `AppSidebar` | Dominios, contextos, permisos, ruta activa, persistencia |
| `AppHeader` | Breadcrumb, buscador, empresa, tema, notificaciones, perfil |
| `MenuUsuario` | Identidad, ayuda y cerrar sesión |
| `BottomNav` | Navegación táctil del cliente (4 destinos + dock del QR) |

### Espaciado de página

La convención vive en `AppShell`, no en cada pantalla:

- Ancho máximo `max-w-7xl` (1280px), centrado.
- Padding lateral `px-4 sm:px-6 lg:px-8`; vertical `py-8`.

**Una pantalla no declara su propio `max-w-*` ni su padding lateral.** Si lo
hace, se desalinea con el resto del producto. Lo que sí decide cada pantalla es
la separación entre sus secciones: `space-y-8`.

Única excepción: una experiencia **a sangre**, como el mapa de "Cerca de mí".
Ahí la pantalla cancela el padding del shell con márgenes negativos que
replican sus valores exactos — si el shell cambia, esa pantalla también.

### Contexto: ¿dónde estoy?

El breadcrumb del header dice **dominio → módulo → subpágina**: "Marketing /
Campañas / Nuevo". El dominio es la parte que importa — sin él la cabecera dice
qué página es, pero no dónde está dentro del producto.

Lo resuelve `migasDeRuta()` en `nav-config.ts`, que elige la sección por el
`href` **más largo** que casa con la ruta. Si una sección tiene varias vistas,
va con `TabsNav` bajo el título, no con más entradas en el menú lateral.

### Alturas de control

| Elemento | Alto |
|---|---|
| Botón e input por defecto | 40px |
| Botón `lg` — superficies táctiles | 44px |
| Controles del header y del menú | 40px |
| Enlace del menú lateral | 36px mínimo |
| Pestaña de `TabsNav` | 44px |

## Animación

- Duración 100–250ms para interacción; usar los tokens `--duration-*` y
  `--ease-*`, nunca números sueltos.
- Entradas: `.animate-fade-up`, `.animate-slide-up`, `.animate-scale-in`
  (+ `.delay-*` para stagger).
- Animaciones elaboradas solo en momentos de alto valor: recompensas,
  onboarding, QR completado, registro completado.
- Flotación decorativa (`.animate-float*`) solo en héroes.
- `prefers-reduced-motion` ya está cubierto en las utilidades: con la
  preferencia activa **nada se mueve**, y ninguna información depende del
  movimiento.

## Estados obligatorios por módulo

Cada pantalla con datos remotos cubre los cuatro: **cargando** (skeleton),
**error** (qué pasó + qué puede hacer el usuario + reintentar), **vacío**
(EmptyState con acción) y **éxito** (toast). Nada de pantallas en blanco, y
nunca una excepción técnica en pantalla.

## Accesibilidad

- Focus visible siempre (`focus-visible:ring-2`), sobre `--ring`.
- Botones-icono con `aria-label`.
- Contraste AA como mínimo. Ojo con el texto sobre navy: una opacidad baja
  sobre fondo oscuro cae por debajo de AA muy rápido.
- **Área táctil ≥ 44px** en superficies móviles (`tokens.minTouchTarget`).
- Diálogos y drawers: trampa de foco, `Escape` cierra, el foco vuelve al
  elemento que los abrió.

## Antipatrones

| No hagas esto | Haz esto |
|---|---|
| `text-[10px]`, `text-[11px]` | `.text-caption` (12.5px) o `.text-overline` (12px) |
| `text-green-600` para marca | `text-primary` |
| `text-green-600` para éxito | `text-success` |
| `bg-white` / `text-black` | `bg-card` / `text-foreground` |
| `rounded-3xl` en una tarjeta | `rounded-xl` |
| `shadow-lg` de Tailwind | `.elevation-2` |
| Un `shadow-glow` en cada botón | Uno por pantalla, el protagonista |
| Placeholder en vez de label | Label visible + helper text |
| "No hay datos" | `EmptyState` con acción |
| Spinner a pantalla completa | Skeleton con la forma del contenido |
| Inventar una card de métrica | `StatCard` |
| Inventar una tabla | Extender `DataTable` |

## Navegación

La arquitectura de navegación vive en `src/components/layout/nav-config.ts`.
Regla: **la arquitectura técnica y la de navegación no tienen por qué
coincidir.** Que exista un módulo en el código no significa que necesite un
enlace principal.

- **Administrador** — 8 dominios: Inicio, Clientes, Beneficios, Marketing,
  Operaciones, Analítica, Empresa, Soporte.
- **Cliente** — 5 dominios: Inicio, Cerca de mí, Mis beneficios, Actividad,
  Cuenta.
- **Empleado** — solo Operaciones. Su pantalla es el mostrador, no un panel de
  administración reducido.
- **Superadmin** — dos contextos separados por un selector: *Plataforma
  Membego* y *Panel de empresa*. Nunca los dos a la vez.

El menú arranca con **solo el dominio activo abierto**. Los permisos por rol se
derivan del segmento de la URL (`adminSectionForPath`), no del grupo del menú:
mover un enlace entre dominios no afecta a quién puede verlo.

**No cambiar rutas por estética.** Muchas están enlazadas desde WhatsApp, QR,
correos y campañas. Si hay que cambiar una: documentar, crear redirect,
verificar enlaces.

## Proceso por fases

| Fase | Alcance | Estado |
|---|---|---|
| 0 | Design System 2.0 + arquitectura de navegación | ✅ |
| 1 | Shell global: sidebar, header, layouts | ✅ |
| 2 | Auth, login, registro, onboarding interactivo | ✅ |
| 3 | Home del cliente | ✅ |
| 4 | Explorar, empresas, promociones | ✅ |
| 5 | Cerca de mí, mapa | ✅ |
| 6 | Wallet, membresías, beneficios, QR | ✅ |
| 7 | Perfil, vehículos, ubicaciones | ✅ |
| 8 | Dashboard administrativo | ✅ |
| 9 | Clientes, membresías, planes | ✅ |
| 10 | Promociones, crecimiento, referidos | ✅ |
| 11 | Marketing, campañas, audiencia | ✅ |
| 12 | Operaciones: scanner, pagos, sucursales | ✅ |
| 13 | Reportes | ✅ |
| 14 | Empresa, empleados, configuración | ✅ |
| 15 | Soporte | ✅ |
| 16 | Superadmin | ✅ |
| 17 | Empleado | ✅ |
| 18 | Páginas públicas | ✅ |
| 19 | Dark mode, accesibilidad, QA visual | ⬜ |
| 20 | Eliminar el frontend visual heredado | ⬜ |

### Correcciones desde verificación visual

Lo que salió del primer despliegue mirado con ojos, no con pruebas.

| Hallazgo | Causa | Resolución |
|---|---|---|
| "Mi ubicación" fallaba al arrastrar | El refresco por viewport viajaba con `contexto=CURRENT` **sin** coordenadas | El cliente reenvía el ancla; el servidor cae al centro del viewport en vez de dar error |
| Distancia medida desde el centro del mapa | `buscarEnViewportRaw` usaba el centro del rectángulo | Se mide desde el ancla (`ancla` en la consulta): "a 2 km" vuelve a significar "de ti" |
| El menú lateral se plegaba | Grupos colapsables con estado en `localStorage` | Eliminado. Para ganar espacio está el riel de iconos |
| Banner del home en verde | `PromoBanner tono="brand"` seguía en `emerald→cyan` | Azul de marca. Igual en `FlashPromotion` y `FeedNovedades` |
| "0 negocios" en el mapa pese a tener la ubicación puesta | `ensureSucursalPrincipal` copiaba dirección y teléfono pero **no las coordenadas**: el pin se guardaba en `Company` y la sucursal quedaba en null | Se propaga el punto; backfill en `migrations_manual/2026-08-sucursal-principal-coordenadas.sql` |

**El pin del perfil no llegaba al mapa.** `Company.latitud/longitud` y
`Sucursal.latitud/longitud` son campos distintos, y "Cerca de mí" consulta
SUCURSALES exigiendo coordenadas. El dueño marcaba su ubicación exacta en
`/admin/perfil`, se guardaba en la empresa, y el negocio no aparecía nunca en el
mapa. No daba error: decía "0 negocios", que es justo lo que diría si de verdad
no hubiera ninguno cerca — por eso se leyó como un problema de datos antes de
ser un bug.

**El menú no se pliega.** Un menú que cambia de forma al navegar hace que nada
esté donde lo dejaste, y llegar a cualquier sitio costaba dos clics. La
respuesta al espacio es el riel de iconos, no esconder dominios de uno en uno.

**Los marcadores del mapa llevan el logo del negocio.** Un mapa con varias
empresas y gotas idénticas obliga a tocar pin por pin; reconocer la marca es a
lo que se va al mapa. Sin logo, la inicial. El HTML del `divIcon` lo inserta
Leaflet por fuera de React, así que `logoUrl` y `empresaNombre` **se escapan**
antes de entrar (`escaparHtml`, `escaparCss`, `urlImagenSegura`).

### Fase 14 · lo que el panel de empresa no decía

**`/admin/sucursales` no decía cuál sale en el mapa.** La pantalla prometía
"para que aparezcan en el mapa de tus clientes" y luego una sucursal sin
coordenadas se veía idéntica a una que sí las tiene. Ahora cada tarjeta lo dice,
con la salida delante ("Añadir ubicación"): avisar de un problema sin decir cómo
arreglarlo solo cambia el desconcierto de sitio.

El cartel es un espejo del filtro SQL del mapa, así que la regla vive en
`sucursalVisibleEnMapa()` y `tests/geo-visibilidad.test.ts` vigila que no se
separen — mentir en ese cartel sería peor que no ponerlo.

**Las invitaciones pendientes no decían cuándo caducan.** `expiraEn` se
consultaba y se tiraba. Una invitación que vence en silencio llega a soporte
como "no me llegó nada". `listInvitacionesPendientes` resuelve `caducada` en la
capa de datos: `Date.now()` en el render es impuro y el compilador lo rechaza.

**El perfil público era cinco `Card` y un botón al final.** Pasa a `FormSection`
(`fieldset`/`legend` de verdad) y `FormActions` pegado al fondo — guardar un
cambio del primer campo obligaba a recorrer el formulario entero. La razón
social sale de "Ubicación", donde estaba metida entre el enlace de Google Maps y
la zona de cobertura.

**"Zona de cobertura" se rellenaba con la URL del mapa.** El campo iba justo
debajo del enlace de Google Maps, con la misma pinta y sin explicar qué
esperaba. Ahora dice que es texto y no un enlace.

### Fase 15 · soporte por cola, no por estado

**La bandeja enseñaba cuatro tarjetas que no cuadraban.** "Total / Nuevos / En
proceso / Resueltos" contaba TRES de los cinco estados: un ticket en
`ESPERANDO_CLIENTE` no salía en ninguna y el desglose no sumaba el total. Un
desglose que no cuadra enseña a no mirarlo. Ninguna era pulsable, además, y
justo debajo había un desplegable para filtrar por lo mismo.

Las sustituyen tres **colas** —mismo criterio que la Fase 12 aplicó a los
pagos—, que además llevan a su lista:

| Cola | Estados | Qué significa |
|---|---|---|
| Te toca a ti | `NUEVO`, `EN_PROCESO` | El trabajo |
| Esperando al cliente | `ESPERANDO_CLIENTE` | No es trabajo, pero se vigila |
| Cerrados | `RESUELTO`, `CERRADO` | Historial |

`tests/soporte-colas.test.ts` exige que **todo estado esté en exactamente una
cola**: si mañana se añade uno al enum y nadie lo asigna, sus tickets
desaparecerían de la bandeja sin dar error.

**Al cliente no se le decía cuándo le tocaba contestar.** `ESPERANDO_CLIENTE` se
mostraba como "Esperando cliente" —escrito desde el punto de vista de quien
atiende— entre otras cuatro insignias. Ahora dice "Te toca contestar" y la fila
se resalta.

**El botón de WhatsApp usaba `bg-success`**: el verde de "salió bien" como color
de una marca ajena, con `hover:bg-success` encima, así que no respondía al pasar
por encima. Pasa al azul de marca.

### Fase 16 · el panel de plataforma, dentro del sistema

**El aviso y su destino contaban cosas distintas.** "Salud de la plataforma"
decía *N tickets abiertos* sumando `NUEVO + EN_PROCESO + ESPERANDO_CLIENTE`,
pero desde la Fase 15 el enlace abre la bandeja en la cola "Te toca a ti", que
son solo los dos primeros. El panel decía 7 y aparecían 5. Nada fallaba — por
eso habría durado. Ahora cuenta `COLAS_TICKET.pendientes`, y hay una prueba que
lo ata: escribir la lista de estados a mano vuelve a separarlos sin dar error.

**El color semántico estaba escrito a mano.** `emerald-600 dark:emerald-400`,
`amber`, `red` — con su variante oscura repetida en cada rama, que es el
síntoma: los tokens ya resuelven el modo oscuro solos. En observabilidad el
color *es* el dato (¿está sano esto?), así que dos pantallas no pueden decir
"todo normal" en verdes distintos.

**Deuda saldada, medida:** el área pasa de 7 micro-textos bajo el suelo a **0**,
de 42 `text-xs` a 0 y de 16 tamaños fuera de escala a 0. El techo global baja de
**193 a 186**. Las cuatro fechas que construían su propio `Intl.DateTimeFormat`
—con locale y zona clavados en el archivo, sobre un servidor que corre en UTC—
pasan por `formatDate`.

`tests/superadmin-coherencia.test.ts` vigila las cuatro cosas: la cola del
aviso, el suelo tipográfico (aquí ya sin techo: es cero), los colores literales
y los formateadores a mano.

### Fase 17 · el mostrador se lee de pie

El escáner y la caja no se usan como el resto del producto. Se usan **de pie,
con el móvil en una mano, el cliente delante y prisa**. Y eran, medido, el área
con más texto por debajo del suelo de todo el proyecto:

| Área | Micro-textos por cada 1000 líneas |
|---|---|
| **Empleado (escáner + caja)** | **3,99** |
| Cliente | 2,68 |
| Administración | 2,23 |
| Público | 1,45 |
| Superadministrador | 1,00 |

El sitio donde peor se lee era el que peor lo tenía. Ahora está a **cero**, y su
guardia no es un techo que baja: es cero y se defiende.

**Los tamaños subieron, no se normalizaron a la baja.** El nombre del cliente,
el veredicto del escaneo y el importe pasan de `text-lg` (18px, fuera de escala)
a `.text-h2` (20–24px). Son la respuesta de la pantalla: a un brazo de
distancia, 17px de tarjeta habría sido peor que lo que había.

**Descartar un registro pendiente medía 28px.** Es una acción destructiva —tira
un registro que no se pudo enviar, justo los que el aviso pide revisar antes de
cerrar el turno— y se toca con una mano. Ahora mide 44px.

**El aviso de cola sin conexión usaba `amber-500` con su `dark:` escrito a
mano.** Es el mensaje que dice "tienes registros sin enviar": si se ve mal en
oscuro, se pierde dinero de verdad.

### Fase 18 · la cara pública, una sola marca

**Había seis degradados distintos para la misma cabecera.** `from-blue-800 via-
blue-700 to-indigo-900`, `from-blue-700 via-sky-600 to-indigo-800`, `from-blue-
600 to-sky-500`, `from-blue-600 to-indigo-700`, `from-blue-700 to-indigo-800` y
`from-slate-900 to-blue-900`. Nadie los eligió distintos: se fueron escribiendo
a mano página a página. La web pública cambiaba de azul al navegar.

Ahora es **`.surface-hero`**, definida una vez, con tres topes de la escala de
marca que **todos** aguantan texto blanco: 6,34:1 · 8,35:1 · 10,13:1.

**`.bg-gradient-brand` no admite texto blanco pequeño.** Su extremo cian da
**2,33:1** contra blanco, muy por debajo de AA — y el documento lo recomendaba
para héroes. Queda para chips, iconos y superficies decorativas; las cabeceras
con párrafos encima usan `.surface-hero`. Está anotado junto a la propia regla.

**Seis clases con dos opacidades encadenadas.** `text-white/80/90`,
`bg-primary/10/50`, `bg-primary/40/20`. Tailwind no las parsea: **descarta la
clase entera**, sin aviso, sin romper el build y sin fallar ninguna prueba. Tres
estaban en la portada, dejando el subtítulo del héroe en blanco puro y sin
jerarquía frente al titular. La guardia las vigila en todo `src`, no solo aquí.

**La landing usa los mismos nueve roles.** Los héroes pasan de tres breakpoints
(`text-4xl sm:text-5xl lg:text-7xl`) a `.text-display`, que ya es fluida de 40 a
72px. Los siete `rounded-3xl` —fuera del vocabulario— bajan a `rounded-2xl`.
Área pública a **cero** micro-textos y **cero** tamaños fuera de escala.

### Decisiones de producto resueltas fuera de fase

| Decisión | Resolución | Dónde vive |
|---|---|---|
| Abrir el marketplace | Sí, pero sin categorías vacías | `categoriasVisibles()` en `modules/marketplace/types.ts` |
| Cambiar el vehículo principal | Permitido; **no** re-tarifa nada | `marcarVehiculoPrincipal()` en `modules/cliente/vehiculosActions.ts` |

**Marca única no es un interruptor.** `esMarcaUnica()` es una consulta:
devuelve `true` mientras haya una sola empresa publicada. El marketplace se
abre solo al publicar la segunda — no hay flag que encender ni despliegue que
hacer.

**"Principal" es una etiqueta, no una tarifa.** Decide cuál vehículo se enseña
primero y cuál viene preseleccionado al comprar. El precio sigue al vehículo
que el cliente elige en el selector, y las renovaciones cobran
`membership.plan.precio` sin mirar el vehículo: marcar otro principal no puede
encarecerle a nadie lo que ya tiene.

### Deuda conocida que se salda por fases

Inventario medido en la Fase 0. No se toca de una barrida: cada módulo lo salda
cuando le toque su fase.

| Deuda | Cantidad |
|---|---|
| Tamaños de texto por debajo de 12px escritos a mano | 218 en el proyecto |
| Verdes literales (`green-*`, `emerald-*`) | 86, en 29 archivos |
| `rounded-3xl` / `rounded-md` / `rounded-sm` | 109 |
| Gradientes escritos a mano | 78 |
| Primitives de `packages/ui` sin ningún uso | 16 de 46 |

Los primitives sin uso **no se borran todavía**: varios (`progress`,
`segmented-control`, `pagination`, `avatar`) son justo lo que las fases de
wizards, tabs y tablas van a necesitar. Se decide en la Fase 20.
