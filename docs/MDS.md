# Membego Design System (MDS) — Documento maestro

**Versión 1.0 · Fase 1** · La base visual de TODA la plataforma: app del
cliente, panel de empresa, portal del empleado, superadmin, landing pública,
marketplace y las futuras apps móviles. Una sola fuente de verdad.

> **Dónde vive el sistema en el código**
>
> | Pieza | Archivo |
> | --- | --- |
> | Tokens CSS (colores, radios, motion, sombras, tipografía) | `src/app/globals.css` |
> | Tokens como datos (para móvil/emails/OG/PDF) | `packages/ui/src/tokens.ts` (`@membego/ui/tokens`) |
> | Componentes base | `packages/ui/src/ui/*` (`@membego/ui/ui/*`, alias `@/components/ui/*`) |
> | Este documento | `docs/MDS.md` |

---

## 1 · Filosofía del diseño

Membego es la app donde el cliente **guarda sus beneficios** y el negocio
**hace crecer su comunidad**. La experiencia debe sentirse como
**Apple Wallet + Revolut + Temu**:

- **Apple Wallet** → la membresía es un objeto precioso: tarjetas con jerarquía,
  QR protagonista, cero ruido.
- **Revolut** → confianza financiera: números tabulares, estados claros,
  feedback inmediato en cada operación.
- **Temu** → energía comercial: promociones con urgencia, badges que venden,
  celebraciones al ganar algo.

Cinco principios que deciden cualquier duda de diseño:

1. **El beneficio es el héroe.** Cada pantalla responde en <2 segundos
   "¿qué gano yo aquí?". El QR, el descuento o el premio siempre dominan la
   jerarquía visual.
2. **Premium por defecto.** Nunca aspecto de "sistema administrativo":
   superficies limpias, sombras suaves multicapa, esquinas generosas,
   tipografía display en títulos.
3. **Rápido y ligero.** Skeletons en vez de spinners, animaciones ≤350 ms,
   navegación con pocos taps, mobile first.
4. **Celebrar, no notificar.** Ganar un premio, canjear un QR o activar un plan
   merece confeti y animación — no un toast gris.
5. **Un solo lenguaje.** El mismo botón, la misma tarjeta y el mismo verde en
   web, panel, landing y móvil. Nada se inventa por pantalla.

## 2 · Identidad visual

- **Personalidad**: cercana pero profesional; tecnológica sin frialdad;
  comercial sin ser ruidosa. Habla de tú, celebra logros, nunca regaña.
- **Emociones objetivo**: confianza (mis pagos están seguros), exclusividad
  (soy VIP aquí), anticipación (algo expira, corro a usarlo), alegría (gané).
- **Una identidad, un sistema** (DS 2.0 · Fase 0): azul eléctrico `primary`
  sobre fondos neutros, gradiente azul→cyan del logo, en la app Y en la
  landing. Antes eran dos: la app era esmeralda y solo la web pública era
  azul. `.theme-landing` sigue existiendo, pero ya no para cambiar el color
  —los valores coinciden— sino para forzar el tema claro en la landing aunque
  el visitante tenga la app en oscuro.
- **El verde dejó de ser marca.** Sobrevive únicamente como `--success`: si un
  verde en pantalla no significa "esto salió bien", está mal puesto.
- **Fotografía**: real, con gente y negocios locales; luz cálida; nunca stock
  corporativo de oficinas.
- **Ilustración**: minimal con gradientes suaves de marca (SVG); Lottie para
  celebraciones. Nada isométrico corporativo, nada clipart 3D genérico.
- **Iconografía**: **Lucide, estilo line, exclusivamente** (ya instalada,
  cientos de usos). No mezclar con Material/Phosphor/Heroicons. Grosor por
  defecto, tamaño 16 px en botones, 20–24 px en navegación, 28 px en
  EmptyState. Iconos rellenos solo para estados "activo" (ej. favorito).
