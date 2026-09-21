# Reportes

Todo reporte de MembeGo se puede **ver, exportar e imprimir**. Este documento
dice dónde vive cada pieza y, sobre todo, **qué reglas no se pueden romper** —
porque los fallos de un reporte no se notan: se ven como un número.

## Las pantallas

| Pantalla | Quién | Motor | Periodo | Exporta | Imprime |
| --- | --- | --- | --- | --- | --- |
| `/superadmin/reportes` | Superadmin | `modules/reportes/globales.ts` | presets + a mano | ✅ CSV | ✅ |
| `/superadmin/reportes/[id]` | Superadmin | `modules/reportes/queries.ts` | presets + a mano | ✅ CSV | ✅ |
| `/admin/reportes` | Dueño del negocio | `modules/reportes/queries.ts` | presets + a mano | ✅ CSV | ✅ |
| `/admin/reportes/citas` | Dueño del negocio | `modules/reportes/citas.ts` | presets + a mano | ✅ CSV | ✅ |
| `/admin/reportes/clientes` | Dueño del negocio | `modules/reportes/clientes.ts` | presets + a mano | ✅ CSV | ✅ |
| `/admin/reportes/crecimiento` | Dueño del negocio | `modules/reportes/crecimiento.ts` | presets + a mano | ✅ CSV | ✅ |
| `/admin/reportes/promociones` | Dueño del negocio | `modules/reportes/promociones.ts` | presets + a mano | ✅ CSV | ✅ |
| `/admin/reportes/regalos` | Dueño del negocio | `modules/reportes/regalos.ts` | presets + a mano | ✅ CSV | ✅ |
| `/admin/app/carwash/reportes` | Encargado | `modules/apps/reportes.ts` | desde/hasta | ✅ CSV | ✅ |
| `/admin/retencion` | Dueño del negocio | `modules/riesgo/retencion.ts` | ventana fija (90 d) | ✅ CSV | ✅ |
| `/admin/riesgo` | Dueño del negocio | `modules/riesgo/` | filtros | ✅ CSV | ✅ |
| `/admin/registros` | Dueño del negocio | `modules/registros/` | filtros | ✅ CSV | ✅ |
| `/admin/seguimiento/imprimir` | Dueño del negocio | `modules/seguimiento/` | desde/hasta | ✅ CSV | ✅ |
| `/superadmin/auditoria` | Superadmin | `modules/auditoria/` | filtros | ✅ CSV | — |
| `/admin/actividad` | Dueño del negocio | `modules/auditoria/` | filtros | ✅ CSV | — |

`/superadmin/reportes/[id]` y `/admin/reportes` montan **el mismo componente**
(`components/reportes/ReporteEmpresaVista`). No es ahorro de código: si fueran
dos vistas, el superadmin y el cliente acabarían discutiendo sobre cifras
distintas del mismo negocio.

## Las cinco reglas

### 1. El periodo se corta en la zona horaria del NEGOCIO

`modules/reportes/rango.ts` es la única puerta. Nunca `new Date(año, mes, 1)`:
eso es medianoche del servidor, que en el despliegue es UTC, y un cobro del día
31 a las 9 de la noche en Santo Domingo cae en el mes siguiente.

Cuando el reporte cruza TODAS las empresas y no hay una de la que sacarla, se
usa `TZ_PLATAFORMA` (`lib/format.ts`).

### 2. Los cobros se fechan con `whereCobrado`

`modules/pagos/cobrado.ts`: `fechaPago`, con respaldo a `updatedAt` solo para
las filas anteriores a la columna. Fechar por `updatedAt` hace que editar una
membresía vieja la mueva de mes y que un informe ya cerrado cambie solo.

### 3. Ninguna cifra sale de una lista recortada

Un contador se hace con `count()`/`groupBy`, nunca con el `.length` de un
`findMany` con `take`. Si hay que recortar una LISTA, el recorte se dice en
pantalla y dentro del archivo exportado.

### 4. Las empresas de práctica quedan fuera por defecto

`SIN_DEMO` (`modules/demo/index.ts`). El interruptor «incluir empresas de
práctica» existe para los entrenamientos; lo que no puede pasar es que se
mezclen sin decirlo. El Resumen y los Reportes tienen que dar la misma cifra.

### 5. Un fallo se dice, no se enseña como cero

Cada motor devuelve `incompleto: boolean` y la pantalla lo pinta. Cuatro
tarjetas en `RD$0` porque una consulta no respondió es peor que un error.

## Granularidad de la serie

Una serie diaria de 365 puntos no es una tendencia: es ruido con forma de
gráfica. Cada reporte agrupa su serie **por día, por semana o por mes**, y el
valor por defecto es **automático** según el largo del periodo:

| Días del periodo | Granularidad |
| --- | --- |
| hasta 62 | Por día |
| 63 a 400 | Por semana |
| más de 400 | Por mes |

**Se pliega en TypeScript, no en SQL**, y es a propósito. Las series ya salen de
la base agrupadas por día **y cortadas en la zona horaria del negocio**
(`AT TIME ZONE`), que es la parte difícil. Plegar esos días es una suma, y
hacerlo fuera de la consulta tiene tres ventajas: no se toca ni un motor, la
semana **nunca puede discrepar del día** porque sale de los mismos números, y si
la agrupación bajara a `date_trunc` habría que volver a pasarle la zona a cada
consulta — una que se olvidara cortaría en UTC sin avisar.

**Solo sirve para cifras aditivas.** Plegar suma cada campo del punto: correcto
para conteos y para dinero, y **mentira para una media o una tasa** (la media de
una semana no es la suma de las medias de sus días). `tests/reportes-granularidad.test.ts`
comprueba que ninguna serie del módulo meta una tasa; si hace falta una media
semanal, se calcula sobre los totales plegados.

**La granularidad viaja en la URL** (`g`), como todo en esta pantalla, y solo
cuando se eligió a mano: la automática se recalcula sola. Cambiar de periodo no
la pierde, y la exportación se la lleva.

