# Trabajos en segundo plano

Fase 2 de `docs/AUDITORIA-PRODUCCION.md` (C-06 y C-07).

## El problema que resuelve

Dos cosas se hacían **dentro del request** y ninguna cabía:

- **Fan-out de notificaciones.** `notificarClientesEmpresa` leía a todos los
  clientes y hacía un único `createMany`. Con 50.000 clientes, un INSERT de
  50.000 filas en una función serverless con límite de tiempo — bloqueando la
  respuesta al administrador que pulsó el botón, y dejando el envío a medias si
  se agotaba.
- **Cron de automatizaciones.** Un bucle `for` con `await` por empresa dentro de
  los 60 segundos del cron. Con mil empresas a ~200 ms son 200 segundos: se
  cortaba a la mitad y **las restantes no se procesaban nunca**, devolviendo 200
  como si todo hubiera ido bien.

## Cómo funciona ahora

```
server action / cron
        │
        ├─ encolar({ tipo, ... })  →  QStash  →  POST /api/jobs
        │                                              │
        └─ (sin QStash: ejecuta en línea)              └─ ejecutarTrabajo()
                                                            │
                                             lote de 1.000 → se encadena solo
```

| Pieza | Archivo |
|---|---|
| Cliente REST de QStash + verificación de firma | `src/lib/jobs/qstash.ts` |
| Catálogo de trabajos y tamaño de lote | `src/modules/jobs/tipos.ts` |
| Encolado con degradación a ejecución en línea | `src/modules/jobs/cola.ts` |
| Ejecución de cada trabajo | `src/modules/jobs/ejecutor.ts` |
| Endpoint que recibe de QStash | `src/app/api/jobs/route.ts` |

### Decisiones que conviene no deshacer

**Lotes encadenados, no cien mensajes de golpe.** El trabajo procesa 1.000
destinatarios y, si quedan más, se encola a sí mismo. Encolar los cien lotes de
una vez llenaría la cola antes de saber si el primero funcionó.

**`orderBy: { id: 'asc' }` en la paginación de destinatarios.** No es estético.
Sin orden explícito PostgreSQL puede devolver las filas en distinto orden entre
consultas, y entonces `skip`/`take` se solapan o se saltan gente: unos reciben
la notificación dos veces y otros ninguna.

**Verificación de firma, no un secreto compartido.** `/api/jobs` es público por
necesidad y hace escrituras masivas. La firma de QStash es un JWT calculado
sobre el **cuerpo** del mensaje: cambiar el `companyId` de la petición la
invalida. Un secreto en cabecera se filtra en un log y ya no hay vuelta atrás.
Está probado en `tests/cola.test.ts` (12 casos).

**El cuerpo se lee crudo y se verifica antes de parsear.** Parsear y
re-serializar para comprobar el hash rompería mensajes legítimos por cualquier
diferencia de formato.

**400 para un cuerpo ilegible, 500 para un fallo de ejecución.** QStash solo
reintenta ante 5xx. Un cuerpo roto no mejora con reintentos; un fallo transitorio
de base sí.

## Configuración

Variables de entorno (Upstash → QStash):

```
QSTASH_TOKEN=...
QSTASH_CURRENT_SIGNING_KEY=...
QSTASH_NEXT_SIGNING_KEY=...
QSTASH_TARGET_URL=https://tu-dominio        # opcional; si no, NEXT_PUBLIC_APP_URL
```

**Sin `QSTASH_TOKEN` los trabajos se ejecutan dentro del request.** No se
pierden, pero vuelve el riesgo original. En producción se escribe un `warn`
ruidoso en el log precisamente para que se note.

**Sin `QSTASH_CURRENT_SIGNING_KEY` el endpoint responde 503** y no ejecuta nada:
mejor que la cola no funcione a que funcione sin firmar.

## Cómo comprobar que funciona

1. Mandar una notificación a todos los clientes desde el panel. La acción debe
   responder de inmediato; en el panel de QStash aparece el mensaje.