- **Estilo de mensajes**: éxito = toast verde + verbo en pasado ("Plan
  activado"); error = qué pasó + qué hacer ("No pudimos guardar. Intenta de
  nuevo"); advertencia = ámbar, nunca bloquea sin explicar; premios =
  overlay con confeti (`CelebracionOverlay`), nunca un simple toast.

## 3 · Principios UX

1. **Mobile first**: se diseña en 390 px; desktop es la adaptación.
2. **Una acción primaria por pantalla** (un solo botón `default`); el resto
   son `secondary`/`outline`/`ghost`.
3. **Estados obligatorios en toda vista**: cargando (skeleton que calca el
   layout real), vacío (`EmptyState` ilustrado con CTA), error (mensaje +
   reintento), éxito (feedback inmediato).
4. **Nada de jerga técnica** frente al usuario: "referencia", no "ID de
   transacción"; "Muestra este código en caja", no "token QR".
5. **Feedback < 100 ms**: todo elemento tocable reacciona (scale 0.98,
   cambio de fondo) aunque la operación tarde.
6. **Reversibilidad y confirmación**: acciones destructivas siempre con
   `ConfirmDialog`; las irreversibles explican la consecuencia.

## 4 · Guía de colores

### 4.1 Tokens semánticos (los de uso diario)

Se usan SIEMPRE los tokens, nunca hex sueltos. Cambian solos entre claro,
oscuro y landing:

| Token | Uso |
| --- | --- |
| `bg-background` / `text-foreground` | lienzo y texto principal |
| `bg-card` / `text-card-foreground` | tarjetas y superficies elevadas |
| `bg-primary` / `text-primary-foreground` | LA acción principal, enlaces de marca, foco |
| `bg-secondary` | acciones secundarias, chips neutros |
| `bg-muted` / `text-muted-foreground` | fondos suaves, texto de apoyo |
| `bg-accent` / `text-accent-foreground` | acento cyan (hover de listas, detalles) |
| `text-destructive` / `bg-destructive` | errores y acciones destructivas |
| `success` / `warning` / `info` | estados semánticos (chips, banners, toasts) |
| `border` / `input` / `ring` | bordes, campos, anillo de foco |
| `bg-sidebar` + derivados | navegación lateral (navy profundo) |
| `--overlay` | fondo de modales/sheets |
| `--skeleton` | placeholders de carga |
| `--glass-surface` / `--glass-border` | superficies de cristal |

### 4.2 Escala de marca (Primary 50–900)

Definida en `globals.css` (`--color-primary-50…900`, OKLCH) y en
`@membego/ui/tokens` (hex). Disponible como `bg-primary-500`,
`text-primary-700`, etc.

| Paso | Cuándo |
| --- | --- |
| 50–100 | fondos teñidos (banners de éxito, hover suave) |
| 200–300 | bordes y decoración de marca |
| 400–500 | **primary del modo oscuro**, acento neón, glow |
| 600–700 | **primary del modo claro**, gradientes |
| 800–900 | texto de marca sobre fondos claros, contraste alto |

**Regla**: para botones/enlaces usa el semántico `primary` (se adapta al
tema); la escala numérica es para gradientes, ilustraciones y casos donde el
tono debe ser exacto en ambos temas.

- **Secundario**: cyan de marca (`--color-cyan-brand-300/500/700`) — cierra el
  gradiente del logo; jamás como color de acción.
- **Azul de marca**: `#2563eb` = `primary[600]`. `landingPrimary` sigue
  exportándose como alias, pero está obsoleto: ya no hay un azul de la landing
  distinto del de marca.
- **Gradientes oficiales**: `.bg-gradient-brand` / `.text-gradient-brand`
  (azul→cyan) y `.text-gradient` (azul→cyan, landing). No inventar otros.
- **Glow / neón**: `.shadow-glow` y `.shadow-glow-strong` usan `--glow-color`,
  azul en todo el producto. Solo para el CTA protagonista o el FAB — un glow
  por pantalla.

### 4.3 Estados interactivos

Hover = fondo `muted` o `opacity-90`; Pressed = `active:scale-[0.98]`;
Focus = anillo `ring` 2 px con offset (ya global via `:focus-visible`);
Disabled = `opacity-50` + sin eventos. Están integrados en los componentes —
no se re-implementan por pantalla.

## 5 · Guía tipográfica

- **Display: Plus Jakarta Sans** (`--font-display`) — títulos h1–h3 y números
  protagonistas. Personalidad de marca.
- **Texto: Geist** (`--font-sans`) — lectura y UI. Neutra y rapidísima.
- **Mono: Geist Mono** (`--font-mono`) — códigos TX, referencias, montos en
  tablas. Siempre `tabular-nums` para cifras alineadas.

Escala (clases en `globals.css`; equivalencias MDS):

| MDS | Clase | Tamaño | Uso |
| --- | --- | --- | --- |
| Display XL / Display | `.text-display` | clamp 40→72 px · 800 | héroes de landing |
| Heading XL | `.text-h1` | clamp 24.8→30 px · 800 | título de página |
| Heading L | `.text-h2` | clamp 19.2→22 px · 700 | título de sección |
| Heading M | `.text-h3` | 17 px · 700 | título de tarjeta |
| Heading S | `.text-h4` | 15 px · 600 | subtítulo / grupo |
| Body M | `.text-body` | 15 px · 1.6 | párrafos |
| Body S | `.text-small` | 13 px · 1.5 | apoyo, celdas |
| Caption | `.text-caption` | 12 px | metadatos, fechas |
| Overline | `.text-overline` | 11 px · caps | etiquetas de sección |
| Button | (integrada en `Button`) | 14 px · 500 | — |

**Reglas**: no componer títulos con `text-*/font-*` a mano — usar la escala.
Tracking negativo solo en display/headings. Nunca más de 3 niveles de
jerarquía en una pantalla.

## 6 · Espaciados

Escala base **4 px**: `2 · 4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 56 ·
64 · 80 · 96` (Tailwind `p-0.5 … p-24`).

| Paso | Uso |
| --- | --- |
| 2–4 | icono↔texto, gaps dentro de un chip |
| 8–12 | padding interno de chips/badges, gaps de listas densas |
| 16 | **padding estándar de tarjetas** y gutter móvil |
| 20–24 | padding de tarjetas grandes, separación entre cards |
| 32–40 | separación entre secciones de una página |
| 48–64 | bloques de landing, cabeceras hero |
| 80–96 | respiración de secciones de marketing en desktop |

Regla: si un espacio no está en la escala, está mal.

## 7 · Sombras

| MDS | Clase | Uso |
| --- | --- | --- |
| Shadow 1 | `.shadow-card` / `.elevation-1` | tarjetas en reposo |
| Shadow 2 | `.shadow-card-hover` / `.elevation-2` | hover, dropdowns |
| Shadow 3 | `.shadow-modal` / `.elevation-3` | modales, sheets |
| Premium | `.shadow-premium` / `-lg` | superficies destacadas (estilo Stripe) |
| Floating | `.shadow-floating` | FABs, botones flotantes |
| Hero | `.shadow-hero` | wallet card, hero banners |
| Glass | `.glass-surface` (incluye su sombra vía `.shadow-card`) | cristal |
| Glow | `.shadow-glow` / `-strong` | CTA de marca, elementos neón |

Reglas: máx. 2 niveles de sombra por pantalla; el glow es exclusivo del
elemento protagonista; en modo oscuro las sombras pesan menos — el contraste
lo da el borde (`border-border`).

## 8 · Bordes y radios

`--radius` base = 10 px. Alias Tailwind ya mapeados:

| MDS | Clase | px | Uso |
| --- | --- | --- | --- |
| XS | `rounded-sm` | 6 | chips pequeños, inputs compactos |
| S | `rounded-md` | 8 | inputs, selects |
| M | `rounded-lg` | 10 | botones sm, badges |
| L | `rounded-xl` | 12 | **botones e inputs estándar** |
| XL | `rounded-2xl` | 20 | **tarjetas** (el radio firma de Membego) |
| Pill | `rounded-full` | ∞ | badges de marketing, chips de filtro, FAB |
| Circle | `rounded-full` + cuadrado | — | avatares, icon buttons redondos |

Nunca esquinas vivas (`rounded-none`) salvo impresión térmica.

## 9 · Componentes

### 9.1 Botones (`@membego/ui/ui/button`)

Variantes: `default` (primary), `secondary`, `outline`, `ghost`, `link`,
`destructive`, `success`. Tamaños: `sm`, `default`, `lg`, `xl` (CTA hero),
`icon`, `icon-sm`; full-width con `w-full`. FAB = `Button size="icon"` +
`rounded-full shadow-floating` (patrón `QrFab`). Estados integrados; loading
= spinner `Loader2` + `disabled` (patrón existente en formularios).

Reglas: 1 botón `default` por vista · destructivo siempre `destructive` +
`ConfirmDialog` · icono a la izquierda del texto.

### 9.2 Campos (`input`, `textarea`, `select`, `password-input`, OTP…)

Input/Textarea/Select/PasswordInput viven en la librería; OTP (`input-otp`),
date (`react-day-picker`), search (patrón `Search` icon + `Input pl-9`),
currency y phone se componen sobre `Input`. Todos heredan estados de
foco/error (`aria-invalid` → ring destructivo). Labels siempre visibles —
nunca placeholder como label.

### 9.3 Tarjetas — el sistema de cards

Base: `Card` (bg-card, `rounded-2xl`, shadow 1) y `.card-interactive` para
hover. Especializadas ya construidas y dónde usarlas:

| Card | Cuándo |
| --- | --- |
| **WalletCard** | la membresía como objeto (detalle y stack del wallet) |
| **PromoAd / Promotion Card** | promociones estilo Temu: imagen + PromoBadge + precio |
| **BusinessCard / Company Card** | empresas en explorar/marketplace |
| **StatCard / Statistics Card** | KPIs con contador animado (dashboards) |
| **Benefit/Reward/Coupon** | variantes de Promotion Card con badge `gratis`/`premium` |
| **Notification Card** | filas del centro de notificaciones |
| **Hero Card** | banner protagonista de inicio (gradiente de marca) |
| **GlassCard** (`@membego/ui/ui/glass-card`) | overlays sobre imagen/gradiente — nunca sobre fondo plano |
| **Payment Card** | métodos de pago y resúmenes de cobro (caja/facturas) |

Regla: una lista = un tipo de card. No mezclar densidades.

### 9.4 Badges

- **Semánticos** (`Badge`): `success` (activo/pagado), `warning`
  (pendiente), `destructive` (rechazado/expirado), `info`, `secondary`
  (finalizado/neutro). Cambian con el tema.
- **Marketing** (`PromoBadge`, nuevo): `nuevo`, `hot`, `premium`,
  `urgencia` (expira/limitado), `gratis`, `recomendado`, `neutro`. Colores
  fijos que NO cambian con el tema — una oferta se ve igual de urgente en
  claro y oscuro. Pill, uppercase, máx. 2 por tarjeta.

### 9.5 Biblioteca restante

Ya existen y son la referencia: Navbar/AppHeader, Sidebar, Bottom Navigation
móvil, Tabs, Carousel (embla), Alert, Toast (sonner), Sheet/Drawer (vaul),
Modal/Dialog/ConfirmDialog, Tooltip, Popover, Accordion, Progress, Avatar,
QR Viewer/Scanner, FAB (QrFab), Notification Bell, Countdown (campañas),
Skeleton, EmptyState, PageHeader, DataTable, StatusBanner. Los widgets
(Membership/Promotion/Referral/Company) son composiciones de estas piezas —
no se crean primitivas nuevas sin pasar por este documento.

## 10 · Iconografía

**Lucide line, único set permitido.** Tamaños: 12–14 px dentro de badges,
16 px en botones, 20 px en nav, 24 px standalone, 28 px en EmptyState.
Color: `text-muted-foreground` por defecto; `text-primary` solo si es de
marca; semántico si acompaña un estado. Animación de iconos solo en carga
(`animate-spin` en `Loader2`) y celebraciones.

## 11 · Animaciones

**Tokens**: `--duration-instant/fast/base/slow/hero` (100/150/200/350/500 ms)
y easings `--ease-out-expo` (entradas) / `--ease-spring` (celebraciones).

| Momento | Animación | Técnica |
| --- | --- | --- |
| Entrada de pantalla | `.animate-fade-up` (350 ms) | CSS |
| Entrada de cards en lista | fade-up con `.delay-75/100/150…` (stagger) | CSS |
| Botón press | `active:scale-[0.98]` | CSS |
| Hover de card | `.card-interactive` (−2 px + shadow 2) | CSS |
| Carga | `.skeleton-shimmer` — nunca spinners de página | CSS |
| Contadores/KPIs | `AnimatedCounter` | JS (rAF) |
| Confeti / premios / canje OK | `CelebracionOverlay` | Canvas |
| Cuenta regresiva | `Countdown` de campañas | JS |
| Escaneo QR | `.scanner-line` | CSS |
| FAB / elementos vivos | `.animate-pulse-soft`, `.animate-float` | CSS |
| Modales/sheets | `.animate-scale-in` / slide del sheet | CSS + Radix |

Reglas: nada > 500 ms · una animación "wow" por pantalla · **todas** deben
respetar `prefers-reduced-motion` (ya cubierto globalmente) · Framer
Motion/Lottie/Rive se reservan para fases futuras — hoy CSS + Canvas cubren
el sistema y pesan cero.

## 12 · Tokens de diseño (resumen técnico)

- **CSS** (`globals.css`): semánticos por tema (`:root`, `.dark`,
  `.theme-landing`), escala `--color-primary-*`, cyan de marca, `--overlay`,
  `--skeleton`, `--glass-*`, `--glow-color`, radios, motion.
- **TS** (`@membego/ui/tokens`): mismos valores en hex/px para móvil,
  emails, OG y PDF. **Regla de sincronía**: cambiar un valor = cambiarlo en
  ambos archivos en el mismo PR.

## 13 · Reglas de uso (convenciones para desarrolladores)

1. Prohibido el hex suelto en componentes — solo tokens/clases del sistema.
2. Prohibido `text-2xl font-bold` a mano para títulos — usar `.text-h*`.
3. Todo componente nuevo entra por `packages/ui` si es genérico, o
   `src/components/<dominio>` si es de negocio — nunca duplicado por página.
4. Espaciado y radios solo de la escala (§6, §8).
5. Toda vista nueva incluye: skeleton, empty state, estado de error.
6. Server Components por defecto; `'use client'` solo con interacción.
7. Textos en español, tono cercano, sin jerga técnica.
8. Números de dinero: `tabular-nums` + formato `RD$` con `toLocaleString('es-DO')`.
9. Modo oscuro y claro se prueban SIEMPRE (la app arranca en ambos).
10. `prefers-reduced-motion` es obligatorio en cualquier animación nueva.

## 14 · Do & Don't

| ✅ Do | ❌ Don't |
| --- | --- |
| Un CTA primario por pantalla | Tres botones de marca compitiendo |
| `PromoBadge tono="urgencia"` para "Expira hoy" | Un `Badge destructive` (eso es un error del sistema) |
| Skeleton que calca el layout | Spinner centrado en página |
| `rounded-2xl` en tarjetas | Radios distintos por página |
| Glass sobre foto/gradiente | Glass sobre fondo blanco plano |
| Confeti al activar un plan | Confeti al guardar un formulario |
| `text-muted-foreground` para apoyo | Grises hex inventados |
| `.bg-gradient-brand` | Gradientes nuevos por pantalla |

## 15 · Accesibilidad

- **Contraste**: AA mínimo (4.5:1 texto normal, 3:1 grande). Los pares
  token/foreground ya lo cumplen — no combinar tokens manualmente sin
  verificar.
- **Táctil**: mínimo 44×44 px (`minTouchTarget` en tokens); los `Button`
  estándar cumplen; en iconos usar `size="icon"`.
- **Foco**: visible siempre (anillo global). Nunca `outline: none` sin
  reemplazo.
- **Teclado**: todo lo interactivo alcanzable con Tab (Radix lo garantiza en
  overlays); orden lógico.
- **Screen readers**: iconos decorativos con `aria-hidden`; botones de solo
  icono con `aria-label`; imágenes con `alt` real.
- **Movimiento**: `prefers-reduced-motion` global (§11).

## 16 · Checklist para validar una pantalla nueva

- [ ] ¿Se diseñó primero en 390 px (mobile)?
- [ ] ¿Hay UN solo CTA primario?
- [ ] ¿Skeleton + empty state + error implementados?
- [ ] ¿Solo tokens del sistema (cero hex, cero tamaños ad-hoc)?
- [ ] ¿Títulos con `.text-h*` y espaciado de la escala?
- [ ] ¿Tarjetas `rounded-2xl` con sombra del catálogo (máx. 2 niveles)?
- [ ] ¿Badges correctos (semántico vs marketing)?
- [ ] ¿Iconos Lucide line en tamaños estándar?
- [ ] ¿Animación de entrada + press states, y respeta reduced-motion?
- [ ] ¿Probada en claro Y oscuro (y landing si aplica)?
- [ ] ¿Foco visible, targets de 44 px, `aria-label` en icon buttons?
- [ ] ¿Textos en español, sin jerga, montos con `tabular-nums`?

## 17 · Plan de migración al MDS

El MDS **formaliza** el sistema que la app ya usa (tokens OKLCH, escala
tipográfica, elevaciones, componentes compartidos) — no lo reemplaza. La
migración es incremental y sin big-bang:

- **Fase 1 (este PR)**: documento maestro + escala Primary 50–900 + tokens de
  motion/overlay/skeleton/glass + `PromoBadge` + `GlassCard` + tokens TS.
  Cero cambios de lógica; cero regresión visual.
- **Fase 2 — barrido de consistencia**: reemplazar hex sueltos y chips
  ad-hoc (`bg-success/15 …` repetidos) por `Badge`/`PromoBadge`; títulos
  manuales → `.text-h*`. Módulo a módulo, empezando por las vistas del
  cliente (mayor tráfico).
- **Fase 3 — pantallas hero**: elevar inicio del cliente, wallet y
  marketplace al nivel Apple/Revolut/Temu usando exclusivamente piezas MDS.
- **Fase 4 — panel de empresa**: densidad tipo Linear (tablas, filtros,
  dashboards) sobre los mismos tokens.
- **Fase 5 — extracción**: publicar `@membego/ui` como paquete versionado
  (GitHub Packages) y consumir los tokens TS desde la app móvil.

Criterio de "migrado": la pantalla pasa el checklist §16 completo.
