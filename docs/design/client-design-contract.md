# Contrato de diseño canónico del cliente

> Un solo contrato para web y React Native. Todo token que no nazca aquí es, como mucho, un alias.

## 0. Fuentes y su clasificación

| # | Fuente | Ruta | Clasificación | Justificación |
|---|--------|------|---------------|---------------|
| F1 | globals.css | `src/app/globals.css` | **canónica (web)** | Define los tokens OKLCH que el navegador resuelve. Retail, vibe, motion, elevación, tipografía y radios viven aquí. |
| F2 | packages/ui tokens | `packages/ui/src/tokens.ts` | **espejo (web)** | Reflejo en hex de F1 para consumidores sin CSS (emails, OG, PDFs). Sin consumidores activos en código (`tests/espejo-tokens.test.ts` lo verifica). |
| F3 | RN tokens | `apps/client/src/theme/tokens.ts` | **legacy-deprecated** | Dice "sincronizados exactamente con packages/ui" (línea 3) pero su `primary.DEFAULT` (`#006bed`, línea 17) discrepa del `primary.DEFAULT` del tailwind config del cliente (`#0284c7`, línea 20). Se reemplaza por este contrato en Todo 4. |
| F4 | RN tailwind config | `apps/client/tailwind.config.js` | **canónica (RN) / consumer-constrained** | NativeWind lo consume directamente. Sus valores de `primary.DEFAULT`, retail, vibe, fuentes Inter y escala tipográfica son los que RN pinta. |
| F5 | Stitch DESIGN.md | `docs/transformacion-membego/stitch/retail_commercial_mobile/DESIGN.md` | **contrato visual mobile** | Prosa (línea 149): Brand Primary `#0284C7`. El frontmatter YAML (`primary: '#006194'`, línea 19) es metadata interna de la herramienta Stitch, no el color de marca. |

## 1. Paleta primaria (marca)

### Decisión

El primario del cliente es **`#5b21b6`** (`vibe-deep`, el violeta del rediseño Vibe del Inicio aprobado el 2026-09-10). Su estado hover/pressed es **`#4c1d95`** (`primary-hover`, paso 800 de la escala violeta).

> **Cambio registrado (2026-10-08).** Hasta el 2026-09-30 este contrato decía retail blue
> (`#0284c7`). Los commits `1e596cd` («align shared UI with Vibe theme», 2026-09-30) y
> `dbbcac0` («unify branding», 2026-10-06), ambos ya en `main`, movieron el primario del
> cliente a la paleta Vibe y la escala `primary.50–900` de RN al violeta (`#f5f3ff`…`#3b0764`,
> `DEFAULT = 700 = #5b21b6`). El retail blue **sigue existiendo como paleta** (`retail.*`,
> §2) y sigue siendo el «Brand Primary» del Stitch comercial; ya no es el primario de la app.
> La prueba `tests/client-design-contract.test.ts` compara `primary.DEFAULT` de RN con
> `--color-vibe-deep` de `globals.css` y comprueba que el Brand Primary del Stitch coincide
> con `retail-blue`. El texto que sigue en esta sección describe la decisión anterior y se
> conserva como historia del conflicto que resolvió.
>
> _Decisión anterior:_ el primario del cliente era `#0284c7` (retail blue) con hover `#0369a1`.

### Conflicto resuelto

| Valor | Fuente | Línea | Veredicto |
|-------|--------|-------|-----------|
| `oklch(0.55 0.22 255)` ≈ `#006bed` | F1 `:root --primary` | 274 | canónico para **web app** (no cliente mobile) |
| `#0084ff` / `#006bed` | F2 `primary.500` / `primary.600` | 59-60 | espejo OKLCH→hex de F1; no es el primario del cliente |
| `#0284c7` | F4 `primary.DEFAULT` | 20 | **canónico del cliente** — coincide con F5 prosa |
| `#0284C7` | F5 prosa "Brand Primary" | 149 | contrato visual mobile |
| `#006194` | F5 frontmatter `primary` | 19 | metadata Stitch (surface-tint), no marca |

### Escala numérica del cliente

La escala 50–900 que usa RN (`F4` líneas 9-19) es el espejo de F2 (OKLCH web). El valor `DEFAULT` (`#0284c7`) NO pertenece a esa escala — es el retail blue de F1 (`--color-retail-blue`, línea 145). Esto es deliberado: el primario que el usuario ve es el retail blue; la escala numérica sirve para gradientes y estados intermedios.

