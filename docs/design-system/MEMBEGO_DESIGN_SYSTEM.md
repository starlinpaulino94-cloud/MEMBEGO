# Membego Design System

## Identidad visual y experiencia unificada del ecosistema

**Versión** 1.0 · **Estado** borrador para revisión · **Fecha** 2026-08-10
**Alcance** Membego y todos los sistemas verticales conectados
**Sustituye a** `docs/MDS.md` y `docs/DESIGN_SYSTEM.md` (ver § 3.2)

---

# 2 · Resumen ejecutivo

## Lo que se pidió y lo que se encontró

El encargo asumía un punto de partida sin sistema de diseño. **No es el caso.**
Membego tiene un sistema de tokens maduro, con decisiones documentadas y —lo que
es más raro— **pruebas automáticas que las vigilan**: cuatro archivos de test
comprueban contraste, espejo de tokens, separación de matices y nombres
accesibles en formularios.

El problema real es distinto y más grave:

> **Existen dos documentos que se declaran maestros, y no dicen lo mismo.**

| Fuente | Color de marca que declara |
|---|---|
| `docs/MDS.md:131` | `#2563eb` |
| `packages/ui/src/tokens.ts` (correos, OG, PDF) | `#2563eb` |
| **`src/app/globals.css:152`** (lo que ve el usuario) | `oklch(0.55 0.22 255)` = **`#006bed`** |

Y aquí está lo importante: **no es un desacuerdo entre documentos, es un
desacuerdo entre dos fuentes de código.** Los dos documentos tenían razón; lo
que no coincide son las fuentes que describen.

La escala de marca de `globals.css` y la de `tokens.ts` son **dos azules
distintos**, con hasta 65 unidades sRGB de separación en el paso 500 — se ven
diferentes a simple vista. La prueba que vigila el espejo (`espejo-tokens.test.ts`)
**solo compara los cuatro estados semánticos**, así que la escala de marca lleva
tiempo desincronizada sin que nada falle.

**Consecuencia práctica:** un cliente que recibe un correo de Membego y luego
abre la aplicación ve dos azules de marca distintos. Detalle completo en A-13.

Con dos maestros y dos fuentes, un equipo nuevo elige el que encuentra primero.
Con tres sistemas verticales, elige tres veces distinto.

## Diagnóstico en una línea

**Los cimientos están bien; la gobernanza no existe.** El sistema no se va a
romper por falta de tokens, sino porque nada impide que el cuarto sistema
conectado invente los suyos.

## Los cinco números que importan

Medidos sobre 1 109 archivos (`src` + `packages/ui/src`), con comentarios
descontados:

| Medida | Hoy | Severidad |
|---|---|---|
| Pasos de la escala de marca desincronizados entre las dos fuentes | **10 de 10** | 🔴 Crítica |
| Textos por debajo de 12 px | **160** | 🔴 Crítica |
| Campos de formulario sin nombre accesible | **99** | 🔴 Crítica |
| Clases de color de Tailwind fuera del vocabulario semántico | **333** | 🟠 Alta |
| Radios fuera del vocabulario declarado | **95** | 🟡 Media |
| HEX escritos a mano en interfaz real | **85** | 🟡 Media |

Y dos que están **bien** y conviene no romper:

| Medida | Hoy |
|---|---|
| Pares de contraste que fallan WCAG AA | **0 de 51** |
| Sombras fuera de la escala | **0** |

## Qué falta de verdad para el ecosistema

Nada de lo anterior es lo que impide que un sistema de restaurante se parezca a
Membego. Lo que lo impide es esto:

1. **No hay shell compartido.** `AppShell`, `AppSidebar`, `AppHeader` y
   `BottomNav` viven en `src/components/layout/`, dentro del monolito. Un
   satélite no puede importarlos.
2. **`@membego/ui` no incluye la navegación.** Exporta 50 componentes, ninguno
   de shell.
3. **No hay `@membego/design-tokens`.** Los tokens viven en `globals.css` (web)
   y en `packages/ui/src/tokens.ts` (espejo manual). Un satélite en otro
   repositorio no tiene de dónde leerlos.
4. **No hay Storybook ni pruebas de regresión visual.**

---

# 3 · Alcance

## 3.1 · Qué cubre

Este documento es la fuente oficial para diseñadores, desarrolladores e IA que
trabajen en:

- Membego (aplicación principal: cliente, admin, empleado, superadmin, público)
- Sistema de Car Wash (hoy embebido en el monolito)
- Sistemas verticales futuros: restaurante, salón, gimnasio, hotel, y los que
  registre un manifiesto (ver `docs/platform/satelite.md`)

## 3.2 · Relación con los documentos existentes

| Documento | Qué pasa con él |
|---|---|
| `docs/MDS.md` | **Absorbido.** Su contenido de color, tipografía y tokens está aquí, corregido contra el código. Queda como puntero |
| `docs/DESIGN_SYSTEM.md` | **Absorbido.** Es el más cercano al código actual; sus decisiones se conservan casi íntegras |
| `docs/MMS.md` | **Se mantiene.** Sistema de movimiento, referenciado desde § 23. No se duplica aquí |
| `docs/GUIA_LENGUAJE_MEMBEGO.md` | **Se mantiene.** Lenguaje, copy y estados canónicos. Es el par de este documento, no su competidor |

> Esta decisión requiere aprobación (ver § 30). Mientras no se apruebe, los tres
> siguen vigentes y la contradicción sigue viva.

## 3.3 · Qué NO cubre

- Lógica de negocio de cada vertical (mesas, bahías, comandas)
- Contratos de datos entre sistemas → `packages/contracts`
- Reglas de lenguaje y nombres de estados → `docs/GUIA_LENGUAJE_MEMBEGO.md`

---

# 4 · Metodología de análisis

## 4.1 · Qué se hizo

1. Inventario de dependencias de interfaz desde `package.json`
2. Lectura completa de `src/app/globals.css` (952 líneas) y
   `packages/ui/src/tokens.ts` (146)
3. Lectura de los cuatro documentos de diseño existentes
4. **Medición automática** sobre 1 109 archivos `.ts`/`.tsx`, descontando
   comentarios antes de contar
5. Ejecución de `scripts/contraste.mjs` (51 pares, tres temas)
6. Inventario de los 50 componentes de `@membego/ui` y los 258 de
   `src/components`

## 4.2 · Cómo se contó

El script de auditoría **descuenta comentarios antes de buscar**. Sin eso, un
archivo que documenta «no escribas `text-[11px]`» se cuenta como infracción, y
el número deja de significar nada.

También separa lo legítimo de la deuda. Ejemplo: de 158 HEX encontrados, **73
están en generadores de imágenes OG y plantillas de correo**, donde las
variables CSS no existen y el hex es la única opción. Contarlos como deuda sería
falsear el diagnóstico. La deuda real son **85**.

## 4.3 · Qué no se pudo verificar

- Ninguna captura de pantalla: no hay entorno de ejecución con datos
- Ningún archivo de Figma o manual de marca (§ 31.1)
- No se verificó el comportamiento real en dispositivos táctiles
- El contraste se verificó **entre tokens**, no sobre composiciones reales con
  imágenes de fondo

---

# 5 · Auditoría del estado actual

## 5.1 · Nivel general de consistencia

**Alto en los cimientos, medio en la aplicación, inexistente en gobernanza.**

| Capa | Estado |
|---|---|
| Tokens de color | 🟢 Completo, semántico, con modo oscuro diseñado (no invertido) |
| Contraste | 🟢 51/51 pares pasan AA, verificado por script |
| Escala tipográfica | 🟢 Definida (9 niveles) 🟠 poco adoptada (160 tamaños a mano) |
| Elevación | 🟢 Tres niveles, cero sombras arbitrarias |
| Radios | 🟠 Vocabulario definido, 95 usos fuera |
| Color en componentes | 🟠 333 clases de paleta cruda |
| Formularios | 🔴 99 campos sin nombre accesible |
| Shell compartido | 🔴 No extraíble |
| Gobernanza | 🔴 Dos maestros contradictorios |

## 5.2 · Lo mejor resuelto

**1. Los estados semánticos se corrigieron con evidencia de uso.**
`globals.css:190-215` documenta que los valores anteriores fallaban como texto
(éxito 3,62:1, alerta **2,28:1**, info 3,44:1) y que el uso real era 150
`text-success` y 118 `text-warning` frente a 23 rellenos sólidos — es decir, el
token estaba optimizado para su caso raro. Se corrigieron a 4,64 · 4,65 · 4,59.