2. Con más de 1.000 clientes, deben aparecer mensajes **encadenados**: uno por
   lote, cada uno con `desde` mayor que el anterior.
3. Disparar el cron a mano: la respuesta debe traer
   `reparto: { empresas, encoladas, enLinea }` con `enLinea: 0`. Si `enLinea` no
   es cero, QStash no está configurado.
4. Probar el rechazo: `curl -X POST https://tu-dominio/api/jobs -d '{}'` debe
   devolver **401**.

## Lo que queda fuera de esta fase

`Upstash-Delay` (implementado en `src/lib/jobs/qstash.ts`) no tiene aún ningún
llamador: es la pieza que falta para reanudar automatizaciones en `WAITING`
(plan B-6: un scheduler que entregue el evento cuando pasa la espera).

## Fase 4 — correos, bus de estrategias y recompensas de referido

Tres tipos de trabajo más, todos con el mismo contrato (`encolar` → `/api/jobs`):

| Tipo | Carga | Emisor | Worker |
|---|---|---|---|
| `email` | `to/subject/html/text/companyId` | `encolarEmail` (`src/modules/jobs/emisiones.ts`) | `sendEmail` (best-effort, nunca lanza) |
| `evento-estrategia` | `eventoId/companyId` | `emitirEventoEstrategia` (`src/modules/estrategias/eventos.ts`) | `despacharEventoEstrategia` (flip atómico `processed` + dispatch + outbox) |
| `recompensas-referido` | `companyId/referenteClienteId/referidoId` | `procesarReferidoCompletado` (`src/modules/referidos/actions.ts`) | `evaluarRecompensas` (idempotente por unique referente+regla) |

Decisiones de diseño que conviene no deshacer:

**El bus de estrategias es ahora un outbox (patrón B-6).** `emitirEventoEstrategia`
persiste `automation_events` con `processed=false` y encola el id; el worker hace
el flip atómico `false → true` y despacha. El flip es la exclusión mutua: un
reintento de QStash o el barrido del cron encuentra el evento ya procesado y no
lo duplica. Si el despacho falla se **reabre** el evento y se relanza el error —
repetir es seguro, perder el evento no lo es. El cron diario
(`/api/cron/automatizaciones`) barre los `processed:false` con más de 6 horas y
los re-encola (resiliencia si la cola estuvo caída o el worker agotó reintentos).

**Emails de prueba y de verificación siguen inline.** `enviarCorreoPrueba`, el
diagnóstico `/api/pagos/cardnet-token/estado?correo=1` y la verificación de
registro (`sendVerificationEmail`, que devuelve al UX si salió) no pasan por la
cola. Los recibos de pago, invitaciones de miembro y avisos de ticket sí.

**Sin QStash se ejecuta en línea y con `await`.** Los emisores hacen `await`
porque, sin cola, `encolar` ejecuta el trabajo dentro del request y este debe
terminar antes de responder. Con QStash configurado, ese `await` es solo la
publicación (rápida); el trabajo pesado corre en el worker.

**La idempotencia de las recompensas ya existía.** El unique
`(referenteClienteId, reglaId)` + manejo de P2002 hacen que un reintento salte
las recompensas ya otorgadas; la clave de dedup por `referidoId` garantiza además
que cada conversión genere su propio trabajo (dos conversiones del mismo
referente no se colapsan).

## Fase 2 de Membego Connect — dead letter y salud de la cola

**Los trabajos difuntos ya no desaparecen.** `encolar` publica con
`Upstash-Failure-Callback` apuntando a `/api/jobs/muerto`: cuando QStash agota
sus reintentos contra `/api/jobs`, entrega el mensaje difunto ahí (firmado con
las mismas claves, verificado igual) y queda en `trabajos_muertos` con su carga
íntegra. Idempotente por `sourceMessageId` — el callback también se reintenta.
Antes, un trabajo que fracasaba tres veces terminaba en el DLQ de QStash, que
nadie mira.

