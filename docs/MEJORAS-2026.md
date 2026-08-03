# Mejoras generales de MembeGo — Diagnóstico y plan

> Fase 1 (auditoría) del plan de 9 frentes. **Este documento se escribió ANTES
> de tocar código de la aplicación**: registra el estado real medido, no
> supuesto, para que las fases siguientes se decidan con datos.

Medición: `2026-08-01` sobre la rama `claude/membego-brand-migration-iy3crt`.

---

## 0. Resumen ejecutivo

De los 9 frentes solicitados, la auditoría encontró que **tres ya están
resueltos o casi**, **cuatro son trabajo real y acotado**, y **uno tiene un
conflicto de negocio que exige tu decisión antes de ejecutarse**.

| # | Frente | Estado medido | Esfuerzo real |
|---|--------|---------------|---------------|
| 1 | Dark mode | 158 `bg-white` sin variante, 8 `text-black`, 21 estilos con hex | **Medio** — pero ~⅓ son legítimos (ver §1) |
| 2 | Sidebar / Navbar | Estructura correcta ya (`z-30` fijo, drawer `z-50`, `lg:pl-60`) | **Bajo** — validar casos, no reescribir |
| 3 | Responsive | 15 de 16 tablas ya con `overflow-x-auto` | **Bajo-medio** — falta vista card en móvil |
| 4 | Paginación | **12 de 16 tablas sin paginar**; `pagination.tsx` existe con 0 usos | **ALTO — el trabajo más valioso** |
| 5 | Plantillas de promos | Kit ya tiene `promo-badge`, `promo-banner`, `flash-promotion` | **Medio** — consolidar, no crear |
| 6 | Rutas públicas | `/promocion/[id]` usa **id**, no slug; `slug` existe en BD sin usar | **Medio-alto** — incluye migración |
| 7 | Reportes | 1 página; recharts instalado; 3 charts existen; **sin export** | **Alto** |
| 8 | Recompensas | Formulario embebido en `/admin/crecimiento` | **Bajo-medio** |
| 9 | Aplicaciones | **CONFLICTO: apagarlo oculta 9 módulos Car Wash funcionando** | **Requiere tu decisión** |

---

## 1. Dark mode — HECHO (Fase 2)

**Dato que cambia la lectura del problema:** el tema por defecto de MembeGo ya
es OSCURO (`ThemeProvider`, `defaultTheme="dark"`). Así que cada superficie
blanca fija dentro de la app no era "algo que se verá mal si alguien activa el
modo oscuro": se estaba viendo mal por defecto.

**El error real no es usar blanco, es mezclarlo.** De las 158 ocurrencias de
`bg-white`, 107 llevan opacidad (`bg-white/10`, `/20`…): son velos sobre
degradados de marca u overlays oscuros y están bien. De las sólidas, la mayoría
son impresión (el papel es blanco), fondo de QR (el lector lo necesita), el
botón de Google (marca) o el marco del formulario de CardNET. Lo que sí rompía
la pantalla eran las **parejas imposibles**: una superficie blanca fija con
texto de token (que en oscuro es casi blanco → ilegible), o una superficie de
token con texto slate fijo (que en oscuro desaparece).

**Corregido (11 sitios, todos parejas imposibles):**

| Dónde | Qué se veía |
| --- | --- |
| Nuevo plan / Editar plan | formulario blanco con etiquetas claras |
| Config. de bienvenida | `<select>` blanco con texto del tema |
| Membresías (chips de filtro) | chip blanco con texto gris claro |
| Ficha de cliente (botón Correo) | botón blanco con texto gris claro |
| Perfil (selector de empresa) | tarjeta blanca con texto del tema |
| Dashboard (recomendaciones) | tarjeta blanca con texto del tema |
| Modal de la ruleta | tarjeta blanca de premio |
| Overlay de celebración (registro) | tarjeta blanca + degradados hacia blanco |
| PanelError | título y texto oscuros sobre lienzo oscuro (invisible) |
| Invitación por token | página clara suelta dentro de la app |

**Guardia permanente:** `tests/tema-oscuro.test.ts` recorre `src` y
`packages/ui/src` y falla si un archivo mezcla las dos capas. La comprobación
es por ARCHIVO a propósito: en JSX la tarjeta es un `<div>` y su texto un `<p>`
anidado, así que mirar línea por línea deja pasar justo el caso real (se
comprobó: la versión por línea no detectaba ninguno de los 11 errores). Los
archivos que mezclan legítimamente están declarados con su motivo, y hay una
prueba que verifica que la guardia sabe fallar y otra que borra exenciones que
ya no aplican.

