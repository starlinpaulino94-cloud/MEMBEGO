# Auditoría · Resumen, Clientes, Membresías y Pagos

> Encargo: «en el módulo de Resumen todas las informaciones deben ser
> verdaderas y actualizadas» + reportes y filtros de clientes en riesgo.
> Fecha: 2026-08-11 · Alcance: `/admin/dashboard`, `/admin/clientes`,
> `/admin/membresias`, `/admin/pagos`, `/admin/reportes`.
> **No se ha cambiado código. Este documento es el entregable.**

---

## Resumen ejecutivo

De los 14 números que muestra el Resumen, **6 no son verdad** y 3 más son
verdad a medias. Ninguno falla por un error de cálculo: fallan porque el mismo
concepto está definido dos veces en dos sitios distintos, o porque nadie
actualiza el dato que se está leyendo.

La contradicción que se ve a simple vista —el Resumen dice «Pagos por validar
7» y la pantalla a la que lleva dice «0 pagos por validar»— no es un caso
aislado: es el patrón. Hay **tres definiciones de "ingresos"**, **dos de "hoy"**
y **dos de "membresía vigente"** conviviendo en el mismo panel.

Y el problema que motivó el encargo tiene una raíz concreta: los datos para
responder «¿quién no viene, se le vence la membresía y le quedan usos?»
**ya existen y ya se calculan**. Lo que no existe es una pantalla que los
muestre. Hoy solo se pueden usar para *mandar una notificación a ciegas*, nunca
para *ver quiénes son*.

| | Hallazgo | Gravedad |
|---|---|---|
| A-1 | «Pagos por validar» cuenta cosas distintas en Resumen y en Pagos | 🔴 |
| A-2 | «Ingresos estimados» usa el precio de lista, no lo cobrado | 🔴 |
| A-3 | «Visitas hoy / este mes» ignoran la zona horaria de la empresa | 🔴 |
| A-4 | Nada vence las membresías: `ACTIVA` es eterna | 🔴 |
| A-5 | «51 membresías» es el número de filas cargadas, no el total | 🟠 |
| A-6 | Los reportes fechan el cobro por `updatedAt` | 🟠 |
| B-7 | Los tres avisos de «Requiere tu atención» llevan a listas sin filtrar | 🔴 |
| B-8 | El segundo buscador de las tablas no busca nada | 🟠 |
| B-9 | «Exportar» exporta solo la página visible, sin avisar | 🟠 |
| B-10 | Membresías repite el fallo de búsqueda que Clientes ya corrigió | 🟠 |
| C-11 | Los segmentos existen pero no se pueden ver ni exportar | 🔴 |
| C-12 | `lavadosRestantes` no se filtra ni se reporta en ninguna parte | 🔴 |

---

## Parte A · Números que no son verdad

### A-1 · «Pagos por validar» significa dos cosas distintas 🔴

**Lo que se ve.** El Resumen muestra `Pagos por validar 7` con un enlace
«Validar pagos». Al pulsarlo, la pantalla de Pagos dice
`0 pagos por validar · 15 en seguimiento`, y sus cinco colas suman cero salvo
«Sin completar».

**Por qué.** Son dos consultas que nunca se pusieron de acuerdo:

| | Qué cuenta | Dónde |
|---|---|---|
| Resumen | `Membership` en `PENDIENTE` **o** `PENDIENTE_PAGO` | `dashboardQueries.ts:63-65` |
| Pagos | `PENDIENTE_PAGO` + cambios de plan + compras `EN_VALIDACION` + cobros en sucursal | `admin/pagos/page.tsx:302-316, 397` |

El estado `PENDIENTE` —el cliente pidió el plan y **nunca completó el pago**— el
Resumen lo llama «por validar» y Pagos lo manda, con razón, a la cola «Sin
completar». No hay nada que validar ahí: no hay pago. Y al revés, el Resumen no
ve los cambios de plan ni las compras de promociones, que sí hay que validar.

**Consecuencia.** El aviso más urgente del panel manda al administrador a una
pantalla vacía. La segunda vez que pasa, deja de creerse el panel entero.

---

### A-2 · «Ingresos estimados» no es dinero 🔴

**Lo que se ve.** `RD$64,400 · Membresías activas / mes`.

**Qué es en realidad.** La suma de `plan.precio` × membresías activas por plan
(`dashboardQueries.ts:144-156`). Es una **lista de precios**, no una caja.

