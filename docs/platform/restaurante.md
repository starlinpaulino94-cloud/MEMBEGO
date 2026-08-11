# El restaurante como sistema aparte

Fase 7b del *Membego Platform Integration Standard v1*.
Continúa `docs/platform/satelite.md`.

---

## La otra mitad del encargo

La Fase 7 contestó «¿se integra un sistema nuevo sin modificar MembeGo?» — sí,
por manifiesto, sin un `switch` ni un despliegue.

Queda la que da nombre al estándar:

**¿Funciona el contrato cuando hay red en medio?**

Todo lo construido hasta aquí se validó **con la red desconectada**. Car Wash
pide por el puerto `ClientePlataforma`, pero con `clienteLocal()`, que llama en
proceso y contra la misma base. Eso demuestra que el contrato *expresa* la
operación. No demuestra nada sobre latencia, reintentos, orden de llegada ni
copias desactualizadas — porque ninguna de esas cosas existe cuando no hay red.

Fue deliberado y está escrito en la Fase 6:

> «Descubrir un hueco con Car Wash cuesta una tarde. Con el primer satélite
> integrado cuesta una versión del contrato y un despliegue coordinado con otro
> equipo.»

Esta es la tarde.

---

## Qué es `apps/restaurant`

Un sistema con **su propia base de datos**, que habla con MembeGo **solo por
HTTP**. Cuatro tablas:

| Tabla | De quién es |
|---|---|
| `mesas`, `comandas` | Del restaurante. MembeGo no sabe que existen |
| `clientes_proyectados` | **Copia** de lectura de un dato del Core |
| `eventos_recibidos` | El inbox: qué webhooks ya se procesaron |

Ni `clientes`, ni `memberships`, ni `promociones`. Verificado contra la base
real: las cuatro tablas y ninguna más.

---

## La regla que sostiene todo

> **La copia local MUESTRA. No DECIDE.**

El camarero teclea un teléfono y ve «Ana, socia Premium» al instante, leyendo la
copia. Sigue funcionando si MembeGo tarda o no responde — el restaurante no
puede dejar de servir comida por algo que no es suyo.

Pero el momento en que ese beneficio **se consume**, la decisión la toma el Core
por HTTP. Sin excepción.

Decidido con la copia, basta un webhook lento para regalar un beneficio que ya
se gastó en otro local hace cinco minutos. Y no se nota: el camarero ve «le
queda uno», lo aplica, el cliente se va contento. Aparece al cuadrar caja, días
después, sin forma de saber a quién se le regaló qué.

Por eso `ClienteProyectado` **no tiene saldos ni usos restantes**. No es un
olvido: tenerlos invitaría a usarlos. Hay una prueba que falla si alguien añade
un campo gastable a esa tabla.

---

## Lo que el cliente en-proceso hacía invisible

### Los eventos no llegan en orden

MembeGo reintenta lo que no responde. El segundo intento de un evento de las
10:00 puede aterrizar **después** del primer intento de uno de las 10:05. No es
un fallo: es cómo funciona cualquier reparto con reintentos.

Aplicado sin mirar, el cliente «vuelve» a su nombre anterior. Y no falla nada:
no hay error, ni log, ni fila mal formada. Solo un dato viejo pisando a uno
nuevo.

Se ordena por `occurredAt`, que el sobre define como *cuándo ocurrió* y no
cuándo se envió — los reintentos no lo mueven. Es el único campo del sobre con
el que se puede ordenar.

La comparación es **estrictamente mayor**. Con `>=`, dos eventos del mismo
instante se aplican los dos y gana el último en llegar: justo el
no-determinismo que la comparación existe para quitar.

### El duplicado es el funcionamiento normal

El mismo `eventId` llega más de una vez **por diseño**. El inbox lo reconoce y
responde 200 sin volver a aplicar.

Está **en base, no en memoria**. El inbox en memoria del SDK sirve para probar;
aquí se vacía al reiniciar el proceso — y reiniciar es exactamente cuando
MembeGo está reintentando lo que quedó sin responder.

### Tres defensas que no se sustituyen

