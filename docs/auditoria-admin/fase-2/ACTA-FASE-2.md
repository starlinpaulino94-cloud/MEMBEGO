# Acta de la fase 2 · Decisiones y especificación del Design System (20-10-2026)

> **Estado:** tareas 2.1 a 2.4 hechas. **No se toca el producto:** el único código que cambia es el auditor de diseño y su prueba (`scripts/auditar-diseno.mjs`, `tests/deuda-diseno.test.ts`). Ningún token, ninguna fuente, ninguna pantalla.
> **Base:** rama `claude/auditoria-fase2`, sobre `claude/ci-main-verde` (los 10 fallos de `main` arreglados, sin subir), sobre `origin/main` `4243a0f8`.
> **Referencias:** los documentos `00` a `15` de la auditoría siguen **sin versionar** (están en el checkout principal, `docs/auditoria-admin/`). Esta acta se entiende sola; cuando cita `10`, `12` o `13` remite a ellos.

## 0. Cómo leer «aprobada»

El 20-10-2026 el dueño escribió «apruebo todas las fases, continúa». Eso **autoriza ejecutar** las fases en orden. No contesta por sí solo preguntas de dominio que el plan reserva al dueño (`13` §3), y la fase 1 ya dejó el precedente: «apruebo la fase 1» no se tomó como respuesta a D-08. Por eso:

- Las decisiones **reversibles** que el plan manda tomar ya (`12` · fase 2, riesgos) se **adoptan con la recomendación de `13`** y quedan marcadas «adoptada, revocable».
- Las que dependen de datos de uso, o que cambian comportamiento o datos, quedan **pendientes**, con lo que habría que saber para cerrarlas.
- La firma de `10` (tarea 2.2) se hace **sobre las pantallas renderizadas de la fase 3**, no sobre una tabla de tamaños: es lo que `12` pide para no «aprobar por gusto» (R-12).

## 1. Decisiones D-01 a D-12 (tarea 2.1)

| Id | Decisión | Estado | Resolución | Qué cambia y cuándo |
|---|---|---|---|---|
| **D-01** | Azul canónico del panel | **Adoptada, revocable** | El de la aplicación, `oklch(0.55 0.22 255)` (≈ `#006bed`) | Ya es `--primary`, `--ring` y `--sidebar-*` en `globals.css` (líneas 303–531, verificado hoy). `#0284c7` (`--color-retail-blue`) y `#2563eb` (`--color-vibe-cobalt`, `--sv2-accent`) dejan de ser azul de acción **del panel**; siguen en el cliente hasta derivarse de la escala (fase 4). |
| **D-02** | Tipografía única Inter | **Adoptada, revocable** — con una corrección (§2) | Inter en el panel; Geist Mono para códigos; Plus Jakarta y Geist salen **del panel** | **Hoy el panel no carga Inter** (§2). La fase 4.8 tiene que cargarla en el layout del panel. |
| **D-03** | Pipeline comercial (`Prospecto` / `Lead`) | **Pendiente** | — | Decisión de dominio con datos en las tablas (R-10). No antes de la fase 8, con uso real. |
| **D-04** | Un solo motor de recompensas | **Pendiente** | — | Igual: exige plan de migración y respaldo propios. No se mezcla con el menú. |
| **D-05** | Destino de Car Wash | **Pendiente de datos** | — | Depende del uso real (D-11). Mientras tanto no se añaden índice ni redirecciones (hoy `/admin/app/carwash` da 404). |
| **D-06** | Retirar el riel de espacios y el modo compacto | **Adoptada, revocable** | Retirar | El código ya es inalcanzable (`07` · FE-01). Se deja de depender de él en la fase 6 y se borra en la 8, con sus pruebas. Reversible con git. |
| **D-07** | Motor universal de membresías y réplica de promociones | **Pendiente de datos** | — | «Aislar con prueba y decidir con la telemetría» (`13`). |
| **D-08** | Contraseña del administrador nuevo: teclearla o invitar | **Pendiente — tu respuesta** | Recomendación de `13`: invitar por correo | Es la tarea 1.10 que quedó sin hacer. Cambia el alta de empresas y exige correo transaccional. Propuesta: hacerla en la 7.3 (un solo `crearEmpresa`) salvo que pidas adelantarla. |
| **D-09** | «Caja» en el menú del administrador | **Adoptada, revocable** | Sí, solo con la capacidad | Se aplica en la fase 6 (menú de 21 entradas). |
| **D-10** | Gerente de sucursal real | **Pospuesta** | — | No hay evidencia de que el negocio lo pida; es un proyecto propio. |
| **D-11** | Telemetría mínima de navegación | **Pendiente — tu respuesta** | Recomendación de `13`: sí | **No existe** (tarea 0.6 sin hacer). Sin ella D-05, D-07 y los borrados de la fase 8 se deciden a ciegas. Opción sin código: leer registros de acceso de Vercel — **NO VERIFICADO** cuánto tiempo conservan. Opción con código: un contador por ruta y rol, sin datos personales; guardaría datos de uso, por eso lo dejo a tu decisión. |
| **D-12** | Verificar Amazon Ember | **Adoptada** | Descartar | Sin acción: sin licencia verificable no se usa. |