Tres cosas la separan de la realidad:

1. **Ignora el precio por categoría de vehículo.** CARTOWN vende `PLAN SILVER`
   a un precio para `SUV PEQ` y a otro para `SUV GRAN` — se ve en la propia
   pantalla de Membresías. El modelo `PlanPrecioCategoria` existe para eso
   (`membresias.prisma:163`), y este cálculo no lo mira: cobra a todos el
   precio base.
2. **Ignora lo que se pagó de verdad.** `Membership.montoPagado` guarda el
   importe real, con su descuento de bienvenida congelado. No se usa aquí.
3. **Arrastra el hallazgo A-4**: si una membresía venció y nadie la desactivó,
   sigue sumando todos los meses.

**Y hay una tercera cifra.** `/admin/reportes` sí usa `montoPagado`
(`reportes/queries.ts:104-108`). Así que el mismo negocio tiene, en el mismo
panel, **tres respuestas distintas a "¿cuánto facturo?"**: la del Resumen, la de
Reportes y la de Caja.

---

### A-3 · «Hoy» empieza a las 8 de la noche de ayer 🔴

`dashboardQueries.ts:37-39`:

```ts
const inicioHoy = new Date(now); inicioHoy.setHours(0, 0, 0, 0)
const inicioMes = new Date(now.getFullYear(), now.getMonth(), 1)
```

`setHours` usa la **hora del proceso Node**, que en Vercel es UTC. La empresa
tiene `zonaHoraria: America/Santo_Domingo` (UTC−4). Por tanto «Visitas hoy»
arranca a las **20:00 hora local del día anterior**: las visitas de anoche
cuentan como de hoy, y las de esta noche contarán como de mañana. Lo mismo con
«Visitas este mes» los días 1 y 30/31, y con la gráfica de 14 días.

**Lo llamativo es que el proyecto ya lo resolvió.** `modules/reportes/rango.ts`
tiene `diaLocal()` y `limiteDiaLocal()`, que calculan el corte con la zona
horaria de la empresa, y `/admin/reportes` los usa. El Resumen no. Son las
mismas visitas contadas con dos calendarios.

---

### A-4 · Nada vence las membresías 🔴

Una membresía pasa a `VENCIDA` en **un solo sitio** de todo el código:
`planActions.ts:331`, cuando un administrador pulsa «desactivar» a mano.

No hay ningún job, cron ni automatización que recorra las membresías cuyo
`fechaVencimiento` ya pasó. El cron diario (`/api/cron/automatizaciones`) manda
recordatorios de vencimiento (`automatizaciones.ts:114`) pero no cambia ningún
estado.

**Qué significa.** `estado = 'ACTIVA'` no quiere decir «vigente»: quiere decir
«nadie la ha tocado desde que se activó». Y el Resumen cuenta exactamente eso
bajo la etiqueta «Clientes activos · Con membresía vigente»
(`dashboardQueries.ts:55`).

**El escáner no se equivoca** —`canje.ts:230-233` compara la fecha antes de
canjear— así que la operación está a salvo. Pero eso crea la peor situación
posible: **el panel enseña como vigentes membresías que el mostrador rechaza.**
El empleado queda en falso delante del cliente.

Efectos en cadena: «Clientes activos», «Ingresos estimados», el segmento
`activos` y el filtro «Activas» de Membresías heredan todos el mismo inflado.

---

### A-5 · «51 membresías compradas» es el número de filas cargadas 🟠

`admin/membresias/page.tsx:74` trae `take: 200` sin `skip` y sin `count`, y el
encabezado imprime `memberships.length` (línea 99). Hoy hay 51 y coincide por
casualidad. **A partir de la membresía 201, la pantalla dirá «200» para
siempre** y las demás serán inalcanzables: esa pantalla no tiene paginación.

Es literalmente el mismo fallo (M-07) que ya se corrigió en `/admin/clientes`
—cuyo comentario de cabecera lo documenta con detalle— y que quedó sin corregir
aquí.

---

### A-6 · Los reportes fechan el cobro por `updatedAt` 🟠

`reportes/queries.ts:100-108`, con el problema ya anotado en el propio código:
la membresía no guarda fecha de pago, así que se usa `updatedAt`. **Editar una
membresía vieja la mueve de periodo**: cambiarle el plan a un cliente en agosto
traslada su cobro de marzo al informe de agosto. Los informes cerrados no son
estables.