**El recorte de la serie larga se dice.** Un rango de más de `MAX_DIAS_SERIE`
(370) días enseña los primeros 370 en la gráfica y la tabla — antes se recortaba
en silencio. Ahora hay un aviso, **y ese aviso se imprime**: en papel, una serie
corta sin nota es indistinguible de un periodo sin datos. Las cifras del resumen
siempre cubren el periodo entero.

## Mientras carga

Cada pantalla de reportes tiene su propio `loading.tsx`
(`components/reportes/EsqueletoReporte.tsx`). No es un adorno: antes caían en el
`loading.tsx` genérico de `/admin`, que pinta **seis tarjetas iguales en
rejilla** — una forma que no llega nunca, así que al aparecer el reporte de
verdad **todo se movía de sitio**. Un esqueleto que no calca la página no reduce
la espera, la hace más brusca.

El esqueleto calca la forma real y en su orden: barra del periodo → fila de
cifras → paneles de gráfico → secciones de tabla. **Las cantidades de cada
pantalla salen de contar su vista** (`<KpiReporte`, `<PanelGrafico`), y
`tests/reportes-carga.test.ts` las compara en cada ejecución: si un reporte gana
una cifra o un gráfico y el esqueleto se queda atrás, la prueba falla.

Los **detalles** usan otro (`EsqueletoDetalleReporte`): son pestañas y una tabla
larga, no cifras. Y el esqueleto lleva `role="status"` con texto oculto, porque
sin él un lector de pantalla solo encuentra silencio.

## Las tablas

Todas las tablas de los reportes son **una sola**:
`components/reportes/TablaReporte.tsx`. Antes eran **ocho copias byte a byte** de
la misma función `Tabla`, una pegada al final de cada vista, con veintiséis usos
entre todas y **ni un control**: el orden era el que trajera la consulta y no
había forma de cambiarlo.

Lo que tiene:

- **Ordenar por columna.** Se pulsa el encabezado: primero de mayor a menor —en
  un reporte casi siempre se busca el mayor—, luego al revés, y a la tercera se
  quita y vuelve el orden del motor. Los empates conservan ese orden, así que la
  tabla nunca se mueve sola entre dos pulsaciones.
- **Buscar**, sobre el texto que se ve, sin acentos ni mayúsculas (la misma
  `normalizarBusqueda` que usa la base).
- **Densidad** cómoda o compacta, guardada en el navegador y **compartida por
  todas las tablas de reportes**: repetir la misma elección nueve veces en una
  pantalla no es una preferencia, es una molestia.

Buscador y densidad aparecen solo **por encima de `UMBRAL_CONTROLES` filas**:
buscar en una tabla de cuatro filas es más trabajo que leerla.

### Por qué una celda puede llevar un número escondido

Las filas llegan ya formateadas — `dinero(142300)` → «RD$142.300,00». Ordenar
**eso** como texto pone «RD$9,00» por encima de «RD$1.200,00», porque el carácter
«9» va después del «1». Una tabla de finanzas ordenada al revés no es un defecto
estético: es una cifra equivocada en una reunión.

Por eso una celda es `string` o `{ texto, orden }`, y hay tres ayudas en
`modules/reportes/tabla.ts` para construirla: `num(valor, texto)`,
`porcentaje(parte, base)` y `razon(parte, base)`.

De ahí sale la regla dura: **a partir de la segunda columna solo se puede ordenar
lo que traiga `orden`**. Una columna de números formateados sin su valor crudo
**no se vuelve ordenable** —su encabezado no se puede pulsar— en vez de ofrecer
un orden que mentiría. `tests/reportes-tabla.test.ts` recorre los bloques
`<Tabla>` de las ocho vistas y falla si encuentra un `entero(…)` o `dinero(…)`
suelto, nombrando el fichero.

`porcentaje()` guarda además el valor **sin redondear**: dos filas que se enseñan
como «33 %» se ordenan por lo que de verdad valen. Y cuando no hay base, escribe
«—» con `orden: null` — un hueco **no es un cero**, así que cae al final tanto
ascendiendo como descendiendo.

### Las tablas largas de los detalles se ordenan en la base

Las de arriba son resúmenes de treinta o cincuenta filas y **están enteras en la
página**: ordenarlas en el navegador no puede perder nada.

Las de `/detalle` son otra cosa. Traen hasta **300 filas ya recortadas por la
consulta**, y ese recorte lo decide el `orderBy`. Ordenarlas en el navegador
daría «las 300 más recientes, ordenadas por monto» — que **no** son «las 300 de
mayor monto». El cobro más grande del trimestre podría no estar en la lista
mientras la tabla parece estar respondiendo a la pregunta.

Por eso ahí el orden **viaja a la consulta**: se elige con un enlace
(`components/reportes/ThOrden.tsx`), se lee de la URL (`?o=` y `?d=`) y entra en
el `orderBy` de Prisma. Sin JavaScript, imprimible, y el enlace se puede pegar
en un chat tal cual. Un `?o=` inventado a mano cae al orden por defecto: lo que
no está en la lista de campos de esa pantalla no llega nunca a la consulta.

Tres consecuencias que están escritas en el código:

- **El subtítulo lo dice.** Con el tope puesto, cambiar el orden cambia *qué*
  filas se ven. El texto sale de `resumenTope()` y nunca a mano: «se muestran 300
  de 4.120: las de mayor monto».
- **El orden por defecto sigue al de la pestaña.** «Revertidas» arranca por
  `revertidaAt` y «Reservadas» por `createdAt`, el mismo criterio con el que el
  reporte las contó.
- **No se puede ordenar por un dato que el permiso esconde.** El nombre de quien
  atendió lo manda `ver_empleados` y ni se pide a la base sin él, así que no hay
  campo de orden para esa columna.

Y todas las columnas que no son la fecha llevan la fecha de segundo criterio:
sin él, dos filas iguales en la columna elegida saldrían en el orden que le
apeteciera a Postgres y la lista cambiaría sola entre dos recargas idénticas.

### Lo que la tabla no hace, a propósito

- **No pagina.** Los reportes agrupan hasta treinta o cincuenta filas y **se
  imprimen**: paginar escondería filas del papel sin decirlo.
- **No tiene multi-selección.** Una tabla de reporte es de solo lectura: no hay
  ninguna acción que aplicar a lo seleccionado. Una casilla que no lleva a
  ningún sitio enseña a desconfiar de los controles que sí sirven.

