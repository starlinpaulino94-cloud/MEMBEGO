# Informe de cierre de la fase 7 · formularios, tablas y flujos (22-10-2026)

> **Estado: la fase 7 se da por TERMINADA por indicación del dueño (22-10-2026), con tres tareas incompletas o sin hacer que se dicen más abajo (§2): 7.4 parcial, 7.6 sin hacer y el «`Campo` en todos los formularios» a medias.** Todo está commiteado en la rama local `claude/auditoria-fase7` (punta `601005cb` antes de este informe), **sin push**. Los nueve bloques que la componen los aprobaste uno a uno.
>
> **La rama, y por qué no se puede subir suelta:** `claude/auditoria-fase7` está **apilada** sobre `fase6 → fase5 → fase4 → fase3 → fase2 → ci-main-verde`, sobre `main`. **Ninguna de esas ramas está en GitHub.** Son 30 commits sobre `fase6` (182 archivos, de ellos 146 de código fuente: +10 497 / −8 619 líneas). Subir una exige subir el resto en orden; el momento y el modo del push siguen siendo tuyos (§6).

## 1. Qué se hizo, tarea por tarea (`12`, fase 7)

| Tarea | Estado | Qué quedó |
|---|---|---|
| **7.1 Tablas por módulo, con paginación de servidor y sin topes silenciosos** | **Hecha, con lo que queda a mano dicho** | **Parques y Tours** completo (reservas, catálogo, vendedores, comisiones, liquidaciones, clientes captados, check-in, ranking, recibo y cobros) con búsqueda, estado, fechas y página **en la URL y resueltas por la base sobre todo el historial** (antes, 200–300 filas y filtro en el navegador). **Plataforma/Supply** (22 tablas), **comprobantes y los cuatro detalles de reportes**, **15 tablas del panel** (empresa y plataforma) y **billing, auditoría y conciliación**. Tablas crudas del panel **53 → 7**; en carpetas de componentes **34 → 24**. |
| **7.2 Formularios únicos, descompuestos, con `Campo`** | **Parcial** | `PlanForm` **único** (había dos); `PromocionForm` con **opciones avanzadas aparte**; `ReservaForm` **1 371 → 223 líneas** y `ExcursionForm` **1 641 → 258** (más sus piezas), con **el error de cada campo** y **sin perder lo escrito** cuando el servidor rechaza. Campos sin nombre accesible **94 → 77**, **no a 0**: no todos los formularios del panel pasaron a `Campo` (ver §2). |
| **7.3 Un solo `crearEmpresa` de dominio con solicitud precargada** | **Hecha** | `darDeAltaEmpresa` lo usan el superadmin, la solicitud aprobada y el registro público; «Empresas → Nueva?solicitud=» llega precargada y deja la solicitud «Creada». Quedan dos creaciones de empresa por otro motivo (copiar una empresa y el Supplier Lite). |
| **7.4 Mostrador: búsqueda de cliente y canje manual auditado** | **PARCIAL** | **Solo la primera mitad, y solo en «Nueva reserva» de Parques y Tours:** la búsqueda de cliente sobre todos los de la empresa (antes, los 200 más recientes). **No se tocó el mostrador (Caja / Canjes y QR) ni el canje manual auditado.** |
| **7.5 Onboarding: sucursal, cobro y horario, y enlace de retorno** | **Hecha** | La sucursal **ya estaba**; se añadieron **horario** y **cobro** (recomendados, no bloquean publicar) y la franja **«Volver a configurar tu empresa»**. |
| **7.6 Notificaciones: historial y puente desde «En riesgo»** | **NO HECHA** | Depende de **D-08**, que sigue abierta. No se empezó. |

**Criterios de aceptación de la fase:** «techo de campos sin nombre y de tablas crudas bajan en cada módulo» → **cumplido** (los techos solo bajaron; ver §3.2). «Cero `take` fijo sin aviso en listados migrados» → **cumplido** para los listados migrados; los cuatro **detalles de reportes** siguen recortados a 300 filas **pero lo dicen** (cabecera «las N más recientes…», que sale del orden vigente) y ordenar cambia la consulta, no reordena lo recortado.