---

## Parte B · Caminos que no llevan a donde dicen

### B-7 · «Cada punto lleva a donde se resuelve» — y no 🔴

Es la promesa literal del bloque «Requiere tu atención»
(`admin/dashboard/page.tsx:193`). Los tres destinos
(`admin/dashboard/page.tsx:132-154`):

| Aviso | Lleva a | Lo que encuentras |
|---|---|---|
| Membresías vencen en 7 días · **2** | `/admin/membresias` | las 51, sin filtrar — **el filtro no existe** |
| Clientes sin visitas en 30 días · **17** | `/admin/clientes` | los 98, sin filtrar — **el filtro no existe** |
| Pagos por validar · **7** | `/admin/pagos` | «0 pagos por validar» (hallazgo A-1) |

El panel identifica correctamente a las 2 personas que hay que llamar hoy… y
después deja al administrador buscándolas a mano entre 51 filas. **Este es el
hallazgo que mejor resume el encargo.**

---

### B-8 · El segundo buscador no busca nada 🟠

En Clientes se ven dos campos de búsqueda apilados. El de arriba funciona
(busca en el servidor, sobre los 98). **El de abajo es un campo muerto.**

`packages/ui/src/ui/data-table.tsx`: el input de la barra de herramientas se
pinta siempre (línea 100), pero el filtro global hace
`if (!searchKey) return true` (línea 63) — sin `searchKey`, **acepta todas las
filas**. `ClientesTable` no pasa `searchKey`, y su comentario dice explícitamente
que se retiró a propósito porque «dos buscadores con alcances distintos en la
misma pantalla es peor que uno solo que funciona». La intención era correcta; el
componente nunca la respetó.

Afecta a **toda** tabla que use `DataTable` sin `searchKey`.

---

### B-9 · «Exportar» exporta solo lo que se ve 🟠

`exportCSV` recorre `table.getFilteredRowModel().rows`
(`data-table.tsx:78-85`): las filas que el navegador tiene cargadas. En
Clientes son **50 de 98**. En Membresías, 200 como mucho. El archivo se
descarga sin ningún aviso de que está incompleto — es la forma más silenciosa
de perder datos.

El proyecto ya tiene el patrón correcto (exportación en el servidor, sobre el
filtro completo) en cinco rutas: `/admin/reportes/export`,
`/admin/actividad/export`, `/admin/registros/export`,
`/admin/seguimiento/export` y la de carwash.

---

### B-10 · Membresías busca solo sobre las 200 filas cargadas 🟠

`MembresíasTable` pasa `searchKey="cliente.nombre"`, que filtra en el navegador
sobre lo ya traído. Es el fallo que Clientes corrigió llevando la búsqueda al
servidor. Además, los chips de estado no incluyen `PENDIENTE_PAGO` ni
`RECHAZADA` (`admin/membresias/page.tsx:15`): un cliente con el pago rechazado
no aparece bajo ninguna pestaña.

---

## Parte C · Lo que existe y no se puede ver

### C-11 · Los segmentos ya calculan lo que pides — para nadie 🔴

`modules/admin/segmentos-def.ts` define, y `segmentos.ts` resuelve contra la
base de datos:

- `por_vencer` — membresías que vencen en 7 días
- `inactivos` — sin visitas en 30 días
- `activos`, `nuevos`, `seguidores`, `plan`

Están calculados, probados y en producción. Pero `resolverSegmento()` devuelve
**`userIds`**, y su único consumidor es el envío de notificaciones. **No hay
ninguna pantalla que muestre la lista de personas de un segmento, ni que
permita exportarla.**

Dicho de otro modo: el sistema sabe quiénes son los 17 clientes en riesgo,
puede mandarles un mensaje… y no puede enseñárselos a nadie.

---

### C-12 · Nadie sabe cuántos usos pagados están sin consumir 🔴

`Membership.lavadosRestantes` está en cada membresía y **no aparece en ningún
filtro ni en ningún reporte**. La columna se muestra en la tabla de Membresías
(«USOS REST.») y ahí termina su vida.

Eso deja sin respuesta tres preguntas que son de dinero:

- ¿Cuánto servicio pagado se le debe hoy a los clientes? (es un **pasivo real**
  del negocio, no una métrica de marketing)