Al imprimir, los controles desaparecen y la tabla sale entera y en el orden que
se esté mirando. Si hay una búsqueda puesta, **el aviso de «filtrado» también se
imprime**: un papel con menos filas de las que hay tiene que decirlo.

## Gráficos

Todo gráfico va dentro de `components/reportes/graficos/PanelGrafico.tsx`, que
pide cuatro cosas: el **gráfico**, la **tabla con los mismos datos**, la
**pregunta de negocio** que contesta y el **periodo**. La tabla no es opcional
en el tipo, y eso es el punto: los gráficos de Recharts no se imprimen, y hasta
que existió este marco la tabla dependía de que quien escribía la pantalla se
acordara.

Hay tres formas, y cada una responde a una pregunta distinta:

| Forma | Componente | Para qué |
|---|---|---|
| Línea / área | `GraficoTendencia` | Cómo evolucionó algo en el periodo. Admite una segunda serie punteada para comparar. |
| Barras horizontales | `GraficoRanking` | Quién va delante y por cuánto. CSS puro: pesa cero y **sí se imprime**. |
| Anillo | `GraficoDistribucion` | De qué se compone un total, con **seis porciones como mucho**. |

Cuando una agrupación trae más filas de las que el anillo aguanta, quien llama
junta la cola en una porción rotulada («El resto de los canales») — nunca la
recorta en silencio, y la tabla del panel sigue trayendo la lista entera.

### Qué pantalla tiene qué

Los cinco reportes que nacieron sin gráfico —finanzas, membresías, clientes,
operación y citas— tienen dos cada uno: una **tendencia** sobre su serie diaria
y un **desglose** (ranking o anillo) sobre la agrupación que más se mira. En
cuatro de ellos la cabecera del archivo decía que no tener gráficos era una
decisión, con su razón —Recharts no imprime, y esos reportes se imprimen—. La
razón era cierta; la conclusión dejó de serlo cuando apareció `PanelGrafico`.
Las cabeceras lo cuentan así, en vez de borrar la decisión anterior.

**Ninguna tabla se quitó.** Las que estaban sueltas en su sección ahora viven
dentro del panel, desplegables en pantalla y siempre presentes en el papel.
`tests/reportes-graficos.test.ts` lo vigila por nombre de tabla.

### La serie de finanzas es solo caja, y lo dice

Es la única que podía mentir. El negocio cobra por dos caminos con **dos
relojes distintos**: la caja se fecha por `Transaction.createdAt` y los cobros
de membresía por `whereCobrado` (`fechaPago`, con respaldo a `updatedAt` solo
cuando es null).

Escribir esa segunda condición otra vez en el SQL de la serie sería crear una
**cuarta copia** de una definición que vive en un solo sitio precisamente
porque las copias anteriores se desincronizaron. Así que la línea es de caja, la
pantalla lo dice con todas las letras, el título del bloque en el CSV también
—para que el archivo se defienda solo una vez bajado— y el KPI de cobros de
membresía sigue arriba con su cifra exacta. Una serie con dos relojes mezclados
sería peor que no tenerla.

## Exportar

- Siempre en el **servidor** (una ruta `export`/`exportar`), nunca en el
  navegador: el navegador solo tiene la página que se está viendo.
- Con **el mismo periodo y el mismo filtro** que la pantalla, leídos con las
  mismas funciones. Un export que exporta otro corte es la forma más silenciosa
  de dar un dato equivocado.
- El archivo abre con un bloque **«Alcance del reporte»**: periodo, filtros y si
  los datos estaban completos. Un CSV descargado no lleva encima las condiciones
  con las que se generó.
- El armado va por `armarCsv` / `armarCsvBloques` (`lib/csv.ts`), que es la
  **única puerta**: separador `;` (Excel en español), BOM al inicio y escapado
  común. `tests/reportes-plataforma.test.ts` prohíbe volver a armarlo a mano.

## Imprimir

`ReporteImprimible` + `BotonImprimir` (`@/components/ui/…`). Un solo bloque
`@media print` para todo el panel; antes eran cinco copias.

- En papel solo se ve la región del reporte: sin menú lateral, sin cabecera del
  panel, sin lo que lleve `print:hidden`.
- **El color del papel no es una decisión de tema**: blanco y negro fijos. Si
  heredara las variables, quien tenga el panel en oscuro imprimiría texto casi
  blanco sobre una hoja blanca.
- La hoja siempre lleva **cuándo se generó**: sobrevive al dato que la produjo.
- `soloPapel` para las pantallas que necesitan una versión distinta en papel
  (Registros: nueve columnas en pantalla, siete en A4).
- **Las gráficas no imprimen.** `ResponsiveContainer` de Recharts mide el
  contenedor al pintar y en `@media print` sale en blanco. Por eso todo gráfico
  vive dentro de `PanelGrafico`, que **exige** la tabla equivalente como prop:
  la regla dejó de depender de que quien escribe la pantalla se acuerde. Esa
  tabla es además la alternativa textual para lectores de pantalla. Ver
  «Gráficos», más abajo.

**No cubre los tickets de 80 mm** (recibos de caja, comprobantes del escáner,
facturas). Papel de rollo continuo con su ancho, su tipografía y su lógica de
reimpresión: solo se parecen a un reporte en que salen por una impresora.

## Guardar como PDF

El mismo botón. El diálogo del navegador ofrece «Guardar como PDF» en todos los
sistemas, y por eso la etiqueta lo dice: mucha gente que quiere el PDF no pulsa
un botón que dice «imprimir» porque cree que necesita una impresora conectada.

No hay librería de PDF en el servidor. Si algún día hace falta una portada con
logo y paginación fija, entra entonces — no antes.

## Monedas

Los ingresos de plataforma se agrupan **por moneda**, nunca en una sola cifra.
Con todas las empresas en DOP se ve igual que antes: una línea. En cuanto haya
dos monedas con dinero, el reporte lo dice y la comparación contra el periodo
anterior se calcula solo para la principal. Sumar pesos con dólares da un número
que no es dinero de nada.

---

# Catálogo de métricas

