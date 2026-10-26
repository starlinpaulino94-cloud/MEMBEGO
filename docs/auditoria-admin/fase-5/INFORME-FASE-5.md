# Informe de la fase 5 · rediseño de los módulos prioritarios (21-10-2026)

> **Estado: construida, medida contra la base de QA y confirmada commit a commit en la rama local `claude/auditoria-fase5`, sin push.** Base: `claude/auditoria-fase4` (`76f9fb1b`), que a su vez apila `fase3` y `fase2` sobre `main` (`5571363e`). Cinco commits propios: `d1387d15` (5.1), `4f902733` (5.2), `bf1fb92e` (5.3), `2491749c` (5.4) y `c4c42f36` (corrección de rendimiento del Resumen, hallada al medir).
>
> **Qué cambia para quien usa el panel:** el Resumen, Pagos, Clientes y Beneficios se ven con la escala tipográfica nueva (`.panel-ds`, Inter 14/20) y las primitivas de la fase 4. **El resto del panel no cambia**: el ámbito sigue apagado en el menú y en las demás ~200 pantallas.

## 1. Qué contiene (tareas 5.1 a 5.4 de `12`)

| Tarea | Qué se hizo | Archivos |
|---|---|---|
| **5.1 Resumen por rol** | Se compone **por lo que la persona puede ver** (sección + función), no por una lista de roles. Máximo 3 bloques de acción y 4 cifras del mes, cada cifra con su ventana escrita («1–21 oct 2026») y el mismo tramo del mes anterior para comparar. El motor consulta **solo** lo que se concede. Resumen de Comercio e Inventario cargan aparte en `<Suspense>`. La página pasó de **921 a 105 líneas**. | `modules/admin/resumen/{bloques,calendario,consultas,reparto}.ts`, `components/admin/resumen/*`, `dashboard/page.tsx` |
| **5.2 Pagos** | La página pasó de **1 049 a 132 líneas**: lectura de las colas en `modules/pagos/{colasMezcla,colasLectura}.ts` (la lógica pura se prueba contra copias de la original), `TarjetaPagoPendiente`, `ColaPagos` y tarjetas por tipo. Lee **solo la cola activa**. | `modules/pagos/*`, `components/admin/pagos/*`, `pagos/page.tsx` |
| **5.3 Clientes** | `ClientesTable` es ahora la `Tabla` de servidor: **una sola paginación** (antes, una de cliente con `pageSize` 25 dentro de la del servidor con 50 filas), `caption` y `scope`, el cliente como identificador de la fila, **«Estado» ya no queda fuera de pantalla a 390 px** (T-10), hora del registro en la zona de la empresa y tres vacíos distintos (no hay / ninguno coincide / falló la carga). La ficha entra al mismo ámbito. | `ClientesTable.tsx`, `clientes/page.tsx`, `clientes/[id]/page.tsx` |
| **5.4 Beneficios** | `/admin/ofertas` es una vista con **una pestaña por tipo** (con su conteo) y **un solo «Crear beneficio»**, que lleva a `/admin/ofertas/crear`, donde se elige el tipo. Solo aparecen los tipos cuya sección puede abrir la persona (el hub anterior enlazaba a secciones vedadas); «Sobre productos» exige además la capacidad `DEALS_MARKETPLACE`. Los cuatro modelos de datos y sus formularios **no se tocan**. | `modules/ofertas/beneficios.ts`, `components/admin/beneficios/TablaBeneficios.tsx`, `ofertas/{page,crear/page}.tsx` |

## 2. Medición

### 2.1 Pruebas y compuertas (hechas ahora, sobre el árbol final)

| Comprobación | Resultado |
|---|---|
| `tsc --noEmit` | **0 errores** |
| `npm test` | **4 896 pruebas; 4 889 pasan, 0 fallan, 7 omitidas.** La fase 4 tenía 4 832: **+64**. |
| eslint sobre los archivos de la fase | 0 problemas (no corrí `npm run lint` completo) |
| `rls:cobertura` | en verde |
| Compuertas de diseño | los techos no suben: `tarjetaLocal` 22, `h1Crudo` 45, `tablaCruda` 53; `NavSeccion`, `Tabla` y `BarrasSimples` salieron de la lista de primitivas en espera por tener ya consumidor |

### 2.2 Equivalencia («mismos resultados antes y después»)

* **Pagos:** 13 pruebas comparan la lógica extraída con copias literales de la lógica original de la página. Con datos sembrados en la base de QA, antes y después dieron las mismas colas (sembrado y limpiado después).
* **Resumen:** cada cifra del motor nuevo se comparó contra la consulta antigua sobre datos sembrados (así salió un defecto: una columna `origen` que no existe, corregido a `canalOrigen`). **Los guiones de esa comparación vivían en una carpeta que la compilación de QA borra** (`.next-qa/herramientas`); el resultado consta aquí, pero los guiones ya no existen.
* **Reparto de consultas (último commit):** el texto que pinta el Resumen es **idéntico byte a byte** para administrador, supervisor, marketing y cajero antes y después del cambio (cuatro comparaciones, todas iguales).

