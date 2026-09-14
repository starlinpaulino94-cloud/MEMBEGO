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
  contenedor al pintar y en `@media print` sale en blanco. Se acompañan de una
  tabla equivalente con `hidden print:block`, que además es la alternativa
  textual para lectores de pantalla.

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
frontera prohíbe.

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
| `ver_datos_personales` | Todo lo marcado 👤 |
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