## 2. Tipografía: lo que se verificó (tarea 2.3)

**Alcance honesto:** se verificó a nivel de **archivo de fuente y de código**, no renderizado en un navegador. El panel autenticado necesita el proyecto de pruebas de QA y no lo levanté para esto; el dato que importa (qué sirve Google y qué carga el panel) no depende de eso. Falta la comprobación visual, y la fase 4.8 es donde corresponde hacerla.

**Qué sirve Google Fonts (subconjunto latino, el que `next/font/google` aloja):**

- **Una sola fuente variable** con eje `wght` 100–900. Los pesos 400, 500 y 600 apuntan al mismo archivo (48 256 bytes el subconjunto latino). Los pesos permitidos por `10` §2 (400, 500, 600) están cubiertos.
- Características OpenType presentes en `GSUB`: `calt ccmp dnom frac locl numr pnum tnum`. **`tnum` está**, así que `font-variant-numeric: tabular-nums` funciona. Las variantes de Inter que **no** vienen en la versión de Google: `case`, `cv*` y `ss*` (por ejemplo, el cero con barra o la «a» de un piso). `10` no las pide, pero hay que saberlo: el `font-feature-settings: "ss01"` del `body` es de Geist y con Inter no hace nada.

**Qué carga hoy el panel (código, verificado):**

- `src/app/layout.tsx` carga Geist, Geist Mono y Plus Jakarta Sans. **Inter solo se carga en `(cliente)/layout.tsx`** (variable `--font-inter`, aplicada bajo la clase `.retail`) y, aparte, en `components/supply-v2/fuentes.ts`.
- Por tanto, **el panel administrativo se pinta hoy con Geist (texto) y Plus Jakarta (títulos `h1`–`h3`), no con Inter.** `10` §2 dice que Inter «ya está en el proyecto»: es cierto para el cliente, no para el panel. La decisión D-02 implica **cargarla** en el panel (fase 4.8, detrás de una clase de ámbito del panel para no mover el cliente).
- Las cifras tabulares hoy solo se aplican a `h1, h2, h3` (`globals.css`, capa base). Tablas, KPI y montos no las tienen: `10` §2 («cifras tabulares en todo el panel») es trabajo de la fase 4, no un hecho.

## 3. Medidas nuevas del auditor y sus techos (tarea 2.4)

`node scripts/auditar-diseno.mjs` ahora cuenta ocho cosas más, y `tests/deuda-diseno.test.ts` las congela como techos que **solo bajan** (con la misma regla de holgura ≤ 10 que las anteriores). Se miden sobre `origin/main` `4243a0f8`, no sobre el código viejo del informe `07`.

«Panel» = páginas de `(admin)`, `(superadmin)`, `(empleado)`, `(vendedor)`, `(onboarding)` + `components/admin` + `components/superadmin`. El cliente final queda fuera a propósito; los componentes compartidos con el cliente (`crm`, `scanner`…) también, porque no se puede decir de quién son sin mirar quién los importa.

