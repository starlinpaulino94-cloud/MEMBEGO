# Informe de la fase 7 · formularios, tablas y flujos — primer bloque (22-10-2026)

> **Estado: la fase 7 NO está terminada.** Este informe cubre el **primer bloque**: el módulo **Parques y Tours** completo en sus listados y recibos, y los formularios de **Plan** y **Promoción**. Está construido, verificado contra la base de QA y en el navegador, y commiteado en la rama local `claude/auditoria-fase7` (12 commits de código, el último de código `77902454`, más este informe), **sin push**. Base: `claude/auditoria-fase6`, apilada sobre `fase5`, `fase4`, `fase3` y `fase2`, sobre `main` (`5571363e`). Ninguna de las seis ramas está en GitHub.
>
> La condición de finalización de la fase es «informe **por módulo** aprobado» (`12`). Te pido que apruebes —o corrijas— **este módulo y estos dos formularios**; lo que falta (§5) se hace después, módulo a módulo, y no empieza sin tu visto bueno.
>
> **Qué cambia para quien usa el panel:** en Parques y Tours, la búsqueda, el estado, el vendedor, las fechas y la página **viajan en la URL** y las resuelve la base **sobre todo el historial**; antes, tres listas de dinero y trabajo (reservas, comisiones y liquidaciones) traían solo las últimas 200 o 300 filas y filtraban en el navegador, así que lo que no estaba en esas filas no se podía encontrar ni se avisaba. Los formularios de plan y promoción muestran **cada error junto a su campo**.

## 1. Qué se hizo

| Tarea | Qué | Dónde |
|---|---|---|
| **7.1 · Parques y Tours** | **8 listados/tablas** pasan a la tabla de servidor del sistema (`caption`, `scope`, columnas con prioridad, vacío que dice la verdad): Reservas, Catálogo, Vendedores, **Comisiones**, **Liquidaciones**, **Clientes captados** (ficha del vendedor), manifiesto del **Check-in** y ranking del equipo. Además, el **recibo de la liquidación** (2 tablas) y los **cobros de la reserva**. | `src/components/excursiones/*Tabla.tsx`, `src/modules/excursiones/*/lista.ts`, `*/queries.ts` |
| **7.2 · `PlanForm` único** | Crear y editar un plan es **un solo formulario** (antes dos copias casi iguales). Un parser puro devuelve el error de cada campo; el formulario lo enlaza (`aria-invalid`, `aria-describedby`) y manda el foco al primero. | `modules/planes/formulario.ts`, `components/admin/PlanForm.tsx`, `PlanCampos.tsx` |
| **7.2 · `PromocionForm`** | Tres secciones a la vista (**Qué ofreces · Cuándo · Cuánto**) y **«Opciones avanzadas»** plegadas (se abren solas si traen contenido). Mismo parser puro con errores por campo. Se conservan los valores por defecto de antes. | `modules/promociones/formulario.ts`, `PromocionForm.tsx`, `PromocionCampos.tsx` |
| **Primitivas** | `BarraFiltros` gana **campos de fecha** (`fechas`): etiqueta enlazada, valor en la URL y chip legible («Desde: 01/10/2026»); sin `fechas` pinta lo mismo que antes. **`Tabla` ajusta su relleno y el ancho de la columna identificadora bajo 768 px** (`px-3` y `min-w-32` en vez de `px-4` y `min-w-40`; en escritorio no cambia): a 390 px el estado de Check-in quedaba fuera de la caja. | `packages/ui/src/ui/barra-filtros.tsx`, `tabla.tsx` |
| **Medida nueva** | El auditor no contaba las `<table>` de las carpetas de módulos (`components/excursiones`, `carwash`, `inventario`…): **migrar Parques y Tours no bajaba ningún número**. Ahora hay `tablaCrudaEnModulos`. | `scripts/auditar-diseno.mjs` |

### Los topes silenciosos que desaparecen

| Pantalla | Antes | Ahora |
|---|---|---|
| Reservas | `take: 200`, búsqueda en el navegador | paginado en la base, total real |
| Comisiones | `take: 300`, 8 filtros en el navegador | paginado, 6 filtros en la URL, total real |
| Liquidaciones | `take: 200`, 5 filtros en el navegador | paginado, 5 filtros en la URL, total real |
| Catálogo / Vendedores | todo en memoria, filtros en el navegador | paginado, filtros en la URL |
| Check-in (manifiesto) | `take: 500` **sin decirlo**; los totales de arriba contaban 500 | el tope sigue (a propósito: se mira de pie junto al bus) pero **la pantalla avisa** «este día tiene N salidas y aquí se muestran las primeras 500» |