*Añadido en la Fase 0 del sistema integral de reportes. Lo anterior —pantallas,
las cinco reglas, exportar, imprimir, monedas— sigue vigente sin cambios: son
el «cómo». Esto es el «qué».*

## Por qué hacía falta

Las cinco reglas protegen el **cómo** se calcula: la zona horaria, el fechado
de los cobros, que ninguna cifra salga de una lista recortada. Lo que no estaba
escrito es **qué significa** cada cifra. La pregunta «¿cuántos clientes activos
tenemos?» tiene hoy más de una respuesta defendible según qué pantalla se mire.

> **Sexta regla: una métrica, una definición, un sitio.** Si «membresía
> renovada» significa una cosa en el reporte de la empresa y otra en el del
> superadmin, las dos pantallas están mal aunque las dos consultas sean
> correctas.

## Vocabulario

### «Ingreso»

Dos flujos distintos, y `modules/reportes/queries.ts` ya los separa a
propósito:

| Término | Qué es | Fuente |
| --- | --- | --- |
| **Ingreso de caja** | Entró por el mostrador | `Transaction.monto`, estado cobrado |
| **Cobro de membresía** | Activaciones y renovaciones | `Membership.montoPagado` vía `whereCobrado` |

No se suman en una sola cifra sin decirlo: sumarlas hace imposible cuadrar el
reporte con la caja del día. Cuando un reporte necesite el total, lo llama
**ingreso total** y enseña los dos sumandos al lado.

Y la distinción que ningún reporte puede difuminar:

- **Cobrado** — el dinero está. Es lo que se reporta como ingreso.
- **Proyectado** — lo que entraría si nadie cancela. Va rotulado como
  estimación, nunca en la misma columna.

`Transaction.estado` tiene ocho valores (`PENDING`, `VALIDATING`, `APPROVED`,
`APPLIED`, `CANCELLED`, `REVERTED`, `EXPIRED`, `ERROR`). **Solo `APPROVED` y
`APPLIED` son dinero.** Ningún reporte suma `PENDING` a un ingreso.

### «Membresía activa»

`estado = 'ACTIVA'` **no basta**. La función correcta ya existe:
`estaVigente` (`modules/membresia/vigencia.ts`) — activa **y** no caducada.

La segunda condición existe porque el job de vencimiento puede no haber pasado.
Una membresía que dice `ACTIVA` con fecha de marzo no está activa, y contarla
infla el indicador más visible del panel.

### «Cliente activo»

**Ya estaba decidido** en `docs/auditoria-clientes-membresias.md` (bloque 3, el
semáforo del cliente), y los reportes no estrenan una definición propia:

| Estado | Definición |
| --- | --- |
| 🟢 Activo | Membresía vigente **y** visita en los últimos 30 días |
| 🟡 En riesgo | Vigente, sin visitas en 30-60 días **o** vence en menos de 7 con usos dentro |
| 🟠 Dormido | Sin visitas en más de 60 días, o vencida hace menos de 30 |
| 🔴 Perdido | Vencida hace más de 60 días sin renovar |

Los umbrales son **configurables por empresa**: un car wash y un restaurante no
tienen la misma frecuencia normal de visita, y un umbral fijo llamaría «dormido»
a un cliente que va cada dos meses porque su negocio funciona así.

«Cliente con membresía vigente» y «cliente con actividad» son los dos
**ingredientes** del semáforo, no sinónimos suyos. Un reporte que necesite uno
de los dos lo llama por su nombre.

### «Cancelada» vs «vencida»

- **Cancelada** — alguien la cortó: hay una decisión detrás.
- **Vencida** — se acabó el tiempo y nadie renovó.

Dos conversaciones comerciales distintas: **no se agregan juntas** en ninguna
métrica de pérdida. Al cliente se le muestra «Finalizada» en ambos casos
(`lib/estados.ts` → `labelCliente`); al negocio, nunca.

### «Renovación»

Un cobro sobre una membresía **que ya existía**, que extiende su vigencia. Se
distingue de la **activación**, que es el primer cobro. Ver «Lo que hoy no se
puede medir».

## Reglas transversales que faltaban

**Límites del rango.** Inclusivo al inicio, exclusivo al final:
`desde <= fecha < hasta`. Una venta a las 23:59:59 del último día entra; una a
las 00:00:00 del siguiente, no.

**Comparación.** El periodo anterior tiene **exactamente los mismos días**.
Comparar 30 contra 31 produce una variación que no significa nada.

**Denominador cero.** Una tasa sin base no es 0 %: es **«sin dato»**. Enseñar
0 % de renovación porque no venció ninguna membresía es decir algo falso.

**Datos incompletos.** Ya existe el mecanismo (`incompleto: boolean`, regla 5).
Se extiende a un segundo caso: cuando el rango pedido es anterior a la fecha
desde la que existe el dato, el reporte lo dice — *«datos completos desde
DD/MM/AAAA»*.

## Fichas

🔒 requiere permiso financiero · 👤 expone datos personales.

### Membresías

| Métrica | Definición | Fórmula / fuente |
| --- | --- | --- |
| Activas | Vigentes al cierre | `estaVigente` |
| Nuevas | Creadas en el periodo | `Membership.createdAt` |
| Pendientes de pago | Esperando validación | `estado IN ('PENDIENTE','PENDIENTE_PAGO')` |
| Rechazadas | Pago rechazado | `estado = 'RECHAZADA'` |
| Canceladas | Cortadas por decisión | `AuditLog.accion = 'MEMBRESIA_CANCELADA'` |
| Renovadas | Cobro que extiende vigencia | `AuditLog.accion = 'MEMBRESIA_RENOVADA'` |
| Próximas a vencer | Vencen en N días | `fechaVencimiento` entre hoy y hoy+N, vigentes |
| Tasa de renovación | Renovadas ÷ (renovadas + vencidas) | derivada |
| Churn | Bajas ÷ activas al inicio | derivada |
| Ingresos por plan 🔒 | Cobros agrupados por plan | `whereCobrado` + `planId` |

**Los cambios de plan se clasifican por el precio del momento**, no por el de
hoy: un plan cuyo precio subió el mes pasado convertiría retroactivamente
subidas en bajadas. Por eso el evento guarda precios, no solo ids.