| Medida | Qué cuenta | Techo hoy | El informe `07` decía | Hallazgo |
|---|---|---:|---|---|
| `h1Crudo` | `<h1` en el panel | **46** | 38 páginas (40 con layouts) | FE-02 |
| `botonCrudo` | `<button` en el panel | **39** | 36 | FE-05 |
| `titulo2xlBold` | `text-2xl font-bold` (en cualquier orden) en el panel | **30** | 26 | FE-12 |
| `tarjetaLocal` | `function/const Kpi\|Tarjeta*\|Metrica\|Cifra\|Dato…` en el panel, sin las `*Page`/`*Layout` | **24** | 26 | FE-04 |
| `tablaCruda` | `<table` en el panel | **54** (47 archivos) | 24 archivos / 47 tablas | FE-13, T-01 |
| `variablesHexEnGlobalsCss` | `--x: #hex;` en `globals.css` | **65** | **31** | FE-12 |
| `mapasDeEstado` | `const … = { }` de estado/tono/insignia con clases `bg-/text-/border-` (heurística; todo el código) | **58** | 54 archivos | FE-03 |
| `componentesSinUso` | archivos de `packages/ui/src/ui` que nadie importa | **15** | 18 | FE-14 |

- **Las 15 sin uso hoy:** `animated-number`, `app-icon`, `calendar`, `date-text`, `flash-promotion`, `glass-card`, `pagination`, `price`, `progress`, `promo-badge`, `promo-banner`, `segmented-control`, `spinner`, `stagger`, `typography`. Respecto a la lista del informe (18) salen `rating-stars` (una página del cliente lo importa de verdad), `countdown` y `shine`; estos dos **solo los importa `flash-promotion`, que a su vez nadie usa**. No se sigue la cadena (un componente que solo usa otro sin uso cuenta como usado), así que la cifra es un suelo: con la cadena serían 17.
- **Las dos que más cambiaron** son el aviso de que los hallazgos eran INFERIDOS: `globals.css` **duplicó** sus variables con hex (31 → 65) y las tablas crudas son **más del doble** de las que el informe contaba como «archivos con `<table>`».
- Lo que **no** se midió: `Button size="icon"` sin `aria-label` y `outline-none` sin `focus-visible` (FE-13). `tests/accesibilidad-formularios.test.ts` solo vigila los **campos de formulario sin nombre** (techo 94); esos dos no tienen hoy ninguna prueba. No estaban en la lista de la tarea 2.4; quedan para las compuertas de la fase 4 (4.10), donde el tipo de `Button` que exija `aria-label` los resuelve de raíz.

## 4. Cifras de la auditoría que ya no se sostienen

Quien lea `07`, `02` o `14` debe usar esta tabla, no sus números: `<h1>` 38 → 46; `<button>` 36 → 39; `text-2xl font-bold` 26 → 30; variables hex de `globals.css` 31 → 65; componentes sin uso 18 → 15; hex en TSX 115 → 113 (techo 114); color crudo 143 → 147 (techo 147). Siguen vigentes: el azul de acción OKLCH, la existencia de tres azules, la ausencia de Inter en el panel y los cero de radios, microtextos, sombras y duraciones.

## 5. Verificación

| Comprobación | Resultado |
|---|---|
| `tests/deuda-diseno.test.ts` | 3 pruebas en verde con los techos nuevos |
| `eslint` sobre los dos archivos | sin errores (1 aviso previo, `clave` sin usar en el modo línea de órdenes) |
| `node scripts/auditar-diseno.mjs` | imprime las 15 medidas en 2 s |
| Independencia del sistema operativo | las rutas se normalizan a «/» antes de comparar (`normalizar`), igual que el auditor ya hacía; **no ejecutado en Linux** |

## 6. Para cerrar la fase 2 hace falta tu respuesta en

1. **D-08** (invitar por correo o seguir tecleando la contraseña) y **D-11** (telemetría: ¿con código o leyendo registros de Vercel?).
2. Confirmar o revocar las cinco adoptadas: **D-01, D-02, D-06, D-09, D-12**.
3. D-03, D-04, D-05, D-07 y D-10 siguen abiertas a propósito; ninguna bloquea la fase 3.

## 7. Cómo reproducir

```bash
node scripts/auditar-diseno.mjs
npx tsx --test tests/deuda-diseno.test.ts
```
