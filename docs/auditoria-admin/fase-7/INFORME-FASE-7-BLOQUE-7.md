# Informe de la fase 7 · séptimo bloque: billing, auditoría y conciliación (22-10-2026)

> **Estado: construido, verificado en el navegador contra QA (solo lectura, solo las pantallas de empresa) y commiteado en la rama local `claude/auditoria-fase7` (`906e9b7e`), sin push; falta tu aprobación de este bloque.** Los bloques 1 a 6 los aprobaste; este es lo que pediste a continuación.
>
> **Lo que tienes que saber:** las tres piezas pasan a la `Tabla` del sistema, y **al mirar la bitácora en el navegador apareció un defecto que ya existía**: en los movimientos de inventario escribía **«[object Object] → [object Object]»** en vez de qué cambió. Lo corregí (es un cambio de lo que se **escribe** en esa pantalla, no de lo que se guarda). **Con esto se cierra 7.1 en el panel de empresa**; lo que queda a mano está en §4.

## 1. Qué se hizo

**4 tablas HTML a mano pasan a la `Tabla`** (las que vivían dentro de componentes):

| Pieza | Dónde se ve | Qué cambió |
|---|---|---|
| **Libro de la cuenta** y **estados de cuenta** (`TablaDeAsientos`, `TablaDeCortes`) | «Mi cuenta Membego» (empresa) y la facturación de una empresa (superadmin) | Ya tenían título y `scope`; ahora son la `Tabla` común. El movimiento es el identificador; el dinero a la derecha; el signo a favor en verde y «Al día» solo con saldo cero, como antes. **Ninguna columna se oculta en estrecho** (son cifras de una cuenta). |
| **Bitácora de actividad** (`BitacoraTabla`) | «Actividad» (empresa) y «Auditoría» (superadmin) | No tenía título ni `scope`. La fecha exacta (hasta el segundo) es el identificador. En pantallas estrechas solo se ocultan «Detalle», «Empresa» y «Sobre»; cuándo, qué y quién siguen a la vista. |
| **Conciliación** (`ConciliacionVista`) | «Conciliación del comercio» (superadmin) | La muestra de casos de cada regla (la tabla dentro de cada `<details>`) con título propio («Casos de la regla PED-01»). **Se imprime con el reporte**, así que ninguna columna se oculta. Los `data-testid` de grupos y reglas no se tocaron. |

## 2. Lo que cambia (te lo digo porque se ve o se nota)

1. **Defecto corregido en la bitácora.** El «Detalle» de los movimientos de inventario (cambio de existencias de un producto) decía `[object Object] → [object Object]`: el sistema guarda el saldo como un objeto con sus cubetas y el texto lo pasaba por `String()`. Ahora dice, p. ej., **«10 en existencia, 2 apartadas → 8 en existencia, 2 apartadas, 1 dañadas»**. Un objeto que no se sabe decir en una línea se **omite** en vez de enseñar basura. Es lo único que toqué fuera de componentes (`modules/auditoria/queries.ts`, la función `describir`, ahora exportada para poder probarla).
2. **Aspecto:** estas tablas toman el marco, la cabecera y el relleno comunes. Las del libro y las de conciliación van **sin marco propio** dentro de su tarjeta.
3. **Bitácora:** «Quién» (nombre, correo e IP) y «Sobre» (tipo y código de la entidad) pasan a una celda de varias líneas cada uno, como antes; ya no hay una fila que se resalta al pasar el puntero (no eran enlaces).
4. **Lo que no cambia y se nota:** la columna «Acción» de la bitácora sigue envolviendo en muchas líneas cuando la etiqueta es larga (p. ej. «Inventario · configuración modificada (umbral de stock bajo, costo de un producto, proveedores u órdenes de compra)»). Es el texto de la etiqueta, no la tabla; si quieres, se acorta aparte.

## 3. Medición

### 3.1 Compuertas

| Comprobación | Resultado |
|---|---|
| `tsc --noEmit` | **0 errores** |
| Pruebas nuevas | **7** (`tests/tablas-billing-auditoria-conciliacion.test.ts`): las cuatro tablas pintadas a HTML con filas de ejemplo y el arreglo de `describir` |
| `npm test` completo | **5 145 pruebas, 5 138 pasan, 0 fallan, 7 omitidas** (el bloque anterior cerró en 5 138: **+7**) |
| eslint sobre lo tocado | 0 problemas |
| Techo `tablaCrudaEnModulos` | **28 → 24**; `tablaCruda` (panel) sigue en 7 |