### 2.3 Antes y después en la base de QA, **medidos a la vez**

Cómo: construí la rama de la fase 4 en un worktree temporal (ya eliminado), la serví en el puerto 3001 y la fase 5 en el 3000, contra el mismo proyecto de QA, y medí las dos **una detrás de otra** (`pg_stat_statements` para sentencias; Playwright a 1 280 px). La base de QA es remota (la línea base de la fase 0 midió 0,5–1,3 s por consulta desde esta máquina): **los tiempos solo sirven para comparar, no son los de producción.**

**Sentencias de datos por carga (excluidas las de control: BEGIN, COMMIT, `set_config`; carga caliente):**

| Pantalla (rol) | Antes | Después | |
|---|---:|---:|---|
| Resumen (administrador) | 71 | **50** | −21 (−30 %) |
| Resumen (supervisor) | 66 | **47** | −19 (−29 %) |
| Resumen (marketing) | 53 | **37** | −16 (−30 %) |
| Resumen (cajero) | 64 | **41** | −23 (−36 %) |
| Pagos (administrador) | 32 | **21** | −11 (−34 %) |
| Clientes (administrador) | 15 | 19 | **+4** (ver §3.5) |
| Beneficios (administrador) | 21 | 17 | −4 |

**Cuándo aparece el contenido (primera vez con más de 150 caracteres en `<main>` / contenido que ya no cambia):**

| Resumen | Antes | Después |
|---|---:|---:|
| administrador | 8,6–8,7 s / 8,9–9,0 s | **4,0–4,3 s / 5,6 s** |
| supervisor | 6,6–6,7 s / 6,8–6,9 s | **4,0–4,4 s / 4,2–4,7 s** |
| marketing | 6,1–6,3 s / 6,4–6,6 s | **3,6–3,9 s / 3,9–4,1 s** |
| cajero | 6,2–6,6 s / 6,5–6,9 s | **3,7–3,9 s / 5,0–5,2 s** |

**El LCP del Resumen parece haber empeorado y no es así; es un efecto de la métrica.** El LCP «antes» era de ~2,0 s porque el elemento más grande que midió fue el texto del correo en la cabecera del shell (2 064 ms): el contenido del Resumen antiguo no lo superaba en tamaño, aunque tardaba 6–9 s en aparecer. El Resumen nuevo tiene un párrafo de cabecera más grande que ese texto, así que el LCP ahora sí sigue al contenido real (~4 s). **No lo cuento como mejora ni como pérdida: lo que mide la tabla de arriba es lo que ve la persona.**

### 2.4 Verificación visual por rol

20 capturas (10 pantallas × 1 280 y 390 px) con los roles del entorno de QA: Resumen de administrador, supervisor, marketing y cajero; Pagos, Clientes, Beneficios (dos pestañas), Crear beneficio y Beneficios de marketing. **Todas: HTTP 200, un solo `<h1>`, sin desborde horizontal y 0 errores de consola.** Revisadas a ojo: el Resumen de marketing a 390 px muestra sus bloques propios (clientes en riesgo, beneficios por vencer, registros, seguidores) y ninguna cifra de dinero (los enlaces solo se pintan si la sección se puede abrir; lo comprueban las pruebas, no lo recorrí enlace a enlace); Clientes a 390 px muestra «Estado» y una sola paginación.

* Después: `verificacion-f5/capturas/` en este worktree (ignorada por Git).
* Antes: las de la línea base de la fase 0, `C:\dev\MEMBEGO\.next-qa\linea-base\empresa\{administrador,supervisor,marketing,cajero}\admin_dashboard-{1280,390}.png` y `…\administrador\admin_clientes-{1280,390}.png`. La línea base también tiene Pagos (`admin_pagos-{1280,768,390}.png`) y el hub de Ofertas (`admin_ofertas-{1280,768,390}.png`) del administrador. Quedan por montar lado a lado: **no hice la comparación píxel a píxel**, solo miré las nuevas.

## 3. Lo que apareció al medir (y qué se hizo)