## 2. Lo que decidí, y por qué

1. **El período de la liquidación se compara con el borde UTC con el que se guarda** (medianoche UTC del primer día, último milisegundo UTC del último), no con la hora local del navegador. El filtro de antes (`new Date('2026-10-01T00:00:00')` en el navegador de RD) **dejaba fuera** el período que empieza ese mismo día. Se conserva lo que significaba: el período **entero** cae dentro del rango. Lo prueba una prueba que guarda un período con la misma función del formulario y comprueba que el filtro lo incluye.
2. **Las fechas de las comisiones y de los captados son días de la plataforma (UTC−4)**, como el check-in: una comisión de las 9 de la noche es del día de la venta.
3. **Un solo parser puro por formulario** (`leerXDeFormulario`), probado sin navegador: cada fallo nombra su campo y el resumen dice «Hay N campos por corregir». La acción devuelve también los `valores` para que el formulario no pierda lo escrito (React 19 reinicia los campos no controlados tras una acción).
4. **La celda interactiva de una comisión es un componente de cliente pequeño** (`ComisionFilaAcciones`: «Ver detalle», aprobar, anular, ajustar); la tabla es de servidor y la recibe como función. El detalle se monta la primera vez que se pide.
5. **El canal de un captado dice su nombre** (QR, enlace, WhatsApp, redes). Antes todo lo que no era QR salía como «Enlace directo», aunque fuera WhatsApp.
6. **El resumen de arriba de Comisiones sigue contando todas**, no solo las filtradas (es el estado de la cuenta, no del filtro).

## 3. Medición

### 3.1 Pruebas y compuertas (sobre el árbol final)

| Comprobación | Resultado |
|---|---|
| `tsc --noEmit` | **0 errores** (corrido sobre el árbol final) |
| `npm test` | **5 051 pruebas; 5 044 pasan, 0 fallan, 7 omitidas**, corrido sobre el árbol final (la fase 6 tenía 4 930: **+121**). La primera corrida dio **1 fallo mío**: `plan-imagen.test.ts` buscaba la validación de la imagen en `planActions.ts`, y desde 7.2 vive en el parser único. La validación **sigue siendo del servidor** (las dos acciones pasan por el parser antes de guardar); la prueba ahora lo exige ahí. |
| eslint sobre los 58 archivos tocados | 0 problemas |
| `rls:cobertura` | ✔ todos los archivos con consultas usan `conEmpresa`/`sinEmpresa` |
| Permisos, capacidades, navegación | **sin cambios** (ninguna ruta, ninguna sección) |

Pruebas nuevas: plan 20, promoción 20, reservas 15, catálogo y vendedores 12, check-in y ranking 12, comisiones y liquidaciones 26, captados + recibo + cobros 15 (+ las que ya existían y se actualizaron).

### 3.2 Los techos de deuda (todos bajan; ninguno sube)

| Medida | Fase 6 | Ahora |
|---|---:|---:|
| `<table>` crudas en el panel (`tablaCruda`) | 53 | **49** |
| `<table>` crudas en carpetas de módulos (`tablaCrudaEnModulos`, medida nueva) | 35 | **28** |
| Campos sin nombre accesible | 94 | **88** |

### 3.3 Las consultas contra la base de QA (solo lectura)

`verificacion-f5/consultas-f7.mts` ejecuta las consultas nuevas contra el proyecto de pruebas aprobado (empresa con 267 comisiones, 1 liquidación, 12 reservas, 4 vendedores, 3 excursiones) y las compara con el mismo cálculo hecho a mano en JavaScript sobre las filas crudas:

* Total sin filtros = conteo directo, en los 7 listados.
* **Comisiones:** el filtro por JSON de la «regla general» da 6 = a mano 6; cada estado coincide; un vendedor coincide; **el rango de un solo día coincide y contiene la comisión de prueba**; la búsqueda por venta, liquidación y texto responde sin error.
* **Liquidaciones:** cada estado coincide; el período `2026-09-20 → 2026-10-19` incluye la liquidación de prueba (el caso que el filtro viejo fallaba).
* **Manifiesto:** `totalDelDia` = conteo directo y `truncado` = `total > 500`.