Eso es un sistema de diseño funcionando: una decisión revisada contra el uso
real, no contra el gusto.

**2. El azul del menú NO es el azul de marca, y está explicado.**
`globals.css:227-231`: el azul de marca (L .55) sobre el navy del menú (L .14)
da ~3,4:1, por debajo de AA. El menú usa un azul aclarado (L .72) que da ~7:1.
Con una nota de que si se toca el navy hay que recalcular el par.

**3. `--info` está separado de la marca por prueba automática.**
`tests/token-info.test.ts` exige 30° de separación de matiz entre `--info` (215)
y `--primary` (255), para que un aviso informativo no parezca un botón.

**4. Las quince sombras eran tres.** `globals.css:527` documenta que
`.shadow-card`, `.shadow-premium` y `.shadow-premium-lg` tenían valores
**idénticos** a `elevation-1/2/3`. Ya eran alias sin saberlo.

## 5.3 · Problemas encontrados

### 🔴 CRÍTICA · A-1 · Dos documentos maestros que se contradicen

**Estado actual:** `MDS.md` y `DESIGN_SYSTEM.md` declaran los dos ser el
documento maestro y dan valores de marca distintos.
**Decisión canónica:** un solo maestro (este). Los otros quedan como punteros.
**Justificación:** con dos fuentes, cada equipo elige la que encuentra primero.
Con tres verticales, se elige tres veces distinto — que es exactamente el
resultado que este encargo quiere evitar.
**Impacto de migración:** ninguno en código. Requiere aprobación.

### 🔴 CRÍTICA · A-2 · 99 campos de formulario sin nombre accesible

**Estado actual:** `tests/accesibilidad-formularios.test.ts` mide 99 y lo
congela como techo.
**Decisión canónica:** todo control de entrada lleva `<Label htmlFor>` o
`aria-label`. Techo objetivo: 0.
**Justificación:** un campo sin nombre accesible es un campo que un lector de
pantalla anuncia como «edición, en blanco». No es una molestia: es un
formulario que no se puede completar.
**Impacto:** 99 ediciones mecánicas, sin riesgo de regresión visual.

### 🔴 CRÍTICA · A-3 · 160 textos por debajo del suelo legible

**Estado actual:** 101 a `11px`, 57 a `10px`, uno a `10.5px`, uno a `9px`. El
sistema declara el suelo en 12,5 px (`.text-caption`).
**Concentración:** `Pista.tsx` (11), `PlanesGrid.tsx` (10), y el resto repartido
en paneles de Car Wash y admin.
**Decisión canónica:** nada de la interfaz baja de 12 px. Etiquetas de sección
usan `.text-overline` (12 px + mayúsculas + tracking), no un tamaño menor.
**Justificación:** `Pista.tsx` es la pantalla de una **pista de lavado** —se
mira de pie, a distancia de brazo, a veces con sol. Es el peor sitio posible
para 10 px.
**Impacto:** 160 sustituciones; algunas obligan a acortar textos o reordenar la
tarjeta. No es mecánico.

### 🟠 ALTA · A-4 · 333 clases de color crudo de Tailwind

**Estado actual:** `text-emerald-600` (13), `bg-emerald-500` (12),
`bg-amber-500` (9), `bg-sky-500` (7)… Concentrado en
`CampanaLanding.tsx` (36), **`packages/ui/src/ui/stat-card.tsx` (30)**,
`cliente/pagos` (22), `membresia/[id]` (22).
**Decisión canónica:** en producto, solo tokens semánticos. Excepción: paletas
categóricas de gráficos (§ 17), que necesitan tonos que ningún semántico cubre.
**Justificación agravante:** que 30 de ellas estén en `@membego/ui` es lo grave.
Ese paquete es lo que un satélite instalaría: exportar un `StatCard` con
esmeralda cruda dentro significa **repartir la inconsistencia a cada sistema
nuevo**.
**Impacto:** `stat-card.tsx` primero (es el que se propaga), luego el resto.

### 🟠 ALTA · A-5 · No existe shell compartido extraíble

**Estado actual:** `AppShell`, `AppSidebar`, `AppHeader`, `BottomNav`,
`CommandPalette`, `MenuUsuario`, `NotificationBell` viven en
`src/components/layout/`. `@membego/ui` no exporta ninguno.
**Decisión canónica:** extraer a `@membego/app-shell` (§ 20).
**Justificación:** sin esto, «que se parezca a Membego» depende de que cada
equipo lo reconstruya mirando capturas. Se reconstruye distinto siempre.
**Impacto:** alto. Es la Fase 2 del plan (§ 29).

### 🟠 ALTA · A-6 · El espejo de tokens se mantiene a mano

**Estado actual:** `packages/ui/src/tokens.ts:9` lo dice explícitamente: «si un
valor cambia aquí, debe cambiar también en `globals.css` (y viceversa)». Hay
una prueba (`tests/espejo-tokens.test.ts`) que lo vigila.
**Decisión canónica:** generar el espejo desde una fuente única
(`@membego/design-tokens`), no sincronizarlo.
**Justificación:** la prueba **no** evitó que se separaran — solo mira cuatro
tokens de 24, y la escala de marca ya divergió (A-13). Un espejo manual con una
prueba parcial da la sensación de estar cubierto sin estarlo, que es peor que no
tener prueba.

### 🔴 CRÍTICA · A-13 · El espejo de tokens **ya está desincronizado** en la escala de marca

**Cómo se encontró:** al convertir los OKLCH de `globals.css` a HEX para esta
tabla, en vez de copiar los del espejo.

**Estado actual:** la escala de marca de `globals.css` y la de
`packages/ui/src/tokens.ts` **son dos azules distintos**:

| Paso | `globals.css` (OKLCH→HEX) | `tokens.ts` | Distancia sRGB |
|---|---|---|---|
| 50 | `#f0f6ff` | `#eff4ff` | 2 |
| 100 | `#ddecff` | `#dbe6fe` | 6 |
| 200 | `#bedcff` | `#bfd3fe` | 9 |
| 300 | `#92c4ff` | `#93b4fd` | 16 |
| 400 | `#52a2ff` | `#608cfa` | 27 |
| **500** | **`#0084ff`** | **`#3b6bf6`** | **65** |
| 600 | `#006bed` | `#2563eb` | 38 |
| 700 | `#0059ce` | `#1d4ed8` | 33 |
| 800 | `#0049a7` | `#1e40af` | 32 |
| 900 | `#004087` | `#1e3a8a` | 31 |

El de CSS es un azul **puro y saturado**; el del espejo es el azul de Tailwind
(`blue-500`/`blue-600`), más apagado y violáceo. En el paso 500 la diferencia es
de 65 unidades sRGB: **se ven distintos a simple vista**.

**Por qué pasó:** `tests/espejo-tokens.test.ts:67` compara **solo los cuatro
estados semánticos** (`success`, `warning`, `danger`, `info`). La escala de marca
no la mira nadie. La Fase 19 sincronizó los estados y la escala se quedó donde
estaba.

**Dónde se nota:** en todo lo que consume el espejo — **correos, imágenes OG,
PDF y recibos**. Un cliente que recibe un correo de Membego y luego abre la
aplicación ve **dos azules de marca distintos**.

**Y explica la contradicción del § 2:** `MDS.md` dice que el azul de marca es
`#2563eb` porque leyó el espejo. La interfaz pinta `#006bed`. Los dos
documentos tenían razón sobre fuentes distintas — el problema es que las fuentes
no coinciden.

**Decisión canónica:** la escala de `globals.css` manda (es la que ve el
usuario en la aplicación). El espejo se **genera**, no se copia. Mientras tanto,
ampliar `espejo-tokens.test.ts` para que cubra los 10 pasos.

**Impacto:** cambia el azul de correos, OG y PDF. Es un cambio visible que hay
que aprobar (D-8).

### 🟡 MEDIA · A-7 · 95 radios fuera del vocabulario

`rounded-3xl` (52), `rounded-md` (31), `rounded-sm` (8). El vocabulario
declarado es `lg` / `xl` / `2xl` / `full`.
**Matiz importante:** 6 de los `rounded-md` están en
`packages/ui/src/ui/dropdown-menu.tsx`, que es un componente de Radix con
estilos por defecto de shadcn. **No es descuido: es código que nadie tocó.**

### 🟡 MEDIA · A-8 · 85 HEX en interfaz real