**Reencolar y descartar son decisiones, no automatismos.** Misma doctrina que
el DEAD_LETTER del outbox de satélites: ambas viven en el panel del superadmin
(`/superadmin/integraciones`), piden confirmación y quedan en la bitácora de
auditoría (`COLA_REENCOLADA` / `COLA_DESCARTADA`). El flip atómico
PENDIENTE → REENCOLADO evita el doble clic; si al reencolar la cola no está,
`encolar` degrada a ejecución en línea y el trabajo no se pierde.

**La degradación en línea se cuenta.** Ejecutar un trabajo dentro del request
por falta de QStash (o por una publicación rechazada) emite el evento
estructurado `cola/degradacion` además del aviso en consola. «¿Cuántos trabajos
corrieron en línea esta semana?» es la pregunta que dice si la cola está bien
puesta, y una frase en consola no la contesta.

**La salud se ve en una tarjeta.** `saludDeLaCola()` suma en cuatro números lo
que antes había que consultar a mano: trabajos difuntos pendientes, webhooks a
satélites en reintento, webhooks agotados y eventos del bus estancados (>6 h
sin despachar).

## Reintentos programados — la escalera, y el cron como red de seguridad

> Hallazgo **A-1** de `docs/AUDITORIA-INTEGRACIONES-2026-09.md`.

Hasta aquí, el único que reintentaba una entrega fallida era el cron diario.
Eso significaba que **un receptor caído treinta segundos le costaba a su cliente
veinticuatro horas**, y que agotar los ocho intentos llevaba ocho días. El
outbox garantizaba que no se perdía nada; no que llegara a tiempo, que es lo
que de verdad se le promete a quien integra.

Ahora **cada fallo programa su propio siguiente intento** en QStash, con espera
creciente:

| Tras el intento | Espera | Acumulado |
|---|---|---|
| 1.º | 30 s | 30 s |
| 2.º | 2 min | ~2,5 min |
| 3.º | 10 min | ~13 min |
| 4.º | 30 min | ~43 min |
| 5.º | 2 h | ~2,7 h |
| 6.º | 6 h | ~8,7 h |
| 7.º | 24 h | ~33 h |
| 8.º | — | `DEAD_LETTER` |

La escalera vive en `src/modules/integraciones/reintentos.ts` (núcleo puro, con
pruebas) y la comparten las DOS colas de salida: satélites (`eventos_salientes`)
y webhooks de empresa (`entregas_webhook`).

**El jitter no es adorno.** Cuando un receptor se cae, todas sus entregas fallan
en el mismo segundo; sin dispersión, las mil vuelven a la vez a los 30 s exactos
y lo primero que recibe un servidor recién levantado es la misma avalancha que
quizá lo tumbó. El desvío es de ±20 % y es **determinista** a partir del id y
del número de intento: si fuera aleatorio, dos publicaciones del mismo reintento
calcularían esperas distintas y la clave de deduplicación dejaría de describir el
mismo mensaje.

**Tres cosas que hay que saber para tocar esto:**

1. **`programarReintento()` NO usa `encolar()`**, y es deliberado. `encolar()`
   degrada a ejecutar en línea cuando falta QStash — y un reintento en línea se
   ejecuta *ahora*, vuelve a fallar, vuelve a programar… dentro del mismo
   request. Una recursión que se come los ocho intentos en un segundo. Aquí se
   publica directo y, si no hay cola, no pasa nada: la fila guarda su
   `proximoIntentoAt` y el cron barre. **El peor caso de la versión nueva es el
   caso normal de la vieja.**
2. **El cron toma solo lo VENCIDO** (`proximoIntentoAt` nulo o pasado). Si
   atendiera todo lo pendiente le gastaría el intento a entregas ya programadas
   y la escalera volvería a ser «una vez al día». `NULL` cuenta como vencido: es
   lo que tienen las filas anteriores a la migración y las que no se pudieron
   programar.