**Se dejó a propósito con paleta clara propia:** `CampanaLanding` (landing
pública de conversión que llega por WhatsApp) y la sección festiva de
Invita y Gana. Son coherentes por dentro (blanco fijo con texto oscuro fijo),
no tienen parejas imposibles y su diseño claro es intencional.

## 2. Sidebar y Navbar — validado (Fase 2)

Lo medido en la auditoría seguía siendo cierto: la estructura no necesitaba
reescritura. De las tres cosas que faltaba verificar, dos ya estaban (Escape
cierra el drawer; el scroll del fondo se bloquea) y la tercera no:

- **Foco atrapado:** con el menú abierto, tabular se escapaba al contenido de
  atrás que el diálogo dice estar tapando (`aria-modal="true"`). Ahora el foco
  circula dentro del panel.
- **Foco devuelto:** al cerrar vuelve al botón que lo abrió, en vez de saltar al
  principio de la página.
- **Menú cerrado, pero tabulable:** el drawer sigue en el árbol para poder
  animarse, así que sus enlaces se podían enfocar con el teclado aunque
  estuvieran fuera de pantalla. Se marca `inert` mientras está cerrado.

## 2. Sidebar y Navbar — ya cumple lo pedido

`AppShell.tsx` medido:

- Sidebar escritorio: `fixed inset-y-0 left-0 z-30`, altura completa. ✅
- Drawer móvil: `fixed inset-0 z-50` (por encima del header). ✅
- Contenido: `lg:pl-60` / `lg:pl-[68px]` según riel colapsado — el navbar y el
  contenido **sí** se reajustan al colapsar. ✅
- Transición: `transition-[width] duration-200`. ✅

**Lo que falta verificar (no reescribir):** cierre con `Escape`, bloqueo de
scroll de fondo con el drawer abierto, y trampa de foco (accesibilidad).

## 3. Responsive — mejor de lo asumido

15 de 16 tablas ya envuelven en `overflow-x-auto`. La única sin él es
`seguimiento/imprimir`, que es una hoja para impresión — correcto así.

**Trabajo real:** vista alternativa en tarjetas para móvil en las tablas densas
(Registros, Pagos, Comprobantes, Clientes) y revisión de formularios largos.
No es un rediseño general.

## 4. Paginación — HECHO (Fase 1)

**Diagnóstico corregido con datos.** La primera lectura decía "12 de 16 tablas
cargan sin límite". Al revisar las consultas reales (viven en `src/modules/`,
no en las páginas) resultó falso: casi todas tenían un tope. El problema no era
la falta de tope sino **lo que el tope hacía**: la página avisaba "truncado" y
las filas por debajo del corte quedaban **inalcanzables por cualquier camino**.
Era exactamente el motivo por el que no se podían reimprimir comprobantes
viejos.

**Lo construido**

- `src/lib/paginacion.ts` — núcleo puro, sin React ni Prisma:
  `leerPaginacion` (acota `?page=-5`, `?pageSize=999999`), `resumirPaginas`
  (corrige la página fuera de rango cuando un filtro encoge el resultado) y
  `urlDePagina` (conserva los filtros activos; la primera página es URL limpia).
  Acepta un **prefijo** para pantallas con varias tablas independientes.
- `src/components/tablas/TablaPaginacion.tsx` — Server Component: la navegación
  son enlaces reales, funciona sin JavaScript y el estado vive en la URL.
- `tests/paginacion.test.ts` — 10 pruebas: valores por defecto, URL manipulada,
  rango humano, página fuera de rango, cero resultados, filtros que sobreviven
  y tablas con prefijo que no se contaminan entre sí.

**Tablas migradas**

| Pantalla | Antes | Ahora |
| --- | --- | --- |
| Registros | 300 fijas | páginas + total real |
| Comprobantes (facturas) | 100 fijas | páginas + búsqueda conservada |
| Seguimiento | 200 fijas | páginas (corte en memoria, tras el filtro derivado) |
| Regalos | 100 fijas | páginas + total del filtro |
| Pagos | 5 colas de 100 | 5 paginaciones independientes con totales reales |
| Superadmin · Membresías | 100 fijas | páginas + total real |
| Campañas | sin tope | páginas |
| Car Wash · Inventario | 300 productos / 25 movimientos | dos tablas paginadas |
| Car Wash · Vehículos | 100 fijas | páginas |
| Clientes | ya paginaba | sin cambios |

