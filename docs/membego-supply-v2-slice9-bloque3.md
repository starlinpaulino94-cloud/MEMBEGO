# Membego Supply 2.0 · Slice 9 · Bloque 3

**Reconciliación de pagos externos, incidentes financieros y resolución manual auditada.**

| | |
|---|---|
| Base efectiva del bloque | `998994c5` (fusión del PR #547 en `main`) |
| Preparación | `b4f6526e` (estabilidad de pruebas, ver §1) |
| Rama | `claude/jolly-brahmagupta-dmhml9` |
| Fecha | 2026-10-02 |
| Estado | Bloque 3 terminado y verificado. **No fusionado, no desplegado.** |

---

## 1. Sincronización: lo que el historial decía de verdad

Antes de escribir una línea, la comprobación pedida. Y el resultado **no fue el
esperado**, así que conviene decirlo claro:

```
git log origin/main..claude/jolly-brahmagupta-dmhml9   →  (vacío)
git diff claude/jolly-brahmagupta-dmhml9 origin/main   →  (vacío)
git merge-base --is-ancestor rama origin/main          →  sí
```

**La rama no tenía commits propios: los bloques 1 y 2 ya estaban fusionados en
`main`** por los PR #546 y #547, y los dos árboles eran idénticos. `main` iba
«por delante» solo por esos dos commits de fusión. No hubo nada que integrar ni
ningún conflicto que resolver, y no voy a inventar un merge para que el informe
parezca más trabajado: la rama se adelantó con `merge --ff-only` a `998994c5`,
que es el **SHA base efectivo** del bloque 3.

Lo que sí preservó esa comprobación: los bloques 1 y 2 y la corrección del
vencimiento de puntos estaban todos en `main`, y ahí siguen.

### La regresión base NO estaba verde, y había que arreglarla antes

Repitiendo `npm run test:db` sobre esa base, **una de cada tres corridas
fallaba**, en dos pruebas distintas:

* `slice2 · F · el barrido expira la reserva caducada` → `0 !== 1`
* `slice3 · I · el barrido vence derechos y vouchers` → `derechosVencidos >= 1`

Misma causa en las dos, y es la tercera vez que ese patrón muerde en este Slice:
**el barrido de Supply 2.0 es global y varios archivos de prueba lo llaman en
paralelo**, así que sus contadores suman lo de todos. Si otro archivo barría
primero, la orden ya estaba expirada y el contador propio decía 0 —sin que nada
del producto estuviera mal—.

Se arregló la **familia** y no la instancia: las cuatro aserciones sobre
contadores globales pasan a comprobar el **efecto** sobre la fila que cada
prueba posee. Commit `b4f6526e`, **solo pruebas**. Después: **254 pasan, 0
fallan, tres corridas seguidas**. Con eso ya se podía empezar.

---

## 2. El modelo de incidentes que había

```prisma
model SupplyV2FinanceIncident {
  supplierId String                      // NOT NULL
  type   SupplyV2FinanceIncidentType     // UN valor: REDEMPTION_REVERSED_AFTER_PAYMENT
  status SupplyV2FinanceIncidentStatus   // OPEN | RESOLVED
  obligationId String?  redemptionId String?
  currency String  amount Decimal(14,2)
  notes String                           // por qué se abrió (obligatorio)
  resolvedById/resolvedAt/resolutionNotes
  @@index([supplierId, status])
}
CHECK (amount >= 0 AND (status <> 'RESOLVED' OR resolvedById IS NOT NULL AND resolvedAt IS NOT NULL))
```

**Invariantes que sostenía**: todo incidente tiene proveedor; todo incidente
tiene importe no negativo y una nota que explica por qué se abrió; uno resuelto
tiene nombre y fecha de quien lo resolvió.

**Consumidores auditados** (cuatro, y ninguno se rompió):

| Quién | Qué hace |
|---|---|
| `finance/obligations.ts` | el **único** que los crea, al reversar una entrega ya pagada |
| `finance/incidents.ts` | `resolverIncidenciaFinancieraEnTx`: exige actor y nota |
| `finance/queries.ts` | el contador de abiertas y la lista paginada del panel |
| `core/catalogo.ts` | las etiquetas legibles de tipo y estado |

**Por qué `supplierId` era obligatorio**: porque el único tipo existente habla de
una **obligación con un proveedor** —dinero que Membego le debe a alguien
concreto—. Cuando se creó, el proveedor siempre se conocía. No era una
restricción arbitraria: era verdad para el único caso que había.

---

## 3. Por qué se extendió, y no se creó otro modelo

Un aviso de pago de una pasarela **es** un incidente financiero: algo sobre
dinero que una persona tiene que mirar y resolver, con estado, severidad, nota y
responsable. Crear `SupplyV2PaymentIncident` en paralelo habría dado dos tablas
con el mismo ciclo de vida, dos paneles, dos contadores de «abiertos» y dos
sitios donde arreglar el siguiente fallo.

Lo que **no** es verdad de un pago externo es el `supplierId` obligatorio, y ahí
estaba el problema estructural. Se eligió la **Opción A** del encargo:

```
supplierId String?   +   CHECK condicionado al tipo
```

```sql
CHECK (
  (type <> 'REDEMPTION_REVERSED_AFTER_PAYMENT' OR "supplierId" IS NOT NULL)
  AND (type <> 'EXTERNAL_PAYMENT_MISMATCH' OR (provider IS NOT NULL AND "reasonCode" IS NOT NULL))
  AND (type <> 'EXTERNAL_PAYMENT_MISMATCH' OR status <> 'RESOLVED' OR resolution IS NOT NULL))
```

* **La regla del Slice 5 no se pierde**: un incidente de proveedor sigue
  exigiendo proveedor. Lo que antes sostenía el `NOT NULL` lo sostiene ahora el
  `CHECK`, y hay prueba que lo intenta violar con SQL crudo.
* **Un incidente de pago externo exige lo que lo hace investigable**: de quién
  vino y por qué no cuadra.
* **Cerrarlo exige decir cómo**, y solo para el tipo nuevo: lo histórico se
  resolvió cuando esa columna no existía y no se le impone una decisión
  retroactiva.
* **Ningún «proveedor sistema» inventado.** Rellenar la clave foránea con una
  fila ficticia sería mentir en el modelo y contaminar todo informe por
  proveedor con filas que no son de nadie.

**Un solo tipo nuevo**, `EXTERNAL_PAYMENT_MISMATCH`, con el motivo concreto en
`reasonCode` (texto, no enum). Los seis casos del encargo —monto, moneda, orden
inexistente, conflicto de estado, transacción duplicada— caben en un tipo
estable más un motivo; seis tipos de enum serían seis migraciones futuras y una
lista que se queda corta el día que una pasarela invente el séptimo desacuerdo.

**`INVESTIGATING` sí; `IGNORED` no.** El estado intermedio hace falta: distingue
un incidente que alguien está mirando de uno que nadie ha abierto, y evita que
dos personas investiguen lo mismo sin saberlo. `IGNORED` **no se añadió**, y es
deliberado: un falso positivo se **resuelve** —con nombre, fecha y nota— usando
`resolution = MARK_FALSE_POSITIVE`. Tener dos formas de decir «ya está»
obligaría a cada consulta de incidentes abiertos a conocer las dos, y la primera
que se olvidara dejaría trabajo invisible.

---

## 4. La conciliación: entidad propia, y por qué

Antes de crear tabla se auditó `SupplyV2Reconciliation` (Slice 4/5). **No
encaja**, en los cinco ejes que importan:

| | `SupplyV2Reconciliation` | conciliación de pasarela |
|---|---|---|
| unidad | un **periodo** (`@@unique([supplierId, kind, periodStart, periodEnd])`) | **una transacción** |
| contraparte | un proveedor (`supplierId` NOT NULL) | una pasarela; **puede no haber proveedor** |
| dirección del dinero | lo que Membego **debe** al proveedor | lo que el **cliente paga** a Membego |
| quién la crea | una persona (`createdById` NOT NULL) | una máquina (el webhook, el barrido) |
| identidad | `(proveedor, tipo, periodo)` | `provider + transacción` |

Meterlo ahí habría pedido `supplierId` opcional, `createdById` opcional, un
tercer `kind`, romper la clave única del periodo y seis columnas nuevas que
serían NULL en todas las filas existentes. **Eso no es extender un modelo: es
vaciarlo de significado para que acepte otro.** El encargo lo decía
—«no mezcles conciliación de settlement con conciliación de gateway si
semánticamente no encajan»— y aquí no encajan.

`SupplyV2PaymentReconciliation` contesta todas las preguntas pedidas:
`provider`, `externalTransactionId`, `externalEventRowId`, `orderId?`,
`expectedAmount?`, `reportedAmount?`, `expectedCurrency?`, `reportedCurrency?`,
`differenceAmount`, `internalStatus`, `externalStatus`, `outcome`, `reasonCode`,
`severity`, `checkedAt`, `incidentId?`, más `checks` y `correlationId`.

**Se refresca, no se duplica.** La identidad es `provider:referencia:orden`: ver
cinco veces el mismo webhook no son cinco comprobaciones, es la misma mirada
repetida, y `checks` dice cuántas veces se miró.

**Y es más que un registro**: la tabla de comprobaciones es el **registro de
asociaciones aceptadas**. Cada pago que cuadra deja una fila `MATCHED` con su
transacción y su compra, y eso es exactamente lo que permite detectar, la
próxima vez, que una transacción ya se usó (§7).

---

## 5. La matriz de estados

Función pura en `operations/conciliacion-dominio.ts`:

```ts
reconciliarEstadoPago(interno, externo) → { resultado, motivo, severidad, explicacion }
//                                          MATCHED | MISMATCH | WAITING | IGNORED
```

| Interno | Externo | Resultado | Motivo | Sev. |
|---|---|---|---|---|
| PAID | PAID (importe igual) | **MATCHED** | — | LOW |
| PENDING / AWAITING_PAYMENT | PAID (importe igual) | **MISMATCH** | STATE_CONFLICT | MEDIUM |
| PAID | PENDING / UNKNOWN | **MISMATCH** | STATE_CONFLICT | HIGH |
| PAID | FAILED | **MISMATCH** | STATE_CONFLICT | HIGH |
| PENDING | FAILED | **MATCHED** | — | LOW |
| PENDING | PENDING / UNKNOWN | **WAITING** | — | LOW |
| CANCELLED / EXPIRED / PAYMENT_REJECTED | PAID | **MISMATCH** | STATE_CONFLICT | HIGH |
| UNKNOWN (no existe la compra) | PAID | **MISMATCH** | UNKNOWN_ORDER | HIGH |
| UNKNOWN | FAILED / PENDING | **IGNORED** | — | LOW |
| cualquiera | PAID, importe distinto | **MISMATCH** | AMOUNT_MISMATCH | HIGH |
| cualquiera | PAID, otra moneda | **MISMATCH** | CURRENCY_MISMATCH | HIGH |

**El orden de la matriz es parte de la decisión**, y está documentado en el
código: sin compra no hay con qué comparar; el desacuerdo de **estado** se
decide antes del monto (si él dice FALLIDO y nosotros PAGADO, comparar importes
sería contestar la pregunta equivocada); y el dinero solo se compara cuando los
dos lados afirman que hubo cobro.

**Las dos direcciones cuentan.** `PAID / UNKNOWN` —nosotros cobramos, la
pasarela no sabe nada— es `HIGH`, no «se ignora»: si acaba en nada, es dinero
que Membego entregó sin haber cobrado. Es la dirección que se suele olvidar.

**Una prueba comprueba que la matriz es total**: las 28 combinaciones de
7 estados internos × 4 externos tienen veredicto, explicación en palabras, y
motivo si y solo si es `MISMATCH`.

---

## 6. Monto y moneda

**Nunca con `Number`.** Los importes viajan en `Decimal` o en texto y se
comparan con `montoCuadra` —el **mismo** criterio que el checkout, un centavo de
tolerancia—. Pasarlos por coma flotante es cómo aparecen las diferencias de un
centavo que nadie sabe explicar.

```
1000.00 DOP vs 1000.00 DOP  → MATCHED
1000.00 DOP vs  999.00 DOP  → MISMATCH · AMOUNT_MISMATCH   · HIGH
1000.00 DOP vs 1000.00 USD  → MISMATCH · CURRENCY_MISMATCH · HIGH
1000.00 DOP vs    (sin importe) → MISMATCH · AMOUNT_MISMATCH · MEDIUM
```

La moneda se decide **antes** del importe: con otra moneda y otro importe, el
motivo es la moneda, porque comparar importes entre monedas distintas no
significa nada. Y `differenceAmount` se guarda en la dirección útil
(`reportado − esperado`): negativo es «cobró de menos».

---

## 7. Identidad del incidente, y la transacción duplicada

```
claveDeIncidente = provider : (transacción | evento) : orden : motivo
```

Único en la base (`dedupeKey`, NULL en todo lo histórico: PostgreSQL admite
varios NULL en un índice único, así que el pasado no se altera). **No** incluye
el `correlationId` ni la fecha —el mismo problema visto otra vez es el mismo
problema— y **sí** incluye el motivo, porque «el monto no cuadra» y «la moneda
no cuadra» sobre la misma transacción son dos cosas que un operador quiere ver
por separado.

La carrera entre dos detecciones simultáneas la resuelve el índice único, y el
que pierde vuelve a leer y devuelve el incidente del que ganó. **Nunca se
reabre un incidente resuelto** porque el proveedor repita el webhook: eso
borraría el trabajo de quien lo cerró.

**La transacción duplicada** (§15) es su propio caso porque no se deduce de la
matriz: los dos lados pueden cuadrar perfectamente y seguir siendo grave. Un
identificador de transacción es único en el sistema del proveedor; verlo en dos
compras significa que se reutilizó, que el proveedor se equivocó, o que estamos
a punto de dar por pagadas **dos compras con un solo cobro**.

Se comprueba **antes de confirmar**, y ese orden es la regla: una vez pagada la
compra, descubrir que el cobro era de otra es un problema que ya costó dinero.
La primera asociación se conserva, la segunda se rechaza con incidente `HIGH`, y
la consulta va dentro de la transacción del procesador, detrás del candado que
ya tiene sobre la orden.

---

## 8. Resolución, actor humano y el servicio oficial

```
OPEN → INVESTIGATING → RESOLVED
```

Toda resolución guarda `resolvedById`, `resolvedAt`, `resolution` y
`resolutionNotes`. **La nota es obligatoria** y se comprueba (vacía o solo
espacios, se rechaza).

Cuatro resoluciones, y **solo una mueve dinero**:

| Resolución | Qué significa | ¿Mueve dinero? |
|---|---|---|
| `ACCEPT_INTERNAL` | lo nuestro es correcto | no |
| `ACCEPT_EXTERNAL` | la evidencia externa es correcta | **sí, por el servicio oficial** |
| `MARK_FALSE_POSITIVE` | no había problema | no |
| `MANUAL_CORRECTION_REQUIRED` | hace falta una corrección fuera de este flujo | no |

**`ACCEPT_EXTERNAL` no es un `UPDATE`.** Ejecuta `confirmarPagoEnTx` —el
servicio oficial— con su candado sobre la orden, su validación de importe, su
emisión de derechos, su reconocimiento económico y su bitácora, y apunta el
efecto en el outbox para que el cliente reciba su aviso. Un `UPDATE` directo a
`paymentStatus` saltaría las cinco cosas y dejaría una compra pagada **sin
derechos**: un cliente que pagó y no recibe nada.

Dos salvaguardas más, las dos probadas:

* **Hay que escribir el importe que se autoriza.** No se toma del incidente:
  quien autoriza un cobro escribe la cifra.
* **Si ese importe no cuadra con la compra, el servicio oficial lo rechaza.**
  Aceptar la evidencia externa no es poder cobrar cualquier cifra.
* **Sin compra a la que apuntar, no se confirma nada** y no se inventa una
  orden: ese incidente se cierra con otra resolución.

### Segregación (§12)

```
la cuenta de la INTEGRACIÓN  →  procesa eventos
una PERSONA autorizada       →  investiga y resuelve
```

Y se **comprueba**, no se confía. Tres condiciones en el servicio:

1. hay actor —sin nombre no hay resolución—;
2. **no es `SUPPLY_V2_WEBHOOK_ACTOR_ID`**: quien procesa el webhook no cierra la
   investigación sobre lo que él mismo procesó;
3. su rol tiene `SUPPLY_V2_PAYMENT_INCIDENT_RESOLVE`, consultado en la base.

La tercera va en el **servicio** y no solo en la acción a propósito: una
comprobación que solo vive en la capa de servidor de Next se la salta cualquier
otro camino —un cron, un script, una prueba— y los permisos que solo se cumplen
por costumbre no son permisos.

El permiso es **nuevo y específico**: `SUPPLY_V2_SETTLEMENT_APPROVE` es sobre
liquidaciones con un proveedor y `SUPPLY_V2_OFFER_MANAGE` es confirmar un pago
de cliente; decidir sobre una discrepancia con una pasarela es otra cosa.

**La suite de pruebas tuvo que separar las dos cuentas** para pasar: `ctx.ops` es
la integración y `ctx.finanzas` la persona. Eso no fue un ajuste cosmético —fue
la regla rechazando el primer diseño de las pruebas, que las confundía—.

---

## 9. Integración con el inbox (§13, §14)

En la rama de rechazo del procesador, **dentro de la misma transacción**, para
que el rechazo y su explicación sean la misma escritura:

| Código del bloque 2 | Clase | ¿Incidente? |
|---|---|---|
| `MONTO_NO_CUADRA` | INCIDENTE | **sí** · AMOUNT_MISMATCH |
| `MONEDA_NO_CUADRA` | INCIDENTE | **sí** · CURRENCY_MISMATCH |
| `ORDEN_DESCONOCIDA` / `SIN_REFERENCIA` | INCIDENTE | **sí** · UNKNOWN_ORDER |
| `ESTADO_IMPOSIBLE` | INCIDENTE | **sí** · STATE_CONFLICT |
| `ORDEN_YA_PAGADA` | DESCARTABLE | no |
| `TIPO_NO_MANEJADO` | DESCARTABLE | no |
| firma inválida · replay · cuerpo inválido · proveedor desconocido | — | **no, nunca** |

Lo de la puerta **no llega** a la conciliación: se rechaza antes de tocar la
base, no tiene estado externo que comparar y no puede abrir un incidente
financiero. Es seguridad de la integración, no finanzas, y mezclarlas llenaría
la cola de finanzas de basura de entrada. Hay prueba que lo comprueba contando
incidentes antes y después de cuatro intentos de la puerta.

**El evento sin orden** (§14) queda rechazado **y** con incidente sin `orderId`
—el modelo extendido lo soporta—, sin inventar una compra y sin proveedor
ficticio.

Y el camino feliz también concilia: un pago aceptado deja su fila `MATCHED`, que
es lo que hace detectable el duplicado siguiente.

---

## 10. Reconciliación programada y manual (§16, §17)

**El barrido** mira los eventos externos recientes —incluidos los que se
procesaron bien, porque un evento `PROCESSED` cuya orden alguien canceló después
es justo el desacuerdo que nadie descubre hasta que falta dinero—, concilia y,
si no cuadra, abre el incidente. **No corrige.** Una segunda pasada no abre
incidentes nuevos.

**La conciliación manual** responde a las tres preguntas que alguien se hace de
verdad: `orderId` («¿qué pasó con esta compra?»), `externalTransactionId`
(«¿qué pasó con este cobro?») y `provider` («¿está todo bien con esta
pasarela?»). Sin criterio, falla en vez de barrer todo.

**El puerto de pasarela** (`PuertoDePasarela`) define el contrato
—`listarTransacciones`, `buscarTransaccion`— y se implementa con el inbox, que
es lo que `TEST_GATEWAY` nos dijo, firmado y verificado. **Lo que esto no
detecta**, y queda dicho: un cobro que la pasarela hizo y del que **nunca nos
avisó**. Para eso hace falta su API; el puerto está listo para recibirla sin
tocar el dominio. No se finge una integración que Supply no tiene.

---

## 11. Migraciones

Dos, **aditivas**, y ninguna anterior editada:

* `20261027_..._bloque3_enums` — `EXTERNAL_PAYMENT_MISMATCH`, `INVESTIGATING`,
  los enums de severidad y resolución, y **dos** acciones de bitácora
  (`SUPPLY_V2_PAYMENT_RECONCILIATION_CREATED`,
  `SUPPLY_V2_FINANCE_INCIDENT_INVESTIGATING`). `_INCIDENT_CREATED` y
  `_INCIDENT_RESOLVED` ya existían del Slice 5 y **se reutilizan**: no se
  duplican acciones.
* `20261028_..._bloque3` — relaja `supplierId`, añade once columnas, el `CHECK`
  condicionado, seis índices, la tabla de comprobaciones con su `CHECK` y sus
  claves foráneas.

**Las filas históricas se preservan**, y hay prueba que las lee: siguen con su
proveedor, con `severity = MEDIUM` por defecto —honesto: nadie se la asignó, y
la del medio no miente en ninguna dirección—, sin `resolution` y sin
`dedupeKey`.

**RLS Capa 2 · una consecuencia que había que atender.** Al hacer `supplierId`
opcional, `supply_v2_finance_incidents` **perdió su política derivada**: la
derivación solo sigue claves foráneas `NOT NULL`. Sin hacer nada, RLS habría
denegado la tabla entera y **el panel de incidencias del Slice 5 habría
aparecido vacío sin un solo error en los logs**. Se declara a mano con la misma
forma que tenía, más la condición que la columna opcional exige:

* **con proveedor** → se ve si su proveedor se ve (igual que antes);
* **sin proveedor** → solo en modo omnisciente, que es lo que le corresponde a
  un incidente de plataforma.

Y `supply_v2_payment_reconciliations` queda **solo omnisciente**, por los mismos
motivos que el inbox y el outbox del bloque 1.

---

## 11 bis. Archivos

### Nuevos

| Archivo | Líneas | Qué es |
|---|---|---|
| `src/modules/supply-v2/operations/conciliacion-dominio.ts` | 382 | La matriz de estados, el emparejamiento de dinero, la identidad del problema y las resoluciones. Puro. |
| `src/modules/supply-v2/operations/conciliacion.ts` | 488 | Conciliar, abrir el incidente idempotente, detectar la transacción ya usada, y los read models del futuro panel. |
| `src/modules/supply-v2/operations/resolucion.ts` | 285 | Investigar y resolver: actor humano, permiso en la base y el servicio financiero oficial. |
| `src/modules/supply-v2/operations/barrido-conciliacion.ts` | 281 | El barrido, la conciliación a petición y el puerto implementado con el inbox. |
| `src/modules/supply-v2/operations/pasarela.ts` | 63 | El contrato `PuertoDePasarela` y la traducción de estados. |
| `prisma/migrations/20261027_..._bloque3_enums/migration.sql` | 29 | Los enums y las dos acciones de bitácora. |
| `prisma/migrations/20261028_..._bloque3/migration.sql` | 137 | `supplierId` opcional, el `CHECK` condicionado y la tabla de comprobaciones. |
| `tests/supply-v2-slice9-bloque3.test.ts` | 356 | 27 pruebas de dominio. |

### Modificados

| Archivo | Cambio |
|---|---|
| `prisma/schema/supply-v2.prisma` | El incidente extendido, los tres enums nuevos y `SupplyV2PaymentReconciliation`. |
| `prisma/schema/supply-v2-operaciones.prisma` · `identidad.prisma` | Back-relaciones y las dos acciones de bitácora. |
| `src/modules/supply-v2/operations/inbox.ts` | El rechazo abre incidente; el duplicado se detecta **antes** de confirmar; el pago aceptado deja su comprobación `MATCHED`. |
| `src/modules/supply-v2/core/catalogo.ts` | Etiquetas de tipo, estado, severidad, resolución y motivos. |
| `src/modules/supply-v2/finance/incidents.ts` · `queries.ts` | Adaptados a un proveedor opcional (`?? null`), sin cambiar su comportamiento. |
| `src/modules/supply-v2/contracts/gateways.ts` | El permiso `SUPPLY_V2_PAYMENT_INCIDENT_RESOLVE` con su etiqueta. |
| `src/modules/auditoria/queries.ts` | Las dos etiquetas nuevas. |
| `prisma/migrations_manual/2026-07-rls-capa2-aislamiento.sql` | La política explícita de incidencias y la de comprobaciones (ver §11). |
| `tests/postgres/supply-v2-slice9.db.test.ts` | +21 pruebas del bloque 3. |

**Supply V1 no se tocó.**

---

## 12. Pruebas

### Dominio — 27 pruebas (`tests/supply-v2-slice9-bloque3.test.ts`)

Los veinte puntos pedidos y algunos más: PAID/PAID · PENDING/PAID ·
PAID/FAILED · PAID/UNKNOWN (la dirección que se olvida) · CANCELLED/PAID ·
importe · importes que un `double` habría estropeado · «dice que cobró y no dice
cuánto» · moneda · el orden moneda-antes-que-importe · diferencia con signo ·
orden desconocida · sin compra y sin cobro · transacción duplicada · severidad ·
los cinco motivos con etiqueta · identidad del incidente · identidad sin
transacción · estados vivos y la ausencia deliberada de `IGNORED` · las cuatro
resoluciones y cuál mueve dinero · traducción del estado externo sin adivinar ·
lectura del pago interpretado (el defecto del bloque 1 que no se reintroduce) ·
los fallos de la puerta no son motivos financieros · **la matriz es total en sus
28 combinaciones**.

### PostgreSQL — 21 pruebas nuevas, en el archivo del Slice 9

En el mismo archivo por lo mismo que el bloque 2: las pruebas de un archivo
corren en serie y las de archivos distintos en paralelo; dos archivos tocando el
mismo inbox, outbox e incidentes se robarían las filas.

| Caso pedido | Prueba | Resultado |
|---|---|---|
| **A** · importe | `B3·A` | 1 incidente OPEN · AMOUNT_MISMATCH · HIGH · compra intacta (PENDING, 0 derechos, 0 efectos) · comprobación con los dos lados y `-100.00` de diferencia |
| **B** · moneda | `B3·B` | incidente OPEN · CURRENCY_MISMATCH · compra intacta |
| **C** · orden desconocida | `B3·C` | incidente OPEN con **`orderId` NULL** y `supplierId` NULL |
| **D** · webhook ×5 | `B3·D` | **1 incidente**, 1 comprobación; la 2.ª a la 5.ª son `EVENT_REPEATED` |
| **D'** · conciliar dos veces | `B3·D` (2.ª) | 1 fila con `checks = 2`: se refresca, no se duplica |
| **E** · transacción en dos compras | `B3·E` | primera **conservada** (PAID, 1 derecho) · segunda **rechazada** (PENDING, 0 derechos) · incidente DUPLICATE_TRANSACTION HIGH que dice de qué compra era |
| **F** · resolución humana | `B3·F` | OPEN → INVESTIGATING → RESOLVED con nota, auditado; investigar dos veces es idempotente |
| **F'** · sin nota | `B3·F` (2.ª) | se rechaza; el incidente no se mueve |
| **G** · no autorizado | `B3·G` | sin actor · **la cuenta de la integración** · un usuario sin permiso · un usuario inexistente: los cuatro fallan y el incidente sigue OPEN |
| **H** · ACCEPT_EXTERNAL | `B3·H` | pasa por `confirmarPagoEnTx`: **1 pago, 1 juego de derechos, 1 evento económico, 1 efecto**; sin importe falla; con importe que no cuadra, **el servicio oficial lo rechaza** |
| **H'** · sin orden | `B3·H` (2.ª) | no puede confirmar nada y no inventa una compra |
| **I** · resolver dos veces | `B3·I` | idempotente: la primera decisión manda y **no se ejecuta un segundo cobro** |
| **J** · errores no financieros | `B3·J` | firma inválida, replay, cuerpo ilegible y proveedor desconocido → **0 incidentes financieros** |
| **J'** · descartables | `B3·J` (2.ª) | orden ya pagada y tipo no manejado → sin incidente |
| **§23** · dos detecciones | `B3·§23` | tres conciliaciones simultáneas → **1 incidente**, 1 comprobación |
| **§23** · dos personas | `B3·§23` (2.ª) | una gana, la otra ve el estado final, **UNA sola corrección**: 1 derecho, 1 evento económico, 1 efecto |
| Invariantes SQL | `B3 · los CHECK…` | cinco intentos con SQL crudo rechazados |
| Historia | `B3 · los incidentes históricos…` | intactos |
| Barrido | `B3 · el barrido…` | revisa, abre uno, no corrige, y la 2.ª pasada no abre nada |
| Manual | `B3 · la conciliación manual…` | por compra, por transacción y por pasarela; sin criterio, falla |
| Lectura | `B3 · las consultas…` | por estado, severidad, compra, transacción, hilo y pasarela, más el resumen |

---

## 13. Invariantes que sostiene PostgreSQL

```sql
-- Un incidente de proveedor SIGUE exigiendo proveedor; uno de pago externo
-- exige de quién vino y por qué; y cerrarlo exige decir cómo.
CONSTRAINT supply_v2_finance_incidents_shape_slice9 CHECK (...)

-- El mismo problema no se abre dos veces.
UNIQUE (dedupeKey)   -- NULL en todo lo histórico

-- Una comprobación que no cuadra tiene que decir por qué, y el veredicto solo
-- puede ser uno de los cuatro que la matriz pura sabe dar.
CONSTRAINT supply_v2_payment_reconciliations_shape CHECK (
  checks >= 1
  AND outcome IN ('MATCHED','MISMATCH','WAITING','IGNORED')
  AND (outcome <> 'MISMATCH' OR "reasonCode" IS NOT NULL))

UNIQUE (dedupeKey)   -- comprobar dos veces lo mismo deja una fila
```

---

## 14. Controles ejecutados

| Control | Resultado |
|---|---|
| `npx tsc --noEmit` | **0 errores** |
| ESLint sobre lo nuevo y lo tocado | **0 avisos** |
| `npm test` | **3509 pasan**, 0 fallan, 6 omitidas |
| `npm run test:db` ×3 | *(ver nota al final del informe)* |
| Suite del Slice 9 (bloques 1+2+3) | **56/56 en tres corridas seguidas** |
| Dominio del bloque 3 | 27/27 |
| `scripts/transacciones-anidadas.mjs` | ninguna |
| Deriva de esquema | **No difference detected** |
| Base **nueva** + `migrate deploy` ×2 | aplicada · sin pendientes · sin deriva · los `CHECK` presentes |
| Sello de migraciones | 182 selladas |
| Preflight de RLS Capa 2 | pasa (con la decisión explícita de §11) |
| Permisos | `SUPPLY_V2_PAYMENT_INCIDENT_RESOLVE` en el catálogo, con etiqueta |
| Etiquetas de bitácora | las dos nuevas puestas; `_CREATED` y `_RESOLVED` reutilizadas |
| `nucleo-sin-verticales.mjs` · `acoplamiento-vertical.mjs` | salen 0 |
| Supply V1 | intacto |

**`npm run lint` sigue fallando en este entorno** por el plugin `react-hooks`,
igual que en los bloques 1 y 2 y **también sobre la base limpia**. No se presenta
como éxito: el lint se ejecutó pasando las rutas, que sí funciona.

---

## 15. Riesgos y limitaciones que quedan

1. **La conciliación es contra lo que la pasarela NOS DIJO, no contra lo que
   cobró.** El puerto está definido y el día que haya una API se enchufa sin
   tocar el dominio, pero hoy un cobro del que nunca nos avisaron no se detecta.
   Es la limitación más importante del bloque y no tiene arreglo sin la API.
2. **El barrido no está enganchado al cron.** El servicio existe y se prueba,
   pero nada lo dispara solo todavía: la conciliación ocurre en el camino del
   webhook y a petición. Engancharlo es una línea en el cron del Slice 9 y se
   dejó fuera a propósito para no mezclarlo con el bloque de operaciones.
3. **Nadie ve los incidentes todavía.** Están en la base, auditados, con todas
   las consultas listas —por estado, severidad, compra, transacción, hilo y
   pasarela— pero **sin pantalla**, como se acordó. Es lo primero del bloque 4.
4. **`MANUAL_CORRECTION_REQUIRED` no hace nada todavía.** Cierra el incidente
   diciendo la verdad —«esto necesita una corrección que este flujo no puede
   hacer»— y ahí acaba. El flujo de corrección es trabajo futuro.
5. **La severidad es fija por motivo.** No hay forma de subirla o bajarla a mano.
   Cuando haya panel se verá si hace falta.
6. **Un incidente resuelto no se reabre automáticamente.** Si el mismo problema
   vuelve, la comprobación se refresca y apunta al incidente cerrado, pero nadie
   recibe un aviso. Las alertas son del bloque 4.
7. **`SupplyV2Reconciliation` (proveedores) y la nueva tabla no se cruzan.** Son
   mundos distintos a propósito; si algún día hace falta una vista unificada,
   habrá que escribirla.

---

## 16. CardNET, otra vez aparte

Sin cambios respecto al bloque 2, y conviene repetirlo porque este bloque toca
dinero: **Supply 2.0 no cobra con CardNET.** El registro de proveedores no lo
conoce, el endpoint le contesta 404, la integración de V1 **no se tocó**, no se
ejecutó ninguna prueba QA contra CardNET y **ninguna prueba suya se marca como
aprobada**. El proveedor de las pruebas es `TEST_GATEWAY` con un secreto que se
genera por corrida.

---

## 17. Criterio de cierre

> Un evento externo que no coincide con la realidad interna no modifica
> silenciosamente dinero. Membego detecta la discrepancia, abre exactamente un
> incidente financiero, conserva el vínculo con el evento y la orden cuando
> existe, permite que una persona autorizada lo investigue y lo resuelva
> mediante los servicios financieros oficiales, y toda la historia queda
> auditada.

Demostrado: `B3·A`, `B3·B`, `B3·C` (detecta y abre, sin tocar la compra) ·
`B3·D` y `B3·§23` (**exactamente uno**, aunque llegue cinco veces o se detecte
en paralelo) · `B3·A` (vínculo con el evento, la orden y el hilo) · `B3·F` y
`B3·G` (una persona autorizada, y solo ella) · `B3·H` (resuelto **por el
servicio oficial**: 1 pago, 1 juego de derechos, 1 evento económico) · `B3·I`
(resolver dos veces no cobra dos veces) · y bitácora en los tres momentos:
conciliación creada, incidente abierto, en investigación y resuelto.

**No se construyó nada del Centro de Operaciones.** El bloque 4 es panel,
health/readiness, flags y kill switches, alertas y búsqueda operativa.