3. **El cerrojo de `intentos`.** El trabajo solo actúa si la fila sigue teniendo
   los intentos que tenía al programarse. Es lo que hace idempotente el
   reintento: un reintento de QStash sobre el mismo trabajo, o el barrido
   pisándolo, no gastan un intento que nadie contó.

El botón «reintentar» del panel del superadmin es la excepción explícita
(`soloVencidos: false`): quien acaba de arreglar la ruta del satélite y lo pulsa
está diciendo «ahora», y responderle que toca dentro de seis horas sería
devolverle su propia espera.

## Webhooks entrantes: que algo de fuera avise hacia dentro

> Hallazgo **B-1** de `docs/AUDITORIA-INTEGRACIONES-2026-09.md` (primera mitad).

MembeGo solo sabía **empujar**: eventos hacia los satélites y hacia las
direcciones que una empresa suscribe. No había ninguna forma de que algo de
fuera empujara hacia dentro, y ése era el hueco por el que cualquier integración
que no hubiéramos escrito a mano resultaba imposible para el usuario final.

Un webhook entrante es una URL secreta (`/api/connect/entrante/<token>`) a la
que una herramienta ajena hace POST. Lo que llega entra en el bus como
`entrante.<slug>` y queda guardado, de donde lo puede recoger una automatización
suscrita a ese evento — igual que recoge `cliente.visita`.

### La regla que sostiene todo lo demás

**Lo que entra va SIEMPRE marcado como entrante.** Si el evento pudiera llamarse
`cliente.visita`, cualquiera con la URL —un secreto, sí, pero uno que viaja en
texto por la configuración de una herramienta de terceros— podría inventar
visitas, disparar beneficios y meter datos falsos en los satélites de otras
empresas. Con el prefijo, una automatización que lo escuche lo hace a sabiendas.

### Lo demás que protege el endpoint

Es la ruta más expuesta del módulo: pública por necesidad, sin sesión, y escribe
en la base.

- **El token no elige la empresa, la descubre.** No hay `companyId` en la
  petición: sale de resolver el token, así que no existe parámetro que
  manipular. Misma propiedad que las claves de API de empresa.
- **Del token solo se guarda su hash.** Que la URL sea el credencial es lo normal
  en un webhook entrante, pero no obliga a guardarla en claro: prefijo indexado
  + secreto en scrypt, así que un volcado de la tabla no permite mandarle un
  evento a nadie.
- **El freno va antes de verificar el secreto.** Verificar cuesta a propósito
  (scrypt); si el freno fuera después, probar tokens al azar saldría gratis para
  quien prueba y nos costaría CPU a nosotros.
- **El cuerpo tiene tope** (64 KB, medido en bytes y no en caracteres) y debe ser
  un objeto JSON: un array llegaría al contexto de la automatización como
  índices numerados.
- **El mismo 404** para «no existe» y «el secreto no cuadra».

### Dos decisiones que sorprenden, y por qué

**Un webhook pausado responde 200.** Es lo contrario de lo que se espera de un
«pausar», y es deliberado: una herramienta que recibe un error se pone a
reintentar y a llenar de avisos de fallo el panel de su dueño, por algo que la
empresa apagó a propósito. Se acepta, no se emite, y se dice en el cuerpo. Un
token que no existe sí es 404: ahí no hay nada que respetar.

**Lo que entra no sale por los webhooks salientes.** Devolverle a la empresa lo
que acaba de mandarnos es ruido en el mejor caso; en el peor —dos herramientas
encadenadas, la segunda apuntando otra vez a nuestra URL de entrada— es un bucle
que solo se nota cuando ya se ha multiplicado. Reenviarlo a propósito sigue
siendo posible con una automatización y `send_webhook`, que es distinto: lo hace
porque alguien lo pidió.

### No hay tabla de recepciones

Lo recibido se guarda como evento en `automation_events`, que ya tiene el
payload, la empresa, el tipo y la hora. La pantalla «Ver lo recibido» lee de
ahí. Una segunda tabla con los mismos datos sería un sitio más que purgar y
aislar, y dos respuestas posibles a «qué nos mandaron el martes».