**Qué NO se paginó y por qué.** Los paneles operativos del Car Wash
(comisiones, turnos, incidencias) reciben un período (`desde`/`hasta`) y su
tope (300–500) es una ventana de trabajo, no un historial abierto; con el
volumen de un local no se alcanza. `superadmin/observabilidad` no tiene tabla
de base de datos: pinta la lista fija de SLOs del código. Los "top N" del
dashboard (últimos 3, últimos 8) son widgets, no tablas.

**Detalle corregido de paso:** en el paginador, la URL "limpia" se resolvía
contra la URL actual, así que volver a la primera página con el tamaño por
defecto no hacía nada.

## 5. Plantillas de promociones

El kit ya aporta `promo-badge`, `promo-banner`, `flash-promotion`, `countdown`,
`price`. La duplicación real está en los componentes de página, no en el kit.

**Estrategia:** un `PublicOfferCard` con `variant` (`estandar` | `destacada` |
`countdown` | `limitada` | `bienvenida` | `referidos`) que **componga** las
piezas del kit ya existentes. Cero componentes nuevos de bajo nivel.

## 6. Rutas públicas de promociones — HECHO (Fase 4)

**Antes:** `/promocion/cmd7k2p9x0001qz3f8b2h4t1a`. Un enlace que no dice nada,
que se corta feo en la vista previa de WhatsApp y que nadie reconoce. La
columna `promociones.slug` existía en el esquema desde la Fase 2 del
marketplace, vacía y sin usarse.

**Ahora:** `/promocion/lavado-premium-gratis`.

**Lo construido:**

- `src/modules/promociones/slug.ts` — núcleo puro: quita acentos (y convierte
  la ñ en n, si no «Año» quedaría «ao»), descarta artículos, corta por palabra
  completa a 60 caracteres y resuelve repeticiones con `-2`, `-3`… El sufijo
  cuenta para el tope, así que el slug nunca crece sin control.
- Asignación en `crearPromocion`, `duplicarPromocion` y —solo si falta— en
  `actualizarPromocion`.
- La ruta pasa a ser `/promocion/[clave]` y resuelve **por slug O por id** en
  una sola consulta. Un enlace viejo con id que ya tiene slug se redirige (308)
  a la dirección con nombre, para que las vistas previas y los contadores de
  las redes no se repartan entre dos URLs.
- Los botones de compartir (panel, detalle público, «mis promociones») y la
  vista previa del editor usan ya la dirección con nombre.
- `tests/promociones-slug.test.ts` — 10 pruebas: acentos y ñ, títulos
  imposibles, corte por palabra, repetidos, tope con sufijo, y la distinción
  entre un id de la base y un slug.

**REGLA QUE NO SE PUEDE ROMPER:** el slug **no cambia** al editar el título.
Un enlace compartido por WhatsApp sigue circulando meses; si el slug cambiara,
ese enlace moriría. Se asigna una vez y se queda.

**Cambio de base de datos** (migración `20260775_promociones_slug`, idempotente):
rellena los slugs de las promociones existentes desde su título, desempata los
repetidos por empresa y crea el índice único `(companyId, slug)`. Dos empresas
distintas SÍ pueden tener «lavado-premium»; la misma empresa, no. Mientras el
SQL no se corra, las promociones viejas siguen abriéndose por id — no se rompe
nada, simplemente aún no tienen nombre bonito.

**Lo que NO se unificó:** siguen existiendo `/oferta/[codigo]` (ofertas
privadas, que se resuelven por un código secreto y no deben ser adivinables) y
`/empresas/[slug]`. Son convenciones distintas porque resuelven cosas
distintas; unificarlas por simetría habría roto el secreto de las ofertas.

## 7. Reportes — HECHO (Fase 5)

**Lo que había:** una página de una sola vista, «el mes en curso», sin filtros,
sin comparación, sin gráfica y sin exportar. Y un detalle que importa más de lo
que parece: los cortes de mes se hacían con la hora del servidor, no con la del
negocio. Un lavado cobrado a las 9 de la noche del día 31 en Santo Domingo se
guarda como la 1 de la madrugada del 1 en UTC, así que caía en el mes siguiente
y el reporte no cuadraba con la caja.