## 2. Lo que NO quedó hecho (dicho sin adornos)

1. **7.6 (notificaciones)**: ni el historial ni el puente desde «En riesgo». Espera D-08.
2. **7.4 a medias:** el mostrador (búsqueda de cliente en Caja y **canje manual auditado**) **no se hizo**. Es una tarea con dinero y trazabilidad; merece su propio diseño y su verificación con un cajero real.
3. **`Campo` en todos los formularios**: bajó el techo (94 → 77) pero **quedan 77 campos sin nombre accesible**. Pendientes conocidos, que son de la fase 8: **`ReservaVendedorForm`** (1 284 líneas, mismo tope de 200 clientes, sí envía la fecha), **`ReservaExcursionForm`** del cliente (1 514 líneas, copia del mismo asistente) y **`VariantesEditor`**.
4. **Tablas que quedan a mano**: 7 en páginas (3 hojas de papel imprimibles, 3 de **Car Wash**, la tabla de concesiones) y 24 en componentes (**Car Wash** 7, inventario 2, el ticket de factura, `TablaReporte`, y **13 del diseño «Stitch» de supply-v2**). Cada una con su razón en los informes 4 a 7. **Car Wash** sigue esperando tu decisión sobre si sobrevive.
5. **Verificación incompleta, por bloques** (§4): todo lo de **plataforma/superadmin** se verificó solo con compilador, pruebas de marcado y las pruebas existentes: **en QA no hay un superadmin con el que entrar**, y **no se ejecutó ninguna prueba de extremo a extremo** (`tests/e2e/`) en toda la fase.
6. **No probé** con lector de pantalla, Firefox ni Safari, ni la **impresión** de los reportes y las hojas de papel, en ningún bloque.

## 3. Medición

### 3.1 Pruebas y compuertas (sobre la punta de la rama)

| Comprobación | Resultado |
|---|---|
| `tsc --noEmit` | **0 errores** |
| `npm test` | **5 177 pruebas; 5 170 pasan, 0 fallan, 7 omitidas.** La fase 6 cerró en 4 930: **+247**, con **15 archivos de prueba nuevos**. Una prueba (`entorno-e2e-remoto › attestation…`) falló **una vez** en una suite completa por lentitud (15 s) y pasa sola y en las demás pasadas |
| eslint sobre los 161 archivos de código tocados o creados en la fase | **0 errores**; 1 aviso (`formatMoney` sin usar en `membresias/page.tsx`) que **ya estaba antes** |
| `rls:cobertura` | ✔ |

### 3.2 Techos de deuda (solo bajan; `tests/deuda-diseno.test.ts` y `accesibilidad-formularios`)

| Medida | Inicio de la fase (`fase6`) | Hoy |
|---|---:|---:|
| `<table>` a mano en el panel | 53 | **7** |
| `<table>` a mano en componentes de módulos | 34 | **24** |
| Mapas «estado → clases de color» | 58 | **52** |
| `<h1>` sin el componente del sistema | 45 | **39** |
| Títulos `2xl` en negrita a mano | 30 | **26** |
| Botones con borde sin foco visible | 25 | **20** |
| Campos de formulario sin nombre accesible | 94 | **77** |

(Radios fuera del vocabulario: 0 todo el tiempo; dos veces la prueba me frenó una clase mía y la corregí.)

## 4. Cómo se verificó cada bloque

| Bloque | Qué | Verificación |
|---|---|---|
| 1 | Parques y Tours (tablas), Plan, Promoción, filtros por fecha | Base de QA y navegador (1280 y 390 px) |
| 2 | `ReservaForm`, búsqueda de cliente, el defecto de la fecha | Navegador + **escribió en QA** (una reserva creada y cancelada) |
| 3 | `ExcursionForm` | Navegador + **escribió en QA** (dos ítems creados y archivados) |
| 4 | 22 tablas de Supply (superadmin) | **Sin navegador** (no hay superadmin en QA); `data-testid` de los E2E conservados y vigilados |
| 5 | Comprobantes y detalles de reportes | Navegador (AquaShine, solo lectura) |
| 6 | 15 tablas del panel | Navegador en las de empresa; **plataforma sin ver** |
| 7 | Billing, auditoría, conciliación | Navegador en las de empresa; **superadmin sin ver** |
| 8 | Alta única de empresa | **Contra la base y Auth de QA, con escritura y limpieza** (18 comprobaciones); la pantalla precargada sin ver |
| 9 | Onboarding | Navegador en QA (solo navegación) |