Esa pantalla es **la mitad del valor de la función**: quien conecta su
herramienta necesita ver el cuerpo exacto para saber qué campos trae antes de
construir nada encima. Es el flujo de las herramientas contra las que esto se
integra — mandas una prueba, miras la forma, y luego automatizas.

## El fan-out y el barrido van en paralelo, y el barrido se corta a tiempo

> Hallazgo **A-6** de `docs/AUDITORIA-INTEGRACIONES-2026-09.md`.

Las cuatro rutas de salida recorrían su lista con un `for` y un `await` dentro:
cada entrega esperaba a que la anterior terminara o agotara sus diez segundos de
timeout. Eso tenía dos consecuencias de tamaños muy distintos.

**En el fan-out era una molestia.** Cinco suscripciones lentas dejaban al worker
del bus cincuenta segundos ocupado en una sola operación de negocio.

**En el barrido era un fallo.** El cron toma hasta cien filas y tiene sesenta
segundos de `maxDuration`. Con un receptor caído, cada fila cuesta diez
segundos: procesaba unas seis y la plataforma mataba la función. Las noventa y
cuatro restantes no se intentaban, no aparecía ningún error, y al día siguiente
volvía a pasar lo mismo con las mismas seis primeras. **Una cola que solo drena
su primer 6 % está atascada y parece que funciona.**

Ahora las cuatro usan `enParalelo` (`modules/integraciones/concurrencia.ts`),
con `CONCURRENCIA = 6`.

**Por qué seis y no sesenta.** Esto no es un pool de trabajos independientes. En
un barrido, muchas de las filas pendientes apuntan **al mismo servidor** —están
pendientes precisamente porque ese servidor está mal—, así que el límite no
reparte carga entre destinos: se la concentra en uno. Un número alto convertiría
nuestro reintento en una avalancha contra alguien que ya está caído, y encima
justo cuando intenta levantarse.

**Los barridos se cortan por tiempo.** `antesDe(presupuesto, margen)` deja de
tomar trabajo antes de que se acabe el presupuesto, y los que ya estaban en
vuelo terminan. El margen (12 s) cubre el timeout de una entrega más lo que
cuesta anotar su resultado: sin él, la plataforma mataría la función a mitad de
un `update` y la fila diría algo que no pasó. Lo que queda sin intentar se
devuelve en `sinTiempo` — y el botón del panel lo dice, porque «12 entregados»
con cuarenta filas sin tocar manda a casa a quien debería volver a pulsar.

**El cron reparte su presupuesto entre las dos colas** (20 s cada una). Comparten
cron, así que comparten los sesenta segundos; sin repartirlo, la primera podría
consumirlo entero y la segunda no llegaría a intentar ni una entrega — un fallo
que solo aparece el día en que una de las dos va mal, o sea el día que más
importa.

**Los fan-out NO se cortan por tiempo**, y es deliberado: corren dentro del
worker de eventos (300 s) sobre una lista acotada por el entitlement. Ahí no hay
presupuesto que apurar, y ponerles un corte sería complicarlos para protegerse
de algo que no pasa.

### Un detalle que solo aparece en paralelo

El barrido de satélites memoizaba los destinos por empresa. En serie funcionaba;
en paralelo, seis trabajadores que empiezan a la vez con filas de la misma
empresa encontrarían el memo vacío los seis y lanzarían seis veces la misma
consulta. Ahora el memo guarda la **promesa**, no el resultado: el primero la
crea y los otros cinco esperan a esa misma — que es lo que el memo prometía
desde el principio.

## Rotar el secreto de un webhook sin cortar

> Hallazgo **A-7** de `docs/AUDITORIA-INTEGRACIONES-2026-09.md`.