### Finanzas 🔒

| Métrica | Fórmula / fuente |
| --- | --- |
| Ingreso de caja | `Transaction.monto`, `estado IN ('APPROVED','APPLIED')` |
| Cobros de membresía | `whereCobrado` |
| Intentos de pago | `PagoIntento` por `createdAt` |
| Tasa de aprobación | `APROBADO` ÷ (`APROBADO` + `RECHAZADO`) |
| Motivos de rechazo | `PagoIntento.motivoRechazo` |
| Cobrado sin entregar | `estado='APROBADO' AND fulfillmentEstado='PENDIENTE'` |
| Anuladas / revertidas | `Transaction.estado IN ('CANCELLED','REVERTED')` |
| Descuentos | `Membership.descuentoBienvenida` |

`PagoIntento` ya está indexado para esto: `[companyId, estado, createdAt]`.

### Clientes 👤

| Métrica | Fuente |
| --- | --- |
| Nuevos | `Cliente.createdAt` |
| Activos | derivada de membresías |
| Con actividad | `Visit.fechaVisita` |
| Con varias membresías | `Membership` agrupado por `clienteId` |
| Valor generado 🔒 | `montoPagado` + `Transaction.monto` |

**Frontera de privacidad, no negociable:** una empresa ve **su relación** con
el cliente. Nunca sus membresías, visitas ni gasto en otra empresa. `Cliente`
lleva `companyId`, así que el aislamiento es directo; lo que hay que vigilar es
no cruzar por `User` —que sí es global— y reconstruir por detrás lo que la
frontera prohíbe. `tests/reporte-clientes.test.ts` comprueba que el motor no
nombra `User` ni una vez.

**Implementada.** Además de la tabla de arriba, el reporte añade:

| Métrica | Fuente |
| --- | --- |
| Tasa de activación | De las altas del periodo, cuántas llegaron a tener una visita (`EXISTS` en la base) |
| Por dónde llegaron | `Cliente.canalOrigen`, la atribución que captura `docs/ADQUISICION.md` |
| De dónde son | `Cliente.ciudad` |
| Consentimiento | `notifPromos` / `notifRecordatorios`, foto de hoy |
| Los que más dejaron 🔒👤 | `Membership.montoPagado` agrupado por cliente |

**Dos relojes, separados en pantalla.** Las cifras del periodo se fechan por
cuándo pasó la cosa; las de **foto de hoy** —base, con membresía vigente, nunca
tuvieron— no dependen del rango y **no se comparan** contra el periodo anterior:
el pasado de una foto de hoy no existe, y una variación ahí sería inventada. Van
en su propio bloque, rotulado, también en el CSV.

**No estrena una definición de «activo».** El semáforo vive en
`modules/riesgo/semaforo.ts` y tiene su pantalla en `/admin/riesgo`. Este
reporte usa por su nombre los dos ingredientes que el vocabulario distingue
—«con membresía vigente» y «con actividad»— y enlaza al semáforo en vez de
repetirlo.

### Códigos y regalos 🔒👤

Lo que un cliente le paga a otro. **Sustituye a la categoría «Cupones» del plan
original**, que no se puede construir: no hay modelo `Cupon` en el esquema, y
`BeneficioTipo.COUPON` y `TransactionTipo.COUPON_USE` están declarados sin que
ningún código los escriba. Un reporte de cupones daría cero en todas sus cifras.

| Métrica | Fuente |
| --- | --- |
| Regalos enviados | `Regalo.createdAt` |
| Aceptados | `Regalo.resueltoAt` con estado `ACEPTADO` |
| Tasa de aceptación | Aceptados ÷ **cerrados**, sin los `CANCELADO` |
| Qué se regala | `Regalo.tipo` (usos, promoción, membresía) |
| A quien no tiene cuenta | `Regalo.destinatarioId` nulo |
| Gift cards emitidas / activadas | `GiftCard.createdAt` / `activadaAt` |
| Vendido en gift cards 🔒 | `GiftCard.monto` de las activadas en el periodo |
| Saldo vivo 🔒 | `GiftCard.saldo` de las activas — **foto de hoy** |
| Quién más regala 👤 | `Regalo` agrupado por remitente |

**Dos cosas distintas que no se suman.** Un regalo lo tiene que **aceptar**
alguien —puede rechazarse o vencerse—; una gift card es **dinero que ya entró**.
Ninguna cifra del reporte los combina.

**El saldo vivo es un PASIVO, no un ingreso.** Ese dinero se cobró al vender la
gift card y el servicio todavía se debe: sumarlo a los ingresos del mes lo
contaría dos veces, una al venderse y otra al consumirse. Va en su propio bloque
y rotulado, también en el CSV.

**La tasa de aceptación sale de los cerrados, y sin los retirados.** Sobre el
total, una tanda recién enviada daría una aceptación baja que no fue. Y un
`CANCELADO` lo retira quien envía, no lo rechaza quien recibe: meterlo en el
denominador castigaría al negocio por una decisión del remitente.

**Lo que no se puede fechar:** el **consumo de una gift card**. Baja `saldo` con
un `decrement` sin dejar fila propia, y la transacción que emite es
`BENEFIT_USE`, tipo que comparten cuatro flujos (ofertas privadas, gift cards,
regalos). Por eso lo consumido va como **acumulado** (`monto − saldo`) y nunca
como cifra del periodo. `tests/reporte-regalos.test.ts` vigila la causa: si
`BENEFIT_USE` pasara a ser exclusivo de gift cards, el consumo sí se podría
fechar.

### Promociones 🔒

Qué se vende, qué se entrega y qué se usa de verdad.

**Tres relojes, tres cifras.** Adquirir, entregar y usar son momentos distintos
y casi nunca caen el mismo día; medirlos con la misma fecha daría un reporte que
cuadra consigo mismo y no con el negocio.

| Momento | Fuente | Qué significa |
| --- | --- | --- |
| **Adquirida** | `ProductoCompra.createdAt` | El cliente la pidió |
| **Entregada** | transición a `ACTIVA` en `producto_compra_transiciones` | El beneficio quedó disponible con su QR |
| **Usada** | `Transaction` tipo `PROMOTION_USE` | Canje real validado en el mostrador |