| Paso | Hex | Origen |
|------|-----|--------|
| 50 | `#f0f6ff` | F2 primary.50 = F4 primary.50 |
| 100 | `#ddecff` | F2 primary.100 = F4 primary.100 |
| 200 | `#bedcff` | F2 primary.200 = F4 primary.200 |
| 300 | `#92c4ff` | F2 primary.300 = F4 primary.300 |
| 400 | `#52a2ff` | F2 primary.400 = F4 primary.400 |
| 500 | `#0084ff` | F2 primary.500 = F4 primary.500 |
| 600 | `#006bed` | F2 primary.600 = F4 primary.600 |
| 700 | `#0059ce` | F2 primary.700 = F4 primary.700 |
| 800 | `#0049a7` | F2 primary.800 = F4 primary.800 |
| 900 | `#004087` | F2 primary.900 = F4 primary.900 |
| **DEFAULT** | ~~`#0284c7`~~ → **`#5b21b6`** | **desde `1e596cd`: F4 `primary.DEFAULT` = F1 `--color-vibe-deep` (ver el cambio registrado arriba)** |

## 2. Paleta retail

Canónica en F1 líneas 145-153 (`@theme`). F4 líneas 25-32 la replica exacta.

| Token | Hex | F1 línea | F4 línea |
|-------|-----|----------|----------|
| `retail-blue` | `#0284c7` | 145 | 26 |
| `retail-deep` | `#0369a1` | 146 | 27 |
| `retail-cyan` | `#06b6d4` | 147 | 28 |
| `retail-mist` | `#f0f9ff` | 148 | 29 |
| `retail-star` | `#f59e0b` | 149 | 30 |
| `retail-lagoon` | `#00687a` | 153 | 31 |

## 3. Paleta vibe

Canónica en F1 líneas 158-169 (`@theme`). F4 líneas 35-48 la replica.

| Token | Hex | F1 línea | F4 línea |
|-------|-----|----------|----------|
| `vibe-violet` | `#7c3aed` | 158 | 36 |
| `vibe-deep` | `#5b21b6` | 159 | 37 |
| `vibe-ink` | `#630ed4` | 160 | 38 |
| `vibe-cobalt` | `#2563eb` | 161 | 39 |
| `vibe-lavanda` | `#dce9ff` | 162 | 40 |
| `vibe-niebla` | `#e5eeff` | 163 | 41 |
| `vibe-borde` | `#e0e7ff` | 164 | 42 |
| `vibe-chip` | `#ddd6fe` | 165 | 43 |
| `vibe-fondo` | `#f8f9ff` | 166 | 44 |
| `vibe-celeste` | `#c7d2fe` | 167 | 45 |
| `vibe-sky` | `#38bdf8` | 168 | 46 |
| `vibe-aqua` | `#67e8f9` | 169 | 47 |

Los chips de categoría de Inicio usan además la paleta `category` de Tailwind (valores 500): amber `#f59e0b` → orange `#f97316`, emerald `#10b981` → teal `#14b8a6`, cyan `#06b6d4` → sky `#0ea5e9`, indigo `#6366f1` → blue `#3b82f6` y pink `#ec4899` → rose `#f43f5e`. El primer gradiente es `vibe-violet` → `vibe-cobalt`.

Para el texto y los iconos sobre superficies claras, Inicio usa los tonos de contraste 700 de cada familia: orange `#c2410c`, teal `#0f766e`, sky `#0369a1`, blue `#1d4ed8` y rose `#be123c`.

## 4. Superficies

| Token | Hex (light) | F1 línea | F4 línea |
|-------|-------------|----------|----------|
| `background` | `oklch(0.985 0.002 264)` / `#ffffff` (RN) | 261 | 51 |
| `foreground` | `oklch(0.14 0.02 264)` / `#111827` (RN) | 262 | 52 |
| `card` | `oklch(1 0 0)` / `#ffffff` | 265 | 54 |
| `muted` | `oklch(0.960 0.004 264)` / `#f3f4f6` | 285 | 58 |
| `muted-foreground` | `oklch(0.50 0.012 264)` / `#4b5563` | 286 | 59 |
| `border` | `oklch(0.87 0.006 264)` / `#e5e7eb` | 327 | 65 |
| `input` | `oklch(0.87 0.006 264)` / `#e5e7eb` | 328 | 66 |
| `ring` | `oklch(0.55 0.22 255)` / `#0284c7` | 329 | 67 |