**Qué comprueban las pruebas:** ninguna de las tres piezas pinta ya una tabla HTML a mano; el libro (título, movimiento como identificador, enlace al pedido solo si hay destino, el signo a favor en verde, vacío); los estados de cuenta (6 columnas sin ocultar, «Al día» solo con saldo cero, «Abrió con…» solo con saldo de apertura, comisiones = comisiones − reversos + ajustes, pagos = pagos + créditos); la bitácora (hora hasta el segundo, «Sistema» sin usuario, IP, empresa solo en la vista global, qué se oculta en estrecho); la conciliación (título, dos filas con la misma referencia no chocan, testids conservados, sin ocultar columnas); y `describir` con números, textos, saldos de inventario y objetos desconocidos.

### 3.2 En el navegador, contra QA (empresa «AquaShine Car Spa», `qa-admin-aquashine`) — **solo lectura**

* **Actividad** (72 acciones, 1280 y 390 px): 200, título «Bitácora de actividad», un `<th scope="row">` por fila, **0 px de desborde de la página**; tras el arreglo, **ya no hay «[object Object]»** en la página.
* **Mi cuenta Membego** (3 movimientos, 1280 y 390 px): 200, título del libro, **0 px de desborde**, 0 errores.
* **Un aviso que no es mío:** React avisó de una discrepancia de hidratación en Actividad por el `caret-color: transparent` que **el navegador de pruebas** añade a los campos del filtro (el mismo que en el bloque anterior).

## 4. Lo que NO está hecho o NO se sabe

1. **No lo vi en un navegador:** la **auditoría**, la **facturación de una empresa** y la **conciliación** del superadmin (en QA no hay superadmin). Son los mismos componentes que sí vi (libro, bitácora) salvo la conciliación, que solo está cubierta por la prueba de marcado, el compilador y los `data-testid` conservados. No ejecuté las pruebas de extremo a extremo de conciliación.
2. En QA **no hay estados de cuenta cerrados**: la tabla de cortes no se vio con filas en el navegador, solo en la prueba.
3. No probé con lector de pantalla, Firefox, Safari ni la **impresión** de la conciliación.
4. **Lo que sigue a mano (24 en carpetas de componentes, 7 en páginas):**
   * **Páginas (7):** 3 hojas de papel, 3 de Car Wash y la tabla de concesiones.
   * **Componentes (24):** **Car Wash** (7), **inventario** (2: `LotesDeSucursal` y `ElegirLotes`), el ticket (`FacturaSheet`), `TablaReporte`, y **13 de supply-v2** (el diseño «Stitch»; en el informe del bloque 4 dije 11, la medida real hoy es 13).
5. **7.1 queda cerrada en el panel de empresa** (todo lo que no es Car Wash, papel, ticket o inventario anidado). **Quedan sin empezar:** 7.3 (`crearEmpresa` único), 7.5 (onboarding), 7.6 (notificaciones; D-08 abierta), la fase 8, y la decisión de las tablas «Stitch».
6. El servidor de QA fue de **desarrollo**, con el navegador de pruebas sin la CSP de la página; **apagado**.

## 5. Decisiones que necesito de ti

1. ¿Apruebas este bloque y los cambios de §2, incluido el arreglo de «[object Object]» en la bitácora?
2. ¿Damos por **cerrada 7.1**, con lo que queda a mano (§4.4)? Las dos preguntas pendientes ahí son **Car Wash** (si sobrevive: 3 páginas y 7 componentes) y si quieres migrar las **13 tablas «Stitch»** de supply-v2 (cambia cómo se ven; tendrías que decidir si ese diseño se conserva).
3. ¿Qué sigue dentro de la fase 7? Propongo **7.3** (un solo `crearEmpresa`) y **7.5** (onboarding), que son de formularios y flujos, no de tablas; **7.6** espera tu decisión D-08.
4. Siguen abiertas: Car Wash, D-08, el arreglo aparte en `main` de la fecha de «Nueva reserva» y el push de las ramas apiladas.

## 6. Cómo verlo

```bash
git switch claude/auditoria-fase7
npx tsx --test tests/tablas-billing-auditoria-conciliacion.test.ts
```

En QA (`qa-admin-aquashine`): `/admin/actividad` y `/admin/facturacion-membego`. **El servidor de QA queda apagado.**