**Lo construido:**

- `src/modules/reportes/rango.ts` — núcleo puro de fechas. Presets (hoy, 7 días,
  30 días, este mes, mes pasado), rango a mano, y todos los límites en
  **medianoche local de la empresa**. Calcula además el periodo anterior con
  EXACTAMENTE los mismos días: comparar 30 días contra un mes de 31 inventaría
  una caída del 3% que nunca ocurrió.
- `src/modules/reportes/queries.ts` — KPIs con su comparación, serie diaria
  (rellenando los días sin actividad), desglose por tipo de operación y por
  método de cobro, clientes más activos y membresías activas por plan. Cada
  consulta va envuelta: si una falla, el reporte se marca como **incompleto** en
  pantalla en vez de enseñar ceros como si fueran reales.
- `ReporteChart` — barras apiladas (ventas / entregas sin cobro) con los colores
  del tema por clases, no hexadecimales quemados.
- `/admin/reportes/export` — CSV con el MISMO rango que la pantalla (viaja por
  query string), separador `;` y BOM, que es lo que Excel en español necesita
  para no partir todo en una columna ni romper los acentos.
- `tests/reportes-rango.test.ts` — 15 pruebas con reloj fijo: la venta nocturna
  cae en el mes correcto, «mes pasado» acierta en febrero bisiesto y al cruzar
  de año, la basura en la URL no rompe nada, la variación no inventa
  porcentajes sobre cero, y el CSV cuadra su fila de TOTAL.

**Decisión que se ve en pantalla:** los ingresos de caja y los cobros de
membresías se muestran SEPARADOS. Son dinero que entra por caminos distintos
(mostrador vs. activaciones y renovaciones) y sumarlos en una sola cifra
impediría cuadrar el reporte contra la caja del día.

**Limitación heredada, escrita para que no sorprenda:** el cobro de una
membresía se fecha por `updatedAt` porque no hay un campo de fecha de pago
propio. Editar una membresía vieja la mueve de periodo. Arreglarlo pide una
columna nueva y su migración; no se hizo aquí para no mezclar cambios de
esquema con esta fase.

## 8. Reglas de recompensas — HECHO (Fase 6)

**Corrección del diagnóstico:** la auditoría apuntó a `ReglaRecompensaForm.tsx`
y a `src/modules/admin/recompensaActions.ts`, pero son de OTRO sistema (las
reglas por N referidos de `/admin/referidos`, modelo `ReglaRecompensa`). El
formulario embebido que había que sacar es el del Growth Engine (`GrowthRule`)
al final de `/admin/crecimiento`. El de referidos se dejó intacto: funciona y
ya tiene su sitio.

**Lo que se encontró al abrirlo:**

1. `crearGrowthRuleAction` validaba y, si algo no cuadraba, hacía `return` sin
   decir nada. El administrador llenaba la regla, pulsaba «Crear» y no pasaba
   NADA: ni regla ni mensaje.
2. **No se podía editar una regla.** Solo crear, pausar y borrar. Cambiar
   «50 puntos» por «100» obligaba a rehacerla y perder el registro anterior.
3. Se podía guardar una regla de tipo «beneficio digital» sin elegir el
   beneficio: se disparaba y no entregaba nada.

**Lo construido:**

- `src/modules/growth/reglas.ts` — núcleo puro (sin Prisma ni React): valida,
  normaliza y SIEMPRE devuelve un motivo legible. Ahí viven también las
  etiquetas en español y `resumirRegla`, que antes estaban duplicadas en la
  página.
- `actualizarGrowthRuleAction` — nueva, con la misma barrera multiempresa que
  las demás (una regla de otra empresa no se puede tocar ni ver).
- Páginas: `/admin/crecimiento/recompensas` (lista con estado, editar, pausar,
  eliminar), `/nueva` y `/[id]/editar`. `/admin/crecimiento` conserva la
  configuración del programa y resume las reglas con enlace a su página.
- `ReglaRecompensaForm` (cliente): oculta los campos que no aplican al tipo
  elegido —un beneficio digital no lleva «cuánto», un disparador que no sea «N
  referidos» no lleva umbral— y muestra los errores.
- `tests/growth-reglas.test.ts` — 9 pruebas sobre el núcleo: cada rechazo trae
  una frase para la persona; el beneficio sin promoción se rechaza; una promo
  elegida por error no se arrastra al cambiar de tipo; el descuento porcentual
  se topa en 100; el umbral solo existe en «N referidos» y se redondea (medio
  referido no existe).

