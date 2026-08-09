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
  `--primary-soft` para los estados. Gradiente: `.bg-gradient-brand`
  (azul → cian), con moderación — hero, CTA protagonista, dock del QR.
- **Superficies:** `--background`, `--card`, `--muted`, `--border`.
- **Estados semánticos** — usar SIEMPRE estos, nunca `text-green-600` suelto:

| Estado | Clases |
|---|---|
| Éxito | `text-success`, `bg-success/10` |
| Alerta | `text-warning`, `bg-warning/10` |
| Peligro | `text-destructive`, `bg-destructive/10` |
| Info | `text-info`, `bg-info/10` |

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
| 13 | Reportes | ⬜ |
| 14 | Empresa, empleados, configuración | ⬜ |
| 15 | Soporte | ⬜ |
| 16 | Superadmin | ⬜ |
| 17 | Empleado | ⬜ |
| 18 | Páginas públicas | ⬜ |
| 19 | Dark mode, accesibilidad, QA visual | ⬜ |
| 20 | Eliminar el frontend visual heredado | ⬜ |

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
