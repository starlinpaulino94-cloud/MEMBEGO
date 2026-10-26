# Informe de la fase 7 · quinto bloque: comprobantes y detalles de reportes (22-10-2026)

> **Estado: construido, verificado en el navegador contra QA (solo lectura) y commiteado en la rama local `claude/auditoria-fase7` (`b5a5924b`), sin push; falta tu aprobación de este bloque.** Los bloques 1 a 4 los aprobaste; este es lo que pediste a continuación («reportes, inventario y facturas»).
>
> **Lo que tienes que saber:** de lo que nombraste, **migré lo que de verdad era una tabla de listado del panel**: el historial de **comprobantes** (facturas) y los **cuatro detalles de reportes** (finanzas, operación, citas, membresías). **No toqué** las tablas de **inventario**, el ticket de la factura ni la tabla de los reportes: no son listados crudos y la `Tabla` no puede reemplazarlas sin perder algo (§4). Es una decisión de alcance que quiero que veas, no un olvido.

## 1. Qué se hizo

**5 `<table>` a mano pasan a la `Tabla` del sistema** (caption para el lector de pantalla, `scope`, identificador de fila, filas con el estado dicho en texto).

| Pantalla | Qué cambió | Dónde |
|---|---|---|
| **Comprobantes** (`/admin/facturas`) | `ComprobantesTabla`. Se van **los dos mapas de color a mano** (estado y tipo) a `EstadoChip`; la paginación pasa a ser el pie de la tabla. De 9 columnas a 6: la **fecha y el tipo** van bajo el número del comprobante y **quién atendió** bajo el cliente; así **la reimpresión cabe a 1280 px sin deslizar la tabla** (antes, y en mi primer intento, el botón quedaba cortado). | `components/facturas/ComprobantesTabla.tsx` |
| **Detalles de reportes** (finanzas, operación, citas, membresías) | `TablaDetalle`, una sola pieza para las cuatro; sustituye a las cuatro tablas y a su encabezado `ThOrden` (borrado). | `components/reportes/TablaDetalle.tsx` |

**Lo delicado de los detalles, y cómo se conserva.** Ordenar una de esas tablas **cambia la consulta** (la lista viene recortada a 300 y el recorte lo decide el `orderBy`), así que la cabecera sigue siendo **un enlace** que lleva a la misma pantalla ordenada, no un control del navegador. `TablaDetalle` marca como ordenable **solo la columna cuya clave es un campo de la pantalla**: lo que antes vigilaba una prueba leyendo el código ahora **no se puede escribir mal**. «Motivo», «Quién la revirtió» y similares siguen sin ser ordenables.

**Ninguna columna de los reportes se oculta en pantallas estrechas, a propósito.** La `Tabla` oculta columnas por prioridad con las medidas de pantalla, y **en el papel el ancho de la página cuenta como pantalla estrecha**: una columna escondida en la impresión de un reporte de dinero sería peor que una tabla que se desliza de lado en el móvil. (Los comprobantes sí ocultan el «Detalle» bajo 1024 px; no se imprimen en este formato.)

## 2. Lo que cambia (te lo digo porque se ve o se nota)

1. **Defecto corregido:** el historial decía **«3 impresiónes»** (con tilde); ahora «impresiones» (y «1 impresión»).
2. **Comprobantes:** el **tipo** (Venta, Uso de membresía…) ya no es una pastilla de color sino texto junto a la fecha, bajo el número. El estado sí es chip (`EstadoChip`, mismos colores de significado).
3. **Detalles de reportes:** el encabezado que **no** está ordenado ya no lleva el icono gris de «ordenable» (↕); queda el texto enlazado y, en el activo, la flecha ↑/↓. Es el costo de usar la tabla común; si lo echas en falta se puede añadir a la primitiva para todas.
4. **Aspecto:** estas cinco tablas toman el marco, la cabecera y el relleno comunes (como las de Parques y Tours y las de Supply). La columna del cliente es el identificador de cada fila.
5. A 390 px, la tabla de comprobantes se desliza **dentro de su marco** (con el comprobante fijo a la izquierda); la página nunca se desborda.

## 3. Medición

### 3.1 Compuertas

| Comprobación | Resultado |
|---|---|
| `tsc --noEmit` | **0 errores** |
| Pruebas nuevas | **9** (`tests/reportes-facturas-tablas.test.ts`) y 1 reescrita (`reportes-orden-detalle`, la de «todo encabezado ordenable existe entre los campos») |
| `npm test` completo | **5 131 pruebas, 5 124 pasan, 0 fallan, 7 omitidas** (el bloque anterior cerró en 5 122: **+9**; la prueba lenta de `entorno-e2e-remoto` esta vez pasó) |
| eslint sobre lo tocado | 0 problemas |
| Techo `tablaCruda` | **27 → 22** (`tests/deuda-diseno.test.ts`). `tablaCrudaEnModulos` sigue en 28: lo migrado vivía en páginas, no en carpetas de componentes |

### 3.2 En el navegador, contra QA (empresa «AquaShine Car Spa», administrador `qa-admin-aquashine`) — **solo lectura, no escribió nada**