| Métrica | Fuente |
| --- | --- |
| Dinero de promociones 🔒 | `ProductoCompra.montoPagado` con `pagoConfirmado`, **fechado por la entrega** |
| Movimiento por estado | Transiciones agrupadas por `hacia` dentro del periodo |
| Por promoción | Compras por `promocionId`; usos vía transacción → QR usado → compra → promoción |
| Regalos P2P | `ProductoCompra.beneficiarioClienteId` no nulo |
| Catálogo y cola de trabajo | `Promocion` y `ProductoCompra` — **foto de hoy** |
| Vitrina | `viewCount` / `shareCount` — acumulado y topado, **es un suelo** |

**«Canje» aquí no es «canje» en Operación.** Operación llama canjes a las
**visitas de membresía** (`Visit`); estos son usos de una promoción comprada, que
no generan visita y por lo tanto **no están contados allí**. Las dos cifras son
disjuntas y ninguna incluye a la otra.

**Los usos salen de la transacción, no de restar `usosRestantes`.** Regalar usos
a un amigo también baja ese contador sin que nadie haya canjeado nada; contar por
diferencias metería los regalos dentro de los canjes. La transacción solo existe
cuando el mostrador validó el QR, y llega por los dos caminos que canjean: el
escáner del panel y la API de plataforma.

**El dinero se fecha por la ENTREGA**, y se dice. `ProductoCompra` no tiene
`fechaPago` —a diferencia de `Membership`, que es lo que `whereCobrado` usa—, así
que esta cifra **no se puede comparar de tú a tú con la de Finanzas**.

**Lo que el reporte NO usa, aunque la columna exista:** `Promocion.canjes` está
declarada, el marketplace la lee y **ningún código la escribe** — vale 0 para
todas; `maxCanjes` y `limitePorCliente` son configuración, no medición.
`tests/reporte-promociones.test.ts` vigila la causa: el día que alguien escriba
`canjes`, la prueba obliga a decidir si el reporte pasa a usarla.

### Crecimiento 👤

Quién trae gente nueva, por dónde entra y en qué paso se cae.

| Métrica | Fuente |
| --- | --- |
| Clics en invitaciones | `ReferralEvent` tipo `CLICK` — ya sin bots ni autoclics (los descarta `/r/[code]`) |
| Registros atribuidos | `ReferralEvent` tipo `REGISTRO` |
| Referidos completados | `Referido.completadoEn`, excluyendo `sospechoso` |
| Invitados con membresía | `ReferralEvent` tipo `MEMBRESIA` |
| Visitas únicas | `count(DISTINCT visitorId)` sobre los clics; la cookie la siembra el clic |
| El embudo | `ReferralEvent` agrupado por `tipo`: eventos y referentes distintos |
| Por dónde entra | `ReferralEvent.canal`, compartidos y clics en la misma fila |
| Quién trae más gente 👤 | `Referido` completados agrupados por referente |
| Enlaces de invitación | `GrowthLink` creados en el periodo; vigentes es **foto de hoy** |
| Lo que apartó el antifraude | `Referido.sospechoso` + eventos `FRAUDE` |
| Recompensas | `ReferralRecompensa` y `GrowthReward` por estado, **separadas** |
| Campañas «Invita y Gana» | `InvitacionEvento` por campaña — **embudo aparte** |

**El embudo es un suelo, no un conteo exacto.** `logReferralEvent` traga sus
errores a propósito —«el tracking jamás debe romper el flujo principal»—, así
que una escritura fallida pierde el evento en silencio. El aviso viaja en la
pantalla **y dentro del CSV**: descargado, un embudo sin esa línea es
indistinguible de un conteo exacto.

**Dos embudos paralelos que NO se suman.** `ReferralEventTipo` e
`InvitacionEventoTipo` miden los mismos hitos con otros nombres (el esquema
lista las equivalencias). Quien pasó por una campaña puede dejar huella en los
dos, así que sumarlos contaría dos veces a la misma persona. Van en secciones
distintas, cada una con sus nombres.

**Lo que el reporte NO cuenta, y por qué.** `PRIMER_USO` está declarado en el
enum y **no lo escribe nadie**: como etapa daría un cero permanente que se
leería como «nadie canjea». `FRAUDE`, `REGISTRO_GLOBAL` y `MEMBRESIA_GLOBAL` no
son etapas del embudo y se cuentan aparte. La lista sale en pantalla y en el
CSV, y `tests/reporte-crecimiento.test.ts` vigila **la causa**: el día que
alguien escriba `PRIMER_USO`, la prueba exige subirlo al embudo.

**`clienteId` siempre es el referente**, nunca el invitado. Por eso la columna
del embudo se llama «referentes distintos»: decir «personas» mezclaría a quien
invita con quien llega.

### Operación

| Métrica | Fuente |
| --- | --- |
| Canjes | `Visit` por `fechaVisita` |
| Canjes que descontaron | `Visit.descontado = true` |
| Por sucursal / empleado | `Visit.sucursalId` / `Visit.empleadoId` |
| QR generados / usados | `AuditLog.accion IN ('QR_GENERADO','QR_USADO')` |

**Dos limitaciones que hay que decir antes de construir:**

1. ~~**`Visit` no tiene `companyId`**~~ — **resuelto en la Fase 5.** La
   columna existe (nullable), con su índice `[companyId, fechaVisita]`, y se
   escribe en el único sitio que crea visitas. La migración
   `20260919_visitas_company_id` solo añade; el relleno del histórico se aplica
   a mano, y hay **dos versiones según el tamaño de la tabla**:
   `2026-09-visitas-company-id-BASE-PEQUENA.sql` (una pasada, corre entero en el
   editor de Supabase) y `2026-09-visitas-company-id.sql` (lotes e índices
   `CONCURRENTLY`, para cuando la tabla crezca — necesita un cliente en
   autocommit, porque **el editor de Supabase envuelve cada ejecución en una
   transacción y `CONCURRENTLY` no puede correr ahí**).

   El 14-09-2026 producción tenía **130 visitas**: el aparato de lotes es para
   el volumen que el modelo prevé, no para el que hay.

   **Mientras el relleno no termine, el reporte de operación lo dice** —banner
   en pantalla y línea «Cobertura de visitas» en el CSV—: los periodos más
   viejos salen por debajo de lo que fueron, y callarlo sería mentir sobre el
   alcance. La cobertura se enseña como un sí/no y no como un número: contar
   las pendientes de UNA empresa exigiría el JOIN por `membershipId` que la fase
   existe para evitar, y un conteo global sería dato de otro inquilino.

   La columna no lleva `@relation`: una clave foránea nueva sobre `visits`
   obliga a Postgres a validar la tabla entera con un lock exclusivo, que es
   exactamente el bloqueo que el resto de la fase se toma el trabajo de evitar.
   La integridad la sigue dando `membershipId`, de donde el valor se copia.
