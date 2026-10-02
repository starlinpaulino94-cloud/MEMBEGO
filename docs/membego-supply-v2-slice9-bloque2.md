# Membego Supply 2.0 · Slice 9 · Bloque 2

**Del proveedor externo al efecto entregado: endpoint HTTP, firma, replay, adaptadores, outbox → cola → worker.**

| | |
|---|---|
| Base del bloque | `bac225ba` (cierre del bloque 1) |
| Base del Slice 9 | `4283786a` (fusión del PR #544, Slice 8 completo) |
| Rama | `claude/jolly-brahmagupta-dmhml9` |
| Commit del bloque | *(ver §12)* |
| Fecha | 2026-10-02 |
| Estado | Bloque 2 terminado y verificado. **No fusionado, no desplegado.** |

---

## 1. El camino, entero y probado

```
PROVEEDOR EXTERNO
   ↓  POST /api/webhooks/supply-v2/TEST_GATEWAY   (ruta pública; la firma es la puerta)
VERIFICACIÓN DE FIRMA Y FRESCURA                  firma.ts        HMAC-SHA256 sobre el cuerpo CRUDO
   ↓                                                              + ventana de tiempo FIRMADA
ADAPTADOR                                         adaptadores.ts  su vocabulario → el nuestro
   ↓
INBOX SUPPLY V2                                   inbox.ts (B1)   identidad única provider+id+tipo
   ↓
PROCESAMIENTO IDEMPOTENTE                         inbox.ts (B1)   candado, orden, dinero, derechos
   ↓
OUTBOX                                            outbox.ts (B1)  apuntado DENTRO de la transacción
   ↓
COLA EXISTENTE                                    jobs/cola.ts    encolar() + clave de deduplicación
   ↓
WORKER                                            worker.ts       entrega FUERA de toda transacción
   ↓
EFECTO EXTERNO                                    worker.ts       aviso al cliente, idempotente
```

El bloque 1 demostraba el núcleo **llamando a las funciones**. Lo nuevo aquí es la
**frontera** que entonces no existía: una petición HTTP de verdad, firmada, que
entra por la ruta y acaba en un aviso que el cliente puede ver.

---

## 2. Endpoint HTTP

`POST /api/webhooks/supply-v2/<proveedor>` ·
`src/app/api/webhooks/supply-v2/[provider]/route.ts` (118 líneas)

* Acepta **solo POST**. `GET` responde **405** con `Allow: POST`, para que un
  proveedor mal configurado lea qué método espera la URL.
* Identifica el proveedor por la URL y **corta antes de leer el cuerpo** si no lo
  conocemos: no tiene sentido traerse 64 KB de algo que no sabremos verificar.
* Tope de tamaño **doble**: primero `content-length` (si viene y ya pasa, se corta
  sin leer) y después los **bytes reales**, porque la cabecera la pone quien llama
  y puede mentir u omitirse. Configurable con `SUPPLY_V2_WEBHOOK_MAX_BYTES`
  (64 KiB por defecto) → **413**.
* **Cuerpo crudo** con `request.text()`, nunca `request.json()`: la firma se
  calcula sobre los bytes que llegaron (ver §3).
* Lista **cerrada** de cabeceras que pasan hacia dentro. No se reenvía un mapa
  completo de cabeceras a la capa de dominio.
* `correlationId` generado o propagado (§6), devuelto en el cuerpo **y** en la
  cabecera `x-correlation-id`.

**No hay una sola decisión financiera en el route handler.** El camino
`autenticar → adaptar → registrar → procesar → contestar` vive en
`operations/entrada.ts`, que se puede ejercitar sin levantar Next. Un route
handler es el peor sitio para la lógica de dinero precisamente porque es el único
que no se puede probar desde una prueba de dominio.

La ruta es pública por necesidad —una pasarela no puede llevar credenciales
nuestras— y `/api/webhooks` **ya estaba excluido** del `matcher` del proxy de
sesión (`src/proxy.ts`), así que no hubo que tocarlo. Lo que protege la ruta no es
la sesión: es la firma.

---

## 3. Firma

Contrato genérico en `operations/firma.ts`, no acoplado a ningún proveedor:

```ts
interface VerificadorDeEventos {
  readonly provider: string
  readonly cabecerasRequeridas: readonly string[]
  verificar(p: PeticionFirmada): Promise<ResultadoVerificacion>
}
```

Implementación inicial: **`TEST_GATEWAY`**, con HMAC-SHA256 realista.

```
contenido = `${timestamp}.${cuerpo crudo}`
firma     = hex( HMAC-SHA256( secreto, contenido ) )
cabeceras = x-sv2-timestamp, x-sv2-signature: v1=<hex>
```

Decisiones que importan:

* **Se firma el cuerpo crudo.** `JSON.parse` + `JSON.stringify` cambia espacios,
  orden de claves y notación de números: la firma no cuadraría nunca y el único
  arreglo a mano sería dejar de verificarla. Probado con el caso real —firma
  auténtica, cuerpo con el monto subido— que **no** pasa.
* **Comparación en tiempo constante reutilizada**, no reescrita:
  `igualesSeguro` de `src/lib/webhooks/svix.ts`. El único cambio en ese archivo
  es exportarla (y documentar por qué). Dos implementaciones de una primitiva de
  seguridad son dos sitios donde equivocarse, y la segunda nunca recibe la misma
  atención que la primera.
* **Rotación de secretos**: `SUPPLY_V2_TEST_GATEWAY_SECRET` admite
  `viejo,nuevo`. Sin rotación, cambiar el secreto obliga a elegir entre perder
  los eventos en vuelo o dejar de verificar un rato.
* **Falla cerrado**: sin secreto configurado, la respuesta es
  `INVALID_SIGNATURE`. Una configuración olvidada deja el webhook inútil; dejar
  pasar lo dejaría abierto.
* **Primero la firma, después la ventana.** Si se mirara la ventana antes, un
  timestamp cualquiera —sin firma válida— decidiría si contestamos 400 (vencido)
  o 401 (firma mala), y eso le diría a quien está probando cuál de las dos cosas
  tiene mal. Así, `REPLAY_REJECTED` solo se puede provocar con una petición
  auténtica, que es justo lo que ese código significa. Hay prueba de ese orden.

---

## 4. Replay

Ventana configurable con `SUPPLY_V2_WEBHOOK_TOLERANCIA_S` (300 s por defecto, lo
mismo que usan Stripe, Svix y el webhook de correo que ya teníamos):

```
abs(ahora − timestampFirmado) <= tolerancia      → se procesa
fuera de ventana                                 → REPLAY_REJECTED (400)
```

Se rechaza **lo viejo y lo del futuro**: un reloj adelantado en el emisor —o un
timestamp de mañana— abriría una ventana de reenvío de duración arbitraria.

**Por qué la idempotencia del bloque 1 no basta, y hay prueba de ello.** El
índice único evita la *consecuencia* duplicada de un evento repetido. No dice
nada de un evento **reproducido**: quien capturó una petición válida de ayer y la
reenvía hoy manda un evento que nunca habíamos visto —otra identidad, otra
fila— y la idempotencia lo deja pasar tan contento. Lo que cierra eso es que el
instante va **dentro de lo firmado**, así que no se puede refrescar sin romper la
firma (probado: refrescar el timestamp da `INVALID_SIGNATURE`).

**Evidencia sin secretos.** Un replay rechazado **no** se inserta en el inbox: lo
que no está firmado y fresco no entra en la base, porque si entrara, cualquiera
podría llenar el inbox desde fuera y el panel de difuntos que viene después
sería un buzón de basura ajena. La evidencia es la línea estructurada (§7) más el
evento contable de `registrarEvento`, ninguno de los cuales tiene campo donde
quepa un secreto.

---

## 5. Adaptadores

```
raw provider event → adaptador → EventoExternoAdaptado
```

```ts
{
  provider, externalEventId, eventType,
  payment: { orderReference, amount, currency, externalTransactionId, status },
  rawSanitizedPayload
}
```

El cuerpo de prueba usa el vocabulario **de un proveedor**, no el nuestro, a
propósito —si la prueba mandara ya `orderNumber` y `PAYMENT_CONFIRMED` no
demostraría que el adaptador hace falta—:

```json
{ "event":       { "id": "evt_abc123", "kind": "payment.updated" },
  "transaction": { "id": "TX-9", "status": "APPROVED", "amount": "1000.00",
                   "currency": "DOP", "order_reference": "MBG-SO-000123" } }
```

* **El defecto del bloque 1 no se reintroduce.** Lo que el adaptador interpreta
  se guarda interpretado (`payload.pago`), y el procesador no vuelve a adivinar
  sobre el cuerpo crudo. `externalTransactionId` y `providerStatus` viajan en el
  cuerpo conservado, que es donde se miran al conciliar: no hizo falta columna
  nueva ni tocar los tipos del bloque 1.
* **El adaptador no decide nada de dinero.** Traduce y nada más. No mira si el
  monto cuadra, no busca la orden, no confirma ni rechaza: eso es del procesador,
  contra *nuestra* orden y dentro de la transacción.
* **No adivina.** Un `status` desconocido es `PAYMENT_UNKNOWN` —que el procesador
  ignora con `TIPO_NO_MANEJADO`—, nunca «aprobado porque no dice lo contrario».
  Un evento que no es de pago tampoco se interpreta como pago aunque traiga un
  estado conocido.
* **Un evento sin identidad propia se rechaza en la puerta.** Inventarle un id
  haría que dos entregas del mismo evento fueran dos cobros.
* Los importes viajan **en texto**: `1000.00` no es un `double`.

---

## 6. Códigos y política HTTP

| Código | HTTP | Por qué |
|---|---|---|
| `EVENT_ACCEPTED` | **200** | Procesado, con efecto. |
| `EVENT_REPEATED` | **200** | Ya lo teníamos resuelto. |
| `EVENT_REJECTED` | **200** | Recibido y **no** aceptado (no cuadra, o no lo manejamos). |
| `INVALID_SIGNATURE` | **401** | Puede no ser quien dice ser. |
| `REPLAY_REJECTED` | **400** | Firma buena, evento viejo. |
| `INVALID_PAYLOAD` | **400** | El cuerpo no se puede leer. |
| `UNKNOWN_PROVIDER` | **404** | Esa URL no existe para él. |
| `PAYLOAD_TOO_LARGE` | **413** | Pasa del tope. |
| `INTERNAL_ERROR` | **500** | Fallamos **nosotros**. |

**La regla es una sola:**

* **200** → nos hacemos cargo. Lo recibimos y decidimos qué hacer, **incluso si
  la decisión fue no hacer nada**. No hay nada que reintentar.
* **4xx** → el que llama está equivocado y reintentar no lo va a arreglar.
* **5xx** → fallamos nosotros y el reintento sirve de algo. **Es el único caso que
  invita a reintentar**, y hay una prueba que lo comprueba sobre la tabla entera.

El corolario incómodo, que es la decisión deliberada del bloque: **un evento
rechazado por no cuadrar responde 200.** No porque esté bien, sino porque un
4xx/5xx haría que el proveedor reintentara durante horas un evento que nunca
vamos a aceptar. El rechazo ya quedó escrito, auditado y a la espera de que una
persona lo mire; reintentarlo no lo haría cuadrar.

Y al revés: devolver 200 a un fallo transitorio nuestro tiraría el evento a la
basura —el proveedor lo daría por entregado—, y un aviso de pago perdido es un
cliente que pagó y no recibe lo que compró.

**Lo que sale en la respuesta** es el código, un mensaje de una palabra y el hilo.
Nunca el motivo: ni por qué la firma no cuadró, ni qué campo faltaba, ni si la
orden existe. Un endpoint público que explica por qué rechazó una firma le está
enseñando a afinarla a quien la está probando, y decir «esa orden no existe»
convierte el webhook en un oráculo para averiguar qué números de orden son
reales. El detalle va al log y a la bitácora, que tienen dueño.

---

## 7. Correlation ID y logs

**El hilo** (`operations/correlacion.ts`) viaja por todo el camino: petición HTTP
→ inbox → procesamiento del pago → bitácora → outbox → trabajo de la cola → logs
del worker, y vuelve en la respuesta. Reglas:

1. Si el proveedor trae uno utilizable, **se respeta** (así su rastro y el nuestro
   se cruzan).
2. Si no trae, o trae basura, **se acuña uno**. Nunca se sigue sin hilo.
3. **No es una credencial**: llega por una cabecera que cualquiera puede poner, así
   que no autoriza nada, no identifica a nadie y no elige ninguna fila. Solo se
   escribe.
4. **Se acota**: 8–64 caracteres de `[A-Za-z0-9._-]`. Sin tope, una cabecera de
   8 KB acabaría copiada en la fila del inbox, en cada efecto y en cada línea de
   log; y sin forma, un hilo con `:` o con salto de línea podría falsificar una
   clave de deduplicación o partir una línea de log en dos.

**Los logs** (`operations/log.ts`) llevan un juego de campos **fijo**: `event`,
`provider`, `externalEventId`, `correlationId`, `inboxId`, `outboxId`, `attempt`,
`status`, `errorCode`. Prefijo `sv2` para poder filtrarlos.

Se hacen **dos cosas**, cada una para lo suyo, y conviene explicar por qué no una:
`registrarEvento` de la observabilidad general existe para **contar**, y su
`extra` solo admite etiquetas (sin arroba, sin espacios, sin siete dígitos
seguidos). Esa forma es la que impide que un correo acabe en los logs —y está
bien que sea así—, pero es justo la que **descartaría** `externalEventId`,
`correlationId`, `inboxId` y `outboxId`, que son lo único con lo que se puede
seguir un pago. Así que lo contable va por `registrarEvento` y lo trazable por la
línea `sv2`.

**Lo que no puede salir**: no hay `extra` libre ni se acepta el cuerpo del
evento, así que no hay ningún campo donde quepa una firma, una cabecera de
autorización, un secreto o un payload. El único texto libre es `errorCode`, y
pasa por `sanearError`. Hay prueba de que un error que trae
`signature=…`/`token=…` sale sin ellos y con el importe intacto.

---

## 8. Outbox → cola → worker

**Despachador** (`despacharEfectos`): reclama filas y las publica en la cola que
ya existe, `encolar()` de `src/modules/jobs/cola.ts`. **No se creó otra cola.**

* La clave de deduplicación del trabajo sale de la **identidad estable** del
  outbox: `sv2out:<outboxId>:<intentos>`. Misma convención que
  `reint:` de Connect: dos publicaciones del mismo intento son un trabajo; el
  intento siguiente sí es otro mensaje.
* **Dos despachadores → un trabajo**, y no depende de la deduplicación de la
  cola: el reclamo (`UPDATE` condicionado al estado) ya lo decide antes. La
  deduplicación es el segundo cinturón.
* Si encolar falla, la fila se **devuelve** (se marca fallida con la escalera) en
  vez de quedarse reclamada. Es mejor no crear el problema que confiar en el
  rescate.
* El despacho ocurre **después** de que el dinero esté decidido y **nunca cambia
  la respuesta HTTP**: lo que se le contesta al proveedor describe qué pasó con el
  pago, no si el aviso salió. Si el despacho falla, el efecto queda apuntado y lo
  recoge el cron.

**Worker** (`entregarEfecto`, ejecutado por el caso `supply-v2-efecto` del
ejecutor de trabajos):

1. reclama de forma atómica (el despachador, con `claimedAt`);
2. ejecuta el efecto **fuera de toda transacción**;
3. marca entregado;
4. en error: sanea el error, incrementa intentos, calcula el backoff con la
   **escalera compartida** y programa el próximo intento;
5. al octavo: **dead letter**, auditado.

**Nada de transacciones abiertas mientras se llama afuera.** Se lee la fila, se
cierra la transacción, se ejecuta el efecto y se abre otra para marcar. Mantener
una transacción abierta durante una llamada externa ataría la duración del
candado a la latencia de un tercero: un proveedor lento mantendría filas
bloqueadas y uno colgado agotaría el pool de conexiones.

**El efecto concreto de este bloque** es el aviso in-app al cliente dueño de la
compra —lo que Supply 2.0 ya le debía y nunca le daba: hasta ahora confirmar un
pago no avisaba a nadie—. Correo, WhatsApp y alertas son de bloques posteriores
a propósito. Se eligió este efecto porque la tabla `notificaciones` tiene índice
único `(userId, dedupeKey)`, así que la idempotencia del efecto se puede
**demostrar**, no solo afirmar.

Se escribe la notificación directamente y **no** con `crearNotificacion`, y la
razón importa: ese ayudante se traga el error a propósito —para un aviso nacido
de un clic, no vas a tumbar una compra porque la campanita falle—, y aquí es lo
contrario: el worker existe para **reaccionar** al fallo, y un ayudante que lo
oculta dejaría la fila marcada como entregada sin que el aviso exista.

---

## 9. Crash safety

| Caso | Qué se hace | Prueba |
|---|---|---|
| **1 · el worker reclama y muere antes de llamar al destino** | `claimedAt` marca el **arriendo**; `recuperarArriendos` devuelve a la cola lo reclamado hace más de 5 min. Se trata como **fallo**, no como reclamo nuevo: consume un intento y acaba en dead letter si se repite. Devolverlo «limpio» sería un bucle infinito perfecto —una fila que mata al worker lo mataría para siempre sin que nadie se enterara—. | `B2·G` |
| **2 · el destino recibe el efecto y el proceso muere antes de marcar DELIVERED** | El efecto recibe una `idempotencyKey` **estable** (el `dedupeKey` de la fila, igual en todos los intentos). El reintento repite el efecto y **no pasa nada peligroso**: choca con el índice único y se trata como ya hecho. | `B2·F` |

También: una fila ya `DELIVERED` no se vuelve a entregar, así que el reintento de
la cola sobre un trabajo que en realidad sí funcionó no manda el aviso dos veces.

**La limitación, dicha claramente.** Esto funciona porque el destino de hoy
—nuestra propia tabla de notificaciones— **sabe deduplicar**. Un destino externo
que no soporte clave de idempotencia (un SMTP cualquiera, una API sin
`Idempotency-Key`) **puede recibir el efecto dos veces** si el proceso muere
justo entre hacerlo y marcarlo. No hay solución general a eso sin cooperación
del destino: lo que se puede hacer —y es lo que se hace— es transmitir la clave
cuando el destino la acepte, y elegir efectos idempotentes cuando no. Queda
documentado aquí para que el bloque que conecte correo lo decida a la vista.

**El arriendo no hizo falta en el inbox**, y la asimetría es deliberada: el
`PROCESSING` del inbox vive **dentro** de una sola transacción, así que un
proceso que muere lo deja en `ROLLBACK`. El del outbox existe justamente porque
la entrega ocurre fuera.

---

## 10. Migraciones

**Una columna nueva**, y hace falta por una razón concreta:

`supply_v2_outbox_events.claimedAt` — el **arriendo**. Sin esta marca, una fila
reclamada por un proceso que murió es indistinguible de una reclamada hace un
segundo, y el rescate o le roba el trabajo a un worker vivo o no corre nunca.
`availableAt` no sirve: dice cuándo se **puede** intentar, no cuándo se **tomó**,
y reutilizarla obligaría a que el reclamo moviera el futuro de la fila, que es lo
que la escalera decide.

Con ella, dos cosas más:

* `CHECK supply_v2_outbox_events_lease`: `status <> 'PROCESSING' OR claimedAt IS
  NOT NULL`. Lo reclamado **siempre** tiene marca; sin esto, una fila sin marca
  en `PROCESSING` sería invisible para el rescate, que es el fallo exacto que la
  columna cierra. Probado intentando violarlo con SQL crudo.
* Índice `(status, claimedAt)`: lo que pregunta el rescate.

`20261026_supply_v2_slice9_bloque2/migration.sql` (41 líneas) es **aditiva**:
columna que admite NULL, relleno compatible con los datos que ya hubiera
(`UPDATE … WHERE status='PROCESSING' AND claimedAt IS NULL`), un `CHECK` **propio**
y un índice nuevo. **No se editó ninguna migración anterior** ni el `CHECK` que ya
existía.

---

## 11. Archivos

### Nuevos

| Archivo | Líneas | Qué es |
|---|---|---|
| `src/app/api/webhooks/supply-v2/[provider]/route.ts` | 118 | La puerta HTTP. Cuerpo crudo, cabeceras, tamaño, respuesta. Cero lógica financiera. |
| `src/modules/supply-v2/operations/firma.ts` | 197 | Contrato del verificador, HMAC, ventana de frescura, `TEST_GATEWAY`, registro de proveedores. |
| `src/modules/supply-v2/operations/adaptadores.ts` | 181 | Contrato del adaptador, `TEST_GATEWAY`, traducción de estados, lectura defensiva. |
| `src/modules/supply-v2/operations/respuestas.ts` | 105 | Los nueve códigos y la política HTTP, con su razonamiento. |
| `src/modules/supply-v2/operations/correlacion.ts` | 59 | Las reglas del hilo. |
| `src/modules/supply-v2/operations/entrada.ts` | 331 | `autenticar → adaptar → registrar → procesar → contestar`. |
| `src/modules/supply-v2/operations/worker.ts` | 352 | Despachador, entrega, rescate de arriendos, efectos. |
| `src/modules/supply-v2/operations/log.ts` | 124 | La línea `sv2` y el evento contable. |
| `prisma/migrations/20261026_supply_v2_slice9_bloque2/migration.sql` | 41 | `claimedAt`, su `CHECK` y su índice. |
| `tests/supply-v2-slice9-bloque2.test.ts` | 446 | 24 pruebas de dominio. |

### Modificados

| Archivo | Cambio |
|---|---|
| `src/modules/jobs/tipos.ts` | Nuevo tipo de trabajo `supply-v2-efecto` (lleva el **id** de la fila, no el efecto: un reintento no debe entregar una versión vieja de algo que la base ya cambió). |
| `src/modules/jobs/cola.ts` | Su caso en `claveDedup`: `sv2out:<id>:<intentos>`. |
| `src/modules/jobs/ejecutor.ts` | Su caso: importa el worker y entrega. |
| `src/app/api/jobs/route.ts` | `'companyId' in carga ? … : null` — el efecto del outbox cuelga de una compra, no de un inquilino. Mismo idioma que ya usaba `anotarDegradacion`. |
| `src/app/api/cron/supply-v2/route.ts` | Red de seguridad: `recuperarArriendos` y después `despacharEfectos`. No es el camino normal —el normal es que la propia petición despache en segundos—; esto recoge lo que ese camino no pudo. |
| `src/modules/supply-v2/operations/outbox.ts` | El reclamo deja `claimedAt`. Es la única línea del bloque 1 que cambia, y es una extensión requerida por §8, no un refactor. |
| `src/lib/webhooks/svix.ts` | Se exporta `igualesSeguro` (una palabra) para no escribir una segunda comparación en tiempo constante. |
| `prisma/schema/supply-v2-operaciones.prisma` | `claimedAt` y su índice. |
| `tests/postgres/supply-v2-slice9.db.test.ts` | +17 pruebas del bloque 2 (ver §12). |
| `src/modules/supply-v2/loyalty/points.ts` | **Corrección aparte del Slice 8** (ver §13 bis): el barrido de vencimiento excluye los lotes ya consumidos. Una condición; nada más. |
| `tests/postgres/supply-v2-slice8.db.test.ts` | La prueba `H2b` de esa corrección, y `H2` deja de depender de cuántos lotes vivos haya acumulados. |
| `tests/postgres/supply-v2-slice3.db.test.ts` | Una prueba inestable desde antes: afirmaba sobre un contador global del barrido (ver §13 ter). Solo la prueba; nada de producción. |

**Supply V1 no se tocó.** Ningún archivo de `src/modules/supply/` ni
`prisma/schema/supply.prisma` aparece en el diff.

---

## 12. Pruebas

### Dominio — 24 pruebas (`tests/supply-v2-slice9-bloque2.test.ts`)

Cubren los doce puntos pedidos y algunos más: firma válida · firma inválida ·
**cuerpo alterado con la firma del original** · sin secreto se falla cerrado ·
rotación de secretos · ventana de frescura (bordes, futuro, `NaN`) · replay
vencido · **el orden firma-antes-que-ventana** · **la idempotencia no sustituye
al replay** · proveedor desconocido (y `CARDNET` entre ellos) · payload válido ·
siete formas de payload inválido · evento sin identidad · traducción de estados
sin adivinar · saneamiento de lo conservado · correlationId válido · once formas
de correlationId que se sustituyen · el hilo no es una credencial · la política
HTTP entera · los tres mapeos del resultado del procesador · los mensajes no
filtran interioridades · la clave del trabajo · la forma de la línea de log · que
por el log no cabe un secreto · configuración y valores por defecto.

### PostgreSQL — 17 pruebas nuevas, en el archivo del Slice 9

Van en **el mismo archivo** que las del bloque 1 a propósito: las pruebas de un
archivo corren **en serie** y las de archivos distintos **en paralelo**. Dos
archivos tocando el mismo inbox y el mismo outbox se robarían las filas —el
despachador de uno reclamaría lo que el otro está comprobando— y la limpieza de
uno borraría lo que el otro tiene en vuelo.

| Caso pedido | Prueba | Resultado |
|---|---|---|
| **A** · webhook duplicado ×5 | `B2·A` | 1 inbox · 1 pago · 1 juego de derechos · 1 efecto · **1 aviso**; un `EVENT_ACCEPTED` y cuatro `EVENT_REPEATED`, todos 200 y con el mismo hilo. |
| **B** · dos peticiones simultáneas | `B2·B` | Una procesa y la otra ve que ya estaba: **una** consecuencia financiera. |
| **C** · firma inválida | `B2·C` | **0 filas** en el inbox, orden intacta, 0 derechos, 0 efectos, 401 sin explicar por qué. Incluye el cuerpo alterado con firma del original. |
| **D** · replay | `B2·D` | 400, **0 filas** en el inbox, cero efecto financiero. Y el mismo evento con fecha de ahora **sí** entra. |
| **E** · dos despachadores | `B2·E` | La fila se encola **una** vez y se entrega una vez. |
| **F** · reintento del worker | `B2·F` | Falla → `FAILED` con hora futura → funciona → `DELIVERED`; la tercera entrega es `YA_ESTABA` y el aviso sigue siendo uno. |
| **G** · muerte y rescate | `B2·G` | Lo reclamado no se roba; lo abandonado se rescata consumiendo un intento; lo vivo se respeta; al vencer se rescata, se despacha y se entrega. Más el `CHECK` del arriendo. |
| **H** · dead letter | `B2·H` | `DEAD_LETTER` tras 8 intentos, auditado, **y la compra sigue pagada con los mismos derechos**: la muerte del aviso no deshace el dinero. |
| **§14** · integración HTTP | `B2·§14` | `POST` real contra el route handler → firma → adaptador → inbox → orden `PAID` → outbox `DELIVERED` → **notificación `PAGO_APROBADO` con el número de compra**. Más la puerta: 405, 404, 413, 400. |
| Extra | `B2·D` (2.ª) | Un evento que no cuadra entra, queda `IGNORED` con `MONTO_NO_CUADRA` y contesta **200**; nadie recibe un aviso de algo que no pasó. |
| Extra | `B2 · sin cuenta designada` | Ver §13. |
| Extra | `B2·H` (2.ª) | Un tipo de efecto sin ejecutor no desaparece en silencio. |
| Extra | `B2 · entrega repetida` | Una entrega repetida **no** devuelve a `FAILED` un evento ya resuelto, ni le cuenta un intento (ver §13, defecto 4). |

---

## 13. Cuatro defectos encontrados al probarlo

Tres los encontró la **prueba de integración HTTP**, no las de dominio —es
exactamente la frontera que el bloque 1 no tenía—; el cuarto salió de releer el
propio código buscando qué podía salir mal.

1. **Un webhook no tiene persona detrás, y confirmar un pago exige una.**
   `confirmarPagoEnTx` falla con `SIN_ACTOR` desde el Slice 5, y hace bien: un
   pago confirmado sin responsable es un agujero de auditoría. Las dos salidas
   fáciles eran malas: inventar un «usuario de sistema» pondría un robot donde
   las pantallas dicen *quién confirmó*, y relajar la regla del Slice 5
   cambiaría la semántica de un camino que mueve dinero —y eso no es de este
   bloque—. Lo que se hace: la organización **designa** la cuenta con la que
   actúa la integración (`SUPPLY_V2_WEBHOOK_ACTOR_ID`), como cualquier cuenta de
   servicio en un sistema contable, y se **comprueba contra la base** (un id mal
   copiado haría fallar la transacción del pago con un error de clave foránea en
   vez de con un motivo legible). Si no está puesta, el evento **no se procesa**:
   queda guardado, reprogramado y auditado, y se responde 500 para que lo
   reintenten. Fallar cerrado aquí deja eventos esperando; dejarlo pasar movería
   dinero sin responsable.
2. **El despacho usaba la hora de entrada de la petición.** El efecto se escribe
   *durante* la petición, así que su `availableAt` es posterior a esa hora, y el
   despachador —que solo reclama lo ya disponible— **no lo veía nunca**: cada
   aviso se habría quedado esperando al cron, hasta un día después. Se despacha
   con la hora de **ahora**.
3. **Un trabajo sin empresa rompía el endpoint de trabajos.** `/api/jobs` leía
   `carga.companyId` dando por hecho que todo trabajo pertenece a un inquilino.
4. **Una entrega repetida podía deshacer un estado final.** Si la cuenta de la
   integración faltaba, el camino anotaba el fallo *sobre la fila*, y una
   entrega repetida de un evento **ya procesado** lo devolvía a `FAILED`:
   un estado final deshecho por un problema de configuración, contra la máquina
   de estados del bloque 1. Ahora un evento ya resuelto se contesta
   `EVENT_REPEATED` antes de pedir cuenta alguna, y hay prueba de que la fila no
   se mueve ni se le cuenta un intento.

---

## 13 bis. Corrección aparte (Slice 8): los puntos dejaban de vencer

**Esto no es una funcionalidad del bloque 2. Es un defecto del Slice 8 que
afectaba dinero real, encontrado al repetir la suite, y va documentado aparte
como corresponde.**

### El síntoma

Al correr `npm run test:db` cuatro veces seguidas, una falló:
`H2 · VENCIMIENTO` decía «los de 30 días vencieron: 10 !== 0». Parecía una
prueba inestable. No lo era.

### La causa

`vencerPuntosEnTx` barre los lotes caducados con una ventana acotada
(`take: 200`, a propósito, para no bloquear la tabla entera). Su filtro pedía
`availableDelta > 0`. Pero **un lote gastado conserva su `availableDelta`** —el
ledger no se reescribe— y lo que de verdad le queda vivo es
`availableDelta − consumedFromLot`.

Así que los lotes **ya consumidos seguían cumpliendo el filtro** y, siendo los
más viejos, ocupaban la ventana de 200 filas entera. El bucle los saltaba uno a
uno con `continue` y la función devolvía 0.

El efecto no era lentitud: **los puntos dejaban de vencer para siempre.** En
cuanto se acumulan 200 lotes consumidos con fecha de caducidad, el cron barre
cada día los mismos lotes muertos y no llega nunca a los vivos. Membego seguiría
debiendo recompensas que debían haber caducado.

### La evidencia, medida sobre la base

```
lotes consumidos que ocupaban la ventana ....... 202   (tope: 200)
lotes vivos que ya debían haber vencido ........  33   (no se tocaban nunca)
```

### La corrección

Una condición en la consulta, comparando las dos columnas **en la base**
(referencia de campo de Prisma); calcularlo en JavaScript era justo lo que
obligaba a traerse los muertos:

```ts
consumedFromLot: { lt: tx.supplyV2PointsMovement.fields.availableDelta }
```

Cambio **aislado**: una condición en `src/modules/supply-v2/loyalty/points.ts`.
No se tocó la semántica de vencer, ni el orden FEFO, ni el ledger, ni ninguna
otra función.

### La prueba

`H2b · los lotes YA CONSUMIDOS no ocupan la ventana del barrido`, en el archivo
del Slice 8. Planta cuatro lotes consumidos con fechas del año 2000 —más viejas
que cualquier otro dato— y un lote vivo justo detrás, y barre con el tope
exactamente en cuatro: con el defecto la ventana se agota en los consumidos y el
lote vivo no se toca.

**Comprobado quitando la corrección**: `H2` y `H2b` fallan las dos; con ella,
pasan las dos. El montaje de `H2b` cuadra con su ledger (para no engañar al
invariante global) y se retira al terminar.

---

## 13 ter. Dos pruebas inestables que había desde antes

Repetir la suite varias veces —que es la única forma de ver esto— sacó dos
pruebas que fallaban de vez en cuando por cómo estaban escritas, no por el
producto. **Ninguna de las dos se arregló tocando código de producción.**

1. **`H2 · VENCIMIENTO` (Slice 8)** dependía de cuántos lotes vivos hubiera
   acumulados en la base compartida: el barrido vence 200 por pasada, y por
   encima de eso la ventana no llegaba a la cuenta recién creada. Ahora vacía la
   cola llamando hasta que no queda nada, que es lo que el cron hace pasada a
   pasada. (El defecto **de producto** que había detrás —los lotes consumidos
   ocupando la ventana— es el de §13 bis.)
2. **`I · el barrido vence derechos y vouchers caducados` (Slice 3)** afirmaba
   sobre el **contador** del barrido (`derechosVencidos >= 1`). El barrido es
   global y varios archivos de prueba lo llaman en paralelo: si otro lo corre
   primero, el derecho ya está vencido y el contador propio dice 0 sin que nada
   esté mal. Ahora se afirma sobre el **efecto** —el derecho queda `EXPIRED` y
   sin vouchers activos—, que es lo que la prueba quería decir.

Se dejan anotadas porque el patrón se repite y conviene que se reconozca: en
una base de pruebas compartida, **un contador global no es una afirmación
segura**; el estado de la fila propia sí.

---

## 14. Controles ejecutados

| Control | Resultado |
|---|---|
| `npx tsc --noEmit` | **0 errores** |
| ESLint sobre lo nuevo y lo tocado | **0 avisos** |
| `npm test` | **3482 pasan**, 0 fallan, 6 omitidas (las mismas de siempre) |
| `npm run test:db` | **254 pasan**, 0 fallan (236 de antes + 17 del bloque 2 + la regresión `H2b` del Slice 8) |
| Suite del Slice 9 (bloques 1+2) repetida | **34/34 en cuatro corridas aparte**, más las que van dentro de cada `test:db` (la concurrencia no es determinista: una corrida no demuestra nada) |
| Dominio del bloque 2 | 24/24 |
| `scripts/transacciones-anidadas.mjs` | **Ninguna transacción anidada** |
| Deriva de esquema (`migrate diff`) | **No difference detected** |
| Base **nueva**, `migrate deploy` ×2 | 1.ª: todas aplicadas · 2.ª: «No pending migrations» · deriva: ninguna · los dos `CHECK` presentes |
| Sello de migraciones | 180 selladas |
| Preflight de RLS Capa 2 | pasa (las dos tablas siguen declaradas solo omniscientes) |
| `nucleo-sin-verticales.mjs` · `acoplamiento-vertical.mjs` | salen 0 |
| Supply V1 | intacto |

**`npm run lint` sigue fallando en este entorno** con «could not find plugin
react-hooks», y se volvió a comprobar que **ocurre igual sobre la base limpia**
(`git stash` → mismo error → `git stash pop`). Es un problema de resolución del
plugin anterior a este trabajo y **no se presenta como éxito**: el lint se
ejecutó pasando las rutas explícitamente, que sí funciona, y sobre todos los
archivos nuevos y tocados.

---

## 15. CardNET, explícitamente separado

* **Supply 2.0 no cobra con CardNET.** Sus métodos siguen siendo
  `TRANSFER | DEPOSIT | CASH | MANUAL`, y este bloque **no añade** un camino de
  tarjeta.
* **Membego V1 sí tiene integración con CardNET**, con sus pruebas
  (`tests/cardnet*.test.ts`). Este bloque **no la toca**.
* El registro de proveedores **no conoce** `CARDNET`: `verificadorDe('CARDNET')`
  y `adaptadorDe('CARDNET')` devuelven `null`, y el endpoint contesta **404**.
  Hay prueba de las dos cosas.
* El diseño está preparado sin estar conectado: `provider` es texto y no un enum,
  así que añadir una pasarela es **un verificador y un adaptador**, sin migración
  y sin tocar el endpoint, el inbox ni el procesador.
* **No se ejecutó ninguna prueba QA contra CardNET** ni se usó una credencial
  real en ninguna prueba: el proveedor de las pruebas es `TEST_GATEWAY` y su
  secreto se genera por corrida. **Ninguna prueba de CardNET se marca como
  aprobada.**

---

## 16. Riesgos y limitaciones que quedan

1. **La idempotencia del efecto depende del destino.** Hoy el destino sabe
   deduplicar (índice único en `notificaciones`). Un destino externo sin clave de
   idempotencia puede recibir el efecto dos veces si el proceso muere entre
   hacerlo y marcarlo (§9). Es una decisión para el bloque que conecte correo.
2. **Hace falta configurar dos cosas** o el camino no funciona:
   `SUPPLY_V2_TEST_GATEWAY_SECRET` (sin él, 401 a todo) y
   `SUPPLY_V2_WEBHOOK_ACTOR_ID` (sin él, 500 y los eventos esperan). Las dos
   fallan **cerrado** y dejan rastro, pero un despliegue a producción que las
   olvide tendrá un webhook que no acepta nada. No hay todavía un centinela de
   salud que lo avise: eso es del bloque de observabilidad.
3. **El despacho en la propia petición alarga el request.** Hoy entrega hasta 10
   efectos en línea cuando no hay QStash —degradación honesta de la cola—, y con
   QStash solo publica. Si el volumen crece, el despacho debería salir del
   request por completo.
4. **Nadie ve los difuntos todavía.** Están en la base y auditados, pero sin panel
   hay que mirarlos por SQL. Es del bloque del Centro de Operaciones.
5. **El cron es diario** (plan Hobby). La red de seguridad del outbox corre una
   vez al día: un efecto que falle al despacharse y cuyo reintento toque antes
   puede esperar hasta la siguiente pasada. El camino normal no depende de eso.
6. **No se abren incidencias financieras**, como se acordó: los eventos inválidos
   siguen `REJECTED`/`IGNORED` con código, auditoría y cero efecto financiero. El
   modelo de incidentes **no se deformó** para cerrar una casilla.
7. **Sin rate limit propio en el endpoint.** El proyecto tiene `lib/rate-limit.ts`
   y aquí no se usó: la firma ya rechaza lo que no está firmado antes de tocar la
   base, y un límite por IP sobre un webhook legítimo puede tirar eventos de
   pago reales. Queda como decisión consciente, no como olvido.

---

## 17. Criterio de cierre

> Un proveedor externo puede enviar un evento HTTP firmado; Membego verifica su
> autenticidad y frescura, lo adapta, lo registra y lo procesa de forma
> idempotente. El efecto posterior sale por el outbox y la cola existente. Si el
> worker falla puede recuperarse o acabar en dead letter, y ningún retry, replay
> o duplicado produce una segunda consecuencia financiera.

Demostrado, en este orden: `B2·§14` (el camino entero por HTTP, hasta el aviso) ·
`B2·A` y `B2·B` (duplicado y simultáneo → una consecuencia) · `B2·C` y `B2·D`
(firma y replay → cero efecto) · `B2·E` (dos despachadores → un trabajo) ·
`B2·F` (reintento y muerte tardía → un solo efecto) · `B2·G` (rescate del
arriendo) · `B2·H` (dead letter sin mover el dinero).

**No se avanzó al Centro de Operaciones.** El bloque 3 es reconciliación e
incidencias financieras.