Concentrados en piezas donde el color es **contenido gráfico**, no interfaz:
`RuletaWheel.tsx` (9), `CelebracionOverlay.tsx` (8), `QRShareCard.tsx` (7),
`ConfettiCelebration.tsx` (6), `MilestoneConfetti.tsx` (6).
**Decisión canónica:** una paleta de celebración con nombre
(`--color-celebration-1..n`), no hex sueltos. Los de `GoogleSignInButton.tsx`
(4) **se quedan**: son los colores oficiales de Google y no pueden cambiar.

### 🟡 MEDIA · A-9 · 48 duraciones fuera de los tokens de movimiento

`duration-150` (20), `duration-200` (12), `duration-300` (10). Los tokens
existen (`--duration-fast: 150ms`, `--duration-base: 200ms`) y coinciden en
valor — **son alias no declarados**, el mismo caso que las sombras. Migración
mecánica y sin riesgo visual.

### 🟡 MEDIA · A-10 · 12 z-index arbitrarios

`z-[500]` (4), `z-[100]` (3), `z-[600]`, `z-[110]`, `z-[120]`, `z-[95]`, `z-[60]`.
Sin escala declarada. `MapaCercaDeMi.tsx` concentra 5.
**Riesgo:** un modal por debajo de un mapa. Se descubre en producción.

### 🟢 BAJA · A-11 · Dos componentes con el mismo nombre en dos sitios

`CampanaForm` (`admin/` y `audiencia/`) y `ReglaRecompensaForm` (`admin/` y
`growth/`). Hay que decidir cuál es el canónico.

### 🟢 BAJA · A-12 · Una sola librería de iconos, y es correcto

366 importaciones, **todas de `lucide-react`**. Cero mezcla. Se documenta como
regla ya cumplida.

## 5.4 · Riesgos para el ecosistema

| Riesgo | Severidad | Por qué |
|---|---|---|
| Cada vertical reconstruye el shell | 🔴 | No hay paquete que importar |
| Cada vertical copia los tokens | 🔴 | No hay `@membego/design-tokens` |
| `@membego/ui` reparte deuda | 🟠 | 30 colores crudos en `stat-card` |
| Sin regresión visual, la deriva no se ve | 🟠 | Se descubre por capturas de usuarios |
| Personalización sin límites rompe la identidad | 🟠 | `Company.colorPrimario` existe sin validación de contraste |

---

# 6 · Principios de diseño

Seis principios. Cada uno con su traducción a una decisión concreta —un
principio que no cambia una decisión es un adjetivo.

## P1 · El beneficio se ve antes que la marca

Membego existe para que alguien sepa **qué se ahorra y qué le queda**. Ese dato
gana la jerarquía de cualquier pantalla.

**Se traduce en:** el número del beneficio usa el peso y el tamaño más altos de
su tarjeta. El logo de la empresa nunca compite con él. En una tarjeta de
membresía, «3 lavados restantes» pesa más que el nombre del plan.

## P2 · El azul manda poco

El color de marca es de **acción**, no de decoración. Una pantalla donde todo es
azul es una pantalla sin jerarquía.

**Se traduce en:** una acción primaria dominante por sección. Los iconos
decorativos van en `--muted-foreground`, no en `--primary`. Las tarjetas no
llevan borde azul salvo selección.

## P3 · El estado se dice, no solo se colorea

**Se traduce en:** todo estado lleva texto o icono además de color. `StatusChip`
nunca es un punto de color a secas. Es también lo que exige WCAG 1.4.1 y lo que
necesita alguien que distingue mal el rojo del verde — que en un negocio con
empleados de todas las edades no es un caso hipotético.

## P4 · Operativo antes que bonito

Media plataforma se usa **de pie**: una pista de lavado, una caja, una cocina.
Ahí no hay tiempo ni comodidad.

**Se traduce en:** suelo de 12 px sin excepciones. Área táctil mínima 44×44.
Nada crítico escondido en un menú de tres puntos. **`Pista.tsx` con 11 textos
por debajo del suelo es la infracción más cara del sistema** — no por cantidad,
sino por dónde está.

## P5 · Especializado por dentro, Membego por fuera

Un restaurante y un lavadero tienen operaciones distintas y **deben** tenerlas.
Lo que no puede cambiar es el marco.

**Se traduce en:** shell, navegación, tipografía, color, estados, formularios,
tablas y feedback vienen del sistema. Mesas, bahías y comandas son del vertical.
Un vertical **nunca** redefine un token semántico.

## P6 · La coherencia se hereda, no se copia

**Se traduce en:** todo lo compartido se **instala** (`@membego/*`). Si un
equipo tiene que mirar una captura para parecerse a Membego, el sistema falló.
Es el mismo principio que la Fase 4 de la plataforma aplicó a los contratos de
datos: una fuente, nunca una copia.

---

# 7 · Identidad de marca

## 7.1 · Activos existentes

| Activo | Ruta | Estado |
|---|---|---|
| Logo principal | `public/logo.svg` | 🟢 |
| Favicon | `public/favicon.ico`, `favicon-16.png`, `favicon-32.png` | 🟢 |
| Icono de app | `public/icon-192.png`, `icon-512.png`, `icon-48.png` | 🟢 |
| Apple touch | `public/apple-touch-icon.png` | 🟢 |
| OG por defecto | `public/og-image.png` | 🟢 |
| Componente | `src/components/layout/Logo.tsx` | 🟢 |
| Logo horizontal | — | 🔴 Pendiente |
| Isotipo suelto | — | 🔴 Pendiente |
| Monocromático | — | 🔴 Pendiente |
| Versión para fondo oscuro | — | 🔴 Pendiente |
| Área de seguridad y tamaño mínimo | — | 🔴 Pendiente |
| Manual de marca / Figma | — | 🔴 Pendiente (§ 31.1) |

## 7.2 · El gradiente de marca

Del código: azul (matiz 255) → cyan (matiz 200), en
`--color-cyan-brand-300/500/700` y las clases `.bg-gradient-brand` /
`.text-gradient-brand`.

**Regla:** el cyan **cierra el gradiente del logo y jamás es color de acción**
(`docs/MDS.md:129`). Un botón cyan se lee como un estado informativo.

## 7.3 · Convivencia de las tres marcas

```
[Membego] │ Restaurante          [logo empresa] Sabores del Mar
 ecosistema   sistema                     empresa cliente
```

| Nivel | Qué es | Dónde aparece | Puede cambiar |
|---|---|---|---|
| **Ecosistema** | Membego | Menú (arriba), login, pie, documentos | Nunca |
| **Sistema** | Restaurante, Car Wash | Junto a Membego, peso menor | Lo fija el manifiesto |
| **Empresa** | Sabores del Mar | Cabecera, perfil, tarjetas | Logo y foto |

**Regla dura:** la marca de la empresa **nunca sustituye** a la de Membego.
Puede acompañarla. Un usuario que abre el sistema de restaurante de su empresa
tiene que saber que está dentro de Membego sin buscarlo.

---

# 8 · Paleta de colores

> **Fuente de verdad:** `src/app/globals.css`. Los HEX de esta tabla son la
> conversión del OKLCH declarado, para consumidores sin soporte OKLCH.

## 8.1 · Marca

| Token | OKLCH claro | HEX claro | HEX oscuro | Uso permitido | Uso prohibido | Origen |
|---|---|---|---|---|---|---|
| `--primary` | `0.55 0.22 255` | **`#006bed`** | `#59a6ff` | Acción primaria, enlaces, foco, selección | Fondo de párrafos, iconos decorativos | `globals.css:152` |
| `--primary-hover` | `0.488 0.203 255` | `#0059ce` | — | Hover del CTA | Estado de reposo | `globals.css:155` |
| `--primary-soft` | `0.938 0.032 255` | `#ddecff` | — | Fondo de chip seleccionado | Texto | `globals.css:156` |
| `--accent` | `0.945 0.025 200` | — | — | Fondo de acento cyan | Acción | `globals.css:166` |
| `--accent-foreground` | `0.40 0.14 200` | — | — | Texto sobre acento | CTA | `globals.css:167` |

**Escala numérica fija** (`--color-primary-50..900`, matiz 255): para
gradientes, ilustraciones y tonos exactos. **No cambia con el tema** — por eso
no sirve para texto adaptable.

## 8.2 · Neutrales

