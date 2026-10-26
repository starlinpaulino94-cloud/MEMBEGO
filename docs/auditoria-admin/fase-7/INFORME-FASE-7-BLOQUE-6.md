# Informe de la fase 7 · sexto bloque: las tablas restantes del panel (22-10-2026)

> **Estado: construido, verificado en el navegador contra QA (solo lectura, solo las pantallas de empresa) y commiteado en la rama local `claude/auditoria-fase7`, sin push; falta tu aprobación de este bloque.** Los bloques 1 a 5 los aprobaste; este es lo que pediste a continuación («las tablas restantes del panel»).
>
> **Lo que tienes que saber:** **15 de las 22 tablas** pasan a la `Tabla` del sistema. **Las 7 que quedan a mano lo están a propósito**: tres son **papel** (la hoja que se imprime), tres son de **Car Wash** (tu decisión) y una es la **tabla de concesiones**, cuyas filas son un componente que se despliega. Las pantallas de **plataforma** (superadmin) **no las pude ver en un navegador**, como en el bloque 4.

## 1. Qué se hizo

**15 `<table>` a mano pasan a la `Tabla`** (caption para el lector de pantalla, `scope`, identificador de fila, estado dicho en texto).

| Dónde | Pantalla | Notas |
|---|---|---|
| Empresa | **Origen de clientes** (adquisición), **Audiencia**, **Retención**, **Clientes en riesgo** | Retención y riesgo son **imprimibles**: ninguna columna se oculta en estrecho (misma razón que los reportes). |
| Empresa | **Regalos** (dos tablas: regalos y tarjetas de regalo), **Registros y comprobantes**, **Seguimiento de recompensas**, **Invitaciones** (los que más comparten) | Se juntan columnas (ver §2) para que las acciones quepan en un escritorio. |
| Plataforma | **Solicitudes**, **Campañas** (lista y ficha), **Membresías** (todas las empresas), **Observabilidad** (objetivos de servicio), tarjeta de **uso de un satélite** | No verificadas en navegador. |

* **Cinco mapas «estado → clases de color» a mano** (regalos, tarjetas de regalo, registros, seguimiento y campañas) pasan a **tonos del `EstadoChip`**, con el mismo significado (ámbar = por hacer, verde = bien, rojo = problema, gris = terminado). Techo de mapas de estado: **58 → 52** (con los del bloque anterior).
* Los **botones de cada fila** (cancelar regalo, acciones de tarjeta, anular y reimprimir, acciones de seguimiento, ajustar usos y vencimiento, borrar membresía…) siguen apareciendo **solo cuando procedía**, y el borrado de membresía sigue pintándose siempre. La ficha de cliente en Membresías sigue siendo enlace **solo si es la empresa activa**.
* **Membresías** distingue ahora «no hay nada» de «ningún resultado» con los dos textos que ya tenía y su enlace «Limpiar».

## 2. Lo que cambia (te lo digo porque se ve o se nota)

1. **Registros:** el **tipo** y la **fecha** van bajo el número del comprobante y **quién atendió** bajo el cliente (9 columnas → 6); «Ver / imprimir» y «Anular» van **una sobre otra**. Con la medición hice dos pasadas: a 1280 px la tabla se deslizaba 43 px y **«Anular» quedaba cortado**; ahora 0.
2. **Regalos:** el **tipo** va con el nombre del regalo, **«De»** pasa a una línea bajo el regalo / el código, y **«Enviado» y «Expira»** se juntan en una columna. Antes, la tabla se deslizaba 62 px a 1280 px.
3. **Seguimiento:** «Otorgado» y «Vence» se juntan en una columna.
4. **Aspecto:** estas tablas toman el marco, la cabecera y el relleno comunes. Las que vivían dentro de una tarjeta (audiencia, invitaciones, objetivos de servicio, uso de un satélite) quedan **sin marco propio** para no tener un borde dentro de otro.
5. **Estado como chip:** regalos, registros, seguimiento y campañas dejan de pintar su pastilla a mano; el texto y los colores de significado son los de antes.
6. **Un cuidado:** al primer intento puse «sin esquinas» (`rounded-none`) en las tablas sin marco y **la prueba de deuda de diseño lo frenó** (esa clase no está en el vocabulario de radios). Lo quité: no se subió ninguna deuda.

## 3. Medición

### 3.1 Compuertas

| Comprobación | Resultado |
|---|---|
| `tsc --noEmit` | **0 errores** |
| Pruebas nuevas | **7** (`tests/tablas-panel-resto.test.ts`) y 3 existentes **actualizadas** (ver nota) |
| `npm test` completo | **5 138 pruebas, 5 131 pasan, 0 fallan, 7 omitidas** (el bloque anterior cerró en 5 131: **+7**) |
| eslint sobre lo tocado | 0 errores; 1 aviso en `membresias/page.tsx` (`formatMoney` sin usar) que **ya estaba antes** de mi cambio |
| Techos | **`tablaCruda` 22 → 7**, **`mapasDeEstado` 58 → 52**; radios fuera del vocabulario, 0 |