| Defensa | De qué protege |
|---|---|
| **Firma** sobre el cuerpo crudo | La URL es pública: cualquiera puede inventar un `customer.created` |
| **Inbox** por `eventId` | El reintento, que es normal |
| **Orden** por `occurredAt` | Un evento viejo llegando después de uno nuevo |

Quitar cualquiera deja un hueco que las otras dos no tapan.

> **El cuerpo se lee CRUDO.** La firma se calcula sobre los bytes exactos que
> llegaron. Parsear el JSON y volver a serializarlo cambia el orden de las
> claves y los espacios: los datos son los mismos y la firma ya no cuadra.
> Falla en todos los eventos y el mensaje —«firma inválida»— apunta al sitio
> equivocado. Es el error más repetido al integrar webhooks firmados.

---

## Decisiones de la operación

### Primero el canje, después el cierre

Cerrando primero, un fallo del canje deja la comanda cobrada **como si** se
hubiera aplicado el beneficio. Al revés queda un canje consumido y una comanda
abierta: visible, y arreglable por quien esté en el mostrador.

De los dos desastres, ese avisa.

### La clave de idempotencia es la comanda

No la llamada, no un uuid nuevo, no la hora. Si el cobro se reintenta —la
respuesta se perdió, el camarero volvió a pulsar— tiene que llegar la **misma**
clave, o se consume el beneficio dos veces por una comida.

### La venta se registra sin bloquear

Después de cerrar y sin `await`. Es información para el Core, no una condición
para cobrar: si falla, el cliente ya pagó y lo que se pierde es una fila de
analítica. Bloquear el cobro por esto sería dejar de facturar porque un sistema
de informes no responde.

### El puesto lo asigna este sistema

`membegoRole` es qué es en MembeGo. `systemRole` es qué es **aquí**, y MembeGo
lo transporta sin interpretarlo.

La tentación es decidir los permisos con `membegoRole`, porque siempre viene y
`systemRole` puede ser `null`. Hacerlo mete a un ADMIN_EMPRESA —que administra
campañas— en la caja del restaurante sin que nadie se lo haya dado.

Sin puesto no se puede nada. Un `systemRole` que este sistema no reconoce
(«Mesero jefe») se trata como sin puesto: denegar por no reconocerlo es
correcto; caerse, no.

---

## Reconciliación — lo que arregla un webhook que no llegó nunca

El inbox evita procesar dos veces. El orden evita que un evento viejo pise a uno
nuevo. **Ninguno de los dos hace nada si el evento no llega.**

Y puede no llegar: el satélite caído más de lo que dura la política de
reintentos, un `DEAD_LETTER`, una partición de red larga. Entonces la copia
queda vieja **para siempre**, y nada avisa. Es el único de los tres problemas de
una proyección que no se resuelve recibiendo mejor, sino **preguntando**.

### No se puede releer todo

Un restaurante con veinte mil clientes proyectados no puede pedirlos todos cada
hora: sería un ataque a MembeGo desde dentro, y peor cuanto más creciera el
negocio.

Se leen **las más viejas**, con un presupuesto por pasada y saltando lo
refrescado hace poco. La carga sobre el Core queda fija y conocida; lo que crece
con el número de clientes es el **tiempo en dar la vuelta**, que es un dato que
se puede mirar.

Por eso el resumen incluye `desfaseMaximoPendiente`: la antigüedad de la copia
más vieja que quedó sin revisar. Una tarea que corre cada hora y no llega a lo
de hace tres días está «funcionando» —no falla, no da error— y no sirve para
nada. `seEstaQuedandoAtras()` convierte eso en algo que se puede vigilar.

### La sutileza que decide si arregla o rompe

> `vigenteDesde` se sella con la hora de **envío**, no con la de llegada.

La respuesta del Core refleja el estado en algún instante entre que se envió la
petición y que se recibió. Sellándola con la hora de llegada, un cambio ocurrido
**durante ese vuelo** queda marcado como más viejo que la copia — y su webhook,
que trae el `occurredAt` real, se descarta por «evento viejo».

Resultado: un cambio real perdido, sin error, **por haber intentado arreglar la
copia**.