| Token | HEX claro | HEX oscuro | Uso | Origen |
|---|---|---|---|---|
| `--background` | `#f9fafb` | `#0a0b0d` | Lienzo | `globals.css:138` |
| `--card` / `--color-surface` | `#ffffff` | `#121416` | Tarjetas, paneles | `:142` |
| `--popover` | `#ffffff` | `#121416` | Menús, popovers | `:146` |
| `--muted` / `--color-surface-subtle` | `#f0f2f4` | — | Fondo secundario | `:162` |
| `--foreground` | `#060911` | `#f0f2f5` | Texto principal | `:139` |
| `--muted-foreground` | `#60636a` | `#83868c` | Texto secundario | `:163` |
| `--border` | `#d2d4d8` | `rgba(255,255,255,.08)` | Bordes | `:216` |
| `--input` | `#d2d4d8` | `rgba(255,255,255,.12)` | Borde de campo | `:217` |
| `--ring` | `#006bed` | `#59a6ff` | Anillo de foco | `:218` |
| `--overlay` | `oklch(.14 .02 264 / 45%)` | `oklch(.05 0 0 / 60%)` | Fondo de modal | `:221` |
| `--skeleton` | — | — | Carga | `:222` |

> **`--border` está en 1,48:1 y es deliberado.** El valor anterior (0.914) daba
> 1,29:1: una tarjeta no se distinguía de la página salvo por su sombra
> (`globals.css:212`).

## 8.3 · Semánticos

| Token | HEX claro | HEX oscuro | Contraste como texto | Origen |
|---|---|---|---|---|
| `--success` | `#00864d` | `#23ba7d` | 4,64:1 · 7,39:1 | `globals.css:203` |
| `--warning` | `#ab6300` | `#f0b135` | 4,65:1 · 9,74:1 | `:205` |
| `--destructive` | `#e7000b` | `#ff6467` | 4,76:1 · 6,38:1 | `:169` |
| `--info` | `#00809b` | `#35afc9` | 4,59:1 · 7,17:1 | `:209` |

> Los cuatro HEX de modo claro coinciden **exactamente** con
> `packages/ui/src/tokens.ts`. Es el único bloque donde el espejo está
> verificado por prueba — ver A-13.

Cada uno con variante `-foreground` para uso como relleno sólido.

**Reglas:**
- `--info` es un **estado**, no un acento. Separado 30° de la marca, con prueba
  (`tests/token-info.test.ts`)
- El **verde es exclusivamente éxito**. Dejó de ser color de marca en DS 2.0
- `--warning-foreground` es **claro** en tema claro y **oscuro** en tema oscuro.
  No es una errata: el ámbar pasó de pálido a medio
- **Pendiente** (🔴): no existe token para el estado *pendiente/neutral* que
  pide el encargo. Hoy se resuelve con `--muted-foreground`

## 8.4 · Prohibiciones

| Prohibido | Por qué |
|---|---|
| Cyan como color de acción | Se lee como estado informativo |
| Verde para algo que no sea éxito | Fue color de marca; reusarlo revive la ambigüedad |
| Escala numérica (`primary-500`) para texto | No cambia con el tema: ilegible en oscuro |
| `--primary` sobre el navy del menú | 3,4:1, por debajo de AA. Usa `--sidebar-primary` |
| Paleta cruda de Tailwind en producto | No tiene modo oscuro ni significado |
| Gradiente detrás de texto pequeño | El contraste varía a lo largo del gradiente |

---

# 9 · Tipografía

## 9.1 · Familias

| Rol | Familia | Carga | Origen |
|---|---|---|---|
| Display / títulos | **Plus Jakarta Sans** | `next/font/google`, variable | `src/app/layout.tsx:2` |
| Texto | **Geist** | `next/font/google`, variable | `layout.tsx:9` |
| Monoespaciada | **Geist Mono** | `next/font/google` | `layout.tsx:14` |

Variable font: todos los pesos en un archivo. Las tres soportan español completo
(tildes, ñ, ¿, ¡).

## 9.2 · Escala oficial

Definida en `globals.css:467-520`.

| Clase | Móvil → Escritorio | Peso | Interlineado | Uso |
|---|---|---|---|---|
| `.text-display` | 40 → 72 px | 800 | 1,05 | Héroes, landing |
| `.text-h1` | 28 → 32 px | 800 | 1,15 | Título de página |
| `.text-h2` | 20 → 24 px | 700 | 1,25 | Título de sección |
| `.text-h3` | 17 px | 700 | 1,30 | Título de tarjeta |
| `.text-h4` | 15 px | 600 | 1,35 | Subtítulo, grupo |
| `.text-body` | 16 px | 400 | 1,60 | Lectura |
| `.text-small` | 14 px | 400 | 1,50 | Secundario |
| `.text-caption` | **12,5 px** | 400 | 1,45 | Microcopy — **el suelo** |
| `.text-overline` | 12 px + mayúsculas | 600 | — | Etiquetas de sección |

## 9.3 · El suelo, y por qué se incumple

**Nada de la interfaz baja de 12 px.** Ni microcopy, ni etiquetas, ni navegación.

`globals.css:459` documenta que la auditoría original encontró **218**
infracciones. Hoy quedan **160**. Va bajando, pero sigue siendo el problema más
grande del sistema.

Antes de escribir `text-[13px]` o `text-[15px]`: **ya existen** como
`.text-small` y `.text-body`.

## 9.4 · Pendientes

🔴 No hay estilos declarados para **precios**, **métricas**, **botones**,
**tablas** ni **mensajes de error**, que el encargo pide explícitamente. Existe
un componente `price.tsx`, pero no una regla tipográfica. Propuesta en § 31.5.

🔴 No hay regla de **tabular numbers** para columnas de importes. Sin
`font-variant-numeric: tabular-nums`, una columna de precios no alinea sus
dígitos y se lee mal — en una pantalla de caja eso se nota todos los días.

---

# 10 · Iconografía e imágenes

## 10.1 · Librería

**`lucide-react` 0.525.0.** 366 importaciones, **cero mezcla con otras
librerías**. Es de las cosas mejor cumplidas del sistema.

| Regla | Valor |
|---|---|
| Grosor | 1,5 px (defecto de Lucide) |
| Tamaños | 16 (en texto) · 20 (botones, menú) · 24 (cabeceras) · 32+ (vacíos) |
| Color decorativo | `--muted-foreground` |
| Color de estado | El token del estado |
| Icono solo | **Obligatorio** `aria-label` + tooltip |
| Icono decorativo | `aria-hidden="true"` |

**Prohibido** mezclar otra librería. Si falta un icono, se dibuja uno en el
estilo de Lucide (mismo grosor, misma caja de 24).

## 10.2 · Imágenes

🔴 **Pendiente de definición.** No hay reglas documentadas de estilo
fotográfico, proporciones, overlays ni calidad mínima. Lo único observable es
que `AspectRatio` de Radix está instalado.

Se necesita (§ 31.1): decisión sobre estilo fotográfico, proporciones canónicas
por tipo de tarjeta, tratamiento de imágenes de promoción y política sobre
imágenes generadas por IA.

---

# 11 · Tokens de diseño

## 11.1 · Dónde viven hoy

| Fuente | Formato | Consumidores |
|---|---|---|
| `src/app/globals.css` | Variables CSS + `@theme` | Web |
| `packages/ui/src/tokens.ts` | TypeScript, sRGB/hex | Correos, OG, PDF, futura app móvil |

El segundo es un **espejo manual** del primero, vigilado por
`tests/espejo-tokens.test.ts`.

## 11.2 · Estructura canónica propuesta

```
color.brand.primary            → --primary
color.brand.primaryHover       → --primary-hover
color.brand.primarySoft        → --primary-soft
color.brand.secondary          → --color-cyan-brand-500
color.background.default       → --background
color.background.subtle        → --muted
color.surface.default          → --card
color.surface.elevated         → --popover
color.text.primary             → --foreground
color.text.secondary           → --muted-foreground
color.text.inverse             → --primary-foreground
color.border.default           → --border
color.feedback.success         → --success
color.feedback.warning         → --warning
color.feedback.danger          → --destructive
color.feedback.info            → --info
color.feedback.pending         → PENDIENTE (§ 8.3)
```

Los alias `--color-brand-primary`, `--color-surface` y `--color-surface-subtle`
**ya existen** (`globals.css:105-112`) y apuntan a los tokens antiguos. No son
un segundo sistema: son el nombre nuevo del mismo valor.

## 11.3 · Familias completas

| Familia | Estado | Dónde |
|---|---|---|
| Color | 🟢 Completa | `globals.css` |
| Radios | 🟢 `sm/md/lg/xl/2xl` | `globals.css:64-68` |
| Elevación | 🟢 3 niveles | `globals.css:534-556` |
| Movimiento | 🟢 6 duraciones + 6 curvas | `globals.css:118-132` |
| Tipografía | 🟠 Clases, no tokens | `globals.css:467` |
| Espaciado | 🔴 Se usa la escala de Tailwind sin declararla | — |
| Breakpoints | 🔴 Se usan los de Tailwind sin declararlos | — |
| z-index | 🔴 No existe | — |
| Tamaños de icono | 🔴 No existe | — |
| Alturas de control | 🔴 No existe | — |

