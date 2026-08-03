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

## 1. Dark mode — el número asusta más de lo que debe

**Medido:** 158 ocurrencias de `bg-white` sin `dark:`, 8 de `text-black`,
21 estilos inline con hexadecimal, 4 `className` con hex.

**Matiz crítico que evita romper cosas:** no todos son errores. Al menos tres
familias son *correctas* y deben conservarse:

1. **Impresión** (`ReceiptTicket`, `FacturaPrintDialog`, `seguimiento/imprimir`):
   el papel es blanco. Forzar tokens de tema rompería los tickets.
2. **Códigos QR** (`IdMembegoCard`, `WalletStack`, `CompanyQRRegistro`): un QR
   necesita fondo blanco real para que el lector lo capte. Es funcional.
3. **Superficies sobre gradiente de marca** (`bg-white/10`, `border-white/20`):
   ahí el blanco es correcto porque el fondo siempre es oscuro.

**Trabajo real:** clasificar las 158 ocurrencias en esas 3 familias + las que sí
son deuda, y migrar solo estas últimas a tokens (`card`, `background`, `muted`,
`border`, `popover`). Los tokens **ya existen** en `globals.css` y el kit los
usa; no hace falta ampliar el sistema, solo aplicarlo donde falta.

**Riesgo:** un reemplazo masivo por regex rompería tickets y QR. Debe ser
archivo por archivo con criterio.

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

## 4. Paginación — aquí está el trabajo más valioso

**Hallazgo principal de toda la auditoría:**

- `packages/ui/src/ui/pagination.tsx` **existe y no se usa en ningún lado**.
- `packages/ui/src/ui/data-table.tsx` existe y lo usan 3 componentes
  (`ClientesTable`, `EmpleadosTable`, `MembresíasTable`), pero es **client-side**:
  recibe el arreglo completo y filtra/exporta en el navegador.
- **12 de 16 tablas cargan sin `take`**, es decir, sin límite:
  `adquisicion`, `carwash/inventario`, `carwash/reportes`, `audiencia`,
  `invitaciones/[id]`, `regalos`, `registros`, `seguimiento` (y su impresión),
  `superadmin/campanas`, `superadmin/campanas/[id]`, `superadmin/observabilidad`.
- Solo 4 tienen límite: `carwash/vehiculos`, `facturas`, `pagos`,
  `superadmin/membresias` — y son `take` fijo, **sin navegación de páginas**.

**Consecuencia real:** con 5.000 visitas o 20.000 registros, esas páginas
intentan traerlo todo. Es el riesgo de rendimiento más concreto del sistema.

**Estrategia:** extender el `DataTable` existente con modo servidor
(`page`, `pageSize`, `total` por props + estado en URL), conectar el
`Pagination` que ya existe, y migrar tabla por tabla empezando por las de
mayor crecimiento: Registros → Visitas/Seguimiento → Clientes → Pagos.

## 5. Plantillas de promociones

El kit ya aporta `promo-badge`, `promo-banner`, `flash-promotion`, `countdown`,
`price`. La duplicación real está en los componentes de página, no en el kit.

**Estrategia:** un `PublicOfferCard` con `variant` (`estandar` | `destacada` |
`countdown` | `limitada` | `bienvenida` | `referidos`) que **componga** las
piezas del kit ya existentes. Cero componentes nuevos de bajo nivel.

## 6. Rutas públicas de promociones — hay deuda real

**Medido:**

- Existen `/promocion/[id]`, `/oferta/[codigo]`, `/promociones`,
  `/empresas/[companySlug]` — cuatro convenciones conviviendo.
- `/promocion/[id]` resuelve por **id interno**, no por slug.
- `promociones.slug` **existe en el esquema** (`String?`) pero no se usa para
  resolver la ruta.
- Sí hay `opengraph-image.tsx` por promoción — la metadata de compartir ya
  funciona.

**Trabajo:** generar slugs únicos por empresa, resolver por slug con respaldo
por id (para no romper enlaces ya compartidos), y unificar la convención.
**Requiere migración de datos** (backfill de slugs) — ver §Migraciones.

## 7. Reportes

`recharts` ya es dependencia y hay 3 componentes de gráfica
(`VisitasChart`, `BarrasEmpresas`, `MembresiasPie`). Existe exportación CSV en
4 módulos (`registros`, `carwash/reportes`, `actividad`, `seguimiento`) — o sea
**el patrón de export ya está resuelto y se puede reutilizar**; Reportes es
justamente el que no lo tiene.

**Trabajo:** KPIs con comparación de período, filtros (rango, sucursal,
agrupación), gráficas con paleta semántica que funcione en ambos temas, y
export reutilizando la ruta que ya existe.

## 8. Reglas de recompensas

`ReglaRecompensaForm.tsx` vive embebido en `/admin/crecimiento/page.tsx`.
Mover a `/admin/crecimiento/recompensas` (listado) + `/nueva` + `/[id]/editar`,
con el mismo patrón de los demás formularios administrativos.

**Validación crítica ya existente que hay que preservar:** la ejecución
idempotente de reglas (evitar recompensas duplicadas ante reintentos) vive en
`src/modules/admin/recompensaActions.ts` — no se toca la lógica, solo la UI.

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