Con la hora de envío, el peor caso es volver a aplicar un evento que ya estaba:
inofensivo, porque el dato es el mismo. Se elige el fallo que no pierde nada.

Y el sello **nunca retrocede**: si mientras se pedía llegó un webhook más nuevo,
se conserva el suyo. Retroceder volvería a abrir la puerta a que un evento viejo
lo pise.

### Fallos

| Qué pasa | Qué se hace |
|---|---|
| `404` — ya no está en el Core | Se olvida la copia. Conservarla enseñaría un cliente que no existe, y quedaría atascada al frente de la cola gastando presupuesto en cada pasada |
| `500`, corte de red | **No se borra nada.** Un fallo del Core no significa que el cliente no exista. Sigue siendo de las más viejas, así que vuelve a salir en la próxima pasada |

### El disparador

`reconciliar()` está envuelta en `tareaReconciliar()`, que añade las tres cosas
que una pasada suelta no necesita y una programada sí:

1. **No solaparse.** Si una pasada tarda más que el intervalo, la siguiente
   arranca encima: las dos piden las mismas filas y le meten al Core **el doble
   de carga** que el presupuesto promete. Y no falla nada — las dos escriben el
   mismo dato.
2. **Decir qué hizo.** `revisadas=50 actualizadas=50` significa que los webhooks
   se están perdiendo todos; `revisadas=50 sinCambios=50` que van bien y esto es
   un seguro. Son opuestos y sin el desglose se ven iguales.
3. **Gritar cuando no da la vuelta.** Es el fallo más silencioso: la tarea
   termina, no da error y devuelve 200 mientras no corrige nada. Por eso es el
   único que se registra como `error`.

Se dispara con `POST /tareas/reconciliar` y `Authorization: Bearer <secreto>` —
la misma convención que los crons de MembeGo. Es un endpoint y no un temporizador
interno a propósito: así lo llama cualquier programador (cron del sistema,
CronJob de Kubernetes, el scheduler de la nube) sin que el satélite tenga que
saber cuál, y no se duplica solo con cada instancia que se levante.

### El cerrojo NO es un advisory lock

Fue lo primero que se escribió, y está mal aquí.

`pg_try_advisory_lock` es de la **sesión** de PostgreSQL, y Prisma habla por un
**pool**: `intentar()` puede tomar el cerrojo en una conexión y `soltar()`
ejecutarse en otra. El unlock no hace nada, la conexión vuelve al pool con el
cerrojo puesto, y la tarea queda muerta para siempre — anunciando «otra pasada
en curso», que parece que está trabajando.

Es un **arrendamiento en una fila**: sobrevive al pool, lo ven todas las
instancias, y si el proceso muere a mitad de pasada vence solo. Tomarlo es una
sola sentencia condicional —leer y luego escribir deja entrar a dos por la
ventana de en medio— y solo su dueño puede soltarlo.

---

## Verificación

**779 pruebas** en `tests/`, de las que 34 son de esta fase.

Y **31 comprobaciones contra PostgreSQL 16 y HTTP reales**
(`scripts/verificar-satelite-restaurante.mts`), que es lo que separa esto de un
ejercicio:

```
FIRMA — la calcula el Core, la verifica el satélite
  ✓ un evento firmado por el Core se acepta
  ✓ una firma manipulada se rechaza con 400
  ✓ una firma de OTRO evento no sirve para este
  ✓ el intruso no entró en la proyección
PROYECCIÓN — persistida de verdad
  ✓ el cliente quedó en la base del satélite
  ✓ guardó `vigenteDesde` del evento, no la hora de guardado
INBOX — el reintento es normal, no un fallo
  ✓ el mismo eventId reintentado responde 200
  ✓ y se reconoce como duplicado
  ✓ no dejó una segunda fila en el inbox
ORDEN — lo que el cliente en-proceso hacía invisible
  ✓ un reintento tardío de un evento viejo NO pisa al nuevo
RECONCILIACIÓN — lo que arregla un webhook que no llegó nunca
  ✓ la copia vieja se refrescó contra el Core
  ✓ el SDK pidió token antes de leer
  ✓ la base del satélite quedó con el dato del Core
  ✓ una copia recién refrescada ya no gasta presupuesto
  ✓ un cliente que ya no está en el Core se olvida
  ✓ y desaparece de la base del satélite
  ✓ la tarea sabe que no se está quedando atrás
TAREA PROGRAMADA — cerrojo real entre pasadas
  ✓ la primera pasada toma el cerrojo
  ✓ la segunda instancia NO entra mientras la primera trabaja
  ✓ soltado el cerrojo, la siguiente pasada sí corre
  ✓ y la copia quedó refrescada
  ✓ y ninguna lectura falló
  ✓ el cerrojo quedó libre al terminar
DISPARADOR HTTP — solo con el secreto
  ✓ sin secreto responde 401
  ✓ con el secreto equivocado responde 401
  ✓ con el secreto correcto dispara la pasada
AISLAMIENTO — la base del satélite es suya
  ✓ solo existen las tablas del satélite
  ✓ no existe la tabla `clientes` de MembeGo
  ✓ no existe la tabla `memberships` de MembeGo
  ✓ no existe la tabla `promociones` de MembeGo
  ✓ no existe la tabla `companies` de MembeGo
```

La firma la genera **la función del Core** (`firmarEd25519`), no una reimplementación.
Si las dos mitades del contrato se hubieran separado, aquí se vería.

### Lo que encontró el compilador

Al escribir el cobro se dieron por supuestas dos formas de DTO —
`r.redemption.id` y `montoCentavos`. `tsc` paró las dos: son `redemptionId` y
`amount`.

Es exactamente para lo que existe `packages/contracts`. Escritas a mano en el
satélite, esas dos suposiciones habrían compilado, se habrían desplegado, y
habrían fallado contra el Core de verdad.

**Y volvió a pasar con la reconciliación, de una forma peor.** Se escribió
`cliente.name` y `cliente.phone`; el DTO dice `nombre` y `telefono`.

Lo grave no es el error: es que el **Core de mentira del script de verificación
lo escribí yo, con la misma equivocación**. Devolvía `name`/`phone`, así que las
22 comprobaciones pasaron en verde con el campo mal. Contra el Core real, cada
reconciliación habría escrito `undefined` en el nombre de cada cliente.

Lo paró `tsc`, porque el doble no está tipado contra mi memoria sino contra el
contrato.

> Un doble escrito por quien se equivoca le da la razón. Es el límite de
> verificar con dobles, y la razón de que el contrato compartido no sea
> opcional.

### Y lo que encontró la base real

El cerrojo de la tarea programada se escribió con `pg_try_advisory_lock`. En las
pruebas con dobles pasaba; contra PostgreSQL con el pool de Prisma se vio que
tomar y soltar pueden caer en conexiones distintas.

Se cambió por un arrendamiento en una fila. **Ningún análisis del código lo
habría enseñado**: la llamada es correcta, la que no encaja es la combinación
con el pool.

Además, una comprobación pasó en verde con el Core de mentira ya cerrado —
`corrio: true` no significa que hiciera nada—. Se añadió la que faltaba:
`fallidas === 0`.

---

## Lo que falta

| Pieza | Estado |
|---|---|
| Base propia, proyección, inbox, firma, SSO | ✅ |
| Verificado contra Postgres y HTTP reales | ✅ |
| **Interfaz del restaurante** | 🔴 No hay pantallas: el dominio y la integración están, la operación se maneja por HTTP |
| **Reconciliación** | ✅ Barrido priorizado, con presupuesto y señal de si se queda atrás |
| **Programarla** | ✅ `POST /tareas/reconciliar` con secreto, cerrojo por arrendamiento y aviso si se queda atrás |
| **Despliegue separado** | 🔴 Vive en el monorepo. Sacarlo a su repositorio es el siguiente paso natural |

> Lo que queda es de producto y de despliegue, no de arquitectura. El circuito
> completo —recibir, ordenar, deduplicar, reconciliar y programarlo— está cerrado
> y verificado contra base y HTTP reales.