- ¿Quién pagó, no ha venido, y se le vence la membresía con usos dentro? (el
  cliente que más rabia le va a dar perder — y **exactamente lo que pediste**)
- ¿Qué planes se consumen y cuáles se compran y se olvidan?

---

## Parte D · Qué proponemos

Tres bloques. El primero **no añade nada**: hace que lo que ya se muestra sea
verdad. Sin él, cualquier reporte nuevo hereda las cifras malas.

### Bloque 1 · Que los números no mientan

| # | Cambio | Cierra |
|---|---|---|
| 1 | **Una sola definición de «pago por validar»**, en un módulo que consuman Resumen y Pagos. Un número, un sitio. | A-1 |
| 2 | **Separar «cobrado» de «esperado».** «Ingresos del mes» = `montoPagado` real (igual que Reportes). «Recurrente esperado» = precio por categoría de vehículo, contando solo membresías realmente vigentes. Dos tarjetas honestas en vez de una ambigua. | A-2 |
| 3 | **Zona horaria de la empresa en el Resumen**, reutilizando `limiteDiaLocal()`/`diaLocal()` de Reportes. Un solo «hoy» en todo el panel. | A-3 |
| 4 | **Job diario que vence membresías**, más cinturón y tirantes: que los conteos de «vigente» miren también `fechaVencimiento`, para que un fallo del job no vuelva a inflar el panel. Con un aviso al admin si la ejecución falla. | A-4 |
| 5 | **Totales reales y paginación en Membresías** (el patrón ya está en Clientes). | A-5, B-10 |
| 6 | **`fechaPago` propia en la membresía**, para que los informes cerrados dejen de moverse. | A-6 |
| 7 | **El input de búsqueda de `DataTable` solo se pinta si hay `searchKey`.** Una línea. | B-8 |
| 8 | **Exportación en el servidor sobre el filtro completo**, en Clientes y Membresías. | B-9 |

### Bloque 2 · Los reportes y filtros que pediste

**9. Filtros combinables en Membresías**, en la URL (compartibles y enlazables
desde el Resumen):

- vence en 7 / 15 / 30 días · vencidas de verdad
- con usos restantes (`> 0`) · sin usos · usos por debajo de N
- sin visitas en 15 / 30 / 60 / 90 días
- por plan · por categoría de vehículo · por sucursal · por método de pago
- renovó / no renovó tras vencer

**10. Filtros equivalentes en Clientes**: sin visitas en X días, con o sin
membresía, membresía por vencer, nuevos, por vehículo, por sucursal, por origen
de captación.

**11. Reporte «Clientes en riesgo» — el que pediste explícitamente.** Una
pantalla que cruza las tres condiciones a la vez:

> *no viene hace X días* **+** *la membresía vence en Y días* **+** *le quedan Z
> usos sin consumir*

Ordenado por **dinero en juego** (usos restantes × valor del uso), no
alfabéticamente: primero el cliente cuya pérdida cuesta más. Cada fila con las
acciones al lado — WhatsApp con el mensaje ya escrito, notificar, renovar,
regalar un uso extra. Exportable entero. Es el destino natural de los dos avisos
del Resumen que hoy no llevan a ninguna parte.

**12. Reporte de retención e inactividad.** Distribución de clientes por días
desde su última visita (0-7 · 8-15 · 16-30 · 31-60 · +60), cuántos renovaron al
vencer, cuánto tarda un cliente nuevo en volver por segunda vez, y qué planes
se consumen frente a cuáles se compran y se olvidan.

**13. Reporte de usos sin consumir (pasivo del negocio).** Cuántos usos pagados
siguen vivos, cuánto valen, y cuándo expiran — con el detalle de qué se pierde
este mes si nadie hace nada.

**14. Ver y exportar un segmento.** Que los segmentos que ya existen tengan
pantalla propia: quiénes son, exportarlos, y desde ahí notificar. Deja de ser un
disparo a ciegas.

### Bloque 3 · Que no se escape nada

**15. Semáforo del cliente**, calculado en un solo sitio y reutilizado en la
tabla, la ficha, los segmentos y las automatizaciones:

| Estado | Definición propuesta |
|---|---|
| 🟢 Activo | membresía vigente y visita en los últimos 30 días |
| 🟡 En riesgo | vigente, pero sin visitas en 30-60 días **o** vence en menos de 7 con usos dentro |
| 🟠 Dormido | sin visitas en más de 60 días, o membresía vencida hace menos de 30 |
| 🔴 Perdido | vencida hace más de 60 días sin renovar |

Los umbrales, configurables por empresa: un car wash y un restaurante no tienen
la misma frecuencia normal de visita.

**16. Ficha del cliente como una sola línea de tiempo**: registro, pagos,
visitas, canjes, citas, notificaciones recibidas, cambios de plan y notas
internas en orden cronológico. Hoy esa información está repartida en seis
pantallas.

**17. Vigilancia automática.** Que el semáforo dispare automatizaciones ya
existentes: cuando un cliente entra en 🟡, se le manda el recordatorio; si a los
7 días sigue igual, se avisa al administrador. Que el sistema persiga al cliente
en riesgo sin que nadie tenga que acordarse de mirar.

**18. Conciliación diaria.** Un chequeo que compare Caja, Membresías y
Transacciones y avise si no cuadran, en vez de esperar a que alguien lo note.

---

## Orden recomendado

1. **Bloque 1 primero, completo.** No tiene sentido construir el reporte de
   riesgo sobre «Clientes activos» si ese número está inflado por membresías que
   vencieron hace meses. Es además el más barato: casi todo es reutilizar
   utilidades que ya existen en el proyecto.
2. **Después 9, 10 y 11** (filtros + reporte de riesgo). Es el 80 % del valor de
   lo que pediste, y a partir del bloque 1 se apoya en cifras ciertas.
3. **Luego 12, 13 y 14** (retención, pasivo, segmentos visibles).
4. **El bloque 3 al final**: el semáforo solo tiene sentido cuando los datos que
   lo alimentan son fiables, y la vigilancia automática solo cuando el semáforo
   está probado.

---

## Estado · Bloque 1 completado (2026-08-11)

Los ocho puntos del Bloque 1 están implementados. Ninguno añade funciones: hacen
que lo que la pantalla ya decía sea verdad.

| # | Hallazgo | Qué se hizo |
|---|---|---|
| 1 | A-1 | `modules/pagos/colas.ts` — las cinco colas definidas UNA vez. El Resumen y `/admin/pagos` cuentan lo mismo porque leen el mismo módulo. `PENDIENTE` deja de contar como «por validar» y los cambios de plan y las compras empiezan a contar. |
| 2 | A-2 | «Ingresos estimados» se parte en dos: **Cobrado este mes** (`montoPagado` real, misma fuente que Reportes) y **Recurrente esperado** (tarifa por categoría de vehículo, solo membresías vigentes). |
| 3 | A-3 | `dashboardQueries` usa `diaLocal`/`limiteDiaLocal` con `Company.zonaHoraria`. La serie de 14 días agrupa en SQL con `AT TIME ZONE`. La fecha del encabezado también. |
| 4 | A-4 | `modules/membresia/vigencia.ts` (regla pura) + `vencimiento.ts` (job diario en el cron). Doble red: aunque el job falle, `membresiaVigente()` exige la fecha. Aplicado al Resumen, a los segmentos y al chip «Vigentes». |
| 5 | A-5, B-10 | `/admin/membresias` con total real, paginación y búsqueda en el servidor. Entran los estados `PENDIENTE_PAGO` y `RECHAZADA`, que no tenían pestaña. |
| 6 | A-6 | Columna `Membership.fechaPago` (migración `20260807_membresia_fecha_pago`), escrita al confirmar el cobro. Reportes y Resumen la usan, con respaldo a `updatedAt` para lo histórico. |
| 7 | B-8 | `DataTable` solo pinta el buscador si recibe `searchKey`. El campo muerto desaparece. |
| 8 | B-9 | `/admin/clientes/export` y `/admin/membresias/export`: CSV en el servidor sobre el filtro completo, con el filtro compartido con la pantalla y un aviso DENTRO del archivo si se alcanza el tope. |

**De propina, dos recortes silenciosos que aparecieron al tocar el código:**

- `/admin/pagos` traía 500 filas y separaba las colas en memoria: a partir de la
  501, el número de la pestaña era falso sin avisar. Ahora la condición se
  aplica en la base y el recuento es exacto siempre.