## 5. Defectos que aparecieron por el camino (y su estado)

| Defecto | Dónde | Estado |
|---|---|---|
| **«Nueva reserva» no enviaba la fecha**: no se podía crear ninguna reserva desde el panel **desde el 26-08-2026** | `ReservaForm` | **Corregido en esta rama. `main` lo sigue teniendo** (§6) |
| Listas de reservas, comisiones y liquidaciones con **tope silencioso de 200–300 filas** y filtro en el navegador | Parques y Tours | Corregido (servidor + URL) |
| El selector de cliente de «Nueva reserva» **solo ofrecía los 200 más recientes** | `ReservaForm` | Corregido (búsqueda en la base) |
| Los formularios de excursión, plan y promoción **borraban lo escrito** cuando el servidor rechazaba algo, con **un solo mensaje por intento** | `ExcursionForm`, planes, promociones | Corregido (error por campo, valores conservados) |
| Al editar una excursión, la capacidad vacía **se llenaba con un 30 que nadie escribió** y se guardaba | `ExcursionForm` | Corregido |
| «**3 impresiónes**» (con tilde) en el historial de comprobantes | Comprobantes | Corregido |
| «**[object Object] → [object Object]**» en el detalle de la bitácora de inventario | Actividad / Auditoría | Corregido |
| El aviso de «Completa antes de publicar» **listaba pasos opcionales** como si bloquearan | Onboarding | Corregido |
| **El rollback del alta de empresa nunca borraba la empresa** (la sucursal principal lo impide; el error se tragaba): **empresa huérfana** y, con cuenta nueva, un usuario sin empresa | Superadmin, solicitud, registro público | **Corregido y verificado.** **Pueden existir empresas huérfanas en producción de altas fallidas anteriores; no las busqué** |
| El registro público dejaba el vertical sin escribir | Registro | Corregido |

## 6. Decisiones que siguen siendo tuyas

1. **D-08** (de la que depende **7.6**) y **D-11**: siguen abiertas.
2. **Car Wash:** ¿sobrevive? Decide 3 páginas y 7 componentes de tablas a mano.
3. **El defecto de la fecha en `main`:** ¿un arreglo aparte sobre `main` **antes** de subir esta pila de ramas? Hoy `main` no puede crear reservas desde el panel.
4. **El push de la pila** (`ci-main-verde → fase2 → … → fase7`): nada está en GitHub. No hice ninguno ni lo haré sin tu orden.
5. **Empresas huérfanas en producción:** ¿preparo la consulta de solo lectura para buscarlas? No la ejecuto sin tu orden.
6. **Una empresa creada por el superadmin nace publicada** (por defecto de la columna); la solicitud y el registro, no. ¿Se unifica?
7. **Las 13 tablas «Stitch» de supply-v2:** migrarlas cambia cómo se ven; ¿se conserva ese diseño?
8. **¿Qué sigue?** Propongo (a) la **fase 8** (plataforma y el resto de los formularios grandes: `ReservaVendedorForm`, `ReservaExcursionForm`, `VariantesEditor`) y (b) retomar **7.4 (mostrador)** como un bloque propio, con un cajero de QA. **7.6** cuando decidas D-08.

## 7. Cómo verlo

```bash
git switch claude/auditoria-fase7
npm test
```

Los nueve informes por bloque están en esta misma carpeta (`INFORME-FASE-7.md`, `INFORME-FASE-7-BLOQUE-2.md` … `-BLOQUE-9.md`) y dicen, cada uno, qué se hizo, qué cambia, cómo se midió y qué **no** se hizo. **No hay servidor de QA levantado.** En QA quedan, de las pruebas de escritura de los bloques 2 y 3, tres registros marcados como de prueba (una reserva cancelada y dos ítems de catálogo archivados) en «QA Tours Punta Cana».