---

# 12 · Espaciado y layouts

## 12.1 · Escala

**Unidad base: 4 px** (escala de Tailwind). Se usa pero **no está declarada**
como propia — un satélite sin Tailwind no tiene de dónde leerla.

| Token propuesto | Valor | Uso |
|---|---|---|
| `space.1` | 4 px | Icono ↔ texto |
| `space.2` | 8 px | Elementos de un grupo |
| `space.3` | 12 px | Padding interno compacto |
| `space.4` | 16 px | Padding de tarjeta, separación de campos |
| `space.6` | 24 px | Separación entre bloques |
| `space.8` | 32 px | Separación entre secciones |
| `space.12` | 48 px | Separación entre zonas de página |

**Evidencia de que la escala se respeta:** solo **7** espaciados arbitrarios en
1 109 archivos, y son casos justificados (solapes negativos en `WalletStack`,
`QRDisplay`).

## 12.2 · Layouts

| Layout | Existe | Ruta de referencia |
|---|---|---|
| Dashboard | 🟢 | `src/app/(admin)/admin/dashboard/page.tsx` |
| Listado | 🟢 | `src/app/(admin)/admin/clientes/page.tsx` |
| Formulario | 🟢 | `src/app/(admin)/admin/planes/nuevo/page.tsx` |
| Detalle | 🟢 | `src/app/(admin)/admin/clientes/[id]/page.tsx` |
| Configuración | 🟢 | `src/app/(admin)/admin/personalizacion/page.tsx` |
| Wizard | 🟢 | `src/app/(onboarding)/onboarding/page.tsx` |
| POS | 🟢 | `src/app/(empleado)/empleado/caja/page.tsx` |
| Mapa | 🟢 | `src/app/(cliente)/cliente/cerca/page.tsx` |
| Marketplace | 🟢 | `src/app/(public)/empresas/page.tsx` |
| Móvil | 🟢 | `src/components/layout/BottomNav.tsx` |
| **KDS (cocina)** | 🔴 | No existe. Llega con el vertical de restaurante |

---

# 13 · Bordes, radios y elevación

## 13.1 · Radios

| Clase | Valor | Uso |
|---|---|---|
| `rounded-lg` | 10 px | Inputs, botones, chips |
| `rounded-xl` | 14 px | Tarjetas, paneles |
| `rounded-2xl` | 20 px | Modales, hojas, drawers |
| `rounded-full` | — | Avatares, pills, dock del QR |

**Fuera del vocabulario:** `rounded-3xl` (52 usos), `rounded-md` (31),
`rounded-sm` (8). Los tokens **no se borran todavía** para no romper esos usos
(`globals.css:59`).

## 13.2 · Elevación

| Nivel | Uso |
|---|---|
| `.elevation-1` | Tarjeta en reposo |
| `.elevation-2` | Hover, dropdown, popover |
| `.elevation-3` | Modal, hoja, drawer |
| `.shadow-glow` | **Fuera de la escala.** Acento de marca, **máximo uno por pantalla** |

Alias históricos con valores idénticos: `.shadow-card` → 1, `.shadow-premium` →
2, `.shadow-premium-lg` → 3.

## 13.3 · z-index (propuesta, 🔴 no existe)

| Token | Valor | Capa |
|---|---|---|
| `z.base` | 0 | Contenido |
| `z.sticky` | 10 | Cabeceras pegajosas |
| `z.dropdown` | 20 | Menús |
| `z.mapOverlay` | 30 | Controles sobre mapa |
| `z.drawer` | 40 | Drawer, hoja |
| `z.modal` | 50 | Modal |
| `z.toast` | 60 | Notificaciones |
| `z.celebration` | 70 | Confeti, overlays de celebración |

Migra los 12 valores sueltos (`z-[500]`, `z-[600]`, `z-[120]`…).

---

# 14 · Componentes

## 14.1 · Inventario

**50 en `@membego/ui`**, 258 en `src/components`.

### Ya existen en `@membego/ui`

`accordion` · `alert` · `alert-dialog` · `animated-number` · `app-icon` ·
`avatar` · `badge` · `button` · `card` · `command` · `confirm-dialog` ·
`countdown` · `data-table` · `date-text` · `delete-button` · `dialog` ·
`dropdown-menu` · `empty-state` · `flash-promotion` · `form-section` ·
`glass-card` · `input` · `label` · `mobile-bottom-sheet` · `page-header` ·
`pagination` · `password-input` · `price` · `progress` · `promo-badge` ·
`promo-banner` · `rating-stars` · `reveal` · `section-header` ·
`segmented-control` · `select` · `sheet` · `shine` · `skeleton` · `sonner` ·
`spinner` · `stagger` · `stat-card` · `status-banner` · `status-chip` ·
`switch` · `tabs` · `tabs-nav` · `textarea` · `typography`

### Faltan del catálogo pedido

| Componente | Estado | Nota |
|---|---|---|
| `Checkbox` · `Radio` | 🟠 | Radix instalado, sin envoltorio en el paquete |
| `Combobox` | 🟠 | `cmdk` instalado; falta el componente |
| `DatePicker` · `TimePicker` | 🟠 | `react-day-picker` instalado |
| `FileUpload` | 🔴 | |
| `Search` | 🔴 | Cada pantalla monta el suyo |
| `Tooltip` · `Popover` | 🟠 | Radix instalado, sin envoltorio |
| `Breadcrumb` | 🔴 | |
| `Drawer` | 🟠 | `vaul` instalado |
| `Stepper` | 🔴 | El onboarding tiene uno propio |
| `ChartContainer` | 🔴 | Recharts sin envoltorio → cada gráfico decide sus colores |
| `FilterBar` | 🔴 | |
| `Navbar` · `Sidebar` · `MobileNavigation` | 🔴 | En `src/components/layout` (§ 20) |
| `CommandPalette` | 🔴 | Ídem |
| `MembershipCard` · `BenefitCard` · `QRCard` | 🔴 | En `src/components`, sin extraer |

**El más urgente es `ChartContainer`.** Sin él, cada gráfico elige sus colores y
el mismo estado se pinta distinto en dos sistemas (§ 17).

## 14.2 · Ficha obligatoria

Todo componente nuevo se documenta con: finalidad · anatomía · variantes ·
tamaños · estados (reposo/hover/foco/activo/deshabilitado/cargando/error) ·
responsive · accesibilidad · modo oscuro · usos correctos · usos incorrectos.

---

# 15 · Jerarquía de botones y acciones

| Nivel | Estilo | Cuántos por sección |
|---|---|---|
| Primaria | `bg-primary` + `text-primary-foreground` | **Uno** |
| Secundaria | Borde + fondo transparente | Varios |
| Terciaria | Solo texto en `--primary` | Varios |
| Destructiva | `bg-destructive`, **nunca** el estilo primario | Uno |
| Icono | `IconButton` + `aria-label` + tooltip | Varios |
| Deshabilitada | Opacidad + `cursor-not-allowed` + motivo | — |
| Cargando | Spinner + texto, ancho **fijo** | — |

**Reglas:**
- Una sola acción primaria dominante por sección (P2)
- Destructiva nunca comparte estilo con primaria: se pulsa la de al lado
- Verbos del `docs/GUIA_LENGUAJE_MEMBEGO.md` § 5. No se inventan
- Un botón que carga **no cambia de ancho**: mueve lo que hay al lado
- Nada crítico solo en un menú de tres puntos (P4)

---

# 16 · Formularios

## 16.1 · Patrón único

| Aspecto | Regla |
|---|---|
| Ancho | Máx. 640 px en una columna |
| Etiqueta | **Siempre visible**, encima del campo |
| Placeholder | Ejemplo, **nunca** sustituto de la etiqueta |
| Ayuda | Debajo, `.text-caption` |
| Obligatorio | Se marca lo **opcional**, no lo obligatorio |
| Validación | Al salir del campo; al enviar, foco al primer error |
| Error | Debajo, `--destructive`, **con texto** (P3) |
| Acciones | Al final, primaria a la derecha |
| Largo | Pasos o página aparte, **nunca** un modal apretado |

## 16.2 · La deuda crítica

**99 campos sin nombre accesible** (A-2). Es el problema más caro del sistema
en accesibilidad: un lector de pantalla anuncia «edición, en blanco».