**Lo que esto NO prueba:** la empresa de QA no tiene comisiones en otra moneda (el filtro «con conversión» dio 0 = 0, que valida la forma de la consulta, no un caso positivo) ni más de 500 salidas en un día (el aviso del manifiesto se prueba por código, no con datos).

### 3.4 En el navegador, contra el entorno de QA

Servidor de **desarrollo** de Next contra el proyecto de pruebas, con `qa-admin-tours` (administrador de «QA Tours Punta Cana», la empresa de QA que sí tiene Parques y Tours; `qa-administrador` es de otra empresa y no lo tiene). **18 pantallas × 2 anchos (1 280 y 390 px)**: panel, reservas, catálogo, vendedores, comisiones (sin filtro, filtrada por estado y día, regla general, página 2), liquidaciones (con y sin resultados), check-in, recibo de liquidación, ficha del vendedor (con y sin filtros), detalle de reserva, nuevo plan y nueva promoción.

| Qué se midió | Resultado |
|---|---|
| Estado HTTP | **200 en las 36 cargas** |
| Errores de consola o de página | **0** (descontando uno solo, esperado: el modo desarrollo usa `eval` y la CSP de producción —A-04— no lo admite; no existe en una compilación de producción) |
| Tablas visibles sin `caption` | **0** (la ficha del vendedor trae 7 `<table hidden>` vacías: son del contenedor oculto con el que React transmite la página, no de nuestro código) |
| Desborde horizontal de la página a 390 px | **0 píxeles en las 18 pantallas** |
| Filas | comisiones **25 de 267** por página, «regla general» **6** (= la consulta de QA), día filtrado **1**, captados **12**, recibo **3**, liquidaciones **1** |

**Interacciones** (con la CSP de la página omitida en el navegador de pruebas, porque sin ella el modo desarrollo no hidrata y los clics no hacen nada): el filtro de fechas viaja en la URL y el chip dice «Desde: 20/10/2026»; quitar el chip deja el otro filtro; «Ver detalle» abre el panel y Escape lo cierra; «Anular» abre el motivo **en la misma fila** y «Cancelar» lo cierra sin anular; en **plan** y **promoción** enviar valores que el navegador acepta y el servidor rechaza (espacios) marca los campos (`aria-invalid`, mensaje debajo, resumen «Hay 2 campos por corregir.») y **el foco va al primer campo con error**; los valores escritos no se pierden. **Nada se escribió en la base de QA** (comprobado: ningún plan ni promoción nuevos).

**Hallazgos y lo que arreglé:**

1. **Check-in a 390 px:** la columna «Embarque» —lo que el operador necesita ver junto al bus— quedaba **fuera de la caja** (contenido de 353 px en una de 314). La hora baja ahora bajo el nombre del cliente y la columna se oculta en pantalla estrecha; y la tabla del sistema usa menos relleno y una columna identificadora más angosta bajo 768 px (**cambio en la primitiva `Tabla`**, que alcanza a todas las tablas: el contenido de Check-in pasa a 314 de 314, y el estado se ve sin desplazarse).
2. **Cobros de la reserva a 390 px:** el estado y el botón «Anular» quedaban cortados; «Método» pasa a prioridad 2 (se oculta en pantalla estrecha).
3. **Fecha de los captados a 390 px:** se partía en cinco renglones; ahora no se parte.
4. **Placeholders** de búsqueda de Comisiones y Liquidaciones demasiado largos (se cortaban): acortados.
5. **Un error mío del guion de verificación, no de la aplicación:** mi primer intento «enviar vacío» pulsaba el primer botón de envío de la página, que es el de **salir** de la barra lateral, y cerró la sesión. Lo digo porque parecía un fallo del formulario y no lo era.

**Lo que NO se ve bien todavía (te lo dejo para tu revisión visual):** en **Comisiones** las filas son altas porque los botones de acción (Aprobar, Anular, Ajustar) se apilan en la celda, y a 390 px las acciones quedan a la derecha, fuera de pantalla (la tabla se desplaza dentro de su caja, como antes). **Los totales de «Cobros»** (tres cifras en una fila) **se pisan a 390 px**: es de antes de esta fase y no lo toqué. **No es una compilación de producción:** los tiempos de carga de un servidor de desarrollo no significan nada y no los reporto.

## 4. Criterios de aceptación de `12` · fase 7