2. **`sucursalId` y `empleadoId` son opcionales.** Los reportes por sucursal o
   empleado llevan una fila **«sin asignar»** que no se esconde. Esconderla
   haría que los subtotales no sumaran el total, que es la forma más rápida de
   que nadie vuelva a confiar en el reporte.

Los reportes de empleado miden **operaciones, no personas**: van detrás de su
propio permiso y no incluyen métricas de ritmo individual que no sirvan a una
decisión operativa.

### Citas

| Métrica | Fuente |
| --- | --- |
| Citas agendadas | `Cita` por `inicio` (el día en que estaban agendadas) |
| Completadas / canceladas / no asistió | `Cita.estado` **actual** |
| Reservadas en el periodo | `Cita.createdAt` — otra pregunta, otra cifra |
| Tasa de asistencia | Completadas ÷ (completadas + no asistió) |
| Quién cancela / motivos | `Cita.canceladaPor`, `Cita.motivoCancelacion` |
| Quién atendió | `Cita.atendidaPorId` (solo lo escribe «completar») 🔒`ver_empleados` |
| Por sucursal | `Cita.sucursalId`, desde que `reservarCita` la guarda (ver la limitación 2) |

**Tres limitaciones, y las tres se dicen en pantalla y en el CSV:**

1. **El estado es el de HOY, no el del día de la cita.** `citas` no guarda un
   sello de tiempo por transición: confirmar, completar, marcar no-asistió y
   cancelar escriben el mismo campo `estado` encima del anterior, y no hay
   bitácora de citas — los `CITA_CANCELADA` del código son tipos de
   **notificación**, no de auditoría. Una cita del 3 de marzo cancelada el 10
   de abril sale como cancelada en el reporte de **marzo**. El reporte responde
   «cómo quedó la agenda de este periodo», nunca «cuántas se cancelaron esta
   semana».

   El bus de automatizaciones sí guarda un `cita.cancelada` con fecha, y aun
   así **no se cuenta**: `emitirEventoEstrategia` es best-effort —fuera de la
   transacción y se traga sus fallos a propósito, para que el bus nunca deshaga
   una cancelación ya guardada—, así que contar con él daría un número que va
   por debajo sin avisar. La salida honesta es la otra: columnas de transición
   en `citas`, como las que `ColaVehiculo` ya tiene (`inicioAt`, `listoAt`,
   `entregadoAt`).

2. ~~**No hay desglose por sucursal**~~ — **resuelto.** `citas.sucursalId`
   existía y ningún código lo escribía, así que la dimensión no se ofrecía (un
   desglose habría sido una tabla con una sola fila «(sin asignar)» y un filtro
   que solo devuelve vacío). Ahora `reservarCita` la guarda: con **una** sola
   sucursal activa la asigna el servidor —preguntar algo con una única
   respuesta es ruido—, y con **varias** el cliente elige, con el id validado
   contra la empresa.

   **Las citas anteriores siguen sin sucursal** y salen en su fila «(sin
   asignar)», que no se esconde: esconderla rompería la suma de los subtotales.
   No se rellenan hacia atrás porque no hay de dónde sacarlo — inventar la
   sucursal de una cita vieja sería fabricar un dato—, y esa fila se vacía sola
   con el tiempo.

   El cupo y el horario siguen siendo **de la empresa**, no de la sucursal:
   `AgendaConfig` es 1:1 con la empresa. Esto registra dónde se atiende; no
   abre una agenda por local.

3. **La tasa de asistencia solo vale si la agenda se cierra.** Sale de las
   citas **cerradas**, nunca del total: sobre el total, una agenda a medio
   cerrar daría una asistencia baja que no existió. Por eso «ya pasaron sin
   cerrar» es una cifra de primera fila con su banner, y no una nota al pie.

Se filtra **por servicio y por sucursal**, no por persona: filtrar por alguien
pondría canceladas y no-asistió en cero por construcción —solo las completadas
registran quién atendió—, y ese cero parece un dato cuando es un artefacto.

## Lo que hoy NO se puede medir

**Ningún reporte va a inventar estos datos.**

| Métrica | Por qué no |
| --- | --- |
| Vencidas por periodo | `modules/membresia/vencimiento.ts` pone `VENCIDA` sin escribir auditoría |
| Cambio de plan | `cambiarPlanDeMembresia` audita con `accion: 'PAGO_APROBADO'` y el plan anterior en el payload |
| Activaciones | El paso a `ACTIVA` no deja rastro |
| Suspensión / reactivación | **No es una carencia: el producto no suspende membresías.** Ver «Tres decisiones» |
| Motivo de cancelación | No se pide ni se guarda |
| Renovación fallida | El cron de tarjeta no registra el fallo |
| Cambio de precio | No se versiona |
| Reembolsos | No existe el concepto en el modelo |
| Aperturas y clics | El proveedor no devuelve evidencia |
| Cuándo se confirmó, completó o canceló una cita | `citas` sobreescribe `estado` y no guarda sello de tiempo por transición. Ver la ficha de Citas |

**Sobre el histórico:** se podrá reconstruir parcialmente desde `AuditLog`
—renovaciones y cancelaciones sí están—, pero vencimientos, activaciones y
cambios de plan **no existen y no se van a fabricar**.

## Permisos

Hoy `reportes` es una sección sin funciones: quien entra lo ve y lo exporta
todo. Se separa en:

| Función | Qué abre |
| --- | --- |
| `ver` | Reportes operativos |
| `ver_financieros` | Todo lo marcado 🔒 |
| `ver_datos_personales` | Todo lo marcado 👤 — **en vigor** desde el reporte de clientes |
| `exportar` | Las rutas `export`/`exportar` |
| `ver_empleados` | Actividad por empleado |
| `ver_auditoria` | Diagnósticos de calidad de datos |

**Se niega por defecto**: una función que no está en el catálogo no existe.

El permiso se comprueba **en la consulta, no en el componente**. Una pantalla
que esconde una columna mientras la ruta de exportación la sigue devolviendo no
protege nada — y la regla de exportar dice que el archivo usa las mismas
funciones que la pantalla, así que el permiso tiene que vivir debajo de las dos.

## Filtros que faltan

**Rangos.** Hoy hay cinco presets (`rango.ts`). Faltan: ayer, esta semana,
semana anterior, este trimestre, trimestre anterior, este año, año anterior,
últimos 90 y 365 días, fecha concreta.

**Comparación.** Contra el periodo anterior ya existe. Falta contra el **mismo
periodo del año anterior**.

**Dimensiones.** Sucursal, plan, estado, cliente, empleado, promoción,
beneficio, campaña, método de pago, canal, fuente, moneda.

Los filtros se combinan, se limpian y **se ven**: si un número sale de un
subconjunto, la pantalla lo dice — y el archivo exportado también, que para eso
existe el bloque «Alcance del reporte».

## Fases

Una fase = un PR = una parada para auditar. **Una fase no está terminada si
solo existe la interfaz.**

| Fase | Contenido | Terminada cuando |
| --- | --- | --- |
| 0 | Este catálogo | Revisado y fusionado |
| 1 | `MembershipEvent`, motivo de cancelación, emisión desde todos los puntos que mutan membresías, backfill, índices | Cancelar, renovar, vencer, activar y cambiar plan escriben su evento. Pruebas que fallan al revertir cada emisión |
| 2 | Permisos granulares + filtros ampliados | Sin `ver_financieros` no se ven ingresos **ni en la exportación**. Prueba con dos empresas |
| 3 ✅ | Reportes de membresías sobre eventos | Cada cifra abre su detalle. Corte de datos visible |
| 4 ✅ | Finanzas y conciliación | Cobrado ≠ proyectado, separados y probados |
| 5 ✅ | Operación: QR, sucursales, empleados, beneficios. Incluye `Visit.companyId` | Hecho. Consulta por sucursal sin JOIN; cobertura del relleno visible en pantalla y CSV; `ver_empleados` filtra EN LA CONSULTA |
| 6 | Marketing, CRM, campañas, referidos | Etapas leídas de `PipelineConfig`, nunca fijas |
| 7 | XLSX y exportación en segundo plano | 100k filas sin bloquear la petición |

**La Fase 7 no incluye una librería de PDF.** La decisión de este documento
—«si algún día hace falta una portada con logo y paginación fija, entra
entonces»— sigue en pie: el botón de imprimir ya produce PDF por el diálogo del
navegador, y el presupuesto de JavaScript está al 96 %.

### Tres decisiones, ya tomadas en la documentación

Las tres estaban resueltas antes de empezar. Se recogen aquí para que la Fase 1
no las vuelva a abrir.

**1 · No se añade el estado `SUSPENDIDA`.**

`docs/GUIA_LENGUAJE_MEMBEGO.md` es la autoridad sobre estados y etiquetas, y su
tabla de `MembershipEstado` tiene exactamente seis: `PENDIENTE`,
`PENDIENTE_PAGO`, `ACTIVA`, `VENCIDA`, `RECHAZADA`, `CANCELADA`. Las campañas sí
tienen `PAUSADA`; las membresías, a propósito, no.

Así que **«membresías suspendidas» y «reactivadas» no son reportes que falten:
son reportes de algo que el producto no hace**. Inventar el estado para poder
enseñar la cifra sería construir el dato al revés — primero el gráfico, después
la realidad. Si algún día el negocio quiere pausar membresías, será una decisión
de producto con su propia migración, y entonces el reporte sale solo.

**2 · El histórico se reconstruye hasta donde llegue, y el hueco se dice.**

`docs/runbooks/restaurar-datos-borrados.md`:

> **No inventes filas para «cuadrar».** Un hueco documentado es recuperable; un
> dato inventado contamina los reportes para siempre.

La regla ya estaba escrita, y estaba escrita pensando justo en esto. Se aplica
al backfill: se reconstruyen desde `AuditLog` las renovaciones y las
cancelaciones —que sí dejaron rastro— y **nada más**. Vencimientos, activaciones
y cambios de plan anteriores a la Fase 1 no existen y no se fabrican. Todo
reporte de ciclo de vida lleva su fecha de corte visible.

**3 · RLS Capa 2 es proyecto aparte, y ya no está bloqueado.**

`docs/RLS.md` § 4 dice que el único motivo por el que no podía encenderse —85
archivos consultando sin contexto de empresa— **quedó resuelto el 2026-08-11**:
la lista `PENDIENTES` del gate está vacía y `scripts/rls-cobertura.mjs` lo
verifica en cada ejecución.

Lo que queda son sus pasos 4 a 6: aplicarla en una base de prueba, ejercitar la
aplicación con el rol `membego_app`, correr `npm run rls:probar`, y recién
entonces producción con los runbooks a mano. Eso es un trabajo con su propio
riesgo y su propia marcha atrás — **no se mete dentro de una fase de reportes**,
donde un fallo se confundiría con un error de consulta.

## Lo que este sistema no va a hacer

- **No inventará historia.** Lo que no se registró, no se reconstruye.
- **No mezclará estimaciones con dinero cobrado** en la misma columna.
- **No enseñará métricas sin evidencia del proveedor** (aperturas, clics).
- **No dará por buena una cifra sin trazabilidad**: si no se puede abrir hasta
  las filas que la producen, no va en el reporte.
- **No cruzará empresas.** Ni en pantalla, ni en exportación, ni en un trabajo
  en segundo plano.