`tests/accesibilidad-formularios.test.ts` lo congela como techo que solo puede
bajar.

---

# 17 · Tablas y datos

## 17.1 · Tablas

Base: `@tanstack/react-table` 8.21 + `packages/ui/src/ui/data-table.tsx`.

| Aspecto | Regla |
|---|---|
| Densidad | Fila 48 px normal · 40 px compacta |
| Alineación | Texto izquierda · **números derecha** con `tabular-nums` |
| Paginación | **Obligatoria** por encima de 50 filas |
| Vacío | `EmptyState` con acción, nunca una tabla vacía |
| Carga | `Skeleton` con la forma de la tabla, no un spinner |
| Móvil | Tarjetas por defecto; scroll horizontal solo si las columnas son comparables entre sí |

## 17.2 · Gráficos

**Recharts 2.15**, sin envoltorio. 🔴 **No hay paleta oficial de gráficos**, y
es el hueco más peligroso del ecosistema: sin ella, «pendiente» es ámbar en un
sistema y gris en otro.

### Paleta propuesta

**Categórica** (hasta 6 series, distinguibles en escala de grises):

| # | Token | Origen |
|---|---|---|
| 1 | `chart.1` | `--color-primary-500` |
| 2 | `chart.2` | `--color-cyan-brand-500` |
| 3 | `chart.3` | `--warning` |
| 4 | `chart.4` | `--success` |
| 5 | `chart.5` | `--color-primary-800` |
| 6 | `chart.6` | `--muted-foreground` |

**Semántica — el mismo significado, el mismo color, en todos los sistemas:**

| Significado | Token |
|---|---|
| Positivo / crecimiento | `--success` |
| Negativo / caída | `--destructive` |
| Neutro / previsto | `--muted-foreground` |
| Destacado | `--primary` |

**Reglas:** las series se distinguen también por forma o patrón, no solo por
color (P3). Cero gráficos decorativos: si no ayuda a decidir, es una tabla.

---

# 18 · Navegación

## 18.1 · Estructura

| Elemento | Ruta |
|---|---|
| Shell | `src/components/layout/AppShell.tsx` |
| Menú lateral | `AppSidebar.tsx` |
| Cabecera | `AppHeader.tsx` |
| Móvil | `BottomNav.tsx` |
| Paleta de comandos | `CommandPalette.tsx` |
| Configuración del menú | `nav-config.ts` (77 entradas) |

## 18.2 · Reglas

- **77 entradas de menú.** Sin agrupar, es una lista infinita. Se organiza por
  categorías con navegación contextual
- **Nombres cortos.** «Facturación y comprobantes fiscales» → **«Facturación»**.
  «Notas de crédito y anulaciones» → **«Notas de crédito»**
- El cambio entre sistemas verticales **no** es un ítem más del menú: es el
  selector de sistema de la cabecera (App Launcher, Fase 5 de la plataforma)
- El usuario debe sentir que cambia de **área dentro de Membego**, no que abre
  otra aplicación

---

# 19 · Shell compartido

## 19.1 · Qué es global y qué es del vertical

| Zona | Dueño | Contenido |
|---|---|---|
| Marca | **Ecosistema** | Logo Membego + nombre del sistema |
| Selector de empresa | **Ecosistema** | Empresas del usuario |
| Selector de sucursal | **Ecosistema** | Sucursales de la empresa |
| Selector de sistema | **Ecosistema** | App Launcher |
| Usuario | **Ecosistema** | Avatar, perfil, salir |
| Notificaciones | **Ecosistema** | Campana |
| Ayuda | **Ecosistema** | Soporte |
| Estado de conexión | **Ecosistema** | Indicador offline |
| **Menú lateral** | **Vertical** | Sus módulos |
| **Contenido** | **Vertical** | Sus pantallas |

El vertical **rellena** dos zonas. No pinta el marco.

## 19.2 · Paquetes propuestos

| Paquete | Responsabilidad | Depende de |
|---|---|---|
| `@membego/design-tokens` | Valores. **Cero** código de interfaz | — |
| `@membego/icons` | Iconos propios en estilo Lucide | — |
| `@membego/ui` | Componentes sin dominio | tokens, icons |
| `@membego/charts` | Recharts envuelto con la paleta oficial | tokens, ui |
| `@membego/app-shell` | Shell, navegación, launcher | tokens, ui, icons |

**Regla de dependencia:** las flechas van en una sola dirección. `design-tokens`
no importa de nadie; `app-shell` importa de todos. Un ciclo aquí significa que
un satélite arrastra medio Membego para pintar un botón.

**Versionado:** semántico. Cambiar el valor de un token semántico es **major**.

Esto extiende a la interfaz lo que la Fase 4 de la plataforma hizo con los
datos: `packages/contracts` es la fuente y el Core reexporta, nunca al revés.

---

# 20 · Modo oscuro

**No se construye invirtiendo colores.** Tiene paleta propia diseñada
(`globals.css:238-286`), y se nota en las decisiones:

| Decisión | Por qué |
|---|---|
| `--primary` sube de L .55 a L .72 | El azul de modo claro no contrasta sobre L .15 |
| `--primary-foreground` pasa a **oscuro** | Sobre un azul claro, el texto va oscuro |
| `--warning` pasa de ámbar medio a claro, con texto oscuro | Simétrico a `--primary` |
| `--border` pasa a `rgba(255,255,255,.08)` | Un gris fijo se ve sucio sobre negro |

**Auditoría:** los 17 pares del tema oscuro pasan AA, con márgenes amplios
(5,07:1 el más ajustado). **No se encontraron** tarjetas que queden blancas,
bordes invisibles ni inputs claros sobre fondo oscuro.

🟠 **Riesgo pendiente:** las 333 clases de color crudo **no tienen modo oscuro**.
`bg-emerald-500` es el mismo verde en los dos temas. Es la manifestación visible
de A-4.

🔴 **Sin verificar:** los gráficos en modo oscuro. Recharts sin envoltorio no
lee los tokens del tema.

---

# 21 · Responsive

## 21.1 · Breakpoints

Se usan los de Tailwind sin declararlos como propios:

| Nombre | Ancho | Dispositivo |
|---|---|---|
| `sm` | 640 px | Móvil grande |
| `md` | 768 px | Tablet |
| `lg` | 1024 px | Laptop |
| `xl` | 1280 px | Escritorio |
| `2xl` | 1536 px | Pantalla grande |

🔴 **Falta** un breakpoint declarado para móvil pequeño (< 380 px), y perfiles
para **POS** y **KDS**, que no son «escritorio»: son pantallas fijas, a
distancia mayor, operadas de pie.

## 21.2 · Reglas

| Elemento | Móvil | Escritorio |
|---|---|---|
| Navegación | `BottomNav` | `AppSidebar` |
| Tabla | Tarjetas | Tabla |
| Modal | Hoja inferior | Diálogo centrado |
| Filtros | Drawer | Barra en línea |
| Acciones de fila | Menú | Botones visibles |

**Área táctil mínima: 44×44 px.** Sin excepciones (WCAG 2.2 AA, 2.5.8).

---

# 22 · Accesibilidad

## 22.1 · Estado frente a WCAG 2.2 AA

| Criterio | Estado | Evidencia |
|---|---|---|
| 1.4.3 Contraste (texto) | 🟢 | 51/51 pares, `scripts/contraste.mjs` |
| 1.4.11 Contraste (no textual) | 🟢 | Foco 4,67:1 · borde 1,48:1 |
| 1.4.1 Uso del color | 🟠 | `StatusChip` lleva texto; sin verificar en gráficos |
| **3.3.2 Etiquetas** | 🔴 | **99 campos sin nombre accesible** |
| **1.4.4 Redimensionado** | 🔴 | 160 textos por debajo de 12 px |
| 2.4.7 Foco visible | 🟢 | `--ring` con contraste verificado |
| 2.1.1 Teclado | 🟠 | Radix lo da; sin verificar en componentes propios |
| 2.5.8 Tamaño del objetivo | 🟠 | Declarado, sin medir |
| 2.3.3 Movimiento | 🟢 | 3 bloques `prefers-reduced-motion` |
| 4.1.2 Nombre, rol, valor | 🟠 | Radix lo da; los propios sin auditar |

> **El sistema NO cumple WCAG 2.2 AA hoy.** Dos criterios fallan de forma
> medida. Declararlo conforme sería falso.

## 22.2 · Lo que falta verificar

Navegación completa por teclado, orden de tabulación, anuncio de errores por
lector de pantalla, zoom al 200 %, y contraste de las series de gráficos.