1. **Menos consultas no era menos espera.** El primer Resumen nuevo metía todas sus consultas en **una** transacción y Prisma las ejecuta una tras otra en esa conexión: pintaba su contenido igual de tarde o peor que el antiguo, que abría una transacción por consulta. Se repartieron en hasta 5 transacciones paralelas (`reparto.ts`, con pruebas). Con el reparto y la lectura en paralelo del onboarding, permisos y empresa, el primer contenido aparece **36–53 % antes** que en la fase 4 y el contenido completo **24–38 % antes**.
2. **El coste que queda es del onboarding, no del Resumen.** `getOnboardingEmpresa` hace **11 sentencias en serie** en cada carga del Resumen, también para una empresa que ya terminó el asistente, y es lo más largo que queda en el camino crítico. No lo toqué (módulo compartido con el asistente); es la mejora más barata que queda.
3. **«≤15 consultas» se cumple para el motor del Resumen, no para la carga de la página.** El motor hace **14 sentencias de datos** para el administrador (el rol que más ve; antes 30). La carga completa de la página son **50**: 14 del motor, 11 del onboarding y el resto (≈25) de Comercio, Inventario y el shell (no los separé uno a uno).
4. **La cabecera del shell se pisa a 1 280 px** («Empresa › Comercio › Beneficios…» sobre el título), en la versión de la fase 4 **y** en la nueva: es del shell, no de la fase 5. Pasa a la fase 6.
5. **Clientes: +4 sentencias y LCP algo peor** (2,4 s → 3,1 s). Una sentencia es por diseño (`getRegionalPrefs`, para formatear la hora del registro en la zona de la empresa; está cacheada por petición). Las otras tres **no las desglosé**. El LCP sube con la tabla de servidor y la fuente Inter (`preload: false`) como candidatos, **sin comprobar**. Es lo único de la fase que medí peor y que no expliqué.

## 4. Criterios de aceptación de `12` · fase 5

| Criterio | Estado |
|---|---|
| Resumen con ≤8 cifras y ≤4 acciones sobre el pliegue | **Cumplido por construcción** (3 acciones + 4 cifras; una prueba lo exige). **Salvedad:** con el asistente de onboarding visible (empresa con el perfil incompleto, como CARTOWN en QA) ocupa ~850 px y las cifras quedan **bajo** el pliegue; es el comportamiento anterior y dónde ponerlo es decisión tuya. |
| ≤15 consultas | **Cumplido en el motor (14); no en la página entera (50).** Ver §3.3. |
| Pagos sin archivo de más de 300 líneas | **Cumplido** (página de 132 líneas; ninguna pieza nueva pasa de 300). |
| Flujos funcionales idénticos | **Probado en consultas y en lo que pinta, NO en el flujo.** Solo navegué (GET): **no aprobé, rechacé ni reimprimí un pago en el navegador**. La prueba E2E de esos tres flujos que pide `12` no está hecha. |
| Informe con capturas antes/después | **Parcial**: las «después» están todas; las «antes» son las de la línea base de la fase 0 (§2.4). |

**Del plan que NO hice:** el «interruptor» para desplegar Pagos, la consulta unificada o el cursor para las colas mixtas (siguen siendo lecturas separadas), la caché de 60 s en lo no accionable del Resumen, y el formulario único de creación de beneficios (5.4 queda en vista con pestañas y un solo punto de entrada; los cuatro formularios siguen siendo cuatro).

## 5. Qué deja de verse en el Resumen (decisión 1 del prototipo aprobado)

Seguidores y referidos históricos, «Pico», la actividad en vivo, «Estado en App Móvil», las recomendaciones y el recurrente. **El cajero deja de ver «Ingresos del mes»** (no trae `reportes › ver_financieros`), lo que es la regla ya aprobada; confirma que es lo que quieres para ese rol.

## 6. Decisiones que necesito de ti

1. ¿Acepto el onboarding como **siguiente mejora de rendimiento** (paralelizar sus 11 sentencias o saltarlas si el asistente está completo), antes de la fase 6? Baja ~1 s en esta base.
2. ¿**Enciendo `.panel-ds` en todo el panel** (cambia la tipografía de las ~200 pantallas) o sigo pantalla a pantalla? Hoy está en seis: Resumen, Pagos, Clientes (lista y ficha), Beneficios y Crear beneficio.
3. ¿Quieres la **prueba E2E de aprobar, rechazar y reimprimir** antes de dar por buena la 5.2? Necesita datos de pagos pendientes sembrados y escribe en la base de QA.
4. Sigue pendiente de ti desde antes: índice de Car Wash, F-03 / D-08, regla de ingresos del cajero, `push` de las ramas apiladas, D-11 (telemetría) y las pruebas con tres personas (3.2).

## 7. Cómo verlo

```bash
git switch claude/auditoria-fase5
npm test
```

Para el panel en el navegador hace falta el entorno de QA (`docs/auditoria-admin/linea-base/README.md`): compilar con `con-entorno-qa.mjs`, servir y entrar con los usuarios `qa-administrador`, `qa-supervisor`, `qa-marketing` y `qa-cajero`. **Los servidores de QA están apagados.**