> **Nota sobre las pruebas existentes que cambié:** `campanas-conjuntas` (2) y `membresias-panel` (1) **leían el código fuente** buscando el color en ámbar de «Aplicada con errores» como `bg-warning/15 text-warning`, el texto `>Empresas con su copia<`, `<caption className="sr-only">` y `>Usos<`. Ahora buscan lo equivalente en la nueva escritura (`APLICADA_PARCIAL: 'aviso'`, `encabezado: 'Empresas con su copia'`, `caption="…"`, `encabezado: 'Usos'`). **Lo que exigen es lo mismo**; cambia cómo está escrito. Te lo digo porque tocar una prueba existente merece que lo sepas.

### 3.2 En el navegador, contra QA (empresa «AquaShine Car Spa», administrador `qa-admin-aquashine`) — **solo lectura**

Nueve pantallas, a 1280 y a 390 px: **todas 200, 0 px de desborde de la página**, cada tabla con su `caption` y un `<th scope="row">` por fila. **Con datos:** adquisición (28 registros), audiencia (6 promociones), riesgo (3 clientes), regalos (4 regalos y 2 tarjetas), registros (25 de 39) y seguimiento (5). **Sin tabla porque no hay datos:** retención y la ficha de invitación (se vieron sin su tabla, no con filas).

* **A 1280 px las tablas ya no se deslizan por dentro** (0 px) en todas; a 390 px se deslizan dentro de su marco con el identificador fijo a la izquierda, como diseña la `Tabla`.
* **Un aviso que investigué y no es mío:** React avisó de una discrepancia de hidratación en adquisición, retención y regalos. El detalle completo dice que la diferencia es un `style="caret-color: transparent"` que **el navegador de pruebas** añade a los campos de fecha y de texto; no tiene que ver con las tablas.

## 4. Lo que NO está hecho o NO se sabe

1. **Plataforma sin ver:** solicitudes, campañas, membresías, observabilidad y la tarjeta de satélite **no se vieron en un navegador** (en QA no hay superadmin). Están cubiertas por el compilador, las pruebas de marcado (incluida la tarjeta de satélite pintada a HTML) y las pruebas existentes de campañas y membresías. **No ejecuté las pruebas de extremo a extremo.**
2. **Retención e invitaciones:** vistas **sin datos**; sus tablas con filas no se vieron.
3. No probé con lector de pantalla, Firefox, Safari ni la **impresión** de riesgo y retención (sí cuidé que no se oculten columnas por ello).
4. **Las 7 `<table>` que siguen a mano, y por qué:**
   * **Papel (3):** la hoja imprimible de **registros** y las dos de **seguimiento / imprimir** (estilo en blanco y negro, filas que no se parten entre páginas, texto pequeño). Son el documento que se imprime, como el ticket del bloque anterior.
   * **Car Wash (3):** `inventario`, `reportes`, `vehiculos`. Siguen siendo decisión tuya.
   * **Concesiones (1):** `ConcesionesPanel`: cada fila es un componente de cliente que se despliega; la `Tabla` es de servidor y no pinta filas con estado propio.
5. `tablaCrudaEnModulos` sigue en **28** (carpetas de componentes): Car Wash, inventario, ticket, `TablaReporte`, las 11 «Stitch» de supply-v2 y otras de billing, auditoría y conciliación.
6. Siguen sin empezar: **billing, auditoría y conciliación** (tablas dentro de componentes), 7.3 (`crearEmpresa` único), 7.5, 7.6 (D-08 abierta) y lo de la fase 8.
7. El servidor de QA fue de **desarrollo**, con el navegador de pruebas sin la CSP de la página; **apagado**.

## 5. Decisiones que necesito de ti

1. ¿Apruebas este bloque y los cambios de §2, sabiendo que la parte de plataforma **no se vio en un navegador**?
2. ¿Estás de acuerdo con **dejar a mano** el papel (3), la tabla de concesiones (1) y Car Wash (3)? Lo de Car Wash es una pregunta tuya desde hace varios bloques: si sobrevive, son 3 páginas y 7 componentes más.
3. ¿Qué sigue? Propongo **billing, auditoría y conciliación** (las tablas que viven dentro de componentes; `LibroDeCuenta`, `BitacoraTabla`, `ConciliacionVista`), que con esto **cerraría 7.1 en el panel de empresa**. Después, 7.3 y 7.5.
4. Siguen abiertas: Car Wash, D-08, el arreglo aparte en `main` de la fecha de «Nueva reserva» y el push de las ramas apiladas.

## 6. Cómo verlo

```bash
git switch claude/auditoria-fase7
npx tsx --test tests/tablas-panel-resto.test.ts
```

En QA (`qa-admin-aquashine`): `/admin/riesgo`, `/admin/regalos`, `/admin/registros`, `/admin/seguimiento`, `/admin/adquisicion`, `/admin/audiencia`. **El servidor de QA queda apagado.**