---

# 23 · Animaciones

Sistema completo en **`docs/MMS.md`**. No se duplica aquí.

| Token | Valor | Uso |
|---|---|---|
| `--duration-instant` | 100 ms | Feedback táctil |
| `--duration-fast` | 150 ms | Hover, toggles |
| `--duration-base` | 200 ms | Transiciones estándar |
| `--duration-slow` | 350 ms | Entrada de pantalla |
| `--duration-hero` | 500 ms | Héroes, banners |
| `--duration-celebration` | 900 ms | Confeti, contadores |

Seis curvas: `--ease-out-expo` (entradas), `--ease-in-quint` (salidas),
`--ease-in-out`, `--ease-spring`, `--ease-bounce`, `--ease-elastic`.

**Regla:** toda animación consume estos valores. Hoy hay **48 duraciones
sueltas** que coinciden en valor con los tokens (A-9): son alias no declarados.

`prefers-reduced-motion` está implementado en tres bloques de `globals.css`.

---

# 24 · Personalización por empresa

## 24.1 · Estado actual

`Company.colorPrimario` existe (`prisma/schema/identidad.prisma:230`), se edita
en `src/modules/empresas/perfilActions.ts:77`, y **no tiene validación de
contraste**.

## 24.2 · Reglas

| Puede personalizar | No puede cambiar |
|---|---|
| Logo | Estructura y navegación |
| Foto de portada | Tipografía |
| Información comercial | Componentes y tamaños |
| Imágenes de promoción | **Estados semánticos** |
| Un acento secundario **validado** | Iconografía |

**Regla dura:** los estados semánticos **no se personalizan jamás**. Un error en
verde porque es el color corporativo de la empresa es un error que nadie ve.

## 24.3 · Validación obligatoria del acento

Si se admite `colorPrimario`, antes de guardarlo:

1. Contraste ≥ 4,5:1 contra `--background` y `--card` en **los dos temas**
2. Separación ≥ 30° de matiz respecto a `--destructive`, `--success` y
   `--warning` (misma regla que ya aplica `tests/token-info.test.ts` a `--info`)
3. Si falla, se rechaza con el motivo y se propone el tono válido más cercano

🔴 **Nada de esto está implementado.** Hoy una empresa puede poner un rojo como
color primario y sus botones de acción serán indistinguibles de sus botones de
borrar.

---

# 25 · Reglas para sistemas especializados

## 25.1 · Lo que un vertical hereda y no negocia

Shell · navegación · tokens · tipografía · componentes de `@membego/ui` ·
estados semánticos · formularios · tablas · feedback · modo oscuro ·
accesibilidad.

## 25.2 · Lo que un vertical define

Sus módulos de menú · sus pantallas de dominio · sus componentes de dominio ·
sus `systemRole` (el Core no los interpreta — Fase 5 de la plataforma).

## 25.3 · Componentes de dominio: no forzar

Un `MesaCard` y una `BahiaCard` **no** deben compartir un componente abstracto.
Comparten `Card`, tipografía, estados y espaciado; su contenido es distinto y
debe serlo.

> Forzar un `RecursoOperativoCard` que sirva a mesas, bahías, sillones y cintas
> produce un componente con doce props opcionales que no le queda bien a nadie.
> **Se comparten las bases visuales, no la lógica de negocio.**

## 25.4 · Lista de comprobación de un vertical nuevo

- [ ] Instala `@membego/design-tokens`, `@membego/ui`, `@membego/app-shell`
- [ ] **Cero** tokens de color propios
- [ ] Su menú entra en el shell, no lo reemplaza
- [ ] Sus estados usan los tokens semánticos
- [ ] Sus gráficos usan `@membego/charts`
- [ ] Modo oscuro sin trabajo extra
- [ ] Sus formularios pasan la prueba de nombres accesibles
- [ ] Ningún texto por debajo de 12 px
- [ ] La marca Membego es visible en toda pantalla

---

# 26 · Arquitectura del Design System

Ver § 19.2. Regla añadida: **`@membego/ui` no puede contener color crudo.** Hoy
lo incumple con 30 clases en `stat-card.tsx`, y es lo que más urge arreglar,
porque ese paquete es lo que se reparte.

---

# 27 · Gobernanza

| Aspecto | Regla |
|---|---|
| Responsable | 🔴 **Sin asignar.** Un sistema sin dueño se erosiona |
| Componente nuevo | Buscar primero si existe. Dos con el mismo nombre ya ocurre (A-11) |
| Revisión | Diseño + accesibilidad antes de entrar al paquete |
| Versionado | Semántico. Cambiar un token semántico es **major** |
| Changelog | Obligatorio por paquete |
| Experimental | Prefijo `Unstable_`, fuera del contrato de versión |
| Obsoleto | Se marca, no se borra. Dos versiones menores de plazo |
| Techos | Los números medidos son **techos que solo bajan** |

## 27.1 · Los techos vigentes

Este proyecto ya usa el patrón: una prueba congela un número y falla si sube.

| Techo | Valor | Dónde |
|---|---|---|
| Campos sin nombre accesible | 99 | `tests/accesibilidad-formularios.test.ts:30` |
| Textos por debajo de 12 px | 160 | `tests/navegacion-shell.test.ts:211` |

**Propuestos:** color crudo (333) · radios fuera de vocabulario (95) · HEX en
interfaz (85) · duraciones sueltas (48) · z-index sueltos (12) · **color crudo
dentro de `@membego/ui` (30, objetivo 0)**.

---

# 28 · Control de calidad

| Herramienta | Estado |
|---|---|
| Contraste automático | 🟢 `scripts/contraste.mjs`, 51 pares |
| Espejo de tokens | 🟢 `tests/espejo-tokens.test.ts` |
| Separación de matices | 🟢 `tests/token-info.test.ts` |
| Nombres accesibles | 🟢 `tests/accesibilidad-formularios.test.ts` |
| **Storybook** | 🔴 |
| **Regresión visual** | 🔴 |
| **Teclado automatizado** | 🔴 |
| Auditoría de tokens | 🟠 Existe como script de esta auditoría; falta hacerlo permanente |

## 28.1 · Antes de publicar

- [ ] Modo claro y oscuro
- [ ] Móvil, tablet, escritorio
- [ ] Estados: vacío, carga, error, sin permiso
- [ ] **Textos largos en español** (30–40 % más largos que en inglés)
- [ ] **Nombres de empresa largos** («Centro de Lavado y Detallado El Progreso»)
- [ ] Navegación por teclado
- [ ] Zoom al 200 %
- [ ] Cero valores fuera de los tokens

---

# 29 · Plan de migración

## Fase 1 · Decidir y congelar

Aprobar este documento · convertir `MDS.md` y `DESIGN_SYSTEM.md` en punteros ·
**resolver A-13 y ampliar `espejo-tokens.test.ts` a los 10 pasos de la escala** ·
hacer permanente el script de auditoría · añadir los techos propuestos ·
completar los tokens que faltan (z-index, iconos, alturas, `pending`).

**Riesgo:** bajo. Nada de código de producto.
**Fin:** una sola fuente, y los números en pruebas.

## Fase 2 · Limpiar lo que se reparte

**`packages/ui` primero.** 30 colores crudos en `stat-card.tsx` · 6 radios en
`dropdown-menu.tsx`.

**Riesgo:** medio (cambio visual real).
**Fin:** cero color crudo y cero radio fuera de vocabulario en `@membego/ui`.

> Va antes que todo lo demás porque es lo que un satélite instalaría. Limpiar la
> aplicación primero y el paquete después significa repartir la deuda mientras
> tanto.

## Fase 3 · Accesibilidad crítica

Los 99 campos sin nombre → 0. Los 160 micro-textos → 0, empezando por
**`Pista.tsx`** (P4).

**Riesgo:** medio. Los micro-textos obligan a reordenar tarjetas.
**Fin:** los dos techos en cero, y el sistema puede declararse AA en esos dos
criterios sin mentir.

## Fase 4 · Extraer los paquetes

`@membego/design-tokens` (generado, no espejado) · `@membego/charts` ·
`@membego/app-shell` · Storybook · regresión visual.

**Riesgo:** alto. Toca el shell de toda la aplicación.
**Depende de:** Fases 1–3.
**Fin:** un proyecto vacío puede montar un shell reconocible como Membego.

## Fase 5 · El resto de la deuda

333 colores crudos en producto · 95 radios · 85 HEX · 48 duraciones · 12
z-index. Módulo a módulo, cada uno bajando su techo.

## Fase 6 · Retirar lo obsoleto