- El CSV de clientes y membresías se llevaba lo que el navegador tenía cargado.
  Si ahora se alcanza el tope de 10 000 filas, el aviso va **en el propio
  archivo**: un recorte se dice, no se calla.

### Para desplegar

```bash
# En el SQL Editor de Supabase (idempotente, aditiva, sin bloqueos largos):
prisma/migrations/20260807_membresia_fecha_pago/migration.sql
```

El relleno histórico copia `updatedAt` en `fechaPago` para lo ya cobrado, que es
exactamente lo que los reportes venían usando: **ningún número cambia el día del
despliegue**. A partir de ahí, cada cobro nuevo guarda su fecha de verdad.

Verificado: tipos, lint sin errores nuevos, 713/713 pruebas (16 nuevas),
`rls:cobertura` sin huecos y build correcto.

### Qué NO cambia todavía

Los tres avisos de «Requiere tu atención» siguen llevando a listas sin filtrar
(hallazgo B-7): ahora sus números son ciertos, pero el filtro de destino
—«vence en 7 días», «sin visitas en 30 días»— es el Bloque 2. Los segmentos
siguen sin pantalla propia (C-11) y `lavadosRestantes` sigue sin reporte (C-12),
también Bloque 2.

---

## Estado · Bloque 2 completado (2026-08-11)

| # | Hallazgo | Qué se hizo |
|---|---|---|
| 9 | — | **Filtros combinables en Membresías**: vence en 7/15/30, con/sin usos, sin venir +15/30/60/90, por plan y por categoría de vehículo. Todos en la URL y compartidos con el CSV. |
| 10 | — | **Filtros equivalentes en Clientes**: sin venir, situación de la membresía (vigente · por vencer · vencida · sin), registrados en los últimos N días y categoría de vehículo. |
| 11 | B-7, C-12 | **`/admin/riesgo`** — el cruce que faltaba: *no viene hace X* **+** *vence en Y* **+** *le quedan Z usos*, ordenado por **dinero en juego**, con WhatsApp ya redactado en cada fila y exportación. Los dos avisos del Resumen llevan aquí con sus umbrales puestos. |
| 12 | C-12 | **`/admin/retencion`** — reparto por días sin venir (con enlace a las personas de cada tramo), tasa de renovación a 90 días, **pasivo de usos pagados sin prestar** y consumo por plan. |
| 13 | C-11 | Los segmentos predefinidos ganan **«ver quiénes son antes de enviar»**: enlazan al directorio con el filtro equivalente. No hacía falta pantalla nueva — los filtros del punto 10 dicen lo mismo. |

### Tres decisiones que conviene conocer

**El orden es por dinero, no por nombre.** Con cincuenta personas y una tarde
para llamar, el orden alfabético reparte el esfuerzo al azar. El *valor en
juego* es lo que queda sin consumir de cada membresía **al precio al que se
compró** (no al de la lista, que puede haber cambiado); en los planes ilimitados
es la renovación completa. Se calcula en SQL para que el orden y la paginación
sigan siendo exactos con miles de filas.

**Cada filtro es una condición dentro de un único `AND`.** Suena a detalle de
implementación y es la propiedad que evita el peor fallo posible aquí: dos
condiciones con su propio `OR` puestas como claves sueltas del mismo objeto se
pisan, y la lista sale **mal filtrada sin ningún error**. Hay prueba.

**Los usos sin consumir se presentan como un pasivo.** No es dinero por ganar:
es servicio ya cobrado que el negocio debe. Si vence sin consumirse no se
convierte en ingreso extra, se convierte en un cliente molesto — y la pantalla
lo dice con esas palabras en vez de dejarlo a interpretación.

### Permisos

`riesgo` y `retencion` entran en `ADMIN_SECTIONS`, y en los dos roles acotados:
Marketing las necesita para dirigir una campaña de retención y Supervisión para
repartir las llamadas.

Verificado: tipos, lint sin errores nuevos, 729/729 pruebas (16 nuevas del
bloque), `rls:cobertura` sin huecos y build correcto. **Sin migración**: todo se
apoya en columnas que ya existen.

### Lo que queda (Bloque 3)

Semáforo del cliente calculado en un solo sitio, ficha del cliente como una sola
línea de tiempo, vigilancia automática que dispare las automatizaciones desde el
semáforo, y conciliación diaria entre Caja, Membresías y Transacciones.