Nota: F1 usa OKLCH; F4 usa hex aproximado. La prueba de contrato acepta tolerancia ≤ 2/255 en la conversión.

## 5. Estados semánticos

| Estado | Hex | F1 línea (oklch) | F2 línea | F4 línea |
|--------|-----|-------------------|----------|----------|
| `success` | `#00864d` | 314 | 88 | 71 |
| `warning` | `#ab6300` | 316 | 89 | 75 |
| `danger` / `destructive` | `#e7000b` | 293 | 90 | 79 |
| `info` | `#00809b` | 320 | 91 | 83 |
| `pending` | oklch(0.545 0.03 264) | 254 | — | — |

`pending` solo existe en F1. F2/F3/F4 no lo declaran. Los correos y PDFs lo resuelven con `muted-foreground` (deuda conocida).

## 6. Tipografía

### Conflicto de familias resuelto

| Familia | F1 (web) | F2 (espejo) | F4 (RN) | F5 (Stitch) |
|---------|----------|-------------|---------|-------------|
| sans / body | `Geist` (línea 11) | `Geist` (línea 116) | **`Inter`** (línea 142) | `Inter` (líneas 53-108) |
| display | `Plus Jakarta Sans` (línea 115) | `Plus Jakarta Sans` (línea 115) | — | — |
| mono | `Geist Mono` (línea 117) | `Geist Mono` (línea 117) | — | — |

**Decisión:** La familia canónica del cliente es **Inter**.

- F4 declara `fontFamily.sans: ['Inter_400Regular', 'System']` (línea 142).
- F5 especifica Inter en cada rol tipográfico (líneas 53-108).
- `apps/client/app/_layout.tsx` carga Inter vía `@expo-google-fonts/inter` (líneas 8-14, 31-37).
- **Consumidor que fuerza la decisión:** `apps/client/app/_layout.tsx` — carga Inter con `useFonts`; cambiar a Geist/Plus Jakarta Sans requeriría sustituir el paquete de fuentes y todas las clases `font-inter-*`.

F2 (`Plus Jakarta Sans` / `Geist`) queda como **canónico para web app**, no para el cliente mobile.

### Escala tipográfica del cliente (F4 líneas 113-127)

RN no soporta `clamp()`; se usa el valor máximo (desktop) de cada rol de F1.

| Rol | Tamaño (px) | Peso | Line-height | Letter-spacing |
|-----|-------------|------|-------------|----------------|
| h1 | 32 | 800 | 1.15 | -0.64px |
| h2 | 24 | 700 | 1.25 | -0.36px |
| h3 | 17 | 700 | 1.3 | -0.17px |
| h4 | 15 | 600 | 1.35 | — |
| body | 16 | 400 | 1.6 | — |
| small | 14 | 400 | 1.5 | — |
| caption | 12.5 | 400 | 1.45 | — |
| overline | 12 | 600 | 1.4 | 0.96px |
| label-sm | 12 | 500 | 14px | — |
| label-md | 12 | 500 | 16px | — |
| label-lg | 14 | 600 | 18px | — |
| price-sm | 13 | 600 | 16px | — |
| price-lg | 20 | 700 | 24px | -0.2px |

Suelo: 12px (F2 `minFontSize`, línea 146). F5 Stitch define `label-sm` en 11px; se sube a 12px por la misma auditoría de 218 tamaños que F1 documenta (líneas 652-659).

## 7. Radios

| Token | px | F1 línea | F2 línea | F4 línea |
|-------|----|----------|----------|----------|
| sm | 8 | 63 (`--radius` - 4px, `--radius` = 10px) | 103 | 135 |
| md | 10 | 64 | 104 | 134 |
| lg | 12 | 65 | 105 | 133 |
| xl | 14 | 66 | 106 | 132 |
| 2xl | 20 | 67 | 107 | 131 |
| pill | 999 | — | 108 | 43 (F3) |

F1 `--radius: 0.625rem` = 10px (línea 190). Los radios se calculan como `calc(var(--radius) ± N)`.

## 8. Escala de espaciado

F2 línea 98: `[0, 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 56, 64, 80, 96]` (base 4px).

F5 define su propia escala (`space-2xs` a `space-2xl`, líneas 117-127). Para el cliente, la escala de F2 es la canónica; los valores de F5 se mapean:

| F5 nombre | F5 valor | Equivalente F2 |
|-----------|----------|----------------|
| space-2xs | 0.125rem (2px) | 2 |
| space-xs | 0.25rem (4px) | 4 |
| space-sm | 0.5rem (8px) | 8 |
| space-md | 0.75rem (12px) | 12 |
| space-base | 1rem (16px) | 16 |
| space-lg | 1.25rem (20px) | 20 |
| space-xl | 1.5rem (24px) | 24 |
| space-2xl | 2rem (32px) | 32 |

## 9. Elevación / sombras

Canónicas en F1 líneas 765-779 (`elevation-1/2/3`) y F4 líneas 97-108 (`boxShadow`).

| Nivel | Uso | Valor |
|-------|-----|-------|
| elevation-1 / card | Reposo | `0 1px 3px 0 rgb(0 0 0 / 0.06), 0 1px 2px -1px rgb(0 0 0 / 0.06)` |
| elevation-2 / premium | Hover/dropdown | `0 1px 2px rgb(15 23 42 / 0.04), 0 4px 12px -2px rgb(15 23 42 / 0.06), 0 12px 32px -8px rgb(15 23 42 / 0.08)` |
| elevation-3 / premium-lg | Modal | `0 2px 4px rgb(15 23 42 / 0.04), 0 8px 24px -4px rgb(15 23 42 / 0.08), 0 24px 56px -12px rgb(15 23 42 / 0.14)` |
| floating | FABs | `0 4px 12px rgb(15 23 42 / 0.10), 0 12px 40px -8px rgb(15 23 42 / 0.22)` |
| hero | Wallet/banners | `0 2px 6px rgb(15 23 42 / 0.05), 0 16px 40px -8px rgb(15 23 42 / 0.14), 0 32px 80px -16px rgb(15 23 42 / 0.18)` |

## 10. Motion

Canónico en F1 líneas 174-186 (`@theme`). F2 líneas 149-158 lo replica.

### Duraciones

| Token | ms | F1 línea |
|-------|----|----------|
| `instant` | 100 | 174 |
| `fast` | 150 | 175 |
| `base` | 200 | 176 |
| `slow` | 350 | 177 |
| `hero` | 500 | 178 |
| `celebration` | 900 | 179 |

### Curvas

| Token | Valores | F1 línea |
|-------|---------|----------|
| `ease-out-expo` | `cubic-bezier(0.16, 1, 0.3, 1)` | 181 |
| `ease-in-quint` | `cubic-bezier(0.64, 0, 0.78, 0)` | 182 |
| `ease-in-out` | `cubic-bezier(0.65, 0, 0.35, 1)` | 183 |
| `ease-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | 184 |
| `ease-bounce` | `cubic-bezier(0.68, -0.55, 0.27, 1.55)` | 185 |
| `ease-elastic` | `cubic-bezier(0.5, 1.5, 0.5, 1)` | 186 |

## 11. Política de modo oscuro

**Modo oscuro: FUERA DE SCOPE para el rediseño del cliente.**

- F1 define un bloque `.dark` completo (líneas 370-424) con tokens oscuros.
- F3/F4 no declaran modo oscuro.
- El cliente RN no tiene toggle de tema activo.

**Decisión:** Los tokens oscuros de F1 se documentan como **legacy/dormant**. No se borran (el web app los usa si alguien activa `.dark` en `html`), pero el rediseño del cliente no los consume ni los extiende. Si un futuro todo requiere modo oscuro en el cliente, se declararán en este contrato con valores propios, no heredando el `.dark` de F1 sin revisión.

## 12. Reglas de consumo

1. **Ningún hex literal en pantallas.** Todo color se referencia vía token (`bg-primary`, `text-retail-blue`, `bg-vibe-violet`).
2. **Web usa F1 (OKLCH).** RN usa F4 (hex). F2 es espejo de F1 para emails/OG/PDFs.
3. **F3 se reemplaza.** `apps/client/src/theme/tokens.ts` se alinea a este contrato en Todo 4.
4. **F5 frontmatter ≠ contrato.** Los valores YAML del Stitch son metadata de la herramienta; el contrato visual es la prosa.
5. **Inter es la fuente del cliente.** Geist/Plus Jakarta Sans son de la web app.
6. **Escala numérica primaria:** el DEFAULT (`#0284c7`) es retail blue; la escala 50-900 es el espejo OKLCH web. No es una contradicción — son dos cosas distintas con el mismo nombre de propiedad.