Alias de sombra (`.shadow-card`, `.shadow-premium`) · tokens `--radius-sm/md` ·
`landingPrimary` · duplicados de A-11.

**Depende de:** que los techos correspondientes estén en cero.

---

# 30 · Riesgos y decisiones pendientes

## 30.1 · Requieren aprobación

| # | Decisión | Por qué no la tomo yo |
|---|---|---|
| D-1 | Consolidar `MDS.md` + `DESIGN_SYSTEM.md` en este documento | Retira dos documentos que hay equipos usando |
| D-2 | Responsable del sistema de diseño | Es una decisión de organización |
| D-3 | ¿Se permite acento por empresa, con validación? | Compromiso comercial ↔ coherencia |
| D-4 | ¿`rounded-3xl` (52 usos) entra al vocabulario o se migra? | 52 usos son una decisión estética consolidada |
| D-5 | Cuál `CampanaForm` es el canónico | Depende de qué flujo sobrevive |
| D-6 | ¿Storybook o alternativa más ligera? | Coste de mantenimiento |
| D-7 | Publicación de los paquetes: ¿GitHub Packages, como `@membego/ui`? | Operativa |
| D-8 | **A-13: ¿manda el azul de `globals.css` o el de `tokens.ts`?** | Cambia el color de marca en correos, OG y PDF (o en la aplicación). Es visible para el cliente |

## 30.2 · Riesgos

| Riesgo | Severidad | Mitigación |
|---|---|---|
| El documento se aprueba y no se aplica | 🔴 | Techos en CI, no buenas intenciones |
| A-13 sigue abierto y el ecosistema hereda dos azules | 🔴 | Resolver en Fase 1, antes de extraer `design-tokens` |
| Fase 4 rompe el shell en producción | 🔴 | Regresión visual **antes** de extraer |
| `@membego/ui` reparte deuda mientras tanto | 🟠 | Fase 2 va primero |
| La personalización se abre sin validar | 🟠 | No abrir `colorPrimario` hasta § 24.3 |
| Los 160 micro-textos se «arreglan» truncando | 🟠 | Revisión de diseño, no solo la prueba |

---

# 31 · Anexos

## 31.1 · Recursos necesarios para completar la identidad visual

Sin esto, las secciones marcadas quedan **pendientes de definición**:

1. **Archivo de marca original** (Figma, AI o SVG editable) — § 7.1: logo
   horizontal, isotipo, monocromático, versión para fondo oscuro
2. **Área de seguridad y tamaño mínimo** del logo — § 7.1
3. **Decisión sobre estilo fotográfico** — § 10.2
4. **Capturas de las pantallas aprobadas** — § 31.9. No hay entorno de ejecución
   con datos, así que las pantallas de referencia están elegidas por lectura de
   código, no por inspección visual
5. **Política sobre imágenes generadas por IA** — § 10.2
6. **Confirmación de qué pantallas están oficialmente aprobadas** — el encargo
   lo pedía y no consta en el repositorio

## 31.2 · Inventario de colores

| Categoría | Cantidad | Detalle |
|---|---|---|
| Tokens semánticos | 44 | `globals.css` |
| Escala de marca | 10 | `--color-primary-50..900` |
| Escala cyan | 3 | `--color-cyan-brand-300/500/700` |
| Espejo TS | 21 | `packages/ui/src/tokens.ts` |
| **HEX en imagen/correo (legítimo)** | 73 | OG, plantillas de correo |
| **HEX en interfaz (deuda)** | 85 | § 5.3 A-8 |
| **Clases crudas de Tailwind (deuda)** | 333 | § 5.3 A-4 |

Valores más repetidos fuera del sistema: `text-emerald-600` (13) ·
`bg-emerald-500` (12) · `bg-amber-500` (9) · `text-emerald-400` (8) ·
`bg-sky-500` (7) · `text-slate-900` (7) · `text-slate-500` (7).

## 31.3 · Inventario de tipografías

Plus Jakarta Sans (display) · Geist (texto) · Geist Mono (código). Las tres por
`next/font/google`, variables, con subconjunto latino.

## 31.4 · Inventario de componentes

537 `.tsx`: **50** en `@membego/ui` · 258 en `src/components` · 227 páginas.
Duplicados por nombre: 2 (§ 5.3 A-11).

## 31.5 · Tokens propuestos

```css
/* Estado que falta */
--pending: oklch(0.55 0.02 264);
--pending-foreground: oklch(0.99 0 0);

/* z-index (§ 13.3) */
--z-base: 0;      --z-sticky: 10;  --z-dropdown: 20; --z-map-overlay: 30;
--z-drawer: 40;   --z-modal: 50;   --z-toast: 60;    --z-celebration: 70;

/* Tamaños de icono */
--icon-sm: 1rem;   --icon-md: 1.25rem;
--icon-lg: 1.5rem; --icon-xl: 2rem;

/* Alturas de control */
--control-sm: 2rem; --control-md: 2.5rem; --control-lg: 2.75rem;

/* Área táctil mínima (WCAG 2.5.8) */
--touch-min: 2.75rem;

/* Números tabulares para importes */
--numeric-tabular: tabular-nums;

/* Gráficos (§ 17.2) */
--chart-1: var(--color-primary-500);
--chart-2: var(--color-cyan-brand-500);
--chart-3: var(--warning);
--chart-4: var(--success);
--chart-5: var(--color-primary-800);
--chart-6: var(--muted-foreground);
```

## 31.6 · Matriz claro/oscuro

51 pares verificados, 3 temas (claro, oscuro, landing). **0 fallos.** Los tres
más ajustados: borde de tarjeta claro **1,48:1** (mín. 1,4) · info landing
**4,59:1** (mín. 4,5) · éxito landing **4,64:1**.

Reproducible: `node scripts/contraste.mjs`.

## 31.7 · Matriz responsive

§ 21. **Pendiente:** móvil pequeño (< 380 px), POS y KDS.

## 31.8 · Matriz de accesibilidad

§ 22.1. **2 criterios en rojo, 5 en ámbar, 3 en verde.**

## 31.9 · Pantallas de referencia (propuestas)

Elegidas **por lectura de código**, no por inspección visual. Pendientes de
confirmación (§ 31.1).

| Pantalla | Ruta | Por qué |
|---|---|---|
| Dashboard admin | `src/app/(admin)/admin/dashboard/page.tsx` | Usa `StatCard` y `PageHeader` del paquete |
| Listado | `src/app/(admin)/admin/clientes/page.tsx` | `DataTable` + `EmptyState` + paginación |
| Inicio cliente | `src/app/(cliente)/cliente/inicio/page.tsx` | Jerarquía del beneficio (P1) |
| Onboarding | `src/app/(onboarding)/onboarding/page.tsx` | Patrón de pasos |

**Contraejemplos** (qué **no** copiar): `CampanaLanding.tsx` (36 colores crudos)
· `Pista.tsx` (11 micro-textos en la pantalla operativa más exigente).

## 31.10 · Deuda visual

| # | Deuda | Cantidad | Severidad | Fase |
|---|---|---|---|---|
| A-1 | Dos maestros contradictorios | 2 | 🔴 | 1 |
| A-2 | Campos sin nombre accesible | 99 | 🔴 | 3 |
| A-3 | Textos < 12 px | 160 | 🔴 | 3 |
| A-4 | Color crudo de Tailwind | 333 (30 en `ui`) | 🟠 | 2 y 5 |
| A-5 | Sin shell compartido | — | 🟠 | 4 |
| A-13 | **Escala de marca desincronizada entre las dos fuentes** | 10 pasos | 🔴 | 1 |
| A-6 | Espejo de tokens manual | — | 🟠 | 4 |
| A-7 | Radios fuera de vocabulario | 95 (6 en `ui`) | 🟡 | 2 y 5 |
| A-8 | HEX en interfaz | 85 | 🟡 | 5 |
| A-9 | Duraciones sueltas | 48 | 🟡 | 5 |
| A-10 | z-index sueltos | 12 | 🟡 | 5 |
| A-11 | Componentes duplicados | 2 | 🟢 | 6 |
| A-12 | Una sola librería de iconos | ✓ | 🟢 | — |

## 31.11 · Cómo reproducir esta auditoría

Los números salen de un script que descuenta comentarios antes de contar. Se
propone hacerlo permanente como `scripts/auditar-diseno.mjs` (Fase 1), con las
mismas reglas que `scripts/acoplamiento-vertical.mjs`: exportable, con prueba de
que **sabe encontrar** lo que busca.

Un número que se cree y es falso es peor que no medir.