| Criterio | Estado |
|---|---|
| Techo de tablas crudas baja en cada módulo | **Cumplido en Parques y Tours** (53→49 panel; 35→28 módulos). Los demás módulos no se han tocado: ver §5. |
| Techo de campos sin nombre baja | **Cumplido:** 94 → 88. |
| Cero `take` fijo sin aviso en listados migrados | **Cumplido en los 8 listados migrados**; las búsquedas internas por id (`take: 500` al buscar vendedores/clientes que coinciden) no son listados. Quedan topes fijos **fuera** de lo migrado: ver §5.4. |
| Informe por módulo aprobado | **Pendiente de ti.** |

## 5. Lo que NO está hecho o NO se sabe

1. **7.1 no está completa.** Faltan las tablas de **Car Wash** (decisión tuya: ¿sobrevive?), **plataforma / supply**, **reportes**, **inventario**, **facturas**, **conciliación**, **billing**, **auditoría** y las tablas sueltas de páginas (`regalos`, `registros`, `seguimiento`, `riesgo`, `retencion`, `audiencia`…): **49 en el panel y 28 en módulos**.
2. **7.2 está a medias:** hechos `PlanForm` y `PromocionForm`. **Faltan** descomponer `ExcursionForm` y `ReservaForm` y llevar `Campo` a los otros formularios (88 campos sin nombre; `ReservaVendedorForm` es de los peores).
3. **7.3, 7.4, 7.5 y 7.6 no se tocaron** (un `crearEmpresa` de dominio con solicitud precargada, búsqueda de cliente y canje manual auditado en el mostrador, onboarding con sucursal/cobro/horario, historial de notificaciones). Son flujos con datos y dinero; 7.3 depende además de **D-08** (invitar al administrador por correo o escribirle la contraseña), que sigue sin decidir.
4. **Topes fijos que siguen vivos** (no son listados de esta pantalla, pero son del mismo tipo): `clientesParaReserva` trae **solo los 200 clientes más recientes** para el selector del alta de reserva (un cliente más antiguo **no se puede elegir**; es el síntoma que 7.4 y la descomposición de `ReservaForm` deben resolver con una búsqueda), `misReservas` 100 y `misLiquidaciones` 50 (portal del vendedor), `metasActivas` 100.
5. **Se pierde una comodidad:** al elegir un vendedor en Comisiones, el filtro de antes **rellenaba solo el rango de fechas** con sus comisiones aprobadas. Ya no lo hace (el servidor no adivina fechas). Si lo usabas para preparar una liquidación, dímelo y lo devuelvo como enlace «Ver las aprobadas de este vendedor».
6. **El resumen de Comisiones** (`resumenComisiones`) lee **todas** las comisiones de la empresa para contar conversiones y reglas generales: correcto hoy (267), pero crece con el historial. No lo toqué.
7. **Búsqueda de captados:** busca primero los clientes que coinciden (sin tope) y después sus atribuciones; con una palabra de una letra en una empresa grande esa lista es larga. Preexistente.
8. **No probé** con lector de pantalla, Firefox ni Safari, ni envié los formularios de plan/promoción **con datos válidos** (eso escribe en la base de QA; sí probé el envío vacío).

## 6. Decisiones que necesito de ti

1. ¿Apruebas **este módulo** (Parques y Tours: listados, recibo, cobros) **y los formularios de Plan y Promoción**?
2. ¿Sigo con el siguiente bloque? Propongo este orden: **(a)** `ReservaForm` + búsqueda de cliente (arregla el tope de 200 y es 7.4), **(b)** `ExcursionForm`, **(c)** plataforma/supply, **(d)** el resto de tablas; Car Wash cuando decidas si sobrevive.
3. ¿Quieres de vuelta el **autorrelleno de fechas por vendedor** en Comisiones (§5.5)?
4. Siguen pendientes de ti desde antes: el `push` de las ramas apiladas, **D-08**, D-11, la regla de ingresos del cajero, el índice de Car Wash, encender `.panel-ds` en todo el panel y las pruebas con tres personas (3.2).

## 7. Cómo verlo

```bash
git switch claude/auditoria-fase7
npm test
```

Para ver las pantallas hace falta el entorno de QA (`docs/auditoria-admin/linea-base/README.md`): servir con `con-entorno-qa.mjs` y entrar con `qa-administrador`. Rutas: `/admin/excursiones/comisiones` (prueba `?estado=APROBADA&desde=2026-10-01&hasta=2026-10-31`), `/admin/excursiones/liquidaciones`, `/admin/excursiones/vendedores/<id>`, `/admin/excursiones/checkin`, `/admin/planes/nuevo`, `/admin/promociones/nuevo`. **El servidor de QA queda apagado al terminar.**