13 pantallas a 1280 y a 390 px (26 cargas): **todas 200, 0 errores de consola, 0 px de desborde de la página**. Con datos: comprobantes (25 de 39, «Página 1 de 2»), finanzas caja (39 filas) y membresías (11), operación (29 canjes), citas (10, y 1 cancelada), membresías activadas (11). Cada tabla con su `caption` y un `<th scope="row">` por fila. Las vistas sin datos (intentos de pago, rechazados, revertidas, cambios de plan, búsqueda sin resultados) muestran su mensaje de vacío.

* **Ordenar:** pulsar «Monto» en caja llevó a `…&o=monto&d=desc&vista=CAJA` y la cabecera quedó con `aria-sort="descending"`. Es el enlace que cambia la consulta, como antes.
* **Comprobantes a 1280 px:** primero medí 121 px de deslizamiento dentro de la tabla (la reimpresión cortada), lo corregí juntando columnas y volví a medir: **0**.

### 3.3 Qué comprueban las pruebas nuevas

Ninguna de las cinco pantallas pinta una `<table>` a mano; la pantalla de comprobantes ya no lleva sus mapas de color ni sus formateadores y tiene **una sola** paginación (el pie); el total (monto, «—» en una venta sin monto, «GRATIS» en una entrega), el estado y el plural de impresiones; solo es enlace de orden la columna que es un campo; `aria-sort` en la vigente; el cliente como identificador; ninguna columna oculta en los reportes; ningún dato que el permiso esconde (`ver_empleados`) puede ser una columna ordenable.

## 4. Lo que NO está hecho o NO se sabe

**Lo que decidí no migrar, y por qué** (siguen contando en `tablaCrudaEnModulos`):

1. **Tablas de inventario** (`LotesDeSucursal`, `ElegirLotes`): son tablas **pequeñas dentro de una tarjeta**, ya con título (`aria-label`) y `scope`, y cada fila lleva `data-lote` y `data-estado`, que la `Tabla` no escribe y que usan las pruebas de extremo a extremo (`inventario-lotes.spec.ts`). `ElegirLotes` además lleva un campo editable por fila. Envolverlas en el marco de la `Tabla` daría una tabla con borde dentro de una tarjeta con borde.
2. **`FacturaSheet`**: es **el ticket impreso**, no un listado; su estilo es el del papel y no debe cambiar con el tema.
3. **`TablaReporte`** (las tablas de los reportes): ya tiene `scope`, título, orden, búsqueda y densidad **en el navegador**, a propósito (no pagina porque se imprime); la `Tabla` es de servidor y no lo hace. Cambiarla perdería esas funciones.
4. **Car Wash** (`inventario`, `reportes`, `vehiculos` y 7 componentes): sigue siendo decisión tuya si sobrevive.
5. Las 11 tablas «Stitch» de supply-v2 (del bloque anterior).

**Otras limitaciones**

6. No probé con lector de pantalla, Firefox, Safari ni **la impresión** de un detalle (el papel no se vio; sí se evitó ocultar columnas por esa razón).
7. En QA no hay datos de intentos de pago, rechazados, revertidas ni cambios de plan: esas vistas se vieron **vacías**, no con filas. La columna «Motivo» de pasarela y las de revertidas no se vieron renderizadas con datos reales; sí están cubiertas por la prueba de marcado y por el compilador.
8. Siguen sin empezar: el resto de tablas del panel (**22 `<table>`**: adquisición, audiencia, regalos, registros, retención, riesgo, seguimiento, invitaciones, y las de superadmin: campañas, membresías, observabilidad, solicitudes…), 7.3, 7.5, 7.6 (D-08 abierta) y lo de la fase 8.
9. El servidor de QA fue de **desarrollo** con el navegador de pruebas sin la CSP de la página; **apagado**.

## 5. Decisiones que necesito de ti

1. ¿Apruebas este bloque y los cambios de §2 (en especial 2 y 3: el tipo como texto y el icono de «ordenable»)?
2. ¿Estás de acuerdo con **dejar fuera** inventario, el ticket y `TablaReporte` (§4.1–4.3)? Si prefieres que la `Tabla` las absorba, haría falta antes extenderla (filas con atributos, tabla anidada sin marco).
3. ¿Qué sigue? Propongo **las 22 tablas restantes del panel** por módulos: el seguimiento y su impresión, regalos, registros, retención, riesgo y audiencia (empresa), y luego las de superadmin. Aparte quedan 7.3 (`crearEmpresa` único), 7.5 y 7.6.
4. Siguen abiertas: Car Wash, D-08, el arreglo aparte en `main` de la fecha de «Nueva reserva» y el push de las ramas apiladas.

## 6. Cómo verlo

```bash
git switch claude/auditoria-fase7
npx tsx --test tests/reportes-facturas-tablas.test.ts
```

En QA (`qa-admin-aquashine`): `/admin/facturas` y `/admin/reportes/finanzas/detalle?vista=CAJA&desde=2026-01-01&hasta=2026-10-31` (pulsa «Monto»). **El servidor de QA queda apagado.**