Había un solo secreto por suscripción. Cambiarlo dejaba de golpe todas las
entregas sin una firma que el receptor reconociera, hasta que alguien copiara el
nuevo a mano en su servidor. Así que la única rotación practicable era **borrar
la suscripción y crear otra** — que cambia el id y tira el historial de
entregas.

Una rotación que obliga a un corte es una rotación que no se hace. Y el
problema es *cuándo* se descubre: la primera vez que hace falta rotar de verdad
es cuando se sospecha que el secreto se filtró, o sea el peor momento imaginable
para enterarse de que el procedimiento duele.

**Cómo funciona ahora.** Al rotar se genera un secreto nuevo y el anterior sigue
vivo `DIAS_SOLAPE_ROTACION` días (7). Durante el solape la cabecera v2 lleva
**las dos firmas** y el receptor valida con la que tenga configurada, así que
los dos lados dejan de tener que coincidir en el mismo minuto.

**El solape se acaba solo.** `secretosVivos()` compara contra el reloj en cada
envío, así que una rotación caducada deja de firmar con el viejo aunque nadie
haya limpiado la fila. Si dependiera de un trabajo que la borra, un trabajo que
no corre dejaría el secreto retirado firmando para siempre — lo contrario de
rotar.

**El vigente va siempre primero en la lista**, y no es estético: la cabecera v1
no admite lista (su verificador hace un único `timingSafeEqual`) y se firma con
`secretos[0]`. Invertir el orden dejaría a un receptor en v1 validando con el
secreto que se retira, y se le caería el día que vence el solape en vez del día
que le avisamos.

**Quien siga en v1 tiene un corte duro al vencer el plazo.** Es la razón
adicional para migrar a v2, y la pantalla lo dice con la fecha exacta antes de
que nadie confirme una rotación.

### Lo que se descubrió al hacerlo

El secreto de un webhook **nunca se pudo volver a ver**. Tres comentarios
—el del esquema, el de `crearSuscripcion` y el del panel— afirmaban lo
contrario, y el del esquema usaba esa afirmación para justificar guardarlo en
claro en vez de sellarlo con la clave maestra como las credenciales de conector.
Como no se enseña nunca, esa justificación no se sostiene: **sellarlo es una
migración pendiente**, anotada en la auditoría. Los tres comentarios están
corregidos.

## Elegir qué eventos recibe un webhook

> Hallazgo **A-5** de `docs/AUDITORIA-INTEGRACIONES-2026-09.md`.

`SuscripcionWebhook.eventos` existía desde la Fase 3 y la interfaz no ofrecía
una sola casilla, así que toda suscripción nacía —y se quedaba— recibiéndolo
todo. **Lista vacía sigue significando «todos»**, y eso no cambia: es el default
de todo lo que hay creado hoy, y cambiarlo dejaría sin avisos a quien ya está
integrado.

Lo que sí cambia es que ahora se puede filtrar, al crear y **después**. Lo
segundo es lo que de verdad hacía falta: todas las suscripciones existentes
tienen la lista vacía precisamente porque no había forma de decir otra cosa.

**La lista de eventos sale del bus**, no de un array escrito a mano
(`modules/connect/eventosSuscribibles.ts`): se deriva de `EVENTOS_REENVIADOS`
pasado por el mapa v2. Una lista a mano falla de las dos formas y las dos son
caras — ofrecer un evento que nadie recibirá nunca, u olvidarse de uno nuevo.
Lo único escrito a mano son las etiquetas de negocio, y una prueba exige que
todo evento emitido tenga la suya: añadir uno sin traducirlo rompe la CI en vez
de enseñarle `purchase.refunded` a la dueña de un salón.

### La trampa que esto podía haber sido

Los avisos que manda una automatización se llaman `automation.<lo que la regla
decida>` (`estrategias/actionSink.ts`): el nombre lo inventa la propia empresa,
así que **no se puede enumerar en una lista de casillas**.

