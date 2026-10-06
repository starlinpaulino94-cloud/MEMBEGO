# Membego Supply 2.0 · Slice 9 · Bloque 1

**Idempotencia externa, inbox, outbox transaccional, reintentos y dead letter.**

| | |
|---|---|
| Base | `4283786a` (fusión del PR #544, Slice 8 completo) |
| Rama | `claude/jolly-brahmagupta-dmhml9` |
| Commit del bloque | `929ec900` |
| Fecha | 2026-10-02 |
| Estado | Bloque 1 terminado y verificado. **No fusionado, no desplegado.** |

---

## 1. Qué se puede demostrar hoy y antes no

Un aviso de pago externo puede:

* llegar **una vez** → se procesa;
* llegar **repetido** → es la misma fila y no vuelve a entrar al camino del dinero;
* llegar **cinco veces a la vez** → sigue siendo una fila y un solo cobro;
* **fallar** al procesarse → se reprograma con la escalera compartida;
* **reintentarse** → acaba bien sin duplicar nada;
* **morir** tras ocho intentos → queda con quién, qué, cuántas veces, qué error y
  quién lo reintentó a mano.

Y en ninguno de esos caminos se duplica dinero, derechos, obligaciones ni
eventos económicos. Un evento que **no cuadra** —otro importe, otra moneda, una
orden que no existe, un estado imposible— no modifica nada: queda rechazado con
su código y su rastro en la bitácora.

---

## 2. Infraestructura reutilizada (no se construyó nada paralelo)

| Lo que hacía falta | Lo que ya existía y se usó |
|---|---|
| Escalera de reintentos | `src/modules/integraciones/reintentos.ts` — 8 intentos, de 30 s a 24 h, con jitter de ±20 %. La misma que usan las dos colas de salida de Connect. |
| Entrega fuera de la transacción | `src/modules/jobs/cola.ts` (`encolar`), con deduplicación, reintentos de QStash y dead letter en `trabajos_muertos`, que ya tiene panel para reencolar. |
| Bitácora | `auditarEnTx`, como todo Supply 2.0. Ocho acciones nuevas, todas con etiqueta legible en `ACCION_LABEL`. |
| Transacciones y aislamiento | `sinEmpresa` / `Tx` de `src/lib/tenant.ts`. |
| Máquinas de estado | `puedeTransicionar` / `Transiciones<E>` de `src/modules/supply-v2/core/estados.ts`. |
| Errores de dominio | `fallo(codigo, mensaje)` de `core/errores.ts`. |

**Una segunda escalera de reintentos habría sido una segunda promesa, distinta
de la primera, sobre cuándo Membego se rinde.** Por eso no se escribió.

### Lo que NO se pudo reutilizar, y por qué

El razonamiento queda escrito en `prisma/schema/supply-v2-operaciones.prisma`
para que nadie las una más adelante creyendo que fue un descuido:

* **`WebhookEntrante`** (Connect) no es un inbox de eventos: es el **endpoint**
  que una empresa configuró —nombre, slug, prefijo, secreto con scrypt, contador
  de recibidos—. Guarda la puerta, no lo que entró por ella.
* **`ClaveIdempotencia`** no puede ser la identidad de un evento externo: su
  clave es `(sistemaId, clave)` con `sistemaId` **obligatorio** hacia
  `SistemaConectado` —una pasarela de pago no es un satélite con usuarios SSO y
  credenciales—, y lo que guarda es una **respuesta HTTP con caducidad**: es una
  caché de respuestas de API, no un registro de proceso con estados.
* **`EventoSaliente`** no puede ser el outbox de Supply: cuelga de
  `SistemaConectado` con `onDelete: Cascade`, su identidad es
  `(sistemaId, domainEventId)` y su worker resuelve **la URL y el secreto del
  satélite** para entregar. El destino de un efecto de Supply no es la URL de un
  satélite: es un trabajo de la cola.

---

## 3. Orden de candados

Definido **antes** de implementar, y escrito en el esquema y en el código:

```
INBOX  (advisory lock por provider + id externo + tipo)
  → ORDEN  (FOR UPDATE)
    → oferta / lote / beneficio   (lo que ya hacía el checkout)
      → OUTBOX  (solo INSERT; nunca se bloquea)
```

* El candado del inbox es **el más externo** y solo lo pide el procesador de
  eventos externos. **Ningún checkout lo toma**, así que no puede haber abrazo
  mortal con una compra en curso.
* El advisory va **antes** del `FOR UPDATE` porque la fila puede no existir
  todavía cuando dos entregas simultáneas entran: el advisory serializa por
  identidad aunque no haya fila que bloquear.
* El outbox **nunca se bloquea**: se escribe dentro de la transacción financiera
  y se lee después, fuera de ella. El worker reclama la fila con un `UPDATE`
  condicionado al estado, no con `FOR UPDATE`, y así el outbox queda fuera del
  orden de candados compartido.
* **Sin transacciones anidadas.** Lo que falla se anota en su **propia**
  transacción, porque la que falló ya se fue atrás con el `ROLLBACK`.

---

## 4. Archivos

### Nuevos

| Archivo | Líneas | Qué es |
|---|---|---|
| `prisma/schema/supply-v2-operaciones.prisma` | 200 | Dos modelos, dos enums y el razonamiento completo. |
| `prisma/migrations/20261024_supply_v2_slice9_enums/migration.sql` | 29 | Los enums y las 8 acciones de bitácora, aparte porque PostgreSQL no puede usar un valor de enum en la transacción que lo crea. |
| `prisma/migrations/20261025_supply_v2_slice9/migration.sql` | 115 | Las dos tablas. **Aditiva**: no toca ninguna columna existente. |
| `src/modules/supply-v2/operations/domain.ts` | 339 | Puro, sin una sola consulta: identidad, huella, máquinas de estado, backoff, clasificación de fallos, validación contra la orden, saneamiento. |
| `src/modules/supply-v2/operations/inbox.ts` | 479 | Registrar, procesar con el candado puesto, anotar el fallo, reintentar a mano. |
| `src/modules/supply-v2/operations/outbox.ts` | 187 | Emitir dentro de la transacción, reclamar, entregar, reprogramar, matar, reintentar. |
| `tests/supply-v2-slice9-dominio.test.ts` | 304 | 28 pruebas de dominio. |
| `tests/postgres/supply-v2-slice9.db.test.ts` | 607 | 19 pruebas contra PostgreSQL de verdad. |

### Modificados

| Archivo | Cambio |
|---|---|
| `prisma/schema/identidad.prisma` | 8 valores de `AuditAccion` y las dos back-relaciones de `User`. |
| `prisma/schema/supply-v2.prisma` | La back-relación `externalEvents` en `SupplyV2CustomerOrder`. |
| `src/modules/auditoria/queries.ts` | Las 8 etiquetas legibles, para que no salgan en crudo ni se pierdan al filtrar. |
| `prisma/migrations_manual/2026-07-rls-capa2-aislamiento.sql` | Las dos tablas declaradas **solo omniscientes**, con el motivo (ver §7). |
| `prisma/migrations/SUMAS.txt` | Sello de las dos migraciones nuevas. |

**Supply V1 no se tocó.** Ningún archivo de `src/modules/supply/` ni de
`prisma/schema/supply.prisma` aparece en el diff.

---

## 5. Los seis casos obligatorios

| Caso | Prueba | Resultado |
|---|---|---|
| **A** · evento duplicado | `A · el mismo evento llega dos veces…` | Una fila, un pago, un derecho, un efecto. La segunda vez devuelve `REPETIDO` sin tocar el dinero. |
| **B** · cinco duplicados simultáneos | `B · cinco entregas SIMULTÁNEAS…` | Una fila (la gana una, las otras cuatro recuperan la ganadora). Cinco procesos a la vez: **un** `PROCESADO` y cuatro `REPETIDO`; un derecho, un efecto. |
| **C** · el worker falla tras la transacción | `C · el worker muere DESPUÉS de la transacción…` | El efecto quedó `PENDING`, la compra sigue `PAID`, y un worker posterior lo reclama y lo entrega. **La notificación caída no revierte la compra.** |
| **D** · el reintento funciona | `D · un fallo transitorio se reintenta y acaba bien…` | `FAILED` con `nextAttemptAt` en el futuro → reintento → `PROCESSED`, con un solo derecho y un solo efecto. |
| **E** · dead letter | `E · ocho fallos dejan al evento muerto…` | `DEAD_LETTER` con 8 intentos, `nextAttemptAt` nulo, último error saneado y auditoría. El reintento manual deja `retriedById`/`retriedAt` y su propia entrada. |
| **F** · evento inválido | 5 pruebas `F · …` | Importe, moneda, orden inexistente y evento sin referencia → **rechazados** (incidente). Orden ya pagada y tipo no manejado → **ignorados** (descartables). En los seis casos: la orden no cambia, cero derechos, cero efectos. |

Además: `G` (el índice único y los `CHECK` los sostiene la base, no el servicio),
`H` (orden de candados bajo carrera real), `I` (outbox), `J` (nada secreto se
guarda).

---

## 6. Cuatro defectos encontrados al probarlo

Los cuatro estaban en código que compilaba, pasaba el lint y «parecía» correcto.

1. **La traducción del adaptador se tiraba.** `registrarEventoExterno` recibía el
   pago ya interpretado y guardaba solo el cuerpo crudo; el procesador lo volvía
   a adivinar con *nuestros* nombres de campo. Toda pasarela que llamara
   `order_reference` a la referencia habría acabado con sus eventos marcados
   `SIN_REFERENCIA` aunque la trajeran dentro. Ahora se guardan las dos cosas
   separadas: `pago` (lo que el adaptador interpretó) y `cuerpo` (lo que llegó,
   saneado).
2. **La recuperación del duplicado se hacía dentro de la transacción abortada.**
   En PostgreSQL un `INSERT` que viola el índice único **aborta la transacción
   entera**, y Prisma no abre savepoints: la consulta siguiente respondía
   `25P02`. La quinta entrega simultánea de un webhook habría devuelto un error
   de infraestructura en vez de «esto ya llegó». **Lo encontró la prueba de
   concurrencia contra PostgreSQL; ninguna prueba unitaria podía verlo.**
3. **El tipo del evento se miraba después del dinero.** Un tipo que no manejamos
   sobre una orden con otro importe se rechazaba por `MONTO_NO_CUADRA`: un
   descuadre inventado de algo que nunca iba a mover un peso, y una pista falsa
   para quien leyera la bitácora.
4. **`sanearError(new Error(''))` devolvía vacío.** Una fila muerta con el error
   en blanco no le dice nada a quien tiene que decidir qué hacer con ella.

Y una corrección de higiene de pruebas: la suite **limpia sus filas al entrar y
al salir**. Había 405 filas heredadas de corridas anteriores, y una ventana de
reclamo acotada acaba fallando por esa basura y no por el outbox —la misma
trampa que puso el Slice 5 en rojo durante el Slice 8—.

---

## 7. Invariantes sostenidas por la base de datos

```sql
-- La identidad idempotente. Ni el SQL crudo puede saltársela.
"supply_v2_external_events_provider_externalEventId_eventTyp_key"
  UNIQUE (provider, "externalEventId", "eventType")

-- Y la del outbox.
"supply_v2_outbox_events_dedupeKey_key" UNIQUE ("dedupeKey")

-- Filas que no pueden mentir.
CONSTRAINT supply_v2_external_events_shape CHECK (
  attempts >= 0
  AND (status = 'PROCESSED') = ("processedAt" IS NOT NULL)
  AND ("retriedById" IS NULL) = ("retriedAt" IS NULL))
```

Las tres se prueban **intentando violarlas** con `$executeRaw`, saltándose el
servicio entero (pruebas `G`).

**RLS Capa 2.** Las dos tablas quedan **solo omniscientes**, declaradas a mano en
`prisma/migrations_manual/2026-07-rls-capa2-aislamiento.sql`:

* no llevan `companyId`, y no es un olvido: un aviso de pago llega a **Membego**,
  no a un inquilino;
* darles camino por `orderId` sería **peor** que no dárselo: `orderId` es `NULL`
  justo en las filas que importan al investigar —el evento que llegó con una
  referencia que no existe—, y media tabla con una regla y media con otra es
  exactamente lo que no se quiere al perseguir un pago;
* abrirlas a lectura de inquilino filtraría de una empresa a otra: el `payload` y
  el `correlationId` nombran la operación de un cliente y el proveedor que la
  sirve.

---

## 8. Controles ejecutados

| Control | Resultado |
|---|---|
| `npx tsc --noEmit` | **0 errores** |
| ESLint sobre lo nuevo y lo tocado | **0 avisos** |
| `npm test` | **3458 pasan**, 0 fallan, 6 omitidas (las mismas 6 de la base) |
| `npm run test:db` | **237 pasan**, 0 fallan — tres corridas seguidas |
| Suite del bloque contra PostgreSQL | 19/19 en **cinco corridas seguidas** (la concurrencia no es determinista: una sola corrida no demuestra nada) |
| Dominio | 28/28 |
| Deriva de esquema (`migrate diff`) | **No difference detected** |
| Sello de migraciones | 179 selladas, las dos nuevas incluidas |
| Base **nueva**, `migrate deploy` dos veces | 1.ª: todas aplicadas · 2.ª: «No pending migrations» · deriva: ninguna |
| `nucleo-sin-verticales.mjs` | sale 0 |
| `acoplamiento-vertical.mjs` | sale 0 |
| Preflight de RLS Capa 2 | pasa: ninguna tabla queda denegada sin decidir |
| Supply V1 | intacto: ningún archivo de V1 en el diff |

**`npm run lint` falla en este entorno** con «could not find plugin
react-hooks», **también en la base limpia `4283786a`** (comprobado con `git
stash`): es un problema de resolución del plugin anterior a este bloque, no un
aviso de este código. El lint se ejecutó pasando las rutas explícitamente, que
sí funciona.

---

## 9. Riesgos reales que quedan

1. **No hay endpoint HTTP todavía.** El inbox es una función, no una ruta: nadie
   puede llamarlo desde fuera, y por tanto **no hay verificación de firma**
   escrita. Mientras no exista la ruta no hay superficie expuesta; el día que se
   escriba, la firma es requisito de entrada, no un añadido.
2. **El outbox no está enganchado a la cola.** Los efectos se apuntan y se pueden
   reclamar, pero nada los entrega aún: `reclamarEfectos` → `encolar()` es
   trabajo del bloque siguiente. Hoy eso significa que un efecto apuntado se
   queda esperando, no que se pierda.
3. **No se abren incidencias financieras.** `SupplyV2FinanceIncident` exige
   `supplierId` y un tipo de su enum; un evento externo que no cuadra puede no
   tener proveedor resoluble. Hoy queda **rechazado con código, bitácora y cero
   efecto financiero**, que es la propiedad importante; conectarlo con la
   incidencia es parte del bloque de conciliación.
4. **Nadie ve los difuntos todavía.** Están en la base y en la bitácora con todo
   lo necesario para decidir, pero sin panel hay que mirarlos por SQL. El panel
   es del bloque de Centro de Operaciones.
5. **`reclamarEfectos` recorre candidatos de uno en uno.** Correcto y seguro —el
   `UPDATE` condicional es el candado—, pero con una cola muy larga son N
   consultas. Si el volumen lo pide, se cambia por un `UPDATE … RETURNING` con
   `SKIP LOCKED`; hoy sería optimizar sin medida.

---

## 10. Estado real de CardNET (aparte, como corresponde)

* **Supply 2.0 no cobra con CardNET.** Sus métodos de pago son
  `TRANSFER | DEPOSIT | CASH | MANUAL`. No existe un camino de tarjeta en el
  checkout de Supply, y este bloque **no lo añade**.
* **Membego V1 sí tiene integración con CardNET**, con sus propias pruebas
  (`tests/cardnet*.test.ts`). Este bloque **no la toca**.
* El inbox es **agnóstico del proveedor a propósito**: `provider` es texto y no
  un enum, así que aceptar `CARDNET` el día que haga falta **no pide una
  migración**. Pero hoy **no hay adaptador de CardNET** para Supply 2.0.
* **No se ejecutó ninguna prueba QA contra CardNET**, ni se usaron credenciales
  reales en ninguna prueba. Las pruebas usan el proveedor ficticio
  `TEST_GATEWAY`. Ninguna prueba de CardNET se marca como aprobada.

---

## 11. Lo que este bloque NO hizo (y no está marcado como hecho)

Centro de Operaciones, paneles, alertas, banderas de funcionalidad, kill
switches, automatizaciones, runbooks, E2E final del Slice 9, conciliación
completa, correo, WhatsApp, métricas y liveness/readiness separados. Todo eso es
de los bloques siguientes, tal como se acordó.