## 9. Aplicaciones — CONFLICTO QUE REQUIERE TU DECISIÓN

**El módulo Aplicaciones NO está vacío.** Es la puerta de entrada a la app Car
Wash, que hoy contiene **nueve módulos construidos y funcionando**:

`cola`, `inventario`, `evidencias`, `vehiculos`, `comisiones`, `compras`,
`activos`, `incidencias`, `reportes` (Car Wash).

Además, con la capacidad `NAVEGACION_V2` encendida (CARTOWN la tiene),
**Escáner, Citas, Seguimiento y Sucursales salen del menú principal y solo son
accesibles desde ahí** — es exactamente la causa de "el módulo de seguimiento no
me aparece" que reportaste hace poco.

**Apagar Aplicaciones hoy dejaría 13 módulos sin acceso por menú.**

**Opciones (tu decisión):**

- **A (recomendada):** apagar `NAVEGACION_V2` para CARTOWN — los módulos
  operativos vuelven al menú principal — y *entonces* ocultar Aplicaciones.
  Todo sigue accesible, el menú queda plano y simple.
- **B:** conservar Aplicaciones como está (no ocultarlo).
- **C:** ocultar Aplicaciones tal cual, asumiendo que Cola, Inventario,
  Evidencias, etc. queden solo por URL directa.

No se ejecuta nada de este punto hasta que elijas.

---

## Riesgos técnicos identificados

1. **Reemplazo masivo de colores** rompería tickets impresos y QR (§1).
2. **Refactor del DataTable** afecta 3 pantallas en producción (Clientes,
   Empleados, Membresías): debe ser aditivo (modo servidor opcional), nunca
   sustitutivo de golpe.
3. **Slugs de promociones**: cambiar la resolución de ruta puede romper enlaces
   ya compartidos por WhatsApp. Mitigación: resolver por slug **con respaldo
   por id**, nunca solo por slug.
4. **Aislamiento multiempresa**: cada nueva consulta paginada debe llevar
   `companyId` en el `where` y el `count`. Es el punto donde una paginación mal
   hecha filtra datos de otra empresa.
5. **Trabajo sin fusionar**: la rama acumula ~15 commits (pagos, integraciones,
   superadmin, comprobantes) que aún no están en `main`. Empezar un refactor
   grande encima aumenta el riesgo de conflicto. **Recomendación: fusionar
   antes de la Fase 2.**

## Cambios de base de datos previstos

| Fase | Cambio | Tipo |
|------|--------|------|
| 6 | Backfill de `promociones.slug` + índice único por `(companyId, slug)` | Migración de datos + índice |
| 4 | Índices de apoyo a la paginación donde falten (`createdAt`) | Aditivo |
| — | Ninguno destructivo | — |

## Componentes: reutilizar vs. crear

**Ya existen (reutilizar, no duplicar):** `page-header`, `empty-state`,
`data-table`, `pagination`, `confirm-dialog`, `stat-card`, `status-chip`,
`status-banner`, `skeleton`, `sheet`, `countdown`, `promo-badge`,
`promo-banner`, `flash-promotion`, `price`, `segmented-control`.

**A crear (solo lo que falta):** `DataTableServer` (modo servidor sobre el
DataTable actual), `FilterBar`, `DateRangeFilter`, `ExportMenu`, `MetricCard`
(o extender `stat-card`), `ChartCard`, `PublicOfferCard`, `FormSection`.

## Orden de ejecución propuesto

Respeta el orden que pediste, con una corrección de prioridad: **la paginación
(Fase 3) sube al primer lugar** porque es el único frente con impacto de
rendimiento real y ya tiene los componentes construidos esperando.

1. **Fusionar la rama a `main`** (desbloquea el deploy y limpia la base).
2. Fase 3 — DataTable servidor + paginación (empezando por Registros).
3. Fase 2 — Dark mode clasificado + validaciones de sidebar/responsive.
4. Fase 6 — Recompensas a páginas propias (acotado, bajo riesgo).
5. Fase 5 — Reportes con KPIs, filtros y export.
6. Fase 4 — Plantillas de promociones + slugs y rutas públicas.
7. Fase 7 — Aplicaciones, **según la opción que elijas en §9**.
8. Fase 8 — QA final por tema, tamaño, rol y empresa.