Sin resolver eso, el selector habría sido una trampa. En cuanto alguien marcara
«compras» para filtrar, sus avisos de automatización habrían dejado de llegar
—sin aviso, sin error y sin haberlo pedido—, porque la lista deja de estar
vacía. Un filtro que apaga en silencio algo que no nombraste es peor que no
tener filtro.

Por eso `suscripcionQuiere` entiende **familias**: una entrada terminada en
`.*` cubre su prefijo entero, y la pantalla ofrece «Avisos que manden tus
automatizaciones» = `automation.*`. El prefijo se compara con el punto incluido,
así que `automation.*` cubre `automation.x` pero no `automationX` ni
`automations.y`.

## La firma de los webhooks de empresa

> Hallazgo **A-2** de `docs/AUDITORIA-INTEGRACIONES-2026-09.md`.

Cada entrega sale con **dos** firmas HMAC-SHA256, calculadas con el secreto
`whs_…` de la suscripción:

| Cabecera | Qué firma | Estado |
|---|---|---|
| `X-Membego-Signature-V2` | `{timestamp}.{entregaId}.{cuerpo}` | **la buena** |
| `X-Membego-Signature` | el cuerpo a secas | legado, se retira |

**Qué arregla la v2.** La v1 firmaba solo el cuerpo, así que `X-Membego-Timestamp`
viajaba sin que nada lo protegiera: quien capturara una entrega podía reenviarla
al día siguiente con el timestamp que quisiera y la firma seguía cuadrando. La
cabecera existía y no servía para nada — comprobar la ventana anti-replay con un
valor que elige el atacante es comprobar su palabra. Con el timestamp dentro del
material firmado, cambiarlo rompe la firma, y la ventana pasa a significar algo.

El id de la entrega va dentro por lo mismo, y añade una propiedad: dos entregas
con el mismo cuerpo en el mismo segundo —el mismo evento a dos suscripciones de
la misma empresa— dejan de tener firmas intercambiables.

El material es `materialFirmado()` de `@membego/contracts`, el MISMO que firman
los satélites con Ed25519. Escribir aquí otra concatenación «equivalente» es
como emisor y receptor acaban discrepando por un punto de más.

**Por qué salen las dos.** Cambiarle el significado a la cabecera de siempre
haría que todo el que ya integró empezara a rechazar sus propios avisos el
minuto del despliegue. Y eso no se nota el primer día: se nota tres días
después, cuando alguien echa de menos un dato. Misma estrategia con la que los
satélites pasaron de HMAC a Ed25519.

**Cómo se retira la v1.** Anunciando una fecha, no midiendo. Qué cabecera
comprueba un receptor pasa dentro de su servidor y no vuelve a nosotros: desde
aquí, uno que verifica la v2 y otro que no verifica nada son indistinguibles.

La guía de `/admin/integraciones/desarrolladores` enseña el verificador
completo —firma, ventana y deduplicación por id de entrega— y una prueba
comprueba que ese verificador acepta lo que el emisor manda y rechaza un replay
con el timestamp refrescado.

## Fase 3 de Membego Connect — webhooks de empresa en la misma cola

Las suscripciones de webhook que crea una empresa (`suscripciones_webhook`)
usan el MISMO cron que el outbox de satélites (`/api/cron/integraciones`), no
uno propio: es el mismo trabajo —vaciar una cola de entregas pendientes— y
partirlo en dos gastaría una de las ranuras de cron del plan sin ganar nada.

Dos umbrales distintos, porque responden a preguntas distintas:

| Umbral | Qué significa | Qué pasa |
|---|---|---|
| 8 intentos de UNA entrega | «este mensaje no llega» | la entrega pasa a `DEAD_LETTER` |
| 20 fallos SEGUIDOS de una suscripción | «este destino está muerto» | la suscripción pasa a `DISABLED` |

`DISABLED` no es lo mismo que `PAUSED`: lo primero lo decidió el sistema y hay
algo que mirar; lo segundo lo pidió la empresa y se reactiva con un clic (y al
reactivar se pone el contador a cero, o volvería a apagarse al primer fallo).
